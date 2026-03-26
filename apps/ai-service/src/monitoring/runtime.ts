import type {
  AgendaStatusPatch,
  FactCheckItem,
  RoomResponseEnvelope
} from "@mote/models";
import { logger } from "../logger";
import type { OpenAiChatCompletionsTool } from "../tools/llm/openai-chat-completions-tool";
import type { BackendTranscriptPublisher } from "../transcription/backend-publisher";
import {
  applyHeuristicAgendaProgress,
  applyAgendaStatusPatchLocally,
  normalizeAgendaPatch,
  patchChangesArtifact,
  statusSignature
} from "./agenda";
import {
  createQueue,
  factCheckClaimSignature,
  factCheckCorrectionSignature,
  factCheckItemSignature,
  factCheckTextOverlaps,
  formatMonitorSummary,
  isActionableFactCheck,
  isFactCheckGroundedInTranscript
} from "./helpers";
import {
  buildTranscriptHistory,
  createRoomMonitorState,
  type RoomMonitorState,
  upsertTranscriptTurn
} from "./transcript-history";

type MonitoringIngressMessage =
  | {
      type: "transcript.final";
      roomKey: string;
      roomCode: string;
      participantId: string;
      text: string;
      createdAt: string;
    }
  | {
      type: "transcript.partial";
      roomKey: string;
      roomCode: string;
      participantId: string;
      text: string;
      createdAt: string;
    };

type MonitoringWorkMessage = {
  type: "evaluate_room";
  roomKey: string;
};

type MonitoringOutboundMessage =
  | {
      type: "agenda_status_patch";
      roomCode: string;
      patch: AgendaStatusPatch;
      transcriptTurnCount: number;
    }
  | {
      type: "fact_check_event";
      roomCode: string;
      targetParticipantId: string;
      historyStartedAt: string;
      historyEndedAt: string;
      transcriptTurnCount: number;
      items: FactCheckItem[];
    }
  | {
      type: "chat_message";
      roomCode: string;
      message: string;
      persist?: boolean;
      transcriptTurnCount: number;
    };

export class MeetingMonitoringRuntime {
  private readonly roomStates = new Map<string, RoomMonitorState>();
  private readonly ingressQueue = createQueue<MonitoringIngressMessage>();
  private readonly workQueue = createQueue<MonitoringWorkMessage>();
  private readonly outboundQueue = createQueue<MonitoringOutboundMessage>();

  constructor(
    private readonly backendUrl: string,
    private readonly publisher: BackendTranscriptPublisher,
    private readonly llmTool: OpenAiChatCompletionsTool
  ) {
    void this.processIngressLoop();
    void this.processWorkLoop();
    void this.processOutboundLoop();
  }

  observeFinalTranscript(roomKey: string, roomCode: string, participantId: string, text: string) {
    const normalizedText = text.trim();

    if (!normalizedText) {
      return;
    }

    this.ingressQueue.enqueue({
      type: "transcript.final",
      roomKey,
      roomCode,
      participantId,
      text: normalizedText,
      createdAt: new Date().toISOString()
    });
  }

  observePartialTranscript(roomKey: string, roomCode: string, participantId: string, text: string) {
    const normalizedText = text.trim();

    if (!normalizedText) {
      return;
    }

    this.ingressQueue.enqueue({
      type: "transcript.partial",
      roomKey,
      roomCode,
      participantId,
      text: normalizedText,
      createdAt: new Date().toISOString()
    });
  }

  closeRoom(roomKey: string) {
    this.roomStates.delete(roomKey);
  }

  private ensureRoomState(roomKey: string, roomCode: string) {
    const existing = this.roomStates.get(roomKey);

    if (existing) {
      existing.publicRoomCode = roomCode;
      return existing;
    }

    const state = createRoomMonitorState(roomCode);
    this.roomStates.set(roomKey, state);
    return state;
  }

  private markRoomDirty(roomKey: string, roomCode: string) {
    const state = this.ensureRoomState(roomKey, roomCode);
    state.dirty = true;

    if (!state.evaluationQueued) {
      state.evaluationQueued = true;
      this.workQueue.enqueue({
        type: "evaluate_room",
        roomKey
      });
    }
  }

  private async loadRoom(roomCode: string): Promise<RoomResponseEnvelope["room"] | null> {
    const response = await fetch(`${this.backendUrl}/rooms/${roomCode}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Unable to load room context: ${response.status}`);
    }

