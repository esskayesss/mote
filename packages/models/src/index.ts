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
export type ParticipantRole = "host" | "participant";
export type ParticipantAuthorityRole = "host" | "admin" | "participant";
export type ParticipantTrackKind = "audio" | "video" | "screen";
export type TranscriptionProvider = "none" | "whisperlive" | "sarvam" | "openai";
export type OpenAiTranscriptionModel =
  | "gpt-4o-mini-transcribe"
  | "gpt-4o-transcribe"
  | "whisper-1";

export interface ParticipantMediaCapabilities {
  publishAudio: boolean;
  publishVideo: boolean;
  publishScreen: boolean;
  subscribeAudio: boolean;
  subscribeVideo: boolean;
  subscribeScreen: boolean;
}

export interface RoomPolicy {
  endMeetingOnHostExit: boolean;
}

export interface RoomParticipant {
  id: string;
  displayName: string;
  role: ParticipantRole;
  authorityRole: ParticipantAuthorityRole;
  isPresenter: boolean;
  mediaCapabilities: ParticipantMediaCapabilities;
  joinedAt: string;
}

export interface ParticipantMediaState {
  participantId: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenEnabled?: boolean;
}

export interface TranscriptSegmentPayload {
  text: string;
  speakerParticipantId?: string | null;
  speakerDisplayName?: string | null;
}

export type AgendaExecutionStatus =
  | "pending"
  | "active"
  | "partially_completed"
  | "completed";

export interface AgendaArtifactSubtopic {
  id: string;
  order: number;
  title: string;
  status?: AgendaExecutionStatus;
  talkingPoints: string[];
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
  meetingTitle: string;
  sourcePrompt: string[];
  meetingIntent: string;
  summary: string;
  points: AgendaArtifactPoint[];
}

export interface AgendaStatusPatchSubtopic {
  id: string;
  status: AgendaExecutionStatus;
}

export interface AgendaStatusPatchPoint {
  id: string;
  status: AgendaExecutionStatus;
  subtopics: AgendaStatusPatchSubtopic[];
}

export interface AgendaStatusPatch {
  points: AgendaStatusPatchPoint[];
}

export interface FactCheckItem {
  id: string;
  severity: "low" | "medium" | "high";
  claim: string;
  correction: string;
  rationale: string;
}

export interface RefineAgendaRequest {
  agenda?: string[];
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
  | "fact_check.private"
  | "transcript.partial"
  | "participant.media_state"
  | "participant.updated"
  | "moderation.media_state_changed"
  | "moderation.participant_removed"
  | "meeting.ended"
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

export type FactCheckPrivateEvent = BaseMeetingEvent<
  "fact_check.private",
  {
    windowStartedAt: string;
    windowEndedAt: string;
    items: FactCheckItem[];
  }
>;

export type ParticipantMediaStateEvent = BaseMeetingEvent<
  "participant.media_state",
  ParticipantMediaState
>;

export type ParticipantUpdatedEvent = BaseMeetingEvent<
  "participant.updated",
  { participant: RoomParticipant }
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

export type MeetingEndedEvent = BaseMeetingEvent<
  "meeting.ended",
  { reason: string }
>;

export type MeetingEvent =
  | PresenceJoinedEvent
  | PresenceLeftEvent
  | ChatMessageEvent
  | AgendaUpdatedEvent
  | FactCheckPrivateEvent
  | TranscriptPartialEvent
  | ParticipantMediaStateEvent
  | ParticipantUpdatedEvent
  | ModerationMediaStateChangedEvent
  | ModerationParticipantRemovedEvent
  | MeetingEndedEvent
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
      screenEnabled?: boolean;
    }
  | {
      action: "moderation.set_media_state";
      targetParticipantId: string;
      audioEnabled?: boolean;
      videoEnabled?: boolean;
      screenEnabled?: boolean;
      reason?: string;
    }
  | {
      action: "moderation.remove_participant";
      targetParticipantId: string;
      reason?: string;
    }
  | {
      action: "moderation.update_participant_access";
      targetParticipantId: string;
      authorityRole?: ParticipantAuthorityRole;
      isPresenter?: boolean;
      mediaCapabilities?: Partial<ParticipantMediaCapabilities>;
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
  id: string;
  code: string;
  capacity: number;
  createdAt: string;
  meetingTitle?: string | null;
  transcriptionProvider: TranscriptionProvider;
  transcriptionModel?: string | null;
  policy: RoomPolicy;
  agenda: string[];
  agendaArtifact?: AgendaArtifact | null;
  participants: RoomParticipant[];
}

export interface CreateRoomInput {
  displayName: string;
  meetingTitle?: string;
  transcriptionProvider?: TranscriptionProvider;
  transcriptionModel?: OpenAiTranscriptionModel;
  policy?: Partial<RoomPolicy>;
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
  transcription: {
    provider: TranscriptionProvider;
    model: string;
    language: string;
    sampleRate: number;
    mode: "realtime" | "disabled";
    transport: "websocket" | "none";
    url: string;
  };
  transport: {
    media: "mediasoup";
    events: "websocket";
  };
  ice: IceServerBundle;
}

export interface TranscriptionProviderStatus {
  label: string;
  available: boolean;
  reason?: string | null;
}

export interface TranscriptionProviderStatusResponse {
  providers: Record<TranscriptionProvider, TranscriptionProviderStatus>;
}

export interface CreateRoomResponse extends RoomResponseEnvelope {
  participantId: string;
}

export interface JoinRoomResponse extends RoomResponseEnvelope {
  participantId: string;
}

export const createParticipantName = (index: number) => `Participant ${index}`;
