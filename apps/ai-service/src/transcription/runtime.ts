import type {
  RoomResponseEnvelope,
  TranscriptionProvider,
  TranscriptionProviderStatusResponse
} from "@mote/models";
import type { BackendTranscriptPublisher } from "./backend-publisher";
import { logger } from "../logger";
import type { MeetingMonitoringRuntime } from "../monitoring/runtime";
import { createOpenAiRealtimeSession } from "./providers/openai-realtime-session";
import { createSarvamSession } from "./providers/sarvam-session";
import type {
  RealtimeTranscriptionCallbacks,
  RealtimeTranscriptionProviderSession
} from "./providers/types";
import { createWhisperLiveSession } from "./providers/whisperlive-session";

export interface BrowserSocket {
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
  readyState?: number;
}

type RoomTranscriptionConfig = RoomResponseEnvelope["transcription"];

const decodeBase64Audio = (encoded: string) => {
  const bytes = Buffer.from(encoded, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const decodeMessage = (message: unknown) => {
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    "data" in message
  ) {
    const payload = message as {
      type?: string;
      data?: string;
    };

    if (payload.type === "audio" && typeof payload.data === "string") {
      return decodeBase64Audio(payload.data);
    }
  }

  if (typeof message === "string") {
    if (message === "ping") {
      return message;
    }

    try {
      const payload = JSON.parse(message) as {
        type?: string;
        data?: string;
      };

      if (payload.type === "audio" && typeof payload.data === "string") {
        return decodeBase64Audio(payload.data);
      }
    } catch {}

    return message;
  }

  if (message instanceof ArrayBuffer) {
    return message;
  }

  if (ArrayBuffer.isView(message)) {
    const chunk = new Uint8Array(message.byteLength);
    chunk.set(new Uint8Array(message.buffer, message.byteOffset, message.byteLength));
    return chunk.buffer;
  }

  return null;
};

const cloneBuffer = (buffer: ArrayBuffer) => buffer.slice(0);
const isSocketOpen = (socket: BrowserSocket | null) =>
  socket !== null &&
  (socket.readyState === undefined || socket.readyState === WebSocket.OPEN);

export class ParticipantTranscriptionSession {
  private browserSocket: BrowserSocket | null = null;
  private readonly providerSession: RealtimeTranscriptionProviderSession;
  private providerReady = false;
  private pendingAudio: ArrayBuffer[] = [];
  private lastPartialText = "";
  private publishedFinalKeys = new Set<string>();
  private readyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly roomCode: string,
    private readonly participantId: string,
    private readonly publisher: BackendTranscriptPublisher,
    private readonly monitoringRuntime: MeetingMonitoringRuntime,
    private readonly providerName: TranscriptionProvider,
    private readonly providerTarget: string,
    providerSessionFactory: (callbacks: RealtimeTranscriptionCallbacks) => RealtimeTranscriptionProviderSession
  ) {
    const sessionLogger = logger.withContext({
      roomCode,
      participantId,
      provider: this.providerName,
      providerTarget: this.providerTarget
    });
    const sendToBrowserSocket = (payload: string) => {
      const socket = this.browserSocket;

      if (this.closed || socket === null || !isSocketOpen(socket)) {
        sessionLogger.warn("transcription.browser_socket_send_skipped", {
          reason: this.closed ? "session_closed" : "socket_not_open"
        });
        return false;
      }

      try {
        sessionLogger.withMetadata({ payload }).info("transcription.browser_socket_out");
        socket.send(payload);
        return true;
      } catch (error) {
        sessionLogger.warn("transcription.browser_socket_send_failed", { error });
        return false;
      }
    };

    this.providerSession = providerSessionFactory({
      onReady: () => {
        if (this.closed) {
          return;
        }

        if (this.readyTimeoutId) {
          clearTimeout(this.readyTimeoutId);
          this.readyTimeoutId = null;
        }

        sessionLogger.info("transcription.provider_ready", {
          bufferedChunks: this.pendingAudio.length
        });
        this.providerReady = true;
        const payload = JSON.stringify({ type: "ready" });
        sendToBrowserSocket(payload);

        for (const chunk of this.pendingAudio) {
          this.providerSession.sendAudioChunk(chunk);
        }

        this.pendingAudio = [];
      },
      onPartial: (segment) => {
        if (this.closed) {
          return;
        }

        if (!segment.text || segment.text === this.lastPartialText) {
          return;
        }

        sessionLogger.info("transcription.partial", {
          text: segment.text
        });
        this.lastPartialText = segment.text;
        this.monitoringRuntime.observePartialTranscript(
          this.roomCode,
          this.participantId,
          segment.text
        );
        void this.publisher
          .publishSegment(this.roomCode, this.participantId, "partial", segment.text)
          .catch((error) => {
            sessionLogger.error("transcription.partial_publish_failed", { error });
          });
      },
      onFinal: (segment) => {
        if (this.closed) {
          return;
        }

        if (!segment.text) {
          return;
        }

        const key = `${segment.start ?? "na"}:${segment.end ?? "na"}:${segment.text}`;

        if (this.publishedFinalKeys.has(key)) {
          return;
        }

        this.publishedFinalKeys.add(key);
        this.lastPartialText = "";
        sessionLogger.info("transcription.final", {
          text: segment.text
        });
        void this.publisher
          .publishSegment(this.roomCode, this.participantId, "final", segment.text)
          .catch((error) => {
            sessionLogger.error("transcription.final_publish_failed", { error });
          });
        this.monitoringRuntime.observeFinalTranscript(
          this.roomCode,
          this.participantId,
          segment.text
        );
      },
      onWarning: (message) => {
        if (this.closed) {
          return;
        }

        sessionLogger.warn("transcription.provider_warning", { message });
        const payload = JSON.stringify({ type: "warning", message });
        sendToBrowserSocket(payload);
      },
      onError: (message) => {
        if (this.closed) {
          return;
        }

        sessionLogger.error("transcription.provider_error", { message });
        const payload = JSON.stringify({ type: "error", message });
        sendToBrowserSocket(payload);
      },
      onInfo: (message) => {
        sessionLogger.info("transcription.provider_info", { message });
      }
    });
  }

  async attachBrowserSocket(socket: BrowserSocket) {
    this.closed = false;
    this.browserSocket = socket;
    const sessionLogger = logger.withContext({
      roomCode: this.roomCode,
      participantId: this.participantId,
      provider: this.providerName,
      providerTarget: this.providerTarget
    });
    const connectingPayload = JSON.stringify({ type: "connecting" });

    try {
      sessionLogger.withMetadata({ payload: connectingPayload }).info("transcription.browser_socket_out");
      socket.send(connectingPayload);
    } catch (error) {
      sessionLogger.warn("transcription.browser_socket_send_failed", { error });
      throw error;
    }

    this.readyTimeoutId = setTimeout(() => {
      if (this.providerReady) {
        return;
      }

      sessionLogger.warn("transcription.provider_ready_timeout");
    }, 8_000);

    sessionLogger.info("transcription.browser_attached");
    sessionLogger.info("transcription.provider_connect_start");

    try {
      await this.providerSession.connect();
    } catch (error) {
      sessionLogger.error("transcription.provider_connect_failed", { error });
      throw error;
    }
  }

  handleMessage(message: unknown) {
    const decoded = decodeMessage(message);

    if (decoded === null) {
      return;
    }

    if (typeof decoded === "string") {
      logger.withContext({
        roomCode: this.roomCode,
        participantId: this.participantId,
        provider: this.providerName
      }).withMetadata({
        message: decoded
      }).info("transcription.browser_socket_in");
      if (decoded === "ping") {
        const payload = JSON.stringify({ type: "pong" });
        const socket = this.browserSocket;

        if (!this.closed && socket !== null && isSocketOpen(socket)) {
          logger.withContext({
            roomCode: this.roomCode,
            participantId: this.participantId,
            provider: this.providerName
          }).withMetadata({ payload }).info("transcription.browser_socket_out");

          try {
            socket.send(payload);
          } catch (error) {
            logger.warn("transcription.browser_socket_send_failed", { error });
          }
        }
      }
      return;
    }

    if (!this.providerReady) {
      if (this.pendingAudio.length >= 512) {
        this.pendingAudio.shift();
      }

      this.pendingAudio.push(cloneBuffer(decoded));
      return;
    }

    this.providerSession.sendAudioChunk(decoded);
  }

  close(reason?: string) {
    if (this.closed) {
      return;
    }

    this.closed = true;

    if (this.readyTimeoutId) {
      clearTimeout(this.readyTimeoutId);
      this.readyTimeoutId = null;
    }

    logger.info("transcription.browser_closed", {
      roomCode: this.roomCode,
      participantId: this.participantId,
      provider: this.providerName,
      reason: reason ?? null
    });
    this.browserSocket = null;
    this.providerSession.close();
    this.providerReady = false;
    this.pendingAudio = [];
    this.lastPartialText = "";
    this.publishedFinalKeys.clear();
  }
}

