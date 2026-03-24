import { cors } from "@elysiajs/cors";
import { Elysia, t } from "elysia";
import {
  DEFAULT_AGENDA_TOPICS,
  DEFAULT_ROOM_CAPACITY,
  EVENTS_CHANNEL_NAME,
  type CreateRoomInput,
  type JoinRoomInput,
  type RoomResponseEnvelope,
  type RoomSummary
} from "@mote/models";
import type { EventsRuntime } from "../events/runtime";
import type { AgendaRefinementClient } from "../agenda/refinement-client";
import type { IceConfig } from "../media/ice";
import { createIceServerBundle } from "../media/ice";
import type { MediaRuntime } from "../media/runtime";
import type { RoomStore } from "../store/room-store";

interface TranscriptionConfig {
  url: string;
  model: string;
  language: string;
  sampleRate: number;
}

const toRoomResponse = (
  room: RoomSummary,
  iceConfig: IceConfig,
  transcription: TranscriptionConfig,
  participantId?: string
): RoomResponseEnvelope => ({
  room,
  agenda: room.agenda,
  transcription: {
    provider: "whisperlive",
    model: transcription.model,
    language: transcription.language,
    sampleRate: transcription.sampleRate,
    mode: "realtime",
    transport: "websocket",
    url: transcription.url
  },
  transport: {
    media: "mediasoup",
    events: "websocket"
  },
  ice: createIceServerBundle(iceConfig, participantId)
});

