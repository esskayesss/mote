import { MicVAD } from "@ricky0123/vad-web";
import { logger } from "../logger";

type TranscriptionConnectionState = "idle" | "connecting" | "connected" | "error";

const VAD_ASSET_BASE_URL = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/";
const ONNX_WASM_BASE_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
const VAD_PREROLL_FRAMES = 8;
const BASE64_CHUNK_BYTES = 0x8000;

type RuntimeSession = {
  roomCode: string;
  participantId: string;
  url: string;
  targetSampleRate: number;
  socket: WebSocket;
  vad: MicVAD;
  isVoiceActive: boolean;
  isStreamingAudio: boolean;
  prerollChunks: ArrayBuffer[];
  lastTrackEnabled: boolean;
};

const cloneFrameBuffer = (frame: Float32Array) => {
  const chunkBytes = new Uint8Array(frame.byteLength);
  chunkBytes.set(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
  return chunkBytes.buffer;
};

const encodeBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(index, index + BASE64_CHUNK_BYTES);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const serializeAudioFrame = (buffer: ArrayBuffer) =>
  JSON.stringify({
    type: "audio",
    data: encodeBase64(buffer)
  });

export class DemoTranscriptionSession {
  private session: RuntimeSession | null = null;

  constructor(
    private readonly onConnectionState: (state: TranscriptionConnectionState) => void,
    private readonly onError: (message: string) => void
  ) {}

  private log(message: string, details?: Record<string, unknown>) {
    logger.info(`transcription.${message.replace(/:/g, "_")}`, details ?? {});
  }

  private flushPreroll(session: RuntimeSession) {
    for (const chunk of session.prerollChunks) {
      session.socket.send(serializeAudioFrame(chunk));
    }

    session.prerollChunks = [];
  }

  private startStreamingAudio(session: RuntimeSession, details?: Record<string, unknown>) {
    if (session.isStreamingAudio) {
      return;
    }

    session.isStreamingAudio = true;
    this.log("audio:stream started", {
      roomCode: session.roomCode,
      participantId: session.participantId,
      ...(details ?? {})
    });
  }

  private pauseStreamingAudio(session: RuntimeSession, details?: Record<string, unknown>) {
    if (!session.isStreamingAudio) {
      return;
    }

    session.isStreamingAudio = false;
    this.log("audio:stream paused", {
      roomCode: session.roomCode,
      participantId: session.participantId,
      ...(details ?? {})
    });
  }

  async connect(
    endpointUrl: string,
    roomCode: string,
    participantId: string,
    localStream: MediaStream,
    sampleRate: number
  ) {
    if (
      this.session &&
      this.session.roomCode === roomCode &&
      this.session.participantId === participantId &&
      this.session.url === endpointUrl
    ) {
      return;
    }

    const audioTrack = localStream.getAudioTracks()[0];

    if (!audioTrack) {
      return;
    }

    this.close();
    this.onConnectionState("connecting");
    this.log("connect:start", { endpointUrl, roomCode, participantId, sampleRate });

    const socket = new WebSocket(`${endpointUrl}/${roomCode}/${participantId}`);
    socket.binaryType = "arraybuffer";

    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("Unable to connect transcription uplink.")),
          { once: true }
        );
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to connect transcription uplink.";
      this.log("socket:open failed", { endpointUrl, roomCode, participantId, message });
      this.onConnectionState("error");
      this.onError(message);
      throw error;
    }

    this.log("socket:open", { endpointUrl, roomCode, participantId });

    const vad = await MicVAD.new({
      model: "v5",
      startOnLoad: false,
      processorType: "ScriptProcessor",
      baseAssetPath: VAD_ASSET_BASE_URL,
      onnxWASMBasePath: ONNX_WASM_BASE_URL,
      positiveSpeechThreshold: 0.72,
      negativeSpeechThreshold: 0.45,
      redemptionMs: 900,
      preSpeechPadMs: 250,
      minSpeechMs: 150,
      submitUserSpeechOnPause: false,
      getStream: async () => new MediaStream([audioTrack]),
      pauseStream: async () => undefined,
      resumeStream: async (stream) => stream,
      onSpeechStart: () => {
        const activeSession = this.session;

        if (!activeSession) {
          return;
        }

        this.log("audio:voice started", {
          roomCode,
          participantId
        });
      },
      onSpeechRealStart: () => {
        const activeSession = this.session;

        if (!activeSession) {
          return;
        }

        activeSession.isVoiceActive = true;
        this.startStreamingAudio(activeSession, {
          reason: "voice-detected",
          prerollFrames: activeSession.prerollChunks.length
        });
        this.flushPreroll(activeSession);
      },
      onSpeechEnd: (audio) => {
        const activeSession = this.session;

        if (!activeSession) {
          return;
        }

        activeSession.isVoiceActive = false;
        this.log("audio:voice ended", {
          roomCode,
          participantId,
          samples: audio.length,
          approximateDurationMs: Math.round((audio.length / 16_000) * 1000)
        });
        this.pauseStreamingAudio(activeSession, { reason: "voice-ended" });
      },
      onVADMisfire: () => {
        const activeSession = this.session;

        if (!activeSession) {
          return;
        }

        activeSession.isVoiceActive = false;
        activeSession.prerollChunks = [];
        this.log("audio:voice misfire", {
          roomCode,
          participantId
        });
      },
      onFrameProcessed: (_probabilities, frame) => {
        const activeSession = this.session;

        if (!activeSession || socket.readyState !== WebSocket.OPEN) {
          return;
        }

        if (audioTrack.readyState !== "live") {
          this.pauseStreamingAudio(activeSession, { reason: "track-ended" });
          activeSession.isVoiceActive = false;
          activeSession.prerollChunks = [];
          return;
        }

        if (!audioTrack.enabled) {
          if (activeSession.lastTrackEnabled) {
            this.log("audio:stream interrupted", {
              roomCode,
              participantId,
              reason: "track-disabled"
            });
            this.pauseStreamingAudio(activeSession, { reason: "track-disabled" });
          }

          activeSession.lastTrackEnabled = false;
          activeSession.isVoiceActive = false;
          activeSession.prerollChunks = [];
          return;
        }

        if (!activeSession.lastTrackEnabled) {
          this.log("audio:stream resumed", {
            roomCode,
            participantId,
            reason: "track-enabled"
          });
        }

        activeSession.lastTrackEnabled = true;

        const chunkBuffer = cloneFrameBuffer(frame);

        if (!activeSession.isStreamingAudio) {
          activeSession.prerollChunks.push(chunkBuffer);

          if (activeSession.prerollChunks.length > VAD_PREROLL_FRAMES) {
            activeSession.prerollChunks.shift();
          }
        }

        if (activeSession.isVoiceActive) {
          socket.send(serializeAudioFrame(chunkBuffer));
        }
      }
    });

    await vad.start();

    this.log("audio:vad ready", {
      roomCode,
      participantId,
      model: "v5",
      targetSampleRate: sampleRate
    });

    this.session = {
      roomCode,
      participantId,
      url: endpointUrl,
      targetSampleRate: sampleRate,
      socket,
      vad,
      isVoiceActive: false,
      isStreamingAudio: false,
      prerollChunks: [],
      lastTrackEnabled: audioTrack.enabled
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { type?: string; message?: string };

        if (payload.type === "ready") {
          this.log("socket:ready", { roomCode, participantId });
          this.onConnectionState("connected");
          return;
        }

        if (payload.type === "error" && payload.message) {
          this.log("socket:error", { roomCode, participantId, message: payload.message });
          this.onConnectionState("error");
          this.onError(payload.message);
        }
      } catch (error) {
        logger.error("transcription.socket_message_failed", { error });
      }
    };

    socket.onclose = () => {
      this.log("socket:closed", { roomCode, participantId });
      this.onConnectionState("idle");
    };
  }

  close() {
    if (!this.session) {
      this.onConnectionState("idle");
      return;
    }

    this.pauseStreamingAudio(this.session, { reason: "session-closed" });
    void this.session.vad.destroy();

    if (
      this.session.socket.readyState === WebSocket.OPEN ||
      this.session.socket.readyState === WebSocket.CONNECTING
    ) {
      this.session.socket.close();
    }

    this.session = null;
    this.onConnectionState("idle");
  }
}