    const payload = (await response.json()) as RoomResponseEnvelope;
    return payload.room;
  }

  private async processIngressLoop() {
    while (true) {
      const message = await this.ingressQueue.dequeue();
      const state = this.ensureRoomState(message.roomKey, message.roomCode);
      upsertTranscriptTurn(state.transcriptTurns, message);
      this.markRoomDirty(message.roomKey, message.roomCode);
    }
  }

  private async processWorkLoop() {
    while (true) {
      const message = await this.workQueue.dequeue();

      while (true) {
        const state = this.roomStates.get(message.roomKey);

        if (!state) {
          break;
        }

        state.dirty = false;

        try {
          await this.handleRoomEvaluation(message.roomKey);
        } catch (error) {
          logger.error("monitoring.work_failed", {
            roomKey: message.roomKey,
            workType: message.type,
            error
          });
        }

        const latestState = this.roomStates.get(message.roomKey);

        if (!latestState) {
          break;
        }

        if (!latestState.dirty) {
          latestState.evaluationQueued = false;
          break;
        }
      }
    }
  }

  private async processOutboundLoop() {
    while (true) {
      const message = await this.outboundQueue.dequeue();

      try {
        if (message.type === "agenda_status_patch") {
          await this.publisher.publishAgendaStatusPatch(message.roomCode, message.patch);
          logger.info("agenda.status_patch_applied", {
            roomCode: message.roomCode,
            transcriptTurnCount: message.transcriptTurnCount
          });
        } else if (message.type === "fact_check_event") {
          await this.publisher.publishFactCheckEvent({
            roomCode: message.roomCode,
            targetParticipantId: message.targetParticipantId,
            windowStartedAt: message.historyStartedAt,
            windowEndedAt: message.historyEndedAt,
            items: message.items
          });
          logger.info("fact_check.generated", {
            roomCode: message.roomCode,
            targetParticipantId: message.targetParticipantId,
            itemCount: message.items.length,
            transcriptTurnCount: message.transcriptTurnCount
          });
        } else {
          await this.publisher.publishChatMessage({
            roomCode: message.roomCode,
            message: message.message,
            persist: message.persist
          });
          logger.info("monitoring.chat_published", {
            roomCode: message.roomCode,
            persisted: message.persist ?? false,
            transcriptTurnCount: message.transcriptTurnCount
          });
        }
      } catch (error) {
        logger.error("monitoring.outbound_failed", {
          roomCode: message.roomCode,
          outboundType: message.type,
          error
        });
      }
    }
  }

  private async handleRoomEvaluation(roomKey: string) {
    const state = this.roomStates.get(roomKey);

    if (!state) {
      return;
    }

    const roomCode = state.publicRoomCode;
    const room = await this.loadRoom(roomCode);

    if (!room) {
      this.closeRoom(roomKey);
      return;
    }

    const roomTranscriptHistory = buildTranscriptHistory(room, state.transcriptTurns);
    const presenterTranscriptHistory = buildTranscriptHistory(room, state.transcriptTurns, {
      presenterOnly: true
    });

    if (roomTranscriptHistory.length === 0) {
      return;
    }

    const latestFactCheckFocus = roomTranscriptHistory.slice(-10);
    const factCheckHistory = roomTranscriptHistory;
    const presenterFocus = presenterTranscriptHistory.slice(-10);
    const presenterCoverage = presenterTranscriptHistory;
    const effectiveAgendaArtifact =
      room.agendaArtifact && state.optimisticAgendaPatch
        ? applyAgendaStatusPatchLocally(room.agendaArtifact, state.optimisticAgendaPatch)
        : room.agendaArtifact;
    const currentAgendaStatuses = effectiveAgendaArtifact
      ? statusSignature(effectiveAgendaArtifact)
      : null;
    const inputSignature = JSON.stringify({
      presenterFocus,
      presenterCoverage,
      latestFactCheckFocus,
      factCheckHistory,
      currentAgendaStatuses,
      issuedFactChecks: state.issuedFactChecks.map((item) => item.signature)
    });

    if (state.lastEvaluationSignature === inputSignature) {
      return;
    }

    state.lastEvaluationSignature = inputSignature;

    const agendaEvaluation =
      effectiveAgendaArtifact &&
      effectiveAgendaArtifact.points.length > 0 &&
      presenterFocus.length > 0
        ? await this.llmTool.evaluateAgendaStatuses({
            roomCode,
            meetingTitle: room.meetingTitle ?? effectiveAgendaArtifact.meetingTitle,
            focusTranscriptWindow: presenterFocus.join("\n"),
            coverageTranscriptWindow: presenterCoverage.join("\n"),
            agendaArtifact: effectiveAgendaArtifact
          })
        : null;
    const modelPatch =
      effectiveAgendaArtifact && agendaEvaluation
        ? normalizeAgendaPatch(effectiveAgendaArtifact, agendaEvaluation)
        : null;
    const patch =
      effectiveAgendaArtifact && modelPatch
        ? applyHeuristicAgendaProgress(effectiveAgendaArtifact, modelPatch, presenterTranscriptHistory)
        : null;
    const shouldPublishAgendaPatch =
      effectiveAgendaArtifact && patch ? patchChangesArtifact(effectiveAgendaArtifact, patch) : false;

    if (shouldPublishAgendaPatch && patch) {
      state.optimisticAgendaPatch = patch;
      this.outboundQueue.enqueue({
        type: "agenda_status_patch",
        roomCode,
        patch,
        transcriptTurnCount: roomTranscriptHistory.length
      });
    }

    const returnedFactChecks = await this.llmTool.evaluateFactChecks({
      roomCode,
      meetingTitle: room.meetingTitle ?? effectiveAgendaArtifact?.meetingTitle ?? null,
      latestTranscriptFocus: latestFactCheckFocus,
      transcriptHistory: factCheckHistory,
      issuedFactChecks: state.issuedFactChecks.map((item) => ({
        claim: item.claim,
        correction: item.correction
      }))
    });
    const actionableFactChecks = returnedFactChecks.filter(isActionableFactCheck);
    const transcriptGroundingWindow = factCheckHistory.join("\n");
    const groundedFactChecks = actionableFactChecks.filter((item) =>
      isFactCheckGroundedInTranscript(item, transcriptGroundingWindow)
    );

    logger.info("meeting_state.request_resolved", {
      roomCode,
      transcriptTurnCount: roomTranscriptHistory.length,
      presenterTurnCount: presenterTranscriptHistory.length,
      activeTarget: agendaEvaluation?.activeTarget ?? null,
      pointStatuses: patch?.points.map((point) => ({
        id: point.id,
        status: point.status
      })),
      factCheckCount: groundedFactChecks.length
    });

    const seenSignatures = new Set(state.issuedFactChecks.map((item) => item.signature));
    const seenClaimSignatures = state.issuedFactChecks.map((item) => item.claimSignature);
    const seenCorrectionSignatures = state.issuedFactChecks.map((item) => item.correctionSignature);
    const newFactChecks = groundedFactChecks.filter((item) => {
      const signature = factCheckItemSignature(item);
      const claimSignature = factCheckClaimSignature(item);
      const correctionSignature = factCheckCorrectionSignature(item);

      if (seenSignatures.has(signature)) {
        return false;
      }

      if (
        seenClaimSignatures.some((seen) => factCheckTextOverlaps(seen, claimSignature)) ||
        seenCorrectionSignatures.some((seen) => factCheckTextOverlaps(seen, correctionSignature))
      ) {
        return false;
      }

      seenSignatures.add(signature);
      seenClaimSignatures.push(claimSignature);
      seenCorrectionSignatures.push(correctionSignature);
      return true;
    });

    if (newFactChecks.length > 0) {
      state.issuedFactChecks.push(
        ...newFactChecks.map((item) => ({
          signature: factCheckItemSignature(item),
          claimSignature: factCheckClaimSignature(item),
          correctionSignature: factCheckCorrectionSignature(item),
          emittedAt: new Date().toISOString(),
          claim: item.claim,
          correction: item.correction
        }))
      );

      const targetParticipantId =
        room.participants.find((participant) => participant.isPresenter)?.id ??
        room.participants.find((participant) => participant.role === "host")?.id;

      if (targetParticipantId) {
        this.outboundQueue.enqueue({
          type: "fact_check_event",
          roomCode,
          targetParticipantId,
          historyStartedAt: state.transcriptTurns[0]?.createdAt ?? new Date().toISOString(),
          historyEndedAt:
            state.transcriptTurns[state.transcriptTurns.length - 1]?.createdAt ??
            new Date().toISOString(),
          transcriptTurnCount: roomTranscriptHistory.length,
          items: newFactChecks
        });
      }
    }

    this.outboundQueue.enqueue({
      type: "chat_message",
      roomCode,
      message: formatMonitorSummary({
        agendaArtifact: effectiveAgendaArtifact ?? null,
        activeTarget: agendaEvaluation?.activeTarget ?? null,
        patch,
        transcriptTurnCount: roomTranscriptHistory.length,
        returnedFactCheckCount: returnedFactChecks.length,
        groundedFactCheckCount: groundedFactChecks.length,
        publishedFactCheckCount: newFactChecks.length,
        lastTranscriptLine: roomTranscriptHistory[roomTranscriptHistory.length - 1] ?? null,
        evaluationInput: {
          agendaFocus: presenterFocus.slice(-3),
          agendaCoverageTail: presenterCoverage.slice(-5),
          factCheckFocus: latestFactCheckFocus.slice(-4),
          factCheckHistoryTail: factCheckHistory.slice(-6),
          issuedFactCheckCount: state.issuedFactChecks.length
        },
        agendaEvaluation,
        factCheckEvaluation: returnedFactChecks
      }),
      persist: false,
      transcriptTurnCount: roomTranscriptHistory.length
    });
  }
}
