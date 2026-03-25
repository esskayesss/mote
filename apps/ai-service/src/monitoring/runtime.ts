import type {
  AgendaArtifact,
  AgendaExecutionStatus,
  AgendaStatusPatch,
  FactCheckItem,
  RoomResponseEnvelope
} from "@mote/models";
import { logger } from "../logger";
import type { OpenAiChatCompletionsTool } from "../tools/llm/openai-chat-completions-tool";
import type { BackendTranscriptPublisher } from "../transcription/backend-publisher";

interface BufferedTranscriptSegment {
  participantId: string;
  text: string;
  createdAt: string;
}

interface RoomMonitorState {
  segments: BufferedTranscriptSegment[];
  livePartials: Map<string, BufferedTranscriptSegment>;
  agendaIntervalId: ReturnType<typeof setInterval>;
  factCheckIntervalId: ReturnType<typeof setInterval>;
  lastAgendaInputSignature: string | null;
  lastAgendaProcessedAt: string | null;
  lastFactCheckInputSignature: string | null;
  lastFactCheckProcessedAt: string | null;
  recentFactChecks: Array<{
    signature: string;
    emittedAt: string;
  }>;
}

type MonitoringIngressMessage =
  | {
      type: "transcript.final";
      roomCode: string;
      participantId: string;
      text: string;
      createdAt: string;
    }
  | {
      type: "transcript.partial";
      roomCode: string;
      participantId: string;
      text: string;
      createdAt: string;
    };

type MonitoringWorkMessage =
  | {
      type: "agenda_status_tick";
      roomCode: string;
    }
  | {
      type: "fact_check_tick";
      roomCode: string;
    };

type MonitoringOutboundMessage =
  | {
      type: "agenda_status_patch";
      roomCode: string;
      patch: AgendaStatusPatch;
      windowStartedAt: string;
      windowEndedAt: string;
    }
  | {
      type: "fact_check_event";
      roomCode: string;
      targetParticipantId?: string;
      windowStartedAt: string;
      windowEndedAt: string;
      items: FactCheckItem[];
    };

const AGENDA_STATUS_INTERVAL_MS = 5_000;
const FACT_CHECK_INTERVAL_MS = 5_000;
const SEGMENT_RETENTION_MS = 10 * 60_000;
const FACT_CHECK_DEDUP_TTL_MS = 3 * 60_000;

const createQueue = <TMessage>() => {
  const items: TMessage[] = [];
  let waitingResolver: ((message: TMessage) => void) | null = null;

  return {
    enqueue(message: TMessage) {
      if (waitingResolver) {
        const resolve = waitingResolver;
        waitingResolver = null;
        resolve(message);
        return;
      }

      items.push(message);
    },
    async dequeue() {
      if (items.length > 0) {
        return items.shift() as TMessage;
      }

      return await new Promise<TMessage>((resolve) => {
        waitingResolver = resolve;
      });
    }
  };
};

const statusSignature = (artifact: AgendaArtifact) =>
  JSON.stringify(
    artifact.points.map((point) => ({
      id: point.id,
      status: point.status ?? "pending",
      subtopics: point.subtopics.map((subtopic) => ({
        id: subtopic.id,
        status: subtopic.status ?? "pending"
      }))
    }))
  );

const factCheckSignature = (items: FactCheckItem[]) =>
  JSON.stringify(items.map((item) => [item.claim, item.correction, item.severity]));

const normalizeFactCheckText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const factCheckItemSignature = (item: FactCheckItem) =>
  JSON.stringify([
    item.severity,
    normalizeFactCheckText(item.claim),
    normalizeFactCheckText(item.correction)
  ]);

type PresenterSentence = {
  participantId: string;
  createdAt: string;
  text: string;
};

const FOCUS_SENTENCE_COUNT = 6;
const COVERAGE_SENTENCE_COUNT = 18;
const FACT_CHECK_SENTENCE_COUNT = 28;

const splitIntoSentences = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

export class MeetingMonitoringRuntime {
  private readonly roomStates = new Map<string, RoomMonitorState>();
  private readonly ingressQueue = createQueue<MonitoringIngressMessage>();
  private readonly workQueue = createQueue<MonitoringWorkMessage>();
  private readonly outboundQueue = createQueue<MonitoringOutboundMessage>();
  private readonly queuedAgendaTicks = new Set<string>();
  private readonly queuedFactCheckTicks = new Set<string>();

