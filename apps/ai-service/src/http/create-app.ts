import { Elysia, t } from "elysia";
import {
  AI_EVENT_TYPES,
  DEFAULT_AGENDA_TOPICS,
  EVENTS_CHANNEL_NAME
} from "@mote/models";
import { logger } from "../logger";
import type { TranscriptionRuntime } from "../transcription/runtime";
import type { RefineAgendaWorkflowResult } from "../workflows/agenda/refine-agenda-workflow";

export const createApp = (
  transcriptionRuntime: TranscriptionRuntime,
  backendUrl: string,
  refineAgenda: (input: {
    agenda?: string[];
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
    .get("/transcription/providers/status", async () => transcriptionRuntime.getProviderStatuses())
    .post(
      "/artifacts/agenda/refine",
      async ({ body, set }) => {
        const requestLogger = logger.withContext({
          route: "/artifacts/agenda/refine",
          method: "POST",
          roomCode: body.roomCode ?? null
        }).withMetadata({
          requestBody: body
        });

        try {
          const normalizedAgenda = (body.agenda ?? []).map((item) => item.trim()).filter(Boolean);
          const normalizedTitle = body.meetingTitle?.trim() || undefined;
          const normalizedGoal = body.meetingGoal?.trim() || undefined;

          if (!normalizedTitle && !normalizedGoal && normalizedAgenda.length === 0) {
            throw new Error(
              "Agenda refinement requires a meeting title, meeting goal, or at least one agenda item."
            );
          }

          requestLogger.info("http.request.in");
          const result = await refineAgenda({
            ...body,
            agenda: normalizedAgenda,
            meetingTitle: normalizedTitle,
            meetingGoal: normalizedGoal
          });

          if (!result?.artifact || !Array.isArray(result.artifact.points)) {
            throw new Error("Agenda refinement returned an invalid artifact.");
          }

          requestLogger.info("http.response.out", {
            status: 200,
            resultSummary: {
              source: result.source,
              meetingTitle: result.artifact.meetingTitle,
              pointCount: result.artifact.points.length,
              pointTitles: result.artifact.points.map((point) => point.title)
            }
          });
          requestLogger.info("agenda.refined", {
            source: result.source,
            points: result.artifact.points.length
          });

          return result;
        } catch (error) {
          requestLogger.error("http.response.error", { status: 400, error });
          requestLogger.error("agenda.refine_failed", { error });
          set.status = 400;
          return {
            message:
              error instanceof Error ? error.message : "Unable to refine meeting agenda."
          };
        }
      },
      {
        body: t.Object({
          agenda: t.Optional(
            t.Array(t.String({ minLength: 1, maxLength: 240 }), {
              maxItems: 12
            })
          ),
          roomCode: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
          meetingTitle: t.Optional(t.String({ minLength: 1, maxLength: 160 })),
          meetingGoal: t.Optional(t.String({ minLength: 1, maxLength: 240 }))
        })
      }
    )
    .ws("/transcribe/:code/:participantId", {
      async open(ws) {
        const socketLogger = logger.withContext({
          route: "/transcribe/:code/:participantId",
          roomCode: ws.data.params.code,
          participantId: ws.data.params.participantId
        });

        try {
          socketLogger.info("transcription.socket_open");
          const roomContext = await transcriptionRuntime.validateParticipant(
            backendUrl,
            ws.data.params.code,
            ws.data.params.participantId
          );
          socketLogger.withMetadata({
            transcription: roomContext.transcription
          }).info("transcription.socket_validated");
          await transcriptionRuntime.attachSocket(
            ws.data.params.code,
            ws.data.params.participantId,
            ws,
            roomContext.transcription
          );
        } catch (error) {
          socketLogger.error("transcription.socket_open_failed", { error });
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
        logger.withContext({
          route: "/transcribe/:code/:participantId",
          roomCode: ws.data.params.code,
          participantId: ws.data.params.participantId
        }).withMetadata({
          messageType:
            typeof message === "string"
              ? "string"
              : message instanceof ArrayBuffer
                ? "arraybuffer"
                : ArrayBuffer.isView(message)
                  ? "typed-array"
                  : typeof message
        }).info("transcription.socket_message_in");
        transcriptionRuntime.handleMessage(
          ws.data.params.code,
          ws.data.params.participantId,
          message
        );
      },
      close(ws) {
        logger.withContext({
          route: "/transcribe/:code/:participantId",
          roomCode: ws.data.params.code,
          participantId: ws.data.params.participantId
        }).info("transcription.socket_close");
        transcriptionRuntime.closeSocket(
          ws.data.params.code,
          ws.data.params.participantId
        );
      }
    });
