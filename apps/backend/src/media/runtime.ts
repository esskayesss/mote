import {
  createWorker,
  type types as MediaSoupTypes
} from "mediasoup";
import type { ParticipantMediaState, ParticipantTrackKind } from "@mote/models";
import { logger } from "../logger";
import type { RoomStore } from "../store/room-store";

export interface AppSocket {
  data: {
    params: {
      code: string;
      participantId: string;
    };
  };
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

type SocketMessage =
  | {
      action: "createTransport";
      requestId: string;
      direction: "send" | "recv";
    }
  | {
      action: "connectTransport";
      requestId: string;
      transportId: string;
      dtlsParameters: MediaSoupTypes.DtlsParameters;
    }
  | {
      action: "produce";
      requestId: string;
      transportId: string;
      kind: MediaSoupTypes.MediaKind;
      rtpParameters: MediaSoupTypes.RtpParameters;
      appData?: Record<string, unknown> & {
        mediaTag?: "camera" | "microphone" | "screen";
      };
    }
  | {
      action: "consume";
      requestId: string;
      transportId: string;
      producerId: string;
      rtpCapabilities: MediaSoupTypes.RtpCapabilities;
    }
  | {
      action: "resumeConsumer";
      requestId: string;
      consumerId: string;
    }
  | {
      action: "setMediaState";
      requestId: string;
      audioEnabled: boolean;
      videoEnabled: boolean;
      screenEnabled?: boolean;
    };

interface PeerMediaState {
  participantId: string;
  roomCode: string;
  socket?: AppSocket;
  transports: Map<string, MediaSoupTypes.WebRtcTransport>;
  producers: Map<string, MediaSoupTypes.Producer>;
  consumers: Map<string, MediaSoupTypes.Consumer>;
  mediaState: ParticipantMediaState;
}

const resolveTrackKind = (kind: MediaSoupTypes.MediaKind, appData?: Record<string, unknown>): ParticipantTrackKind =>
  appData?.mediaTag === "screen"
    ? "screen"
    : kind === "audio"
      ? "audio"
      : "video";

const sendSocket = (socket: AppSocket, payload: Record<string, unknown>) =>
  socket.send(JSON.stringify(payload));

const decodeMessage = (rawMessage: unknown) => {
  if (typeof rawMessage === "string") {
    return rawMessage;
  }

  if (rawMessage instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(rawMessage));
  }

  if (ArrayBuffer.isView(rawMessage)) {
    return new TextDecoder().decode(rawMessage);
  }

  if (typeof rawMessage === "object" && rawMessage !== null) {
    return JSON.stringify(rawMessage);
  }

  return null;
};

export class MediaRuntime {
  private roomPeers = new Map<string, Map<string, PeerMediaState>>();

  private constructor(
    private readonly router: MediaSoupTypes.Router,
    private readonly listenIp: string,
    private readonly announcedAddress: string,
    private readonly roomStore: RoomStore
  ) {}