  constructor(
    private readonly backendUrl: string,
    private readonly publisher: BackendTranscriptPublisher,
    private readonly llmTool: OpenAiChatCompletionsTool
  ) {
    void this.processIngressLoop();
    void this.processWorkLoop();
    void this.processOutboundLoop();
  }

  observeFinalTranscript(roomCode: string, participantId: string, text: string) {
    const normalizedText = text.trim();

    if (!normalizedText) {
      return;
    }

    this.ensureRoomState(roomCode);
    this.ingressQueue.enqueue({
      type: "transcript.final",
      roomCode,
      participantId,
      text: normalizedText,
      createdAt: new Date().toISOString()
    });
  }

  observePartialTranscript(roomCode: string, participantId: string, text: string) {
    const normalizedText = text.trim();

    if (!normalizedText) {
      return;
    }

    this.ensureRoomState(roomCode);
    this.ingressQueue.enqueue({
      type: "transcript.partial",
      roomCode,
      participantId,
      text: normalizedText,
      createdAt: new Date().toISOString()
    });
  }

  closeRoom(roomCode: string) {
    const state = this.roomStates.get(roomCode);

    if (!state) {
      return;
    }

    clearInterval(state.agendaIntervalId);
    clearInterval(state.factCheckIntervalId);
    this.roomStates.delete(roomCode);
    this.queuedAgendaTicks.delete(roomCode);
    this.queuedFactCheckTicks.delete(roomCode);
  }

  private ensureRoomState(roomCode: string) {
    const existing = this.roomStates.get(roomCode);

    if (existing) {
      return existing;
    }

    const state: RoomMonitorState = {
      segments: [],
      livePartials: new Map(),
      agendaIntervalId: setInterval(() => {
        this.enqueueAgendaTick(roomCode);
      }, AGENDA_STATUS_INTERVAL_MS),
      factCheckIntervalId: setInterval(() => {
        this.enqueueFactCheckTick(roomCode);
      }, FACT_CHECK_INTERVAL_MS),
      lastAgendaInputSignature: null,
      lastAgendaProcessedAt: null,
      lastFactCheckInputSignature: null,
      lastFactCheckProcessedAt: null,
      recentFactChecks: []
    };

    this.roomStates.set(roomCode, state);
    return state;
  }

  private enqueueAgendaTick(roomCode: string) {
    if (this.queuedAgendaTicks.has(roomCode)) {
      return;
    }

    this.queuedAgendaTicks.add(roomCode);
    this.workQueue.enqueue({
      type: "agenda_status_tick",
      roomCode
    });
  }

  private enqueueFactCheckTick(roomCode: string) {
    if (this.queuedFactCheckTicks.has(roomCode)) {
      return;
    }

    this.queuedFactCheckTicks.add(roomCode);
    this.workQueue.enqueue({
      type: "fact_check_tick",
      roomCode
    });
  }

  private pruneSegments(state: RoomMonitorState) {
    const threshold = Date.now() - SEGMENT_RETENTION_MS;
    state.segments = state.segments.filter(
      (segment) => new Date(segment.createdAt).getTime() >= threshold
    );
  }

