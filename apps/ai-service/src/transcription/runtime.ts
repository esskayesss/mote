import type {
  RoomResponseEnvelope,
  TranscriptionProvider,
  TranscriptionProviderStatusResponse
} from "@mote/models";
import type { BackendTranscriptPublisher } from "./backend-publisher";
import type { MeetingMonitoringRuntime } from "../monitoring/runtime";
import { createOpenAiRealtimeSession } from "./providers/openai-realtime-session";
import { createSarvamSession } from "./providers/sarvam-session";
import type {
  RealtimeTranscriptionCallbacks,
  RealtimeTranscriptionProviderSession
} from "./providers/types";
import { createWhisperLiveSession } from "./providers/whisperlive-session";
import {
  ParticipantTranscriptionSession,
  type BrowserSocket
} from "./session";

type RoomTranscriptionConfig = RoomResponseEnvelope["transcription"];

type TranscriptionParticipantContext = {
  roomId: string;
  roomCode: string;
  transcription: RoomTranscriptionConfig;
};

export class TranscriptionRuntime {
  private readonly sessions = new Map<string, ParticipantTranscriptionSession>();
  private readonly routeSessionKeys = new Map<string, string>();
  private readonly sessionRouteKeys = new Map<string, string>();
  private readonly sessionRoomKeys = new Map<string, string>();
  private readonly roomIngressOwners = new Map<string, string>();

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

  private createKey(roomKey: string, participantId: string) {
    return `${roomKey}:${participantId}`;
  }

  private removeSession(key: string, reason?: string) {
    this.sessions.get(key)?.close(reason);
    this.sessions.delete(key);

    const routeKey = this.sessionRouteKeys.get(key);

    if (routeKey) {
      this.routeSessionKeys.delete(routeKey);
      this.sessionRouteKeys.delete(key);
    }

    const roomKey = this.sessionRoomKeys.get(key);

    if (roomKey) {
      const participantId = key.slice(roomKey.length + 1);

      if (this.roomIngressOwners.get(roomKey) === participantId) {
        this.roomIngressOwners.delete(roomKey);
      }

      this.sessionRoomKeys.delete(key);
    }
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
  ): {
    target: string;
    session: RealtimeTranscriptionProviderSession;
  } {
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
      return {
        target: this.config.providers.openai.baseUrl,
        session: createOpenAiRealtimeSession(
          {
            ...this.config.providers.openai,
            model: "whisper-1",
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
  ): Promise<TranscriptionParticipantContext> {
    const url = new URL(`${backendUrl}/rooms/${roomCode}`);
    url.searchParams.set("participantId", participantId);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Unable to validate transcription participant.");
    }

    const payload = (await response.json()) as Pick<RoomResponseEnvelope, "room" | "transcription">;
    const participant = payload.room?.participants?.find(
      (candidate) => candidate.id === participantId
    );

    if (!participant) {
      throw new Error("Participant is not active in the room.");
    }

    if (!payload.transcription) {
      throw new Error("Room transcription configuration is missing.");
    }

    if (!participant.isPresenter && participant.role !== "host") {
      throw new Error("Only the current presenter or host can own the room transcription ingress.");
    }

    return {
      roomId: payload.room.id,
      roomCode: payload.room.code,
      transcription: payload.transcription
    };
  }

  async attachSocket(
    roomKey: string,
    roomCode: string,
    participantId: string,
    socket: BrowserSocket,
    roomConfig: RoomTranscriptionConfig
  ) {
    const key = this.createKey(roomKey, participantId);
    const routeKey = this.createKey(roomCode, participantId);
    const currentIngressOwner = this.roomIngressOwners.get(roomKey);

    if (currentIngressOwner && currentIngressOwner !== participantId) {
      this.removeSession(this.createKey(roomKey, currentIngressOwner), "superseded");
    }

    this.removeSession(key, "superseded");
    this.roomIngressOwners.set(roomKey, participantId);
    this.routeSessionKeys.set(routeKey, key);
    this.sessionRouteKeys.set(key, routeKey);
    this.sessionRoomKeys.set(key, roomKey);

    const providerBinding = this.createProviderSession(roomConfig, {
      onReady: () => undefined,
      onPartial: () => undefined,
      onFinal: () => undefined,
      onWarning: () => undefined,
      onError: () => undefined,
      onInfo: () => undefined
    });
    const session = new ParticipantTranscriptionSession(
      roomKey,
      roomCode,
      participantId,
      this.publisher,
      this.monitoringRuntime,
      roomConfig.provider,
      providerBinding.target,
      (callbacks) => this.createProviderSession(roomConfig, callbacks).session
    );

    this.sessions.set(key, session);

    try {
      await session.attachBrowserSocket(socket);
    } catch (error) {
      this.removeSession(key, "attach_failed");
      throw error;
    }
  }

  handleMessage(roomCode: string, participantId: string, message: unknown) {
    const key = this.routeSessionKeys.get(this.createKey(roomCode, participantId));

    if (!key) {
      return;
    }

    this.sessions.get(key)?.handleMessage(message);
  }

  closeSocket(roomCode: string, participantId: string) {
    const routeKey = this.createKey(roomCode, participantId);
    const key = this.routeSessionKeys.get(routeKey) ?? routeKey;
    this.removeSession(key);
  }
}