export const createApp = (
  roomStore: RoomStore,
  mediaRuntime: MediaRuntime,
  eventsRuntime: EventsRuntime,
  agendaRefinementClient: AgendaRefinementClient,
  iceConfig: IceConfig,
  transcription: TranscriptionConfig,
  internalApiSecret: string
) =>
  new Elysia()
    .use(cors({ origin: true }))
    .get("/health", () => ({
      ok: true,
      service: "backend",
      transport: "elysia",
      sfu: "mediasoup",
      eventsChannel: EVENTS_CHANNEL_NAME,
      eventsTransport: "websocket"
    }))
    .get("/session-template", () => ({
      room: {
        slug: "demo-room",
        capacity: DEFAULT_ROOM_CAPACITY
      },
      agenda: DEFAULT_AGENDA_TOPICS,
      transcription: {
        provider: "whisperlive",
        model: transcription.model,
        language: transcription.language,
        sampleRate: transcription.sampleRate,
        mode: "realtime",
        transport: "websocket",
        url: transcription.url
      }
    }))
    .post(
      "/rooms",
      async ({ body, set }) => {
        try {
          const input = body as CreateRoomInput;
          let refinedAgenda = input.agenda;
          let agendaArtifact = null;

          try {
            const refinement = await agendaRefinementClient.refine({
              agenda: input.agenda ?? DEFAULT_AGENDA_TOPICS.slice(),
              meetingGoal: "Create a guided meeting agenda for a live orchestration session."
            });

            refinedAgenda = agendaRefinementClient.toPointwiseAgenda(refinement.artifact);
            agendaArtifact = refinement.artifact;

            console.info("[mote:backend] agenda:refined", {
              source: refinement.source,
              points: refinement.artifact.points.length
            });
          } catch (error) {
            console.warn("[mote:backend] agenda:refine failed", {
              error: error instanceof Error ? error.message : error
            });
          }

          const created = roomStore.createRoom(
            {
              ...input,
              agenda: refinedAgenda
            },
            agendaArtifact
          );
          eventsRuntime.publishPresenceJoined(created.room.code, created.participant);
          return {
            participantId: created.participantId,
            ...toRoomResponse(created.room, iceConfig, transcription, created.participantId)
          };
        } catch (error) {
          set.status = String(error).includes("required") ? 400 : 500;
          return { message: error instanceof Error ? error.message : "Room creation failed." };
        }
      },
      {
        body: t.Object({
          displayName: t.String({ minLength: 1, maxLength: 40 }),
          agenda: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 140 }), { maxItems: 8 }))
        })
      }
    )
    .post(
      "/rooms/:code",
      ({ body, params, set }) => {
        try {
          const joined = roomStore.joinRoom(params.code, body as JoinRoomInput);
          eventsRuntime.publishPresenceJoined(joined.room.code, joined.participant);
          return {
            participantId: joined.participantId,
            ...toRoomResponse(joined.room, iceConfig, transcription, joined.participantId)
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to join room.";
          set.status =
            message === "Room not found." ? 404 : message === "Room capacity reached." ? 409 : 400;
          return { message };
        }
      },
      {
        body: t.Object({
          displayName: t.String({ minLength: 1, maxLength: 40 })
        })
      }
    )
    .post(
      "/rooms/:code/leave",
      ({ body, params, set }) => {
        const participantId =
          typeof body?.participantId === "string" ? body.participantId.trim() : "";

        if (!participantId) {
          set.status = 400;
          return { message: "Participant ID is required." };
        }

        const removedParticipant = roomStore.removeParticipant(params.code, participantId);

        if (removedParticipant) {
          eventsRuntime.publishPresenceLeft(params.code, participantId);
        }

        return { ok: true };
      },
      {
        body: t.Object({
          participantId: t.String({ minLength: 1 })
        })
      }
    )
    .get(
      "/rooms/:code",
      ({ params, query, set }) => {
      const room = roomStore.getRoom(params.code);

      if (!room) {
        set.status = 404;
        return { message: "Room not found." };
      }

        const participantId =
          typeof query.participantId === "string" && query.participantId.trim().length > 0
            ? query.participantId.trim()
            : undefined;

        return toRoomResponse(room, iceConfig, transcription, participantId);
      },
      {
        query: t.Object({
          participantId: t.Optional(t.String())
        })
      }
    )
    .post(
      "/internal/transcription-events",
      ({ body, headers, set }) => {
        if (headers["x-internal-api-secret"] !== internalApiSecret) {
          set.status = 401;
          return { message: "Unauthorized." };
        }

        try {
          const stage = body.stage === "partial" ? "partial" : "final";
          const event = eventsRuntime.publishTranscriptSegment(
            body.roomCode,
            body.participantId,
            body.text,
            stage
          );
          console.info("[mote:backend:transcription] event:published", {
            roomCode: body.roomCode,
            participantId: body.participantId,
            stage,
            eventId: event.id
          });

          return { ok: true, eventId: event.id };
        } catch (error) {
          set.status = 400;
          return {
            message:
              error instanceof Error ? error.message : "Unable to publish transcription event."
          };
        }
      },
      {
        body: t.Object({
          roomCode: t.String({ minLength: 1 }),
          participantId: t.String({ minLength: 1 }),
          stage: t.Union([t.Literal("partial"), t.Literal("final")]),
          text: t.String({ minLength: 1, maxLength: 5_000 })
        })
      }
    )
    .ws("/ws/:code/:participantId", {
      open(ws) {
        const room = roomStore.getRoom(ws.data.params.code);
        const participant = roomStore.getParticipant(ws.data.params.code, ws.data.params.participantId);

        if (!room || !participant) {
          ws.close(1008, "Unknown room or participant");
          return;
        }

        const { existingProducers, participantStates } = mediaRuntime.attachSocket(
          room.code,
          ws.data.params.participantId,
          ws
        );

        ws.send(
          JSON.stringify({
            type: "connected",
            routerRtpCapabilities: mediaRuntime.getRouterCapabilities(),
            existingProducers,
            participantStates
          })
        );
      },
      async message(ws, message) {
        await mediaRuntime.handleMessage(
          ws.data.params.code,
          ws.data.params.participantId,
          ws,
          message
        );
      },
      close(ws) {
        mediaRuntime.closePeer(ws.data.params.code, ws.data.params.participantId);
        const removedParticipant = roomStore.removeParticipant(ws.data.params.code, ws.data.params.participantId);

        if (removedParticipant) {
          eventsRuntime.publishPresenceLeft(ws.data.params.code, ws.data.params.participantId);
        }
      }
    })
    .ws("/events/:code/:participantId", {
      open(ws) {
        const room = roomStore.getRoom(ws.data.params.code);
        const participant = roomStore.getParticipant(ws.data.params.code, ws.data.params.participantId);

        if (!room || !participant) {
          ws.close(1008, "Unknown room or participant");
          return;
        }

        const snapshot = eventsRuntime.attachSocket(room.code, ws.data.params.participantId, ws);
        ws.send(JSON.stringify({ type: "snapshot", snapshot }));
      },
      async message(ws, message) {
        await eventsRuntime.handleMessage(
          ws.data.params.code,
          ws.data.params.participantId,
          ws,
          message
        );
      },
      close(ws) {
        eventsRuntime.closeSocket(ws.data.params.code, ws.data.params.participantId);
      }
    });