  private pruneRecentFactChecks(state: RoomMonitorState) {
    const threshold = Date.now() - FACT_CHECK_DEDUP_TTL_MS;
    state.recentFactChecks = state.recentFactChecks.filter(
      (item) => new Date(item.emittedAt).getTime() >= threshold
    );
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

  private buildPresenterWindows(
    state: RoomMonitorState,
    room: RoomResponseEnvelope["room"],
    sinceCreatedAt: string | null = null
  ) {
    const presenterIds = new Set(
      room.participants
        .filter((participant) => participant.isPresenter)
        .map((participant) => participant.id)
    );

    if (presenterIds.size === 0) {
      return null;
    }

    const presenterSegments = state.segments.filter(
      (segment) =>
        presenterIds.has(segment.participantId) &&
        new Date(segment.createdAt).getTime() >= Date.now() - SEGMENT_RETENTION_MS
    );
    const livePresenterSegments = Array.from(state.livePartials.values()).filter((segment) =>
      presenterIds.has(segment.participantId)
    );
    const allPresenterSegments = [...presenterSegments, ...livePresenterSegments].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    );

    if (allPresenterSegments.length === 0) {
      return null;
    }

    const hasFreshTranscript = allPresenterSegments.some((segment) =>
      sinceCreatedAt ? segment.createdAt > sinceCreatedAt : true
    );

    if (!hasFreshTranscript) {
      return null;
    }

    const sentences: PresenterSentence[] = allPresenterSegments.flatMap((segment) =>
      splitIntoSentences(segment.text).map((text) => ({
        participantId: segment.participantId,
        createdAt: segment.createdAt,
        text
      }))
    );

    if (sentences.length === 0) {
      return null;
    }

    const formatSentence = (sentence: PresenterSentence) => {
      const speaker =
        room.participants.find((participant) => participant.id === sentence.participantId)
          ?.displayName ?? "Presenter";
      return `${speaker}: ${sentence.text}`;
    };

    const focusSentences = sentences.slice(-FOCUS_SENTENCE_COUNT);
    const coverageSentences = sentences.slice(-COVERAGE_SENTENCE_COUNT);
    const factCheckSentences = sentences.slice(-FACT_CHECK_SENTENCE_COUNT);

    return {
      startedAt:
        coverageSentences[0]?.createdAt ??
        allPresenterSegments[0]?.createdAt ??
        new Date().toISOString(),
      endedAt:
        allPresenterSegments[allPresenterSegments.length - 1]?.createdAt ??
        new Date().toISOString(),
      focusTranscriptWindow: focusSentences.map(formatSentence).join("\n").trim(),
      coverageTranscriptWindow: coverageSentences.map(formatSentence).join("\n").trim(),
      factCheckTranscriptWindow: factCheckSentences.map(formatSentence).join("\n").trim()
    };
  }

  private normalizeAgendaPatch(
    artifact: AgendaArtifact,
    evaluation: {
      activeTarget: {
        kind: "point" | "subtopic";
        id: string;
      } | null;
      points: Array<{
        id: string;
        status: AgendaExecutionStatus;
        subtopics: Array<{
          id: string;
          status: AgendaExecutionStatus;
        }>;
      }>;
    }
  ): AgendaStatusPatch {
    const pointPatchMap = new Map(evaluation.points.map((point) => [point.id, point]));
    const activeTarget = evaluation.activeTarget;

    return {
      points: artifact.points.map((point) => {
        const pointPatch = pointPatchMap.get(point.id);
        const subtopicPatchMap = new Map(
          (pointPatch?.subtopics ?? []).map((subtopic) => [subtopic.id, subtopic.status] as const)
        );
        const normalizedSubtopicStatuses = point.subtopics.map((subtopic) => {
          const previousStatus = subtopic.status ?? "pending";
          const requestedStatus = subtopicPatchMap.get(subtopic.id) ?? previousStatus;

          if (activeTarget?.kind === "subtopic" && activeTarget.id === subtopic.id) {
            return "active";
          }

          if (previousStatus === "completed") {
            return "completed";
          }

          if (requestedStatus === "completed") {
            return "completed";
          }

          if (
            previousStatus === "partially_completed" ||
            previousStatus === "active" ||
            requestedStatus === "partially_completed" ||
            requestedStatus === "active"
          ) {
            return "partially_completed";
          }

          return "pending";
        }) as AgendaExecutionStatus[];

        const previousPointStatus = point.status ?? "pending";
        const requestedPointStatus = pointPatch?.status ?? previousPointStatus;
        const hasActiveSubtopic = normalizedSubtopicStatuses.includes("active");
        const hasProgressSubtopic = normalizedSubtopicStatuses.some(
          (status) => status === "active" || status === "partially_completed" || status === "completed"
        );
        const allSubtopicsCompleted =
          point.subtopics.length > 0 &&
          normalizedSubtopicStatuses.every((status) => status === "completed");
        const pointLostFocus =
          previousPointStatus === "active" &&
          activeTarget !== null &&
          !(
            (activeTarget.kind === "point" && activeTarget.id === point.id) ||
            (activeTarget.kind === "subtopic" &&
              point.subtopics.some((subtopic) => subtopic.id === activeTarget.id))
          );

        let normalizedPointStatus: AgendaExecutionStatus = "pending";

        if (activeTarget?.kind === "point" && activeTarget.id === point.id) {
          normalizedPointStatus = "active";
        } else if (pointLostFocus && (hasProgressSubtopic || point.subtopics.length === 0)) {
          normalizedPointStatus = "completed";
        } else if (previousPointStatus === "completed" || requestedPointStatus === "completed" || allSubtopicsCompleted) {
          normalizedPointStatus = "completed";
        } else if (
          previousPointStatus === "partially_completed" ||
          previousPointStatus === "active" ||
          requestedPointStatus === "partially_completed" ||
          requestedPointStatus === "active" ||
          hasActiveSubtopic ||
          hasProgressSubtopic
        ) {
          normalizedPointStatus = "partially_completed";
        }

        return {
          id: point.id,
          status: normalizedPointStatus,
          subtopics: point.subtopics.map((subtopic, index) => ({
            id: subtopic.id,
            status: normalizedSubtopicStatuses[index] ?? "pending"
          }))
        };
      })
    };
  }

