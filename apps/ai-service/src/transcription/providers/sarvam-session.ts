import { SarvamAIClient } from "sarvamai";
import type {
  RealtimeTranscriptionCallbacks,
  RealtimeTranscriptionProviderSession
} from "./types";

const float32ToPcmS16Le = (buffer: ArrayBuffer) => {
  const samples = new Float32Array(buffer);
  const output = new Int16Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output.buffer;
};

const pcmS16LeToWav = (pcmBuffer: ArrayBuffer, sampleRate: number) => {
  const pcmBytes = new Uint8Array(pcmBuffer);
  const wavBuffer = new ArrayBuffer(44 + pcmBytes.byteLength);
  const view = new DataView(wavBuffer);
  const bytes = new Uint8Array(wavBuffer);

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcmBytes.byteLength, true);
  bytes.set(pcmBytes, 44);

  return wavBuffer;
};

const encodeBase64 = (buffer: ArrayBuffer) =>
  Buffer.from(new Uint8Array(buffer)).toString("base64");

const concatenateBuffers = (buffers: ArrayBuffer[]) => {
  const totalBytes = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;

  for (const buffer of buffers) {
    const bytes = new Uint8Array(buffer);
    merged.set(bytes, offset);
    offset += bytes.byteLength;
  }

  return merged.buffer;
};

export const createSarvamSession = (
  config: {
    url: string;
    apiKey: string;
    model: string;
    mode: "transcribe";
    languageCode: string;
    sampleRate: number;
    inputAudioCodec: "pcm_s16le";
    highVadSensitivity: boolean;
    vadSignals: boolean;
    flushSignal: boolean;
  },
  callbacks: RealtimeTranscriptionCallbacks
): RealtimeTranscriptionProviderSession => {
  let socket: Awaited<ReturnType<SarvamAIClient["speechToTextStreaming"]["connect"]>> | null = null;
  let nonTranscriptMessageCount = 0;
  let flushTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingPcmChunks: ArrayBuffer[] = [];
  let pendingPcmBytes = 0;
  let readyEmitted = false;
  const minChunkBytes = Math.max(3200, Math.round(config.sampleRate * 2 * 0.2));

  const client = new SarvamAIClient({
    apiSubscriptionKey: config.apiKey
  });

  const scheduleFlush = () => {
    if (flushTimeoutId) {
      clearTimeout(flushTimeoutId);
    }

    flushTimeoutId = setTimeout(() => {
      try {
        socket?.flush();
      } catch (error) {
        callbacks.onWarning?.(
          error instanceof Error ? error.message : "Sarvam flush failed."
        );
      }
    }, 900);
  };

  const flushPendingAudio = () => {
    if (!socket || socket.readyState !== 1 || pendingPcmBytes === 0) {
      return;
    }

    const pcmChunk = concatenateBuffers(pendingPcmChunks);
    const wavChunk = pcmS16LeToWav(pcmChunk, config.sampleRate);

    socket.transcribe({
      audio: encodeBase64(wavChunk),
      sample_rate: config.sampleRate,
      encoding: "audio/wav"
    });

    pendingPcmChunks = [];
    pendingPcmBytes = 0;
  };

  const emitReady = () => {
    if (readyEmitted) {
      return;
    }

    readyEmitted = true;
    callbacks.onReady?.();
  };

  return {
    async connect() {
      if (!config.apiKey.trim()) {
        throw new Error("Sarvam API key is not configured.");
      }

      if (socket && socket.readyState <= 1) {
        return;
      }

      socket = await client.speechToTextStreaming.connect({
        model: config.model,
        mode: config.mode,
        "language-code": config.languageCode,
        sample_rate: String(config.sampleRate),
        input_audio_codec: config.inputAudioCodec,
        high_vad_sensitivity: config.highVadSensitivity ? "true" : "false",
        vad_signals: config.vadSignals ? "true" : "false",
        flush_signal: config.flushSignal ? "true" : "false",
        "Api-Subscription-Key": config.apiKey,
        debug: false,
        reconnectAttempts: 3
      } as any);

      socket.on("open", () => {
        emitReady();
      });

      socket.on("message", (payload) => {
        if (payload.type === "error") {
          const errorMessage =
            "error" in payload.data && typeof payload.data.error === "string"
              ? payload.data.error
              : JSON.stringify(payload.data);
          callbacks.onWarning?.(`Sarvam error: ${errorMessage}`);
          return;
        }

        if ("type" in payload && payload.type && payload.type !== "data") {
          callbacks.onInfo?.(`Sarvam payload: ${JSON.stringify(payload)}`);
        }

        const transcript =
          payload.type === "data" &&
          "transcript" in payload.data &&
          typeof payload.data.transcript === "string"
            ? payload.data.transcript.trim()
            : "";

        if (!transcript) {
          if (nonTranscriptMessageCount < 5) {
            nonTranscriptMessageCount += 1;
            callbacks.onInfo?.(`Sarvam payload: ${JSON.stringify(payload)}`);
          }
          return;
        }

        callbacks.onFinal?.({
          text: transcript,
          completed: true
        });
      });

      socket.on("error", (error) => {
        callbacks.onError?.(
          error instanceof Error ? error.message : "Sarvam transcription connection failed."
        );
      });

      socket.on("close", () => {
        callbacks.onInfo?.("Sarvam provider socket closed.");
        socket = null;
        readyEmitted = false;
      });

      await socket.waitForOpen();
      emitReady();
    },
    sendAudioChunk(chunk) {
      if (!socket || socket.readyState !== 1) {
        throw new Error("Sarvam transcription socket is not connected.");
      }

      const pcmChunk = float32ToPcmS16Le(chunk);
      pendingPcmChunks.push(pcmChunk);
      pendingPcmBytes += pcmChunk.byteLength;

      if (pendingPcmBytes >= minChunkBytes) {
        flushPendingAudio();
      }

      scheduleFlush();
    },
    close() {
      if (flushTimeoutId) {
        clearTimeout(flushTimeoutId);
        flushTimeoutId = null;
      }

      try {
        flushPendingAudio();
        socket?.flush();
      } catch {}

      socket?.close();
      socket = null;
      readyEmitted = false;
    }
  };
};
