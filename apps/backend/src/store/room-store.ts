import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import {
  type AgendaArtifact,
  DEFAULT_AGENDA_TOPICS,
  DEFAULT_ROOM_CAPACITY,
  type CreateRoomInput,
  type JoinRoomInput,
  type MeetingEvent,
  type ParticipantMediaState,
  type RoomParticipant,
  type RoomSummary
} from "@mote/models";

const ROOM_CODE_PARTS = {
  adjectives: ["amber", "brisk", "clear", "ember", "kind", "lunar", "quiet", "silver"],
  nouns: ["harbor", "maple", "meadow", "otter", "river", "signal", "spruce", "studio"],
  suffixes: ["bridge", "delta", "grove", "north", "summit", "thread", "trail", "wave"]
} as const;

const sanitizeCode = (value: string) => value.trim().toLowerCase();
const sanitizeDisplayName = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 40);
const sanitizeAgenda = (agenda: string[] | undefined) => {
  const cleaned = (agenda ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);

  return cleaned.length ? cleaned : [...DEFAULT_AGENDA_TOPICS];
};
const pick = <T>(values: readonly T[]) => values[Math.floor(Math.random() * values.length)];

export class RoomStore {
  private db: Database;
  private roomExistsStatement;
  private insertRoomStatement;
  private insertParticipantStatement;
  private roomByCodeStatement;
  private participantCountStatement;
  private participantsByRoomStatement;
  private participantByIdStatement;
  private deleteParticipantStatement;
  private deleteRoomIfEmptyStatement;
  private updateRoomAgendaStatement;
  private insertEventStatement;
  private eventsByRoomStatement;
  private mediaStateEventsByRoomStatement;

  constructor(private readonly databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath, { create: true });

    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        capacity INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        agenda_json TEXT NOT NULL,
        agenda_artifact_json TEXT
      );

      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
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

    this.roomExistsStatement = this.db.query("SELECT 1 FROM rooms WHERE code = ?1 LIMIT 1");
    this.insertRoomStatement = this.db.query(
      "INSERT INTO rooms (code, capacity, created_at, agenda_json, agenda_artifact_json) VALUES (?1, ?2, ?3, ?4, ?5)"
    );
    this.insertParticipantStatement = this.db.query(
      "INSERT INTO participants (id, room_code, display_name, role, joined_at) VALUES (?1, ?2, ?3, ?4, ?5)"
    );
    this.roomByCodeStatement = this.db.query<
      {
        code: string;
        capacity: number;
        created_at: string;
        agenda_json: string;
        agenda_artifact_json: string | null;
      },
      [string]
    >(
      "SELECT code, capacity, created_at, agenda_json, agenda_artifact_json FROM rooms WHERE code = ?1 LIMIT 1"
    );
    this.participantCountStatement = this.db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM participants WHERE room_code = ?1"
    );
    this.participantsByRoomStatement = this.db.query<
      { id: string; display_name: string; role: RoomParticipant["role"]; joined_at: string },
      [string]
    >(
      `SELECT id, display_name, role, joined_at
       FROM participants
       WHERE room_code = ?1
       ORDER BY joined_at ASC`
    );
    this.participantByIdStatement = this.db.query<
      { id: string; room_code: string; display_name: string; role: RoomParticipant["role"]; joined_at: string },
      [string, string]
    >(
      `SELECT id, room_code, display_name, role, joined_at
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
    this.updateRoomAgendaStatement = this.db.query(
      "UPDATE rooms SET agenda_json = ?2, agenda_artifact_json = ?3 WHERE code = ?1"
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
  }

  private createRoomCode() {
    let code = "";

    do {
      code = `${pick(ROOM_CODE_PARTS.adjectives)}-${pick(ROOM_CODE_PARTS.nouns)}-${pick(ROOM_CODE_PARTS.suffixes)}`;
    } while (this.roomExistsStatement.get(code));

    return code;
  }

  private createParticipant(displayName: string, role: RoomParticipant["role"]): RoomParticipant {
    return {
      id: crypto.randomUUID(),
      displayName,
      role,
      joinedAt: new Date().toISOString()
    };
  }

  private mapParticipants(code: string): RoomParticipant[] {
    return this.participantsByRoomStatement.all(code).map((participant) => ({
      id: participant.id,
      displayName: participant.display_name,
      role: participant.role,
      joinedAt: participant.joined_at
    }));
  }

  getRoom(code: string): RoomSummary | null {
    const room = this.roomByCodeStatement.get(sanitizeCode(code));

    if (!room) {
      return null;
    }

    return {
      code: room.code,
      capacity: room.capacity,
      createdAt: room.created_at,
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
    const host = this.createParticipant(displayName, "host");
    const code = this.createRoomCode();
    const createdAt = new Date().toISOString();

    this.insertRoomStatement.run(
      code,
      DEFAULT_ROOM_CAPACITY,
      createdAt,
      JSON.stringify(agenda),
      agendaArtifact ? JSON.stringify(agendaArtifact) : null
    );
    this.insertParticipantStatement.run(host.id, code, host.displayName, host.role, host.joinedAt);

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

    const participant = this.createParticipant(displayName, "guest");

    this.insertParticipantStatement.run(
      participant.id,
      room.code,
      participant.displayName,
      participant.role,
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

  updateAgenda(roomCode: string, agenda: string[], agendaArtifact?: AgendaArtifact | null) {
    const normalizedCode = sanitizeCode(roomCode);
    const sanitized = sanitizeAgenda(agenda);
    this.updateRoomAgendaStatement.run(
      normalizedCode,
      JSON.stringify(sanitized),
      agendaArtifact ? JSON.stringify(agendaArtifact) : null
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
        videoEnabled: payload.videoEnabled
      });
    }

    return Array.from(states.values());
  }
}
