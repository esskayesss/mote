import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator
} from "unique-names-generator";
import {
  type AgendaArtifact,
  DEFAULT_ROOM_CAPACITY,
  type CreateRoomInput,
  type JoinRoomInput,
  type MeetingEvent,
  type OpenAiTranscriptionModel,
  type ParticipantAuthorityRole,
  type ParticipantMediaCapabilities,
  type ParticipantMediaState,
  type RoomParticipant,
  type RoomPolicy,
  type RoomSummary,
  type TranscriptionProvider
} from "@mote/models";

const sanitizeCode = (value: string) => value.trim().toLowerCase();
const sanitizeDisplayName = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 40);
const sanitizeMeetingTitle = (value: string | undefined) => {
  const cleaned = (value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  return cleaned.length ? cleaned : null;
};
const sanitizeTranscriptionProvider = (value: string | undefined): TranscriptionProvider =>
  value === "sarvam"
    ? "sarvam"
    : value === "none"
      ? "none"
      : value === "openai"
        ? "openai"
        : "whisperlive";
const sanitizeOpenAiTranscriptionModel = (
  value: string | undefined
): OpenAiTranscriptionModel | null => (value ? "whisper-1" : null);
const sanitizeAgenda = (agenda: string[] | undefined) => {
  const cleaned = (agenda ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);

  return cleaned;
};
const DEFAULT_ROOM_POLICY: RoomPolicy = {
  endMeetingOnHostExit: true
};
const DEFAULT_MEDIA_CAPABILITIES: ParticipantMediaCapabilities = {
  publishAudio: true,
  publishVideo: true,
  publishScreen: true,
  subscribeAudio: true,
  subscribeVideo: true,
  subscribeScreen: true
};
const sanitizeRoomPolicy = (policy: Partial<RoomPolicy> | undefined): RoomPolicy => ({
  endMeetingOnHostExit:
    typeof policy?.endMeetingOnHostExit === "boolean"
      ? policy.endMeetingOnHostExit
      : DEFAULT_ROOM_POLICY.endMeetingOnHostExit
});
const sanitizeAuthorityRole = (value: string | undefined): ParticipantAuthorityRole =>
  value === "host" || value === "admin" ? value : "participant";
const sanitizeMediaCapabilities = (
  value: Partial<ParticipantMediaCapabilities> | undefined
): ParticipantMediaCapabilities => ({
  publishAudio:
    typeof value?.publishAudio === "boolean"
      ? value.publishAudio
      : DEFAULT_MEDIA_CAPABILITIES.publishAudio,
  publishVideo:
    typeof value?.publishVideo === "boolean"
      ? value.publishVideo
      : DEFAULT_MEDIA_CAPABILITIES.publishVideo,
  publishScreen:
    typeof value?.publishScreen === "boolean"
      ? value.publishScreen
      : DEFAULT_MEDIA_CAPABILITIES.publishScreen,
  subscribeAudio:
    typeof value?.subscribeAudio === "boolean"
      ? value.subscribeAudio
      : DEFAULT_MEDIA_CAPABILITIES.subscribeAudio,
  subscribeVideo:
    typeof value?.subscribeVideo === "boolean"
      ? value.subscribeVideo
      : DEFAULT_MEDIA_CAPABILITIES.subscribeVideo,
  subscribeScreen:
    typeof value?.subscribeScreen === "boolean"
      ? value.subscribeScreen
      : DEFAULT_MEDIA_CAPABILITIES.subscribeScreen
});
export class RoomStore {
  private db: Database;
  private updateRoomIdStatement;
  private roomExistsStatement;
  private insertRoomStatement;
  private insertParticipantStatement;
  private roomByCodeStatement;
  private participantCountStatement;
  private participantsByRoomStatement;
  private participantByIdStatement;
  private deleteParticipantStatement;
  private deleteRoomIfEmptyStatement;
  private deleteRoomStatement;
  private updateRoomAgendaStatement;
  private updateParticipantAccessStatement;
  private insertEventStatement;
  private eventsByRoomStatement;
  private mediaStateEventsByRoomStatement;

  constructor(private readonly databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath, { create: true });

    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT,
        code TEXT PRIMARY KEY,
        capacity INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        meeting_title TEXT,
        transcription_provider TEXT NOT NULL DEFAULT 'whisperlive',
        transcription_model TEXT,
        policy_json TEXT NOT NULL DEFAULT '{"endMeetingOnHostExit":true}',
        agenda_json TEXT NOT NULL,
        agenda_artifact_json TEXT
      );

      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        authority_role TEXT NOT NULL DEFAULT 'participant',
        is_presenter INTEGER NOT NULL DEFAULT 0,
        media_capabilities_json TEXT NOT NULL DEFAULT '{"publishAudio":true,"publishVideo":true,"publishScreen":true,"subscribeAudio":true,"subscribeVideo":true,"subscribeScreen":true}',
        joined_at TEXT NOT NULL,
        FOREIGN KEY(room_code) REFERENCES rooms(code) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS participants_room_code_idx ON participants(room_code);

      CREATE TABLE IF NOT EXISTS room_events (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        type TEXT NOT NULL,
        scope TEXT NOT NULL,
        actor_participant_id TEXT,
        target_participant_id TEXT,
        created_at TEXT NOT NULL,
        persisted INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(room_code) REFERENCES rooms(code) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS room_events_room_code_created_at_idx
        ON room_events(room_code, created_at DESC);

      CREATE INDEX IF NOT EXISTS room_events_room_code_type_created_at_idx
        ON room_events(room_code, type, created_at DESC);
    `);

    const roomColumns = this.db
      .query<{ name: string }, []>("PRAGMA table_info(rooms)")
      .all()
      .map((column) => column.name);

    if (!roomColumns.includes("agenda_artifact_json")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN agenda_artifact_json TEXT");
    }

    if (!roomColumns.includes("meeting_title")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN meeting_title TEXT");
    }

    if (!roomColumns.includes("id")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN id TEXT");
    }

    if (!roomColumns.includes("transcription_provider")) {
      this.db.exec(
        "ALTER TABLE rooms ADD COLUMN transcription_provider TEXT NOT NULL DEFAULT 'whisperlive'"
      );
    }

    if (!roomColumns.includes("transcription_model")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN transcription_model TEXT");
    }

    if (!roomColumns.includes("policy_json")) {
      this.db.exec(
        `ALTER TABLE rooms ADD COLUMN policy_json TEXT NOT NULL DEFAULT '{"endMeetingOnHostExit":true}'`
      );
    }

    const participantColumns = this.db
      .query<{ name: string }, []>("PRAGMA table_info(participants)")
      .all()
      .map((column) => column.name);

    if (!participantColumns.includes("authority_role")) {
      this.db.exec(
        "ALTER TABLE participants ADD COLUMN authority_role TEXT NOT NULL DEFAULT 'participant'"
      );
    }

    if (!participantColumns.includes("is_presenter")) {
      this.db.exec(
        "ALTER TABLE participants ADD COLUMN is_presenter INTEGER NOT NULL DEFAULT 0"
      );
    }

    if (!participantColumns.includes("media_capabilities_json")) {
      this.db.exec(
        `ALTER TABLE participants ADD COLUMN media_capabilities_json TEXT NOT NULL DEFAULT '{"publishAudio":true,"publishVideo":true,"publishScreen":true,"subscribeAudio":true,"subscribeVideo":true,"subscribeScreen":true}'`
      );
    }

    this.updateRoomIdStatement = this.db.query("UPDATE rooms SET id = ?2 WHERE code = ?1");
    this.roomExistsStatement = this.db.query("SELECT 1 FROM rooms WHERE code = ?1 LIMIT 1");
    this.insertRoomStatement = this.db.query(
      "INSERT INTO rooms (id, code, capacity, created_at, meeting_title, transcription_provider, transcription_model, policy_json, agenda_json, agenda_artifact_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
    );
    this.insertParticipantStatement = this.db.query(
      "INSERT INTO participants (id, room_code, display_name, role, authority_role, is_presenter, media_capabilities_json, joined_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
    );
    this.roomByCodeStatement = this.db.query<
      {
        id: string | null;
        code: string;
        capacity: number;
        created_at: string;
        meeting_title: string | null;
        transcription_provider: TranscriptionProvider;
        transcription_model: string | null;
        policy_json: string;
        agenda_json: string;
        agenda_artifact_json: string | null;
      },
      [string]
    >(
      "SELECT id, code, capacity, created_at, meeting_title, transcription_provider, transcription_model, policy_json, agenda_json, agenda_artifact_json FROM rooms WHERE code = ?1 LIMIT 1"
    );
    this.participantCountStatement = this.db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM participants WHERE room_code = ?1"
    );
    this.participantsByRoomStatement = this.db.query<
      {
        id: string;
        display_name: string;
        role: RoomParticipant["role"];
        authority_role: ParticipantAuthorityRole;
        is_presenter: number;
        media_capabilities_json: string;
        joined_at: string;
      },
      [string]
    >(
      `SELECT id, display_name, role, authority_role, is_presenter, media_capabilities_json, joined_at
       FROM participants
       WHERE room_code = ?1
       ORDER BY joined_at ASC`
    );
    this.participantByIdStatement = this.db.query<
      {
        id: string;
        room_code: string;
        display_name: string;
        role: RoomParticipant["role"];
        authority_role: ParticipantAuthorityRole;
        is_presenter: number;
        media_capabilities_json: string;
        joined_at: string;
      },
      [string, string]
    >(
      `SELECT id, room_code, display_name, role, authority_role, is_presenter, media_capabilities_json, joined_at
       FROM participants
       WHERE room_code = ?1 AND id = ?2
       LIMIT 1`
    );
    this.deleteParticipantStatement = this.db.query(
      "DELETE FROM participants WHERE room_code = ?1 AND id = ?2"
    );
    this.deleteRoomIfEmptyStatement = this.db.query(
      `DELETE FROM rooms
       WHERE code = ?1
         AND NOT EXISTS (
           SELECT 1 FROM participants WHERE room_code = ?1
         )`
    );
    this.deleteRoomStatement = this.db.query("DELETE FROM rooms WHERE code = ?1");
    this.updateRoomAgendaStatement = this.db.query(
      "UPDATE rooms SET agenda_json = ?2, agenda_artifact_json = ?3, meeting_title = ?4 WHERE code = ?1"
    );
    this.updateParticipantAccessStatement = this.db.query(
      `UPDATE participants
       SET authority_role = ?3,
           is_presenter = ?4,
           media_capabilities_json = ?5
       WHERE room_code = ?1 AND id = ?2`
    );
    this.insertEventStatement = this.db.query(
      `INSERT INTO room_events (
        id,
        room_code,
        type,
        scope,
        actor_participant_id,
        target_participant_id,
        created_at,
        persisted,
        payload_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    );
    this.eventsByRoomStatement = this.db.query<
      {
        id: string;
        room_code: string;
        type: MeetingEvent["type"];
        scope: MeetingEvent["scope"];
        actor_participant_id: string | null;
        target_participant_id: string | null;
        created_at: string;
        persisted: number;
        payload_json: string;
      },
      [string, number]
    >(
      `SELECT id, room_code, type, scope, actor_participant_id, target_participant_id, created_at, persisted, payload_json
       FROM room_events
       WHERE room_code = ?1
       ORDER BY created_at DESC
       LIMIT ?2`
    );
    this.mediaStateEventsByRoomStatement = this.db.query<
      {
        actor_participant_id: string | null;
        payload_json: string;
      },
      [string]
    >(
      `SELECT actor_participant_id, payload_json
       FROM room_events
       WHERE room_code = ?1
         AND type = 'participant.media_state'
      ORDER BY created_at DESC`
    );

    const roomsMissingIds = this.db
      .query<{ code: string }, []>("SELECT code FROM rooms WHERE id IS NULL OR id = ''")
      .all();

    for (const room of roomsMissingIds) {
      this.updateRoomIdStatement.run(room.code, crypto.randomUUID());
    }
  }

  private createRoomCode() {
    let code = "";

    do {
      code = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: "-",
        style: "lowerCase",
        length: 3
      });
    } while (this.roomExistsStatement.get(code));

    return code;
  }

  private createParticipant(
    displayName: string,
    role: RoomParticipant["role"],
    authorityRole: ParticipantAuthorityRole,
    isPresenter: boolean,
    mediaCapabilities: ParticipantMediaCapabilities
  ): RoomParticipant {
    return {
      id: crypto.randomUUID(),
      displayName,
      role,
      authorityRole,
      isPresenter,
      mediaCapabilities,
      joinedAt: new Date().toISOString()
    };
  }

  private mapParticipants(code: string): RoomParticipant[] {
    return this.participantsByRoomStatement.all(code).map((participant) => ({
      id: participant.id,
      displayName: participant.display_name,
      role: participant.role,
      authorityRole: sanitizeAuthorityRole(participant.authority_role),
      isPresenter: Boolean(participant.is_presenter),
      mediaCapabilities: sanitizeMediaCapabilities(
        JSON.parse(participant.media_capabilities_json) as Partial<ParticipantMediaCapabilities>
      ),
      joinedAt: participant.joined_at
    }));
  }

  getRoom(code: string): RoomSummary | null {
    const room = this.roomByCodeStatement.get(sanitizeCode(code));

    if (!room) {
      return null;
    }

    return {
      id: room.id ?? crypto.randomUUID(),
      code: room.code,
      capacity: room.capacity,
      createdAt: room.created_at,
      meetingTitle: room.meeting_title,
      transcriptionProvider: room.transcription_provider,
      transcriptionModel: room.transcription_model,
      policy: sanitizeRoomPolicy(JSON.parse(room.policy_json) as Partial<RoomPolicy>),
      agenda: JSON.parse(room.agenda_json) as string[],
      agendaArtifact: room.agenda_artifact_json
        ? (JSON.parse(room.agenda_artifact_json) as AgendaArtifact)
        : null,
      participants: this.mapParticipants(room.code)
    };
  }

  getParticipant(roomCode: string, participantId: string) {
    return this.participantByIdStatement.get(sanitizeCode(roomCode), participantId) ?? null;
  }

  createRoom(input: CreateRoomInput, agendaArtifact?: AgendaArtifact | null) {
    const displayName = sanitizeDisplayName(input.displayName);

    if (!displayName) {
      throw new Error("Display name is required.");
    }

    const agenda = sanitizeAgenda(input.agenda);
    const meetingTitle = sanitizeMeetingTitle(input.meetingTitle);

    if (!meetingTitle && agenda.length === 0) {
      throw new Error("Either a meeting title or at least one agenda item is required.");
    }

    const transcriptionProvider = sanitizeTranscriptionProvider(input.transcriptionProvider);
    const transcriptionModel =
      transcriptionProvider === "openai"
        ? sanitizeOpenAiTranscriptionModel(input.transcriptionModel)
        : null;
    const policy = sanitizeRoomPolicy(input.policy);
    const host = this.createParticipant(
      displayName,
      "host",
      "host",
      true,
      sanitizeMediaCapabilities(undefined)
    );
    const code = this.createRoomCode();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.insertRoomStatement.run(
      id,
      code,
      DEFAULT_ROOM_CAPACITY,
      createdAt,
      meetingTitle,
      transcriptionProvider,
      transcriptionModel,
      JSON.stringify(policy),
      JSON.stringify(agenda),
      agendaArtifact ? JSON.stringify(agendaArtifact) : null
    );
    this.insertParticipantStatement.run(
      host.id,
      code,
      host.displayName,
      host.role,
      host.authorityRole,
      host.isPresenter ? 1 : 0,
      JSON.stringify(host.mediaCapabilities),
      host.joinedAt
    );

    const room = this.getRoom(code);

    if (!room) {
      throw new Error("Room creation failed.");
    }

    return { room, participantId: host.id, participant: host };
  }

  joinRoom(code: string, input: JoinRoomInput) {
    const room = this.getRoom(code);

    if (!room) {
      throw new Error("Room not found.");
    }

    const countRecord = this.participantCountStatement.get(room.code);
    const participantCount = countRecord?.count ?? 0;

    if (participantCount >= room.capacity) {
      throw new Error("Room capacity reached.");
    }

    const displayName = sanitizeDisplayName(input.displayName);

    if (!displayName) {
      throw new Error("Display name is required.");
    }

    const participant = this.createParticipant(
      displayName,
      "participant",
      "participant",
      false,
      sanitizeMediaCapabilities(undefined)
    );

    this.insertParticipantStatement.run(
      participant.id,
      room.code,
      participant.displayName,
      participant.role,
      participant.authorityRole,
      participant.isPresenter ? 1 : 0,
      JSON.stringify(participant.mediaCapabilities),
      participant.joinedAt
    );

    const updatedRoom = this.getRoom(room.code);

    if (!updatedRoom) {
      throw new Error("Unable to load room.");
    }

    return {
      room: updatedRoom,
      participantId: participant.id,
      participant
    };
  }

  removeParticipant(roomCode: string, participantId: string) {
    const normalizedCode = sanitizeCode(roomCode);
    const participant = this.getRoom(normalizedCode)?.participants.find((candidate) => candidate.id === participantId) ?? null;
    this.deleteParticipantStatement.run(normalizedCode, participantId);
    this.deleteRoomIfEmptyStatement.run(normalizedCode);
    return participant;
  }

  removeRoom(roomCode: string) {
    const normalizedCode = sanitizeCode(roomCode);
    const room = this.getRoom(normalizedCode);

    if (!room) {
      return null;
    }

    this.deleteRoomStatement.run(normalizedCode);
    return room;
  }

  updateParticipantAccess(
    roomCode: string,
    participantId: string,
    input: {
      authorityRole?: ParticipantAuthorityRole;
      isPresenter?: boolean;
      mediaCapabilities?: Partial<ParticipantMediaCapabilities>;
    }
  ) {
    const existing = this.getParticipant(roomCode, participantId);

    if (!existing) {
      return null;
    }

    const currentCapabilities = sanitizeMediaCapabilities(
      JSON.parse(existing.media_capabilities_json) as Partial<ParticipantMediaCapabilities>
    );
    const nextAuthorityRole =
      input.authorityRole !== undefined
        ? sanitizeAuthorityRole(input.authorityRole)
        : sanitizeAuthorityRole(existing.authority_role);
    const nextIsPresenter =
      typeof input.isPresenter === "boolean" ? input.isPresenter : Boolean(existing.is_presenter);
    const nextCapabilities = sanitizeMediaCapabilities({
      ...currentCapabilities,
      ...(input.mediaCapabilities ?? {})
    });

    this.updateParticipantAccessStatement.run(
      sanitizeCode(roomCode),
      participantId,
      nextAuthorityRole,
      nextIsPresenter ? 1 : 0,
      JSON.stringify(nextCapabilities)
    );

    return this.getRoom(roomCode)?.participants.find((participant) => participant.id === participantId) ?? null;
  }

  updateAgenda(
    roomCode: string,
    agenda: string[],
    agendaArtifact?: AgendaArtifact | null,
    meetingTitle?: string | null
  ) {
    const normalizedCode = sanitizeCode(roomCode);
    const sanitized = sanitizeAgenda(agenda);
    this.updateRoomAgendaStatement.run(
      normalizedCode,
      JSON.stringify(sanitized),
      agendaArtifact ? JSON.stringify(agendaArtifact) : null,
      sanitizeMeetingTitle(meetingTitle ?? undefined)
    );
    return this.getRoom(normalizedCode);
  }

  appendEvent(event: MeetingEvent) {
    this.insertEventStatement.run(
      event.id,
      sanitizeCode(event.roomCode),
      event.type,
      event.scope,
      event.actorParticipantId,
      event.targetParticipantId,
      event.createdAt,
      event.persisted ? 1 : 0,
      JSON.stringify(event.payload)
    );
  }

  listRecentEvents(roomCode: string, limit = 50): MeetingEvent[] {
    return this.eventsByRoomStatement.all(sanitizeCode(roomCode), limit).map((event) => ({
      id: event.id,
      roomCode: event.room_code,
      type: event.type,
      scope: event.scope,
      actorParticipantId: event.actor_participant_id,
      targetParticipantId: event.target_participant_id,
      createdAt: event.created_at,
      persisted: Boolean(event.persisted),
      payload: JSON.parse(event.payload_json)
    })) as MeetingEvent[];
  }

  listLatestParticipantMediaStates(roomCode: string): ParticipantMediaState[] {
    const states = new Map<string, ParticipantMediaState>();

    for (const event of this.mediaStateEventsByRoomStatement.all(sanitizeCode(roomCode))) {
      const payload = JSON.parse(event.payload_json) as ParticipantMediaState;
      const participantId = event.actor_participant_id ?? payload.participantId;

      if (!participantId || states.has(participantId)) {
        continue;
      }

      states.set(participantId, {
        participantId,
        audioEnabled: payload.audioEnabled,
        videoEnabled: payload.videoEnabled,
        screenEnabled: payload.screenEnabled ?? false
      });
    }

    return Array.from(states.values());
  }
}
