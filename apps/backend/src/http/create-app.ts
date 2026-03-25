import { cors } from "@elysiajs/cors";
import { Elysia, t } from "elysia";
import {
  type AgendaArtifact,
  type AgendaStatusPatch,
  DEFAULT_AGENDA_TOPICS,
  DEFAULT_ROOM_CAPACITY,
  EVENTS_CHANNEL_NAME,
  type FactCheckItem,
  type CreateRoomInput,
  type JoinRoomInput,
  type RoomResponseEnvelope,
  type RoomSummary,
  type TranscriptionProvider
} from "@mote/models";
import type { EventsRuntime } from "../events/runtime";
import type { AgendaRefinementClient } from "../agenda/refinement-client";
import { logger } from "../logger";
import type { IceConfig } from "../media/ice";
import { createIceServerBundle } from "../media/ice";
import type { MediaRuntime } from "../media/runtime";
import type { RoomStore } from "../store/room-store";

interface TranscriptionConfig {
  url: string;
  providers: Record<
    TranscriptionProvider,
    {
      model: string;
      language: string;
      sampleRate: number;
    }
  >;
}

const toRoomResponse = (
  room: RoomSummary,
  iceConfig: IceConfig,
  transcription: TranscriptionConfig,
  participantId?: string
): RoomResponseEnvelope => ({
  room,
  transcription: {
    provider: room.transcriptionProvider,
    model: room.transcriptionModel ?? transcription.providers[room.transcriptionProvider].model,
    language: transcription.providers[room.transcriptionProvider].language,
    sampleRate: transcription.providers[room.transcriptionProvider].sampleRate,
    mode: room.transcriptionProvider === "none" ? "disabled" : "realtime",
    transport: room.transcriptionProvider === "none" ? "none" : "websocket",
    url: room.transcriptionProvider === "none" ? "" : transcription.url
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
  aiServiceUrl: string,
  iceConfig: IceConfig,
  transcription: TranscriptionConfig,
  internalApiSecret: string
) => {
  const applyAgendaStatusPatch = (
    agendaArtifact: AgendaArtifact,
    patch: AgendaStatusPatch
  ): AgendaArtifact => {
    const pointPatchMap = new Map(patch.points.map((point) => [point.id, point]));

    return {
      ...agendaArtifact,
      points: agendaArtifact.points.map((point) => {
        const pointPatch = pointPatchMap.get(point.id);
        const subtopicPatchMap = new Map(
          (pointPatch?.subtopics ?? []).map((subtopic) => [subtopic.id, subtopic.status] as const)
        );

        return {
          ...point,
          status: pointPatch?.status ?? point.status,
          subtopics: point.subtopics.map((subtopic) => ({
            ...subtopic,
            status: subtopicPatchMap.get(subtopic.id) ?? subtopic.status
          }))
        };
      })
    };
  };

  const refineAgendaInBackground = async (
    roomCode: string,
    agenda: string[],
    meetingTitle: string | null | undefined,
    hostParticipantId: string
  ) => {
    const agendaLogger = logger.withContext({
      flow: "agenda_refinement",
      roomCode,
      hostParticipantId
    });

    try {
      agendaLogger.info("agenda.refine.requested", {
        meetingTitle: meetingTitle ?? null,
        promptAgenda: agenda
      });
      const refinement = await agendaRefinementClient.refine({
        roomCode,
        agenda,
        meetingTitle: meetingTitle ?? undefined,
        meetingGoal: "Create a guided meeting agenda for a live orchestration session."
      });

      const refinedAgenda = agendaRefinementClient.toPointwiseAgenda(refinement.artifact);
      const room = roomStore.updateAgenda(
        roomCode,
        refinedAgenda,
        refinement.artifact,
        refinement.artifact.meetingTitle
      );

      if (!room) {
        agendaLogger.warn("agenda.refine.room_missing");
        return;
      }

      eventsRuntime.publishAgendaUpdated(roomCode, room.agenda, room.agendaArtifact ?? null, hostParticipantId);
      agendaLogger.info("agenda.refined", {
        source: refinement.source,
        points: refinement.artifact.points.length,
        refinedAgenda: room.agenda,
        artifactTitle: refinement.artifact.meetingTitle
      });
    } catch (error) {
      agendaLogger.error("agenda.refine_failed", { error });
    }
  };

  const terminateRoomIfHostExitPolicyApplies = (
    roomCode: string,
    removedParticipantId: string,
    removedParticipantRole: RoomSummary["participants"][number]["role"]
  ) => {
    const room = roomStore.getRoom(roomCode);

    if (!room) {
      return false;
    }

    if (removedParticipantRole !== "host" || !room.policy.endMeetingOnHostExit) {
      return false;
    }

    const reason = "The meeting has ended because the host left.";
    eventsRuntime.publishMeetingEnded(roomCode, removedParticipantId, reason);
    mediaRuntime.closeRoom(roomCode, reason);
    eventsRuntime.closeRoom(roomCode, reason);
    roomStore.removeRoom(roomCode);
    return true;
  };

  return new Elysia()
    .use(
      cors({
        origin: true,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["content-type", "x-internal-api-secret"],
        credentials: true
      })
    )
    .options("/rooms", ({ set }) => {
      set.status = 204;
      return "";
    })
    .options("/rooms/:code", ({ set }) => {
      set.status = 204;
      return "";
    })
    .options("/rooms/:code/leave", ({ set }) => {
      set.status = 204;
      return "";
    })
    .options("/internal/transcription-events", ({ set }) => {
      set.status = 204;
      return "";
    })
    .options("/internal/agenda-status-patches", ({ set }) => {
      set.status = 204;
      return "";
    })
    .options("/internal/fact-check-events", ({ set }) => {
      set.status = 204;
      return "";
    })
    .get("/health", () => ({
      ok: true,
      service: "backend",
      transport: "elysia",
      sfu: "mediasoup",
      eventsChannel: EVENTS_CHANNEL_NAME,
      eventsTransport: "websocket"
    }))
    .get("/transcription/providers/status", async ({ set }) => {
      const requestLogger = logger.withContext({
        route: "/transcription/providers/status",
        method: "GET"
      });

      try {
        requestLogger.info("http.request.in");
        const response = await fetch(`${aiServiceUrl}/transcription/providers/status`);

        if (!response.ok) {
          throw new Error(`AI service returned ${response.status}`);
        }

        const payload = await response.json();
        requestLogger.info("http.response.out", {
          status: response.status,
          payload
        });
        return payload;
      } catch (error) {
        set.status = 502;
        requestLogger.error("http.response.error", { status: 502, error });
        return {
          message:
            error instanceof Error
              ? error.message
              : "Unable to load transcription provider status."
        };
      }
    })
    .get("/session-template", () => ({
      room: {
        slug: "demo-room",
        capacity: DEFAULT_ROOM_CAPACITY
      },
      policy: {
        endMeetingOnHostExit: true
      },
      agenda: DEFAULT_AGENDA_TOPICS,
      transcription: {
        provider: "none",
        model: transcription.providers.none.model,
        language: transcription.providers.none.language,
        sampleRate: transcription.providers.none.sampleRate,
        mode: "disabled",
        transport: "none",
        url: ""
      }
    }))
    .post(
      "/rooms",
      ({ body, set }) => {
        const requestLogger = logger.withContext({
          route: "/rooms",
          method: "POST"
        }).withMetadata({
          body
        });

        try {
          requestLogger.info("http.request.in");
          const input = body as CreateRoomInput;
          const promptAgenda = (input.agenda ?? []).map((item) => item.trim()).filter(Boolean);
          const promptTitle = input.meetingTitle?.trim() || undefined;

          if (!promptTitle && promptAgenda.length === 0) {
            throw new Error("Either a meeting title or at least one agenda item is required.");
          }

          const created = roomStore.createRoom({
            ...input,
            meetingTitle: promptTitle,
            agenda: promptAgenda
          });
          eventsRuntime.publishPresenceJoined(created.room.code, created.participant);

          const response = {
            participantId: created.participantId,
            ...toRoomResponse(created.room, iceConfig, transcription, created.participantId)
          };

          requestLogger.withContext({
            roomCode: created.room.code,
            participantId: created.participantId
          }).info("http.response.out", {
            status: 200,
            response
          });

          queueMicrotask(() => {
            void refineAgendaInBackground(
              created.room.code,
              promptAgenda,
              created.room.meetingTitle,
              created.participantId
            );
          });

          return response;
        } catch (error) {
          set.status = String(error).includes("required") ? 400 : 500;
          requestLogger.error("http.response.error", {
            status: set.status,
            error
          });
          return { message: error instanceof Error ? error.message : "Room creation failed." };
        }
      },
      {
        body: t.Object({
          displayName: t.String({ minLength: 1, maxLength: 40 }),
          meetingTitle: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
          transcriptionProvider: t.Optional(
            t.Union([
              t.Literal("none"),
              t.Literal("whisperlive"),
              t.Literal("sarvam"),
              t.Literal("openai")
            ])
          ),
          transcriptionModel: t.Optional(
            t.Union([
              t.Literal("gpt-4o-mini-transcribe"),
              t.Literal("gpt-4o-transcribe"),
              t.Literal("whisper-1")
            ])
          ),
          policy: t.Optional(
            t.Object({
              endMeetingOnHostExit: t.Optional(t.Boolean())
            })
          ),
          agenda: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 140 }), { maxItems: 8 }))
        })
      }
    )
    .post(
      "/rooms/:code",
      ({ body, params, set }) => {
        const requestLogger = logger.withContext({
          route: "/rooms/:code",
          method: "POST",
          roomCode: params.code
        }).withMetadata({
          body
        });

        try {
          requestLogger.info("http.request.in");
          const joined = roomStore.joinRoom(params.code, body as JoinRoomInput);
          eventsRuntime.publishPresenceJoined(joined.room.code, joined.participant);
          const response = {
            participantId: joined.participantId,
            ...toRoomResponse(joined.room, iceConfig, transcription, joined.participantId)
          };
          requestLogger.withContext({
            participantId: joined.participantId
          }).info("http.response.out", {
            status: 200,
            response
          });
          return response;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to join room.";
          set.status =
            message === "Room not found." ? 404 : message === "Room capacity reached." ? 409 : 400;
          requestLogger.error("http.response.error", {
            status: set.status,
            error
          });
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
        const requestLogger = logger.withContext({
          route: "/rooms/:code/leave",
          method: "POST",
          roomCode: params.code
        }).withMetadata({
          body
        });

        const participantId =
          typeof body?.participantId === "string" ? body.participantId.trim() : "";

        if (!participantId) {
          set.status = 400;
          requestLogger.error("http.response.error", {
            status: 400,
            error: new Error("Participant ID is required.")
          });
          return { message: "Participant ID is required." };
        }

        requestLogger.withContext({ participantId }).info("http.request.in");

        const removedParticipant = roomStore.removeParticipant(params.code, participantId);

        if (removedParticipant) {
          if (
            terminateRoomIfHostExitPolicyApplies(
              params.code,
              participantId,
              removedParticipant.role
            )
          ) {
            requestLogger.withContext({ participantId }).info("http.response.out", {
              status: 200,
              removed: true,
              roomEnded: true
            });
            return { ok: true, roomEnded: true };
          }

          eventsRuntime.publishPresenceLeft(params.code, participantId);
        }

        requestLogger.withContext({ participantId }).info("http.response.out", {
          status: 200,
          removed: Boolean(removedParticipant)
        });
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
      "/internal/agenda-status-patches",
      ({ body, headers, set }) => {
        if (headers["x-internal-api-secret"] !== internalApiSecret) {
          set.status = 401;
          return { message: "Unauthorized." };
        }

        try {
          const room = roomStore.getRoom(body.roomCode);

          if (!room?.agendaArtifact) {
            throw new Error("Room agenda artifact is unavailable.");
          }

          const nextArtifact = applyAgendaStatusPatch(room.agendaArtifact, body.patch);
          const nextAgenda = nextArtifact.points
            .map((point) => point.title.trim())
            .filter(Boolean)
            .slice(0, 8);
          const updatedRoom = roomStore.updateAgenda(
            body.roomCode,
            nextAgenda,
            nextArtifact,
            nextArtifact.meetingTitle
          );

          if (!updatedRoom) {
            throw new Error("Room not found.");
          }

          const event = eventsRuntime.publishAgendaUpdated(
            body.roomCode,
            updatedRoom.agenda,
            updatedRoom.agendaArtifact ?? null,
            null
          );

          logger.info("agenda.status_patch_published", {
            roomCode: body.roomCode,
            eventId: event.id,
            pointCount: nextArtifact.points.length
          });

          return { ok: true, eventId: event.id };
        } catch (error) {
          set.status = 400;
          return {
            message:
              error instanceof Error ? error.message : "Unable to publish agenda status patch."
          };
        }
      },
      {
        body: t.Object({
          roomCode: t.String({ minLength: 1 }),
          patch: t.Object({
            points: t.Array(
              t.Object({
                id: t.String({ minLength: 1 }),
                status: t.Union([
                  t.Literal("pending"),
                  t.Literal("active"),
                  t.Literal("partially_completed"),
                  t.Literal("completed")
                ]),
                subtopics: t.Array(
                  t.Object({
                    id: t.String({ minLength: 1 }),
                    status: t.Union([
                      t.Literal("pending"),
                      t.Literal("active"),
                      t.Literal("partially_completed"),
                      t.Literal("completed")
                    ])
                  })
                )
              })
            )
          })
        })
      }
    )
    .post(
      "/internal/fact-check-events",
      ({ body, headers, set }) => {
        if (headers["x-internal-api-secret"] !== internalApiSecret) {
          set.status = 401;
          return { message: "Unauthorized." };
        }

        try {
          const room = roomStore.getRoom(body.roomCode);

          if (!room) {
            throw new Error("Room not found.");
          }

          const targetParticipantId =
            body.targetParticipantId ??
            room.participants.find((participant) => participant.role === "host")?.id;

          if (!targetParticipantId) {
            throw new Error("No fact check recipient is available.");
          }

          const event = eventsRuntime.publishFactCheckPrivate(
            body.roomCode,
            null,
            targetParticipantId,
            body.windowStartedAt,
            body.windowEndedAt,
            body.items as FactCheckItem[]
          );

          logger.info("fact_check.event_published", {
            roomCode: body.roomCode,
            targetParticipantId,
            itemCount: body.items.length,
            eventId: event.id
          });

          return { ok: true, eventId: event.id };
        } catch (error) {
          set.status = 400;
          return {
            message:
              error instanceof Error ? error.message : "Unable to publish fact check event."
          };
        }
      },
      {
        body: t.Object({
          roomCode: t.String({ minLength: 1 }),
          targetParticipantId: t.Optional(t.String({ minLength: 1 })),
          windowStartedAt: t.String({ minLength: 1 }),
          windowEndedAt: t.String({ minLength: 1 }),
          items: t.Array(
            t.Object({
              id: t.String({ minLength: 1 }),
              severity: t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high")]),
              claim: t.String({ minLength: 1, maxLength: 240 }),
              correction: t.String({ minLength: 1, maxLength: 240 }),
              rationale: t.String({ minLength: 1, maxLength: 320 })
            }),
            { maxItems: 5 }
          )
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
          logger.info("transcription.event_published", {
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
          if (
            terminateRoomIfHostExitPolicyApplies(
              ws.data.params.code,
              ws.data.params.participantId,
              removedParticipant.role
            )
          ) {
            return;
          }

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
};
