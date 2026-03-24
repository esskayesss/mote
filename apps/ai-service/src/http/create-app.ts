import { Elysia } from "elysia";
import {
  AI_EVENT_TYPES,
  DEFAULT_AGENDA_TOPICS,
  EVENTS_CHANNEL_NAME
} from "@mote/models";
import type { TranscriptionRuntime } from "../transcription/runtime";

export const createApp = (
  transcriptionRuntime: TranscriptionRuntime,
  backendUrl: string
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
