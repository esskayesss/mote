import { createWhisperClient } from "@mote/whisper-client";
import type { BackendTranscriptPublisher } from "./backend-publisher";

interface BrowserSocket {
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
}

const decoder = new TextDecoder();

const decodeMessage = (message: unknown) => {
  if (typeof message === "string") {
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

class ParticipantTranscriptionSession {
  private browserSocket: BrowserSocket | null = null;
  private readonly providerSession;
  private providerReady = false;
  private pendingAudio: ArrayBuffer[] = [];
  private lastPartialText = "";
  private publishedFinalKeys = new Set<string>();
  private forwardedChunkCount = 0;

  constructor(
    private readonly roomCode: string,
    private readonly participantId: string,
    private readonly publisher: BackendTranscriptPublisher,
    private readonly providerUrl: string,
    model: string,
    language: string,
    sampleRate: number
  ) {
    const client = createWhisperClient({
      url: providerUrl,
      model,
      language,
      sampleRate
    });

    this.providerSession = client.createRealtimeSession({
      onReady: () => {
        console.info("[mote:ai-service] provider:ready", {
          roomCode: this.roomCode,
          participantId: this.participantId,
          bufferedChunks: this.pendingAudio.length
        });
        this.providerReady = true;
        this.browserSocket?.send(JSON.stringify({ type: "ready" }));

        for (const chunk of this.pendingAudio) {
          this.providerSession.sendAudioChunk(chunk);
        }

        this.pendingAudio = [];
      },
      onPartial: (segment) => {
        if (!segment.text || segment.text === this.lastPartialText) {
          return;
        }

        console.info("[mote:ai-service] transcript:partial", {
          roomCode: this.roomCode,
          participantId: this.participantId,
          text: segment.text
        });
        this.lastPartialText = segment.text;
        void this.publisher
          .publishSegment(this.roomCode, this.participantId, "partial", segment.text)
          .catch((error) => {
            console.error("[mote:ai-service] partial publish failed", error);
          });
      },
      onFinal: (segment) => {
        if (!segment.text) {
          return;
        }

        const key = `${segment.start ?? "na"}:${segment.end ?? "na"}:${segment.text}`;

        if (this.publishedFinalKeys.has(key)) {
          return;
        }

        this.publishedFinalKeys.add(key);
        this.lastPartialText = "";
        console.info("[mote:ai-service] transcript:final", {
          roomCode: this.roomCode,
          participantId: this.participantId,
          text: segment.text
        });
        void this.publisher
          .publishSegment(this.roomCode, this.participantId, "final", segment.text)
          .catch((error) => {
            console.error("[mote:ai-service] final publish failed", error);
          });
      },
      onWarning: (message) => {
        console.warn("[mote:ai-service] provider:warning", {
          roomCode: this.roomCode,
          participantId: this.participantId,
          message
        });
        this.browserSocket?.send(JSON.stringify({ type: "warning", message }));
      },
      onError: (message) => {
        console.error("[mote:ai-service] provider:error", {
          roomCode: this.roomCode,
          participantId: this.participantId,
          message
        });
        this.browserSocket?.send(JSON.stringify({ type: "error", message }));
      }
    });
  }

  async attachBrowserSocket(socket: BrowserSocket) {
    this.browserSocket = socket;
    console.info("[mote:ai-service] browser:attached", {
      roomCode: this.roomCode,
      participantId: this.participantId
    });
    console.info("[mote:ai-service] provider:connect:start", {
      roomCode: this.roomCode,
      participantId: this.participantId,
      providerUrl: this.providerUrl
    });

    try {
      await this.providerSession.connect();
    } catch (error) {
      console.error("[mote:ai-service] provider:connect failed", {
        roomCode: this.roomCode,
        participantId: this.participantId,
        providerUrl: this.providerUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    socket.send(JSON.stringify({ type: "connecting" }));
  }

  handleMessage(message: unknown) {
    const decoded = decodeMessage(message);

    if (decoded === null) {
      return;
    }

    if (typeof decoded === "string") {
      if (decoded === "ping") {
        this.browserSocket?.send(JSON.stringify({ type: "pong" }));
      }
      return;
    }

    if (!this.providerReady) {
      if (this.pendingAudio.length >= 64) {
        this.pendingAudio.shift();
      }

      this.pendingAudio.push(cloneBuffer(decoded));
      return;
    }

    this.forwardedChunkCount += 1;
    if (this.forwardedChunkCount === 1 || this.forwardedChunkCount % 100 === 0) {
      console.info("[mote:ai-service] audio:forwarded", {
        roomCode: this.roomCode,
        participantId: this.participantId,
        chunkCount: this.forwardedChunkCount
      });
    }
    this.providerSession.sendAudioChunk(decoded);
  }

  close(reason?: string) {
    console.info("[mote:ai-service] browser:closed", {
      roomCode: this.roomCode,
      participantId: this.participantId,
      reason: reason ?? null
    });
    this.browserSocket?.send(JSON.stringify({ type: "closed", reason: reason ?? null }));
    this.providerSession.close();
    this.browserSocket = null;
    this.providerReady = false;
    this.pendingAudio = [];
  }
}

export class TranscriptionRuntime {
  private sessions = new Map<string, ParticipantTranscriptionSession>();

  constructor(
    private readonly publisher: BackendTranscriptPublisher,
    private readonly config: {
      providerUrl: string;
      model: string;
      language: string;
      sampleRate: number;
    }
  ) {}

  private createKey(roomCode: string, participantId: string) {
    return `${roomCode}:${participantId}`;
  }

  async validateParticipant(
    backendUrl: string,
    roomCode: string,
    participantId: string
  ) {
    const url = new URL(`${backendUrl}/rooms/${roomCode}`);
    url.searchParams.set("participantId", participantId);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Unable to validate transcription participant.");
    }

    const payload = (await response.json()) as {
      room?: {
        participants?: Array<{ id: string }>;
      };
    };

    const participantExists = payload.room?.participants?.some(
      (participant) => participant.id === participantId
    );

    if (!participantExists) {
      throw new Error("Participant is not active in the room.");
    }
  }

  async attachSocket(roomCode: string, participantId: string, socket: BrowserSocket) {
    const key = this.createKey(roomCode, participantId);
    const existing = this.sessions.get(key);

    if (existing) {
      existing.close("superseded");
      this.sessions.delete(key);
    }

    const session = new ParticipantTranscriptionSession(
      roomCode,
      participantId,
      this.publisher,
      this.config.providerUrl,
      this.config.model,
      this.config.language,
      this.config.sampleRate
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
