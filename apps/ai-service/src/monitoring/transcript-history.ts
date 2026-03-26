import type { AgendaStatusPatch, RoomResponseEnvelope } from "@mote/models";

const MAX_TRANSCRIPT_TURNS = 240;

export interface TranscriptTurn {
  participantId: string;
  text: string;
  createdAt: string;
  isFinal: boolean;
}

export interface RoomMonitorState {
  publicRoomCode: string;
  transcriptTurns: TranscriptTurn[];
  lastEvaluationSignature: string | null;
  issuedFactChecks: Array<{
    signature: string;
    claimSignature: string;
    correctionSignature: string;
    emittedAt: string;
    claim: string;
    correction: string;
  }>;
  evaluationQueued: boolean;
  dirty: boolean;
  optimisticAgendaPatch: AgendaStatusPatch | null;
}

type MonitoringIngressMessage =
  | {
      type: "transcript.final";
      participantId: string;
      text: string;
      createdAt: string;
    }
  | {
      type: "transcript.partial";
      participantId: string;
      text: string;
      createdAt: string;
    };

export const createRoomMonitorState = (roomCode: string): RoomMonitorState => ({
  publicRoomCode: roomCode,
  transcriptTurns: [],
  lastEvaluationSignature: null,
  issuedFactChecks: [],
  evaluationQueued: false,
  dirty: false,
  optimisticAgendaPatch: null
});

export const upsertTranscriptTurn = (
  turns: TranscriptTurn[],
  message: MonitoringIngressMessage
) => {
  const lastTurn = turns[turns.length - 1];

  if (
    lastTurn &&
    lastTurn.participantId === message.participantId &&
    lastTurn.isFinal === false
  ) {
    lastTurn.text = message.text;
    lastTurn.createdAt = message.createdAt;
    lastTurn.isFinal = message.type === "transcript.final";
  } else {
    turns.push({
      participantId: message.participantId,
      text: message.text,
      createdAt: message.createdAt,
      isFinal: message.type === "transcript.final"
    });
  }

  if (turns.length > MAX_TRANSCRIPT_TURNS) {
    turns.splice(0, turns.length - MAX_TRANSCRIPT_TURNS);
  }
};

const buildSpeakerMap = (room: RoomResponseEnvelope["room"]) =>
  new Map(
    room.participants.map((participant) => [
      participant.id,
      participant.displayName ?? "Participant"
    ])
  );

const getAgendaSpeakerIds = (room: RoomResponseEnvelope["room"]) => {
  const presenters = room.participants.filter((participant) => participant.isPresenter);

  if (presenters.length > 0) {
    return new Set(presenters.map((participant) => participant.id));
  }

  return new Set(
    room.participants
      .filter((participant) => participant.role === "host")
      .map((participant) => participant.id)
  );
};

export const buildTranscriptHistory = (
  room: RoomResponseEnvelope["room"],
  turns: TranscriptTurn[],
  options?: { presenterOnly?: boolean }
) => {
  const participantIds = new Set(room.participants.map((participant) => participant.id));
  const speakerMap = buildSpeakerMap(room);
  const agendaSpeakerIds = options?.presenterOnly ? getAgendaSpeakerIds(room) : null;

  return turns
    .filter((turn) => participantIds.has(turn.participantId))
    .filter((turn) => (agendaSpeakerIds ? agendaSpeakerIds.has(turn.participantId) : true))
    .map((turn) => {
      const speaker = speakerMap.get(turn.participantId) ?? "Participant";
      return `${turn.createdAt} ${speaker}${turn.isFinal ? "" : " [live]"}: ${turn.text}`;
    });
};
