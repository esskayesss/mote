import type {
  AgendaArtifact,
  AgendaUpdatedEvent,
  ChatMessageEvent,
  MeetingClientAction,
  MeetingEvent,
  MeetingServerMessage,
  MeetingSnapshot,
  ModerationMediaStateChangedEvent,
  ModerationParticipantRemovedEvent,
  ParticipantMediaStateEvent,
  PresenceJoinedEvent,
  PresenceLeftEvent,
  TranscriptPartialEvent,
  TranscriptFinalEvent
} from "@mote/models";
import type { AppSocket } from "../media/runtime";
import type { RoomStore } from "../store/room-store";

const sendSocket = (socket: AppSocket, payload: MeetingServerMessage) =>
  socket.send(JSON.stringify(payload));

const parseMessage = (rawMessage: unknown) => {
  if (typeof rawMessage === "string") {
    return rawMessage;
  }

  if (rawMessage instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(rawMessage));
  }

  if (ArrayBuffer.isView(rawMessage)) {
    return new TextDecoder().decode(rawMessage);
  }

  if (typeof rawMessage === "object" && rawMessage !== null) {
    return JSON.stringify(rawMessage);
  }

  return null;
};

export class EventsRuntime {
  private roomSockets = new Map<string, Map<string, AppSocket>>();

  constructor(private readonly roomStore: RoomStore) {}

  private getRoomSockets(roomCode: string) {
    let sockets = this.roomSockets.get(roomCode);

    if (!sockets) {
      sockets = new Map();
      this.roomSockets.set(roomCode, sockets);
    }

    return sockets;
  }

  private buildEvent<TEvent extends MeetingEvent>(
    event: Omit<TEvent, "id" | "createdAt" | "persisted">
  ): TEvent {
    return {
      ...event,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      persisted: true
    } as TEvent;
  }

  private emit(roomCode: string, event: MeetingEvent, excludeParticipantId?: string) {
    const sockets = this.roomSockets.get(roomCode);

    if (!sockets) {
      return;
    }

    for (const [participantId, socket] of sockets.entries()) {
      if (participantId === excludeParticipantId) {
        continue;
      }

      if (socket.readyState === WebSocket.OPEN) {
        sendSocket(socket, { type: "event", event });
      }
    }
  }

  private publish(event: MeetingEvent, options?: { excludeParticipantId?: string; persist?: boolean }) {
    if (options?.persist !== false && event.persisted) {
      this.roomStore.appendEvent(event);
    }

    this.emit(event.roomCode, event, options?.excludeParticipantId);
    return event;
  }

  private snapshot(roomCode: string): MeetingSnapshot {
    const room = this.roomStore.getRoom(roomCode);

    if (!room) {
      throw new Error("Room not found.");
    }

    return {
      room,
      recentEvents: this.roomStore.listRecentEvents(roomCode, 100).reverse(),
      participantMediaStates: this.roomStore.listLatestParticipantMediaStates(roomCode)
    };
  }

  private ensureHost(roomCode: string, participantId: string) {
    const participant = this.roomStore.getParticipant(roomCode, participantId);

    if (!participant || participant.role !== "host") {
      throw new Error("Only the host can perform this action.");
    }
  }

  attachSocket(roomCode: string, participantId: string, socket: AppSocket) {
    this.getRoomSockets(roomCode).set(participantId, socket);
    return this.snapshot(roomCode);
  }

  closeSocket(roomCode: string, participantId: string) {
    const sockets = this.roomSockets.get(roomCode);
    sockets?.delete(participantId);

    if (sockets?.size === 0) {
      this.roomSockets.delete(roomCode);
    }
  }

  publishPresenceJoined(roomCode: string, participant: PresenceJoinedEvent["payload"]["participant"]) {
    const event = this.buildEvent<PresenceJoinedEvent>({
      roomCode,
      type: "presence.joined",
      scope: "room",
      actorParticipantId: participant.id,
      targetParticipantId: null,
      payload: { participant }
    });

    return this.publish(event, { persist: false, excludeParticipantId: participant.id });
  }

  publishPresenceLeft(roomCode: string, participantId: string) {
    const event = this.buildEvent<PresenceLeftEvent>({
      roomCode,
      type: "presence.left",
      scope: "room",
      actorParticipantId: participantId,
      targetParticipantId: participantId,
      payload: { participantId }
    });

    return this.publish(event, { persist: false });
  }

  publishAgendaUpdated(
    roomCode: string,
    agenda: string[],
    agendaArtifact: AgendaArtifact | null,
    actorParticipantId: string | null = null
  ) {
    const event = this.buildEvent<AgendaUpdatedEvent>({
      roomCode,
      type: "agenda.updated",
      scope: "room",
      actorParticipantId,
      targetParticipantId: null,
      payload: {
        agenda,
        agendaArtifact
      }
    });

    return this.publish(event);
  }

