import OpenAI from "openai";
import { OpenAIRealtimeWebSocket } from "openai/beta/realtime/websocket";
import type {
  ConversationItemInputAudioTranscriptionCompletedEvent,
  ConversationItemInputAudioTranscriptionDeltaEvent,
  ConversationItemInputAudioTranscriptionFailedEvent
} from "openai/resources/beta/realtime/realtime";
import type {
  RealtimeTranscriptionCallbacks,
  RealtimeTranscriptionProviderSession
} from "./types";

const encodeBase64 = (buffer: ArrayBuffer) =>
  Buffer.from(new Uint8Array(buffer)).toString("base64");

const resampleFloat32 = (
  input: Float32Array,
  fromSampleRate: number,
  toSampleRate: number
) => {
  if (fromSampleRate === toSampleRate) {
    return input;
  }

  const outputLength = Math.max(1, Math.round(input.length * (toSampleRate / fromSampleRate)));
  const output = new Float32Array(outputLength);
  const ratio = fromSampleRate / toSampleRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const lowerIndex = Math.floor(sourceIndex);
    const upperIndex = Math.min(input.length - 1, lowerIndex + 1);
    const mix = sourceIndex - lowerIndex;
    const lower = input[lowerIndex] ?? 0;
    const upper = input[upperIndex] ?? lower;
    output[index] = lower + (upper - lower) * mix;
  }

  return output;
};

const float32ToPcm16 = (buffer: ArrayBuffer, inputSampleRate: number, outputSampleRate: number) => {
  const source = new Float32Array(buffer);
  const resampled = resampleFloat32(source, inputSampleRate, outputSampleRate);
  const output = new Int16Array(resampled.length);

  for (let index = 0; index < resampled.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, resampled[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output.buffer;
};

export const createOpenAiRealtimeSession = (
  config: {
    apiKey: string;
    baseUrl: string;
    model: "whisper-1";
    language: string;
    sampleRate: number;
    inputSampleRate: number;
    noiseReductionType: "near_field" | "far_field";
    turnDetection: {
      type: "server_vad";
      threshold: number;
      prefixPaddingMs: number;
      silenceDurationMs: number;
    };
  },
  callbacks: RealtimeTranscriptionCallbacks
): RealtimeTranscriptionProviderSession => {
  let socket: OpenAIRealtimeWebSocket | null = null;
  let closed = false;
  let ready = false;
  const partialsByItemId = new Map<string, string>();

  const emitReady = () => {
    if (ready || closed) {
      return;
    }

    ready = true;
    callbacks.onReady?.();
  };

  const attachEventHandlers = (client: OpenAIRealtimeWebSocket) => {
    client.on("transcription_session.updated", () => {
      callbacks.onInfo?.("OpenAI transcription session updated.");
      emitReady();
    });

    client.on(
      "conversation.item.input_audio_transcription.delta",
      (event: ConversationItemInputAudioTranscriptionDeltaEvent) => {
        if (closed || !event.delta?.trim()) {
          return;
        }

        const nextTranscript = `${partialsByItemId.get(event.item_id) ?? ""}${event.delta}`;
        partialsByItemId.set(event.item_id, nextTranscript);
        callbacks.onPartial?.({
          text: nextTranscript.trim(),
          completed: false
        });
      }
    );

    client.on(
      "conversation.item.input_audio_transcription.completed",
      (event: ConversationItemInputAudioTranscriptionCompletedEvent) => {
        if (closed || !event.transcript.trim()) {
          return;
        }

        partialsByItemId.delete(event.item_id);
        callbacks.onFinal?.({
          text: event.transcript.trim(),
          completed: true
        });
      }
    );

    client.on(
      "conversation.item.input_audio_transcription.failed",
      (event: ConversationItemInputAudioTranscriptionFailedEvent) => {
        if (closed) {
          return;
        }

        partialsByItemId.delete(event.item_id);
        callbacks.onWarning?.(
          event.error?.message?.trim() || "OpenAI transcription failed for an audio segment."
        );
      }
    );

    client.on("error", (error) => {
      if (!closed) {
        callbacks.onError?.(error.message);
      }
    });

    client.socket.addEventListener("close", () => {
      partialsByItemId.clear();
      ready = false;
      socket = null;

      if (!closed) {
        callbacks.onWarning?.("OpenAI transcription socket closed.");
      }
    });
  };

  return {
    async connect() {
      if (!config.apiKey.trim()) {
        throw new Error("OpenAI API key is not configured.");
      }

      if (socket && socket.socket.readyState <= 1) {
        return;
      }

      closed = false;
      ready = false;
      partialsByItemId.clear();

      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl
      });
      const transcriptionSession = await client.beta.realtime.transcriptionSessions.create({
        input_audio_format: "pcm16",
        input_audio_noise_reduction: {
          type: config.noiseReductionType
        },
        input_audio_transcription: {
          language: config.language,
          model: config.model
        },
        turn_detection: {
          type: config.turnDetection.type,
          threshold: config.turnDetection.threshold,
          prefix_padding_ms: config.turnDetection.prefixPaddingMs,
          silence_duration_ms: config.turnDetection.silenceDurationMs
        }
      });

      callbacks.onInfo?.("OpenAI transcription session created.");

      const realtimeClient = new OpenAI({
        apiKey: transcriptionSession.client_secret.value,
        baseURL: config.baseUrl
      });
      const realtime = new OpenAIRealtimeWebSocket(
        {
          model: "gpt-realtime",
          onURL: (url) => {
            url.searchParams.delete("model");
          }
        },
        realtimeClient as any
      );

      socket = realtime;
      attachEventHandlers(realtime);

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error("Timed out while opening OpenAI transcription session."));
          }
        }, 8_000);

        const settleSuccess = () => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeoutId);
          resolve();
        };

        const settleFailure = (error: Error) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        };

        const settleOnOpen = () => {
          callbacks.onInfo?.("OpenAI transcription socket opened.");
          emitReady();
          settleSuccess();
        };

        realtime.once("error", settleFailure);

        if (realtime.socket.readyState === 1) {
          settleOnOpen();
          return;
        }

        realtime.socket.addEventListener("open", settleOnOpen, { once: true });
        realtime.socket.addEventListener("error", (error: Event) => {
          const event = error as ErrorEvent;
          settleFailure(
            event instanceof Error
              ? event
              : event.error instanceof Error
                ? event.error
              : new Error("Unable to open OpenAI transcription socket.")
          );
        }, { once: true });
      });
    },
    sendAudioChunk(chunk) {
      if (!socket || socket.socket.readyState !== 1) {
        throw new Error("OpenAI transcription socket is not connected.");
      }

      const pcm16Chunk = float32ToPcm16(chunk, config.inputSampleRate, config.sampleRate);

      socket.send({
        type: "input_audio_buffer.append",
        audio: encodeBase64(pcm16Chunk)
      });
    },
    close() {
      closed = true;
      ready = false;
      partialsByItemId.clear();
      socket?.close({
        code: 1000,
        reason: "Closing transcription session."
      });
      socket = null;
    }
  };
};