export class TranscriptionRuntime {
  private sessions = new Map<string, ParticipantTranscriptionSession>();

  constructor(
    private readonly publisher: BackendTranscriptPublisher,
    private readonly monitoringRuntime: MeetingMonitoringRuntime,
    private readonly config: {
      providers: {
        whisperlive: {
          url: string;
          model: string;
          language: string;
          sampleRate: number;
        };
        sarvam: {
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
        };
        openai: {
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
        };
      };
    }
  ) {}

  private createKey(roomCode: string, participantId: string) {
    return `${roomCode}:${participantId}`;
  }

  private async probeWebSocketTarget(url: string, timeoutMs = 1_500) {
    if (!url.trim()) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const socket = new WebSocket(url);
      const finish = (value: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);

        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close();
        }

        resolve(value);
      };

      const timeoutId = setTimeout(() => finish(false), timeoutMs);

      socket.addEventListener("open", () => finish(true), { once: true });
      socket.addEventListener("error", () => finish(false), { once: true });
      socket.addEventListener("close", () => finish(settled ? false : true), { once: true });
    });
  }

  async getProviderStatuses(): Promise<TranscriptionProviderStatusResponse> {
    const whisperliveConfigured = Boolean(this.config.providers.whisperlive.url.trim());
    const whisperliveReachable = whisperliveConfigured
      ? await this.probeWebSocketTarget(this.config.providers.whisperlive.url)
      : false;
    const sarvamConfig = this.config.providers.sarvam;
    const sarvamConfigured =
      Boolean(sarvamConfig.url.trim()) &&
      Boolean(sarvamConfig.model.trim()) &&
      Boolean(sarvamConfig.apiKey.trim());
    const openAiConfig = this.config.providers.openai;
    const openAiConfigured =
      Boolean(openAiConfig.apiKey.trim()) &&
      Boolean(openAiConfig.model.trim()) &&
      Boolean(openAiConfig.baseUrl.trim());

    return {
      providers: {
        none: {
          label: "Disabled",
          available: true,
          reason: "Transcription disabled for the room."
        },
        whisperlive: {
          label: "WhisperLive",
          available: whisperliveConfigured && whisperliveReachable,
          reason: !whisperliveConfigured
            ? "WhisperLive URL is not configured."
            : whisperliveReachable
              ? null
              : "WhisperLive is configured but unreachable."
        },
        sarvam: {
          label: "Sarvam Saaras v3",
          available: sarvamConfigured,
          reason: sarvamConfigured ? null : "Missing Sarvam URL, model, or API key."
        },
        openai: {
          label: "OpenAI Realtime Transcription",
          available: openAiConfigured,
          reason: openAiConfigured ? null : "Missing OpenAI base URL, model, or API key."
        }
      }
    };
  }

  private createProviderSession(
    roomConfig: RoomTranscriptionConfig,
    callbacks: RealtimeTranscriptionCallbacks
  ) {
    if (roomConfig.provider === "none") {
      throw new Error("Transcription is disabled for this room.");
    }

    if (roomConfig.provider === "sarvam") {
      return {
        target: this.config.providers.sarvam.url,
        session: createSarvamSession(
          {
            ...this.config.providers.sarvam,
            model: roomConfig.model,
            languageCode: roomConfig.language,
            sampleRate: roomConfig.sampleRate
          },
          callbacks
        )
      };
    }

    if (roomConfig.provider === "openai") {
      const openAiModel = "whisper-1";

      return {
        target: this.config.providers.openai.baseUrl,
        session: createOpenAiRealtimeSession(
          {
            ...this.config.providers.openai,
            model: openAiModel,
            language: roomConfig.language,
            sampleRate: roomConfig.sampleRate
          },
          callbacks
        )
      };
    }

    return {
      target: this.config.providers.whisperlive.url,
      session: createWhisperLiveSession(
        {
          url: this.config.providers.whisperlive.url,
          model: roomConfig.model,
          language: roomConfig.language,
          sampleRate: roomConfig.sampleRate
        },
        callbacks
      )
    };
  }

  async validateParticipant(
    backendUrl: string,
    roomCode: string,
    participantId: string
  ): Promise<{ transcription: RoomTranscriptionConfig }> {
    const url = new URL(`${backendUrl}/rooms/${roomCode}`);
    url.searchParams.set("participantId", participantId);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Unable to validate transcription participant.");
    }

    const payload = (await response.json()) as Pick<RoomResponseEnvelope, "room" | "transcription">;

    const participantExists = payload.room?.participants?.some(
      (participant) => participant.id === participantId
    );

    if (!participantExists) {
      throw new Error("Participant is not active in the room.");
    }

    if (!payload.transcription) {
      throw new Error("Room transcription configuration is missing.");
    }

    return {
      transcription: payload.transcription
    };
  }

  async attachSocket(
    roomCode: string,
    participantId: string,
    socket: BrowserSocket,
    roomConfig: RoomTranscriptionConfig
  ) {
    const key = this.createKey(roomCode, participantId);
    const existing = this.sessions.get(key);

    if (existing) {
      existing.close("superseded");
      this.sessions.delete(key);
    }

    const providerBinding = this.createProviderSession(roomConfig, {});
    const session = new ParticipantTranscriptionSession(
      roomCode,
      participantId,
      this.publisher,
      this.monitoringRuntime,
      roomConfig.provider,
      providerBinding.target,
      (callbacks) => this.createProviderSession(roomConfig, callbacks).session
    );

    this.sessions.set(key, session);
    await session.attachBrowserSocket(socket);
  }

  handleMessage(roomCode: string, participantId: string, message: unknown) {
    this.sessions.get(this.createKey(roomCode, participantId))?.handleMessage(message);
  }

  closeSocket(roomCode: string, participantId: string) {
    const key = this.createKey(roomCode, participantId);
    this.sessions.get(key)?.close();
    this.sessions.delete(key);
  }
}