  static async create(options: {
    rtcMinPort: number;
    rtcMaxPort: number;
    listenIp: string;
    announcedAddress: string;
    roomStore: RoomStore;
  }) {
    const worker = await createWorker({
      logLevel: "warn",
      rtcMinPort: options.rtcMinPort,
      rtcMaxPort: options.rtcMaxPort
    });

    const router = await worker.createRouter({
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48_000,
          channels: 2
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90_000,
          parameters: {
            "x-google-start-bitrate": 1000
          }
        }
      ]
    });

    return new MediaRuntime(router, options.listenIp, options.announcedAddress, options.roomStore);
  }

  getRouterCapabilities() {
    return this.router.rtpCapabilities;
  }

  private getOrCreatePeer(roomCode: string, participantId: string): PeerMediaState {
    let peers = this.roomPeers.get(roomCode);

    if (!peers) {
      peers = new Map();
      this.roomPeers.set(roomCode, peers);
    }

    let peer = peers.get(participantId);

    if (!peer) {
      peer = {
        participantId,
        roomCode,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        mediaState: {
          participantId,
          audioEnabled: true,
          videoEnabled: true,
          screenEnabled: false
        }
      };
      peers.set(participantId, peer);
    }

    return peer;
  }

  private getParticipantStates(roomCode: string) {
    return Array.from(this.roomPeers.get(roomCode)?.values() ?? []).map((peer) => ({
      ...peer.mediaState
    }));
  }

  private getPeer(roomCode: string, participantId: string) {
    return this.roomPeers.get(roomCode)?.get(participantId);
  }

  private broadcast(roomCode: string, payload: Record<string, unknown>, excludeParticipantId?: string) {
    const peers = this.roomPeers.get(roomCode);

    if (!peers) {
      return;
    }

    for (const peer of peers.values()) {
      if (peer.participantId === excludeParticipantId) {
        continue;
      }

      if (peer.socket && peer.socket.readyState === WebSocket.OPEN) {
        sendSocket(peer.socket, payload);
      }
    }
  }

  private closePeerState(roomCode: string, participantId: string) {
    const peers = this.roomPeers.get(roomCode);
    const peer = peers?.get(participantId);

    if (!peer) {
      return;
    }

    for (const producer of peer.producers.values()) {
      this.broadcast(roomCode, { type: "producerClosed", producerId: producer.id }, participantId);
      producer.close();
    }

    for (const consumer of peer.consumers.values()) {
      consumer.close();
    }

    for (const transport of peer.transports.values()) {
      transport.close();
    }

    peers?.delete(participantId);

    if (peers?.size === 0) {
      this.roomPeers.delete(roomCode);
    }
  }

  attachSocket(roomCode: string, participantId: string, socket: AppSocket) {
    const mediaLogger = logger.withContext({
      subsystem: "media",
      roomCode,
      participantId
    });

    this.closePeerState(roomCode, participantId);

    const peer = this.getOrCreatePeer(roomCode, participantId);
    peer.socket = socket;
    mediaLogger.info("media.socket_attached");

    return {
      existingProducers: Array.from(this.roomPeers.get(roomCode)?.values() ?? [])
        .flatMap((candidate) =>
          Array.from(candidate.producers.values()).map((producer) => ({
            producerId: producer.id,
            participantId: candidate.participantId,
            kind: producer.kind
          }))
        )
        .filter((producer) => producer.participantId !== participantId),
      participantStates: this.getParticipantStates(roomCode)
    };
  }

  closePeer(roomCode: string, participantId: string) {
    this.closePeerState(roomCode, participantId);
  }

  closeRoom(roomCode: string, reason?: string) {
    const peers = this.roomPeers.get(roomCode);

    if (!peers) {
      return;
    }

    for (const peer of peers.values()) {
      if (peer.socket && peer.socket.readyState === WebSocket.OPEN) {
        peer.socket.close(1000, reason);
      }

      this.closePeerState(roomCode, peer.participantId);
    }

    this.roomPeers.delete(roomCode);
  }

  async handleMessage(roomCode: string, participantId: string, socket: AppSocket, rawMessage: unknown) {
    const mediaLogger = logger.withContext({
      subsystem: "media",
      roomCode,
      participantId
    });
    const peer = this.getPeer(roomCode, participantId);

    if (!peer) {
      mediaLogger.warn("media.socket_message_dropped", {
        reason: "peer-not-found"
      });
      return;
    }

    const decodedMessage = decodeMessage(rawMessage);

    if (!decodedMessage) {
      mediaLogger.warn("media.socket_message_dropped", {
        reason: "unsupported-payload",
        payloadType: typeof rawMessage
      });
      return;
    }

    let message: SocketMessage;

    try {
      message = JSON.parse(decodedMessage) as SocketMessage;
      mediaLogger.withMetadata({
        rawMessage: decodedMessage
      }).info("media.socket_message_in", {
        action: message.action
      });
    } catch {
      mediaLogger.warn("media.socket_message_invalid", {
        rawMessage: decodedMessage
      });
      sendSocket(socket, { type: "error", message: "Invalid signaling payload" });
      return;
    }

    try {
      switch (message.action) {
        case "createTransport": {
          const transport = await this.router.createWebRtcTransport({
            listenInfos: [
              {
                protocol: "udp",
                ip: this.listenIp,
                announcedAddress: this.announcedAddress
              },
              {
                protocol: "tcp",
                ip: this.listenIp,
                announcedAddress: this.announcedAddress
              }
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            appData: {
              participantId,
              direction: message.direction
            }
          });

          peer.transports.set(transport.id, transport);
          mediaLogger.info("media.transport_created", {
            direction: message.direction,
            transportId: transport.id
          });

          const payload = {
            type: "response",
            requestId: message.requestId,
            data: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
              sctpParameters: transport.sctpParameters
            }
          };
          mediaLogger.info("media.socket_message_out", { action: message.action, payload });
          sendSocket(socket, payload);
          break;
        }

        case "connectTransport": {
          const transport = peer.transports.get(message.transportId);
          if (!transport) throw new Error("Transport not found");

          await transport.connect({ dtlsParameters: message.dtlsParameters });
          mediaLogger.info("media.transport_connected", { transportId: transport.id });
          const payload = { type: "response", requestId: message.requestId, data: { connected: true } };
          mediaLogger.info("media.socket_message_out", { action: message.action, payload });
          sendSocket(socket, payload);
          break;
        }

        case "produce": {
          const transport = peer.transports.get(message.transportId);
          if (!transport) throw new Error("Transport not found");

          const participant = this.roomStore.getParticipant(roomCode, participantId);

          if (!participant) {
            throw new Error("Participant not found");
          }

          const trackKind = resolveTrackKind(message.kind, message.appData);

          if (
            (trackKind === "audio" && !participant.media_capabilities_json.includes('"publishAudio":true')) ||
            (trackKind === "video" && !participant.media_capabilities_json.includes('"publishVideo":true')) ||
            (trackKind === "screen" && !participant.media_capabilities_json.includes('"publishScreen":true'))
          ) {
            throw new Error(`Participant is not allowed to publish ${trackKind}.`);
          }

          const producer = await transport.produce({
            kind: message.kind,
            rtpParameters: message.rtpParameters,
            appData: {
              ...(message.appData ?? {}),
              participantId
            }
          });

          peer.producers.set(producer.id, producer);
          mediaLogger.info("media.producer_created", {
            transportId: transport.id,
            producerId: producer.id,
            kind: producer.kind
          });
          producer.on("transportclose", () => {
            peer.producers.delete(producer.id);
          });
          producer.on("@close", () => {
            peer.producers.delete(producer.id);
            this.broadcast(roomCode, { type: "producerClosed", producerId: producer.id }, participantId);
          });

          this.broadcast(
            roomCode,
            {
              type: "producerAdded",
              producerId: producer.id,
              participantId,
              kind: producer.kind,
              mediaTag:
                (producer.appData as { mediaTag?: "camera" | "microphone" | "screen" }).mediaTag ??
                null
            },
            participantId
          );

          const payload = {
            type: "response",
            requestId: message.requestId,
            data: { id: producer.id }
          };
          mediaLogger.info("media.socket_message_out", { action: message.action, payload });
          sendSocket(socket, payload);
          break;
        }

        case "consume": {
          const transport = peer.transports.get(message.transportId);
          if (!transport) throw new Error("Transport not found");

          if (!this.router.canConsume({ producerId: message.producerId, rtpCapabilities: message.rtpCapabilities })) {
            throw new Error("Router cannot consume the producer");
          }

          let producerParticipantId = "";

          for (const candidate of this.roomPeers.get(roomCode)?.values() ?? []) {
            if (candidate.producers.has(message.producerId)) {
              producerParticipantId = candidate.participantId;
              break;
            }
          }

          const producerPeer = producerParticipantId
            ? this.roomPeers.get(roomCode)?.get(producerParticipantId)
            : null;
          const producer = producerPeer?.producers.get(message.producerId);
          const consumerParticipant = this.roomStore.getParticipant(roomCode, participantId);

          if (!producer || !consumerParticipant) {
            throw new Error("Producer or participant not found");
          }

          const trackKind = resolveTrackKind(producer.kind, producer.appData as Record<string, unknown>);

          if (
            (trackKind === "audio" && !consumerParticipant.media_capabilities_json.includes('"subscribeAudio":true')) ||
            (trackKind === "video" && !consumerParticipant.media_capabilities_json.includes('"subscribeVideo":true')) ||
            (trackKind === "screen" && !consumerParticipant.media_capabilities_json.includes('"subscribeScreen":true'))
          ) {
            throw new Error(`Participant is not allowed to subscribe to ${trackKind}.`);
          }

          const consumer = await transport.consume({
            producerId: message.producerId,
            rtpCapabilities: message.rtpCapabilities,
            paused: true
          });

          peer.consumers.set(consumer.id, consumer);
          mediaLogger.info("media.consumer_created", {
            transportId: transport.id,
            producerId: message.producerId,
            consumerId: consumer.id,
            producerParticipantId
          });
          consumer.on("transportclose", () => {
            peer.consumers.delete(consumer.id);
          });
          consumer.on("producerclose", () => {
            peer.consumers.delete(consumer.id);
            sendSocket(socket, {
              type: "consumerClosed",
              consumerId: consumer.id,
              producerId: message.producerId
            });
          });

          const payload = {
            type: "response",
            requestId: message.requestId,
            data: {
              id: consumer.id,
              producerId: message.producerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
              participantId: producerParticipantId,
              mediaTag:
                (producer.appData as { mediaTag?: "camera" | "microphone" | "screen" }).mediaTag ??
                null
            }
          };
          mediaLogger.info("media.socket_message_out", { action: message.action, payload });
          sendSocket(socket, payload);
          break;
        }

        case "resumeConsumer": {
          const consumer = peer.consumers.get(message.consumerId);
          if (!consumer) throw new Error("Consumer not found");

          await consumer.resume();
          const payload = { type: "response", requestId: message.requestId, data: { resumed: true } };
          mediaLogger.info("media.socket_message_out", { action: message.action, payload });
          sendSocket(socket, payload);
          break;
        }

        case "setMediaState": {
          peer.mediaState = {
            participantId,
            audioEnabled: message.audioEnabled,
            videoEnabled: message.videoEnabled,
            screenEnabled: message.screenEnabled ?? false
          };

          this.broadcast(
            roomCode,
            {
              type: "participantMediaStateChanged",
              participantId,
              audioEnabled: message.audioEnabled,
              videoEnabled: message.videoEnabled,
              screenEnabled: message.screenEnabled ?? false
            },
            participantId
          );

          const payload = {
            type: "response",
            requestId: message.requestId,
            data: { ok: true }
          };
          mediaLogger.info("media.socket_message_out", { action: message.action, payload });
          sendSocket(socket, payload);
          break;
        }
      }
    } catch (error) {
      mediaLogger.error("media.signaling_failed", {
        action: message.action,
        error
      });
      const payload = {
        type: "response",
        requestId: message.requestId,
        error: error instanceof Error ? error.message : "Unknown signaling error"
      };
      mediaLogger.info("media.socket_message_out", { action: message.action, payload });
      sendSocket(socket, payload);
    }
  }
}
