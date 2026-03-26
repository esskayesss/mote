import type { TranscriptionProvider } from "@mote/models";
import { logger } from "../logger";
import type { BackendTranscriptPublisher } from "./backend-publisher";
import type {
  RealtimeTranscriptionCallbacks,
  RealtimeTranscriptionProviderSession
} from "./providers/types";

export interface BrowserSocket {
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
  readyState?: number;
}

export interface MonitoringObserver {
  observePartialTranscript(
    roomKey: string,
    roomCode: string,
    participantId: string,
    text: string
  ): void;
  observeFinalTranscript(
    roomKey: string,
    roomCode: string,
    participantId: string,
    text: string
  ): void;
}

const decodeBase64Audio = (encoded: string) => {
  const bytes = Buffer.from(encoded, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const cloneBuffer = (buffer: ArrayBuffer) => buffer.slice(0);

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
    private readonly roomKey: string,
    private readonly roomCode: string,
    private readonly participantId: string,
    private readonly publisher: BackendTranscriptPublisher,
    private readonly monitoringRuntime: MonitoringObserver,
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
        sendToBrowserSocket(JSON.stringify({ type: "ready" }));

        for (const chunk of this.pendingAudio) {
          this.providerSession.sendAudioChunk(chunk);
        }

        this.pendingAudio = [];
      },
      onPartial: (segment) => {
        if (this.closed || !segment.text || segment.text === this.lastPartialText) {
          return;
        }

        sessionLogger.info("transcription.partial", {
          text: segment.text
        });
        this.lastPartialText = segment.text;
        this.monitoringRuntime.observePartialTranscript(
          this.roomKey,
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
        if (this.closed || !segment.text) {
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
          this.roomKey,
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
        sendToBrowserSocket(JSON.stringify({ type: "warning", message }));
      },
      onError: (message) => {
        if (this.closed) {
          return;
        }

        sessionLogger.error("transcription.provider_error", { message });
        sendToBrowserSocket(JSON.stringify({ type: "error", message }));
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
