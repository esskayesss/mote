import { Elysia, t } from "elysia";
import {
  AI_EVENT_TYPES,
  DEFAULT_AGENDA_TOPICS,
  EVENTS_CHANNEL_NAME
} from "@mote/models";
import type { TranscriptionRuntime } from "../transcription/runtime";
import type { RefineAgendaWorkflowResult } from "../workflows/agenda/refine-agenda-workflow";

export const createApp = (
  transcriptionRuntime: TranscriptionRuntime,
  backendUrl: string,
  refineAgenda: (input: {
    agenda: string[];
    roomCode?: string;
    meetingTitle?: string;
    meetingGoal?: string;
  }) => Promise<RefineAgendaWorkflowResult>
) =>
  new Elysia()
    .get("/health", () => ({
      ok: true,
      service: "ai-service",
      channel: EVENTS_CHANNEL_NAME
    }))
    .get("/agent-preview", () => ({
      modes: AI_EVENT_TYPES,
      suggestedNextTopic: DEFAULT_AGENDA_TOPICS[1]
    }))
    .post(
      "/artifacts/agenda/refine",
      async ({ body, set }) => {
        try {
          const result = await refineAgenda(body);

          console.info("[mote:ai-service] agenda:refined", {
            roomCode: body.roomCode ?? null,
            source: result.source,
            points: result.artifact.points.length
          });

          return result;
        } catch (error) {
          console.error("[mote:ai-service] agenda:refine failed", {
            roomCode: body.roomCode ?? null,
            error
          });
          set.status = 400;
          return {
            message:
              error instanceof Error ? error.message : "Unable to refine meeting agenda."
          };
        }
      },
      {
        body: t.Object({
          agenda: t.Array(t.String({ minLength: 1, maxLength: 240 }), {
            minItems: 1,
            maxItems: 12
          }),
          roomCode: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
          meetingTitle: t.Optional(t.String({ minLength: 1, maxLength: 160 })),
          meetingGoal: t.Optional(t.String({ minLength: 1, maxLength: 240 }))
        })
      }
    )
    .ws("/transcribe/:code/:participantId", {
      async open(ws) {
        try {
          console.info("[mote:ai-service] socket:open", {
            roomCode: ws.data.params.code,
            participantId: ws.data.params.participantId
          });
          await transcriptionRuntime.validateParticipant(
            backendUrl,
            ws.data.params.code,
            ws.data.params.participantId
          );
          await transcriptionRuntime.attachSocket(
            ws.data.params.code,
            ws.data.params.participantId,
            ws
          );
        } catch (error) {
          console.error("[mote:ai-service] socket:open failed", {
            roomCode: ws.data.params.code,
            participantId: ws.data.params.participantId,
            error
          });
          ws.send(
            JSON.stringify({
              type: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "Unable to initialize transcription session."
            })
          );
          ws.close(1008, "Transcription rejected");
        }
      },
      message(ws, message) {
        transcriptionRuntime.handleMessage(
          ws.data.params.code,
          ws.data.params.participantId,
          message
        );
      },
      close(ws) {
        console.info("[mote:ai-service] socket:close", {
          roomCode: ws.data.params.code,
          participantId: ws.data.params.participantId
        });
        transcriptionRuntime.closeSocket(
          ws.data.params.code,
          ws.data.params.participantId
        );
      }
    });