  publishTranscriptSegment(
    roomCode: string,
    participantId: string,
    text: string,
    stage: "partial" | "final"
  ) {
    const normalizedText = text.trim().slice(0, 5_000);

    if (!normalizedText) {
      throw new Error("Transcript text is required.");
    }

    const participant = this.roomStore.getParticipant(roomCode, participantId);
    const payload = {
      text: normalizedText,
      speakerParticipantId: participantId,
      speakerDisplayName: participant?.display_name ?? null
    };

    if (stage === "partial") {
      const event = this.buildEvent<TranscriptPartialEvent>({
        roomCode,
        type: "transcript.partial",
        scope: "room",
        actorParticipantId: participantId,
        targetParticipantId: null,
        payload
      });

      return this.publish(event, { persist: false });
    }

    const event = this.buildEvent<TranscriptFinalEvent>({
      roomCode,
      type: "transcript.final",
      scope: "room",
      actorParticipantId: participantId,
      targetParticipantId: null,
      payload
    });

    return this.publish(event);
  }

  async handleMessage(roomCode: string, participantId: string, socket: AppSocket, rawMessage: unknown) {
    const parsed = parseMessage(rawMessage);

    if (!parsed) {
      sendSocket(socket, { type: "error", message: "Unsupported event payload." });
      return;
    }

    let message: MeetingClientAction;

    try {
      message = JSON.parse(parsed) as MeetingClientAction;
    } catch {
      sendSocket(socket, { type: "error", message: "Invalid event payload." });
      return;
    }

    try {
      switch (message.action) {
        case "chat.send": {
          const event = this.buildEvent<ChatMessageEvent>({
            roomCode,
            type: "chat.message",
            scope: "room",
            actorParticipantId: participantId,
            targetParticipantId: null,
            payload: {
              message: message.message.trim().slice(0, 2_000)
            }
          });

          if (!event.payload.message) {
            throw new Error("Message is required.");
          }

          this.publish(event);
          break;
        }

        case "agenda.update": {
          throw new Error("Agenda source of truth is locked for this meeting.");
        }

        case "participant.media_state": {
          const event = this.buildEvent<ParticipantMediaStateEvent>({
            roomCode,
            type: "participant.media_state",
            scope: "room",
            actorParticipantId: participantId,
            targetParticipantId: participantId,
            payload: {
              participantId,
              audioEnabled: message.audioEnabled,
              videoEnabled: message.videoEnabled
            }
          });

          this.publish(event);
          break;
        }

        case "moderation.set_media_state": {
          this.ensureHost(roomCode, participantId);

          const targetParticipant = this.roomStore.getParticipant(roomCode, message.targetParticipantId);

          if (!targetParticipant) {
            throw new Error("Target participant not found.");
          }

          const latestStates = new Map(
            this.roomStore
              .listLatestParticipantMediaStates(roomCode)
              .map((state) => [state.participantId, state] as const)
          );
          const currentState = latestStates.get(message.targetParticipantId) ?? {
            participantId: message.targetParticipantId,
            audioEnabled: true,
            videoEnabled: true
          };

          const nextState = {
            participantId: message.targetParticipantId,
            audioEnabled: message.audioEnabled ?? currentState.audioEnabled,
            videoEnabled: message.videoEnabled ?? currentState.videoEnabled
          };

          const moderationEvent = this.buildEvent<ModerationMediaStateChangedEvent>({
            roomCode,
            type: "moderation.media_state_changed",
            scope: "participant",
            actorParticipantId: participantId,
            targetParticipantId: message.targetParticipantId,
            payload: {
              ...nextState,
              reason: message.reason?.trim() || undefined
            }
          });
          const stateEvent = this.buildEvent<ParticipantMediaStateEvent>({
            roomCode,
            type: "participant.media_state",
            scope: "participant",
            actorParticipantId: message.targetParticipantId,
            targetParticipantId: message.targetParticipantId,
            payload: nextState
          });

          this.publish(moderationEvent);
          this.publish(stateEvent);
          break;
        }

        case "moderation.remove_participant": {
          this.ensureHost(roomCode, participantId);

          const removedParticipant = this.roomStore.removeParticipant(roomCode, message.targetParticipantId);

          if (!removedParticipant) {
            throw new Error("Target participant not found.");
          }

          const removalEvent = this.buildEvent<ModerationParticipantRemovedEvent>({
            roomCode,
            type: "moderation.participant_removed",
            scope: "participant",
            actorParticipantId: participantId,
            targetParticipantId: message.targetParticipantId,
            payload: {
              participantId: message.targetParticipantId,
              reason: message.reason?.trim() || undefined
            }
          });

          const sockets = this.roomSockets.get(roomCode);
          const targetSocket = sockets?.get(message.targetParticipantId);
          this.publish(removalEvent);
          this.publishPresenceLeft(roomCode, message.targetParticipantId);
          targetSocket?.close(4001, "Removed by host");
          this.closeSocket(roomCode, message.targetParticipantId);
          break;
        }

      }
    } catch (error) {
      sendSocket(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Event handling failed."
      });
    }
  }
}
