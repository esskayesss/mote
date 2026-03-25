export const EVENTS_CHANNEL_NAME = "meeting.events";

export const AI_EVENT_TYPES = [
  "agenda.nudge",
  "fact_check.private",
  "correction.private",
  "speaker.coaching.private"
] as const;

export const DEFAULT_ROOM_CAPACITY = 12;

export const DEFAULT_AGENDA_TOPICS = [
  "Define the FileBackedNotesManager class responsibilities and public API",
  "Plan read and write flows for opening, creating, and updating note files",
  "Handle path validation, file errors, and recovery behavior",
  "Design tests for temporary directories, missing files, and corrupted input",
  "Agree on next implementation steps and ownership"
] as const;

export type ParticipantStatus = "live" | "waiting" | "offline";
export type ParticipantRole = "host" | "guest";

export interface RoomParticipant {
  id: string;
  displayName: string;
  role: ParticipantRole;
  joinedAt: string;
}

export interface ParticipantMediaState {
  participantId: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export interface TranscriptSegmentPayload {
  text: string;
  speakerParticipantId?: string | null;
  speakerDisplayName?: string | null;
}

export type AgendaExecutionStatus = "pending" | "active" | "completed";

export interface AgendaArtifactSubtopic {
  id: string;
  order: number;
  title: string;
  status?: AgendaExecutionStatus;
}

export interface AgendaArtifactPoint {
  id: string;
  order: number;
  title: string;
  objective: string;
  subtopics: AgendaArtifactSubtopic[];
  status?: AgendaExecutionStatus;
  talkingPoints: string[];
  successSignals: string[];
  estimatedDurationMinutes: number;
  ownerHint?: string | null;
  dependencies?: string[];
  tags: string[];
}

export interface AgendaArtifact {
  kind: "agenda.v1";
  locked: true;
  generatedAt: string;
  sourcePrompt: string[];
  meetingIntent: string;
  summary: string;
  points: AgendaArtifactPoint[];
}

export interface RefineAgendaRequest {
  agenda: string[];
  roomCode?: string;
  meetingTitle?: string;
  meetingGoal?: string;
}

export interface RefineAgendaResponse {
  artifact: AgendaArtifact;
  source: "model" | "fallback";
}

export type MeetingEventType =
  | "presence.joined"
  | "presence.left"
  | "chat.message"
  | "agenda.updated"
  | "transcript.partial"
  | "participant.media_state"
  | "moderation.media_state_changed"
  | "moderation.participant_removed"
  | "transcript.final";

export type MeetingEventScope = "room" | "participant" | "system";

export interface BaseMeetingEvent<TType extends MeetingEventType, TPayload> {
  id: string;
  roomCode: string;
  type: TType;
  scope: MeetingEventScope;
  actorParticipantId: string | null;
  targetParticipantId: string | null;
  createdAt: string;
  persisted: boolean;
  payload: TPayload;
}

export type PresenceJoinedEvent = BaseMeetingEvent<
  "presence.joined",
  { participant: RoomParticipant }
>;

export type PresenceLeftEvent = BaseMeetingEvent<
  "presence.left",
  { participantId: string }
>;

export type ChatMessageEvent = BaseMeetingEvent<
  "chat.message",
  { message: string }
>;

export type AgendaUpdatedEvent = BaseMeetingEvent<
  "agenda.updated",
  { agenda: string[]; agendaArtifact?: AgendaArtifact | null }
>;

export type ParticipantMediaStateEvent = BaseMeetingEvent<
  "participant.media_state",
  ParticipantMediaState
>;

export type ModerationMediaStateChangedEvent = BaseMeetingEvent<
  "moderation.media_state_changed",
  ParticipantMediaState & { reason?: string }
>;

export type ModerationParticipantRemovedEvent = BaseMeetingEvent<
  "moderation.participant_removed",
  { participantId: string; reason?: string }
>;

export type TranscriptFinalEvent = BaseMeetingEvent<
  "transcript.final",
  TranscriptSegmentPayload
>;

export type TranscriptPartialEvent = BaseMeetingEvent<
  "transcript.partial",
  TranscriptSegmentPayload
>;

export type MeetingEvent =
  | PresenceJoinedEvent
  | PresenceLeftEvent
  | ChatMessageEvent
  | AgendaUpdatedEvent
  | TranscriptPartialEvent
  | ParticipantMediaStateEvent
  | ModerationMediaStateChangedEvent
  | ModerationParticipantRemovedEvent
  | TranscriptFinalEvent;

export interface MeetingSnapshot {
  room: RoomSummary;
  recentEvents: MeetingEvent[];
  participantMediaStates: ParticipantMediaState[];
}

export type MeetingClientAction =
  | {
      action: "chat.send";
      message: string;
    }
  | {
      action: "agenda.update";
      agenda: string[];
    }
  | {
      action: "participant.media_state";
      audioEnabled: boolean;
      videoEnabled: boolean;
    }
  | {
      action: "moderation.set_media_state";
      targetParticipantId: string;
      audioEnabled?: boolean;
      videoEnabled?: boolean;
      reason?: string;
    }
  | {
      action: "moderation.remove_participant";
      targetParticipantId: string;
      reason?: string;
    };

export type MeetingServerMessage =
  | {
      type: "snapshot";
      snapshot: MeetingSnapshot;
    }
  | {
      type: "event";
      event: MeetingEvent;
    }
  | {
      type: "error";
      message: string;
    };

export interface RoomSummary {
  code: string;
  capacity: number;
  createdAt: string;
  agenda: string[];
  agendaArtifact?: AgendaArtifact | null;
  participants: RoomParticipant[];
}

export interface CreateRoomInput {
  displayName: string;
  agenda?: string[];
}

export interface JoinRoomInput {
  displayName: string;
}

export interface IceServerDefinition {
  urls: string[];
  username?: string;
  credential?: string;
  credentialType?: "password";
}

export interface IceServerBundle {
  servers: IceServerDefinition[];
  expiresAt: string | null;
  ttlSeconds: number;
}

export interface RoomResponseEnvelope {
  room: RoomSummary;
  agenda: string[];
  transcription: {
    provider: "whisperlive";
    model: string;
    language: string;
    sampleRate: number;
    mode: "realtime";
    transport: "websocket";
    url: string;
  };
  transport: {
    media: "mediasoup";
    events: "websocket";
  };
  ice: IceServerBundle;
}

export interface CreateRoomResponse extends RoomResponseEnvelope {
  participantId: string;
}

export interface JoinRoomResponse extends RoomResponseEnvelope {
  participantId: string;
}

export const createParticipantName = (index: number) => `Participant ${index}`;
