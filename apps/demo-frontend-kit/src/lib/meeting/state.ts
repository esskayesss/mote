import type {
  ChatMessageEvent,
  FactCheckPrivateEvent,
  MeetingEvent,
  MeetingSnapshot,
  ParticipantMediaState,
  RoomSummary
} from "@mote/models";
import { createTranscriptEntry } from "./transcript";
import type { TranscriptEntry } from "./types";

export const mapParticipantMediaStates = (states: ParticipantMediaState[]) =>
  Object.fromEntries(states.map((state) => [state.participantId, state]));

export const setParticipantMediaStateRecord = (
  states: Record<string, ParticipantMediaState>,
  state: ParticipantMediaState
) => ({
  ...states,
  [state.participantId]: state
});

export const removeParticipantMediaStateRecord = (
  states: Record<string, ParticipantMediaState>,
  participantId: string
) => {
  const { [participantId]: _removed, ...rest } = states;
  return rest;
};

export const applyMeetingSnapshotState = (snapshot: MeetingSnapshot) => ({
  room: snapshot.room,
  participantMediaStates: mapParticipantMediaStates(snapshot.participantMediaStates),
  chatMessages: snapshot.recentEvents.filter(
    (event): event is ChatMessageEvent => event.type === "chat.message"
  ),
  factChecks: snapshot.recentEvents.filter(
    (event): event is FactCheckPrivateEvent => event.type === "fact_check.private"
  ),
  transcriptEntries: snapshot.recentEvents
    .filter((event) => event.type === "transcript.final")
    .map((event) =>
      createTranscriptEntry({
        id: event.id,
        text: event.payload.text,
        speakerParticipantId: event.payload.speakerParticipantId ?? null,
        speakerDisplayName: event.payload.speakerDisplayName ?? null,
        createdAt: event.createdAt,
        isPartial: false
      })
    )
});

export const removeLiveTranscriptEntry = (
  entries: Record<string, TranscriptEntry>,
  participantId: string
) => {
  const { [participantId]: _removed, ...rest } = entries;
  return rest;
};

export const upsertParticipantInRoom = (
  room: RoomSummary,
  participant: RoomSummary["participants"][number]
): RoomSummary => {
  const nextParticipants = room.participants.filter((candidate) => candidate.id !== participant.id);
  nextParticipants.push(participant);
  nextParticipants.sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));
  return { ...room, participants: nextParticipants };
};

export const removeParticipantFromRoom = (room: RoomSummary, participantId: string): RoomSummary => ({
  ...room,
  participants: room.participants.filter((participant) => participant.id !== participantId)
});

export const applyAgendaUpdated = (
  room: RoomSummary,
  agenda: string[],
  agendaArtifact: RoomSummary["agendaArtifact"]
): RoomSummary => {
  room.meetingTitle = agendaArtifact?.meetingTitle ?? room.meetingTitle ?? null;
  room.agenda = [...agenda];
  room.agendaArtifact = agendaArtifact ?? null;
  return room;
};

export const resolveParticipantDisplayName = (
  room: RoomSummary | null,
  participantId: string | null | undefined
) =>
  room?.participants.find((participant) => participant.id === participantId)?.displayName ??
  "Participant";

export const createTranscriptEntryFromEvent = (event: Extract<MeetingEvent, { type: "transcript.final" | "transcript.partial" }>) =>
  createTranscriptEntry({
    id: event.id,
    text: event.payload.text,
    speakerParticipantId: event.payload.speakerParticipantId ?? event.actorParticipantId ?? null,
    speakerDisplayName: event.payload.speakerDisplayName ?? null,
    createdAt: event.createdAt,
    isPartial: event.type === "transcript.partial"
  });