  private patchChangesArtifact(artifact: AgendaArtifact, patch: AgendaStatusPatch) {
    return (
      JSON.stringify(patch.points) !==
      JSON.stringify(
        artifact.points.map((point) => ({
          id: point.id,
          status: point.status ?? "pending",
          subtopics: point.subtopics.map((subtopic) => ({
            id: subtopic.id,
            status: subtopic.status ?? "pending"
          }))
        }))
      )
    );
  }

  private async processIngressLoop() {
    while (true) {
      const message = await this.ingressQueue.dequeue();

      const state = this.ensureRoomState(message.roomCode);

      if (message.type === "transcript.partial") {
        state.livePartials.set(message.participantId, {
          participantId: message.participantId,
          text: message.text,
          createdAt: message.createdAt
        });
        continue;
      }

      state.livePartials.delete(message.participantId);
      state.segments.push({
        participantId: message.participantId,
        text: message.text,
        createdAt: message.createdAt
      });
      this.pruneSegments(state);
    }
  }

  private async processWorkLoop() {
    while (true) {
      const message = await this.workQueue.dequeue();

      try {
        if (message.type === "agenda_status_tick") {
          await this.handleAgendaStatusTick(message.roomCode);
        } else {
          await this.handleFactCheckTick(message.roomCode);
        }
      } catch (error) {
        logger.error("monitoring.work_failed", {
          roomCode: message.roomCode,
          workType: message.type,
          error
        });
      } finally {
        if (message.type === "agenda_status_tick") {
          this.queuedAgendaTicks.delete(message.roomCode);
        } else {
          this.queuedFactCheckTicks.delete(message.roomCode);
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
            windowStartedAt: message.windowStartedAt,
            windowEndedAt: message.windowEndedAt
          });
        } else {
          await this.publisher.publishFactCheckEvent({
            roomCode: message.roomCode,
            targetParticipantId: message.targetParticipantId,
            windowStartedAt: message.windowStartedAt,
            windowEndedAt: message.windowEndedAt,
            items: message.items
          });
          logger.info("fact_check.generated", {
            roomCode: message.roomCode,
            targetParticipantId: message.targetParticipantId ?? null,
            itemCount: message.items.length
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

  private async handleAgendaStatusTick(roomCode: string) {
    const state = this.roomStates.get(roomCode);

    if (!state) {
      return;
    }

    this.pruneSegments(state);
    const room = await this.loadRoom(roomCode);

    if (!room) {
      this.closeRoom(roomCode);
      return;
    }

    if (!room.agendaArtifact?.points.length) {
      return;
    }

    const window = this.buildPresenterWindows(state, room, state.lastAgendaProcessedAt);

    if (!window?.focusTranscriptWindow || !window.coverageTranscriptWindow) {
      return;
    }

    const inputSignature = JSON.stringify({
      focusTranscriptWindow: window.focusTranscriptWindow,
      coverageTranscriptWindow: window.coverageTranscriptWindow,
      currentStatuses: statusSignature(room.agendaArtifact)
    });

    if (state.lastAgendaInputSignature === inputSignature) {
      return;
    }

    const evaluation = await this.llmTool.evaluateAgendaStatuses({
      roomCode,
      meetingTitle: room.meetingTitle ?? room.agendaArtifact.meetingTitle,
      focusTranscriptWindow: window.focusTranscriptWindow,
      coverageTranscriptWindow: window.coverageTranscriptWindow,
      agendaArtifact: room.agendaArtifact
    });
    const patch = this.normalizeAgendaPatch(room.agendaArtifact, evaluation);

    state.lastAgendaInputSignature = inputSignature;
    state.lastAgendaProcessedAt = window.endedAt;
    logger.info("agenda.status_request_resolved", {
      roomCode,
      windowStartedAt: window.startedAt,
      windowEndedAt: window.endedAt,
      activeTarget: evaluation.activeTarget,
      pointStatuses: patch.points.map((point) => ({
        id: point.id,
        status: point.status
      }))
    });

    if (!this.patchChangesArtifact(room.agendaArtifact, patch)) {
      logger.info("agenda.status_request_noop", {
        roomCode,
        windowStartedAt: window.startedAt,
        windowEndedAt: window.endedAt
      });
      return;
    }

    this.outboundQueue.enqueue({
      type: "agenda_status_patch",
      roomCode,
      patch,
      windowStartedAt: window.startedAt,
      windowEndedAt: window.endedAt
    });
  }

  private async handleFactCheckTick(roomCode: string) {
    const state = this.roomStates.get(roomCode);

    if (!state) {
      return;
    }

    this.pruneSegments(state);
    const room = await this.loadRoom(roomCode);

    if (!room) {
      this.closeRoom(roomCode);
      return;
    }

    const window = this.buildPresenterWindows(state, room, state.lastFactCheckProcessedAt);

    if (!window?.factCheckTranscriptWindow) {
      return;
    }

    const inputSignature = JSON.stringify({
      startedAt: window.startedAt,
      endedAt: window.endedAt,
      transcriptWindow: window.factCheckTranscriptWindow
    });

    if (state.lastFactCheckInputSignature === inputSignature) {
      return;
    }

    state.lastFactCheckInputSignature = inputSignature;
    state.lastFactCheckProcessedAt = window.endedAt;
    const items = await this.llmTool.factCheckTranscriptWindow({
      roomCode,
      meetingTitle: room.meetingTitle ?? room.agendaArtifact?.meetingTitle ?? null,
      transcriptWindow: window.factCheckTranscriptWindow
    });
    logger.info("fact_check.request_resolved", {
      roomCode,
      windowStartedAt: window.startedAt,
      windowEndedAt: window.endedAt,
      itemCount: items.length,
      items: items.map((item) => ({
        severity: item.severity,
        claim: item.claim
      }))
    });

    if (items.length === 0) {
      return;
    }

    this.pruneRecentFactChecks(state);
    const seenSignatures = new Set(state.recentFactChecks.map((item) => item.signature));
    const unseenItems = items.filter((item) => !seenSignatures.has(factCheckItemSignature(item)));

    if (unseenItems.length === 0) {
      logger.info("fact_check.request_suppressed", {
        roomCode,
        windowStartedAt: window.startedAt,
        windowEndedAt: window.endedAt,
        reason: "duplicate_items"
      });
      return;
    }

    const outputSignature = factCheckSignature(unseenItems);
    const targetParticipantId =
      room.participants.find((participant) => participant.role === "host")?.id;
    state.recentFactChecks.push(
      ...unseenItems.map((item) => ({
        signature: factCheckItemSignature(item),
        emittedAt: window.endedAt
      }))
    );

    this.outboundQueue.enqueue({
      type: "fact_check_event",
      roomCode,
      targetParticipantId,
      windowStartedAt: window.startedAt,
      windowEndedAt: window.endedAt,
      items: unseenItems
    });
    logger.info("fact_check.request_enqueued", {
      roomCode,
      windowStartedAt: window.startedAt,
      windowEndedAt: window.endedAt,
      itemCount: unseenItems.length,
      outputSignature
    });
  }
}
