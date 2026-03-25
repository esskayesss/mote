import { Device } from "mediasoup-client";
import type * as MediaSoupClientTypes from "mediasoup-client/types";
import type {
  IceServerDefinition,
  ParticipantMediaState
} from "@mote/models";
import { logger } from "../logger";

type SignalingResponse<T> = {
  data?: T;
  error?: string;
};

type SignalingMessage =
  | {
      type: "connected";
      routerRtpCapabilities: MediaSoupClientTypes.RtpCapabilities;
      existingProducers: {
        producerId: string;
        participantId: string;
        kind: string;
        mediaTag?: string | null;
      }[];
      participantStates: ParticipantMediaState[];
    }
  | {
      type: "producerAdded";
      producerId: string;
      participantId: string;
      kind: string;
      mediaTag?: string | null;
    }
  | {
      type: "producerClosed";
      producerId: string;
    }
  | {
      type: "consumerClosed";
      consumerId: string;
      producerId: string;
    }
  | ParticipantMediaState & {
      type: "participantMediaStateChanged";
    }
  | {
      type: "response";
      requestId: string;
      data?: unknown;
      error?: string;
    }
  | {
      type: "error";
      message: string;
    };

interface MediaSessionState {
  roomCode: string;
  participantId: string;
  iceServers: RTCIceServer[];
  socket: WebSocket;
  device: MediaSoupClientTypes.Device;
  sendTransport?: MediaSoupClientTypes.Transport;
  recvTransport?: MediaSoupClientTypes.Transport;
  pendingRequests: Map<string, (payload: SignalingResponse<unknown>) => void>;
  producers: Map<string, MediaSoupClientTypes.Producer>;
  consumers: Map<string, MediaSoupClientTypes.Consumer>;
  consumedProducerIds: Set<string>;
  screenShareProducerId?: string;
  screenShareTrack?: MediaStreamTrack | null;
  screenShareStream?: MediaStream | null;
}

interface RemoteParticipantTracks {
  audio?: MediaStreamTrack;
  video?: MediaStreamTrack;
  screen?: MediaStreamTrack;
}

type RemoteVideoBindingTarget = "primary" | "camera" | "screen";

export class DemoMediaSession {
  private session: MediaSessionState | null = null;
  private remoteStreams = new Map<string, MediaStream>();
  private remoteCameraStreams = new Map<string, MediaStream>();
  private remoteScreenStreams = new Map<string, MediaStream>();
  private remoteVideoElements = new Map<string, HTMLVideoElement>();
  private participantMediaStates = new Map<string, ParticipantMediaState>();
  private remoteParticipantTracks = new Map<string, RemoteParticipantTracks>();

  constructor(
    private readonly websocketBaseUrl: string,
    private readonly onTransportState: (state: "idle" | "connecting" | "connected" | "error") => void,
    private readonly onError: (message: string) => void,
    private readonly onRemoteStreamsChanged: () => void
  ) {}

  private log(message: string, details?: Record<string, unknown>) {
    logger.info(`media.${message.replace(/[: ]/g, "_")}`, details ?? {});
  }

  getRemoteStream(participantId: string) {
    return this.remoteStreams.get(participantId) ?? null;
  }

  getRemoteCameraStream(participantId: string) {
    return this.remoteCameraStreams.get(participantId) ?? null;
  }

  getRemoteScreenStream(participantId: string) {
    return this.remoteScreenStreams.get(participantId) ?? null;
  }

  static toRtcIceServers(servers: IceServerDefinition[]): RTCIceServer[] {
    return servers.map((server) => ({
      urls: server.urls,
      username: server.username,
      credential: server.credential
    }));
  }

  hasRemoteStream(participantId: string) {
    return this.remoteStreams.has(participantId);
  }

  hasRemoteCameraStream(participantId: string) {
    return this.remoteCameraStreams.has(participantId);
  }

  hasRemoteScreenStream(participantId: string) {
    return this.remoteScreenStreams.has(participantId);
  }

  getParticipantMediaState(participantId: string) {
    return this.participantMediaStates.get(participantId) ?? null;
  }

  isScreenShareActive() {
    return Boolean(this.session?.screenShareProducerId);
  }

  getLocalScreenShareStream() {
    return this.session?.screenShareStream ?? null;
  }

  bindRemoteVideo(
    node: HTMLVideoElement,
    binding: string | { participantId: string; target?: RemoteVideoBindingTarget }
  ) {
    let participantId =
      typeof binding === "string" ? binding : binding.participantId;
    let target =
      typeof binding === "string" ? "primary" : (binding.target ?? "primary");
    let elementKey = `${participantId}:${target}`;

    this.remoteVideoElements.set(elementKey, node);
    this.syncRemoteVideoElement(participantId, target);

    return {
      update: (nextBinding: string | { participantId: string; target?: RemoteVideoBindingTarget }) => {
        this.remoteVideoElements.delete(elementKey);
        participantId =
          typeof nextBinding === "string" ? nextBinding : nextBinding.participantId;
        target =
          typeof nextBinding === "string" ? "primary" : (nextBinding.target ?? "primary");
        elementKey = `${participantId}:${target}`;
        this.remoteVideoElements.set(elementKey, node);
        this.syncRemoteVideoElement(participantId, target);
      },
      destroy: () => {
        this.remoteVideoElements.delete(elementKey);
      }
    };
  }

  pruneRemoteStreams(validParticipantIds: string[]) {
    const validIds = new Set(validParticipantIds);

    for (const [participantId, stream] of this.remoteStreams.entries()) {
      if (validIds.has(participantId)) {
        continue;
      }

      for (const track of stream.getTracks()) {
        track.stop();
      }

      this.remoteStreams.delete(participantId);
      this.remoteCameraStreams.delete(participantId);
      this.remoteScreenStreams.delete(participantId);
      this.remoteVideoElements.delete(participantId);
      this.participantMediaStates.delete(participantId);
      this.remoteParticipantTracks.delete(participantId);
    }

    this.onRemoteStreamsChanged();
  }

  async connect(
    roomCode: string,
    participantId: string,
    localStream: MediaStream,
    iceServers: RTCIceServer[]
  ) {
    if (
      this.session &&
      this.session.roomCode === roomCode &&
      this.session.participantId === participantId
    ) {
      return;
    }

    this.close();
    this.onTransportState("connecting");
    this.log("connect:start", { roomCode, participantId, iceServerCount: iceServers.length });

    const session: MediaSessionState = {
      roomCode,
      participantId,
      iceServers,
      socket: new WebSocket(`${this.websocketBaseUrl}/ws/${roomCode}/${participantId}`),
      device: new Device(),
      pendingRequests: new Map(),
      producers: new Map(),
      consumers: new Map(),
      consumedProducerIds: new Set(),
      screenShareTrack: null,
      screenShareStream: null
    };

    this.session = session;

    await new Promise<void>((resolve, reject) => {
      session.socket.addEventListener("open", () => resolve(), { once: true });
      session.socket.addEventListener(
        "error",
        () => reject(new Error("Unable to connect mediasoup signaling")),
        { once: true }
      );
    });

    session.socket.onmessage = async (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as SignalingMessage;

        if (payload.type === "response") {
          const resolver = session.pendingRequests.get(payload.requestId);

          if (resolver) {
            session.pendingRequests.delete(payload.requestId);
            resolver({ data: payload.data, error: payload.error });
          }
          return;
        }

        if (payload.type === "connected") {
          this.participantMediaStates.clear();

          for (const state of payload.participantStates) {
            this.participantMediaStates.set(state.participantId, state);
          }

          this.log("socket:connected", {
            roomCode,
            participantId,
            existingProducers: payload.existingProducers.length,
            participantStates: payload.participantStates.length
          });
          await session.device.load({ routerRtpCapabilities: payload.routerRtpCapabilities });
          await this.createTransport(session, "send");
          await this.createTransport(session, "recv");
          await this.produceLocalMedia(session, localStream);
          await this.syncParticipantMediaState(
            localStream.getAudioTracks()[0]?.enabled ?? false,
            localStream.getVideoTracks()[0]?.enabled ?? false
          );

          for (const producer of payload.existingProducers) {
            await this.consumeProducer(session, producer);
          }

          this.onTransportState("connected");
          this.onRemoteStreamsChanged();
          return;
        }

        if (payload.type === "producerAdded") {
          this.log("producer:added", payload);
          await this.consumeProducer(session, payload);
          return;
        }

        if (payload.type === "producerClosed") {
          this.log("producer:closed", payload);
          const consumer = Array.from(session.consumers.values()).find(
            (candidate) => candidate.producerId === payload.producerId
          );

          if (consumer) {
            this.removeConsumer(consumer.id);
          }
          return;
        }

        if (payload.type === "consumerClosed") {
          this.log("consumer:closed", payload);
          this.removeConsumer(payload.consumerId);
          return;
        }

        if (payload.type === "participantMediaStateChanged") {
          this.participantMediaStates.set(payload.participantId, {
            participantId: payload.participantId,
            audioEnabled: payload.audioEnabled,
            videoEnabled: payload.videoEnabled,
            screenEnabled: payload.screenEnabled ?? false
          });
          this.onRemoteStreamsChanged();
          return;
        }

        if (payload.type === "error") {
          this.onTransportState("error");
          this.onError(payload.message);
        }
      } catch (error) {
        logger.error("media.socket_message_failed", { error });
        this.onTransportState("error");
        this.onError(error instanceof Error ? error.message : "Media session failed.");
      }
    };

    session.socket.onclose = () => {
      this.log("socket:closed", { roomCode, participantId });
      this.onTransportState("idle");
    };
  }

  close() {
    for (const stream of this.remoteStreams.values()) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }

    this.remoteStreams.clear();
    this.remoteCameraStreams.clear();
    this.remoteScreenStreams.clear();
    this.participantMediaStates.clear();
    this.remoteParticipantTracks.clear();
    this.onRemoteStreamsChanged();

    if (!this.session) {
      this.onTransportState("idle");
      return;
    }

    for (const producer of this.session.producers.values()) {
      producer.close();
    }

    if (this.session.screenShareTrack) {
      this.session.screenShareTrack.stop();
    }

    this.session.screenShareStream = null;

    for (const consumer of this.session.consumers.values()) {
      consumer.close();
    }

    this.session.sendTransport?.close();
    this.session.recvTransport?.close();

    if (
      this.session.socket.readyState === WebSocket.OPEN ||
      this.session.socket.readyState === WebSocket.CONNECTING
    ) {
      this.session.socket.close();
    }

    this.session = null;
    this.onTransportState("idle");
  }

  async syncParticipantMediaState(audioEnabled: boolean, videoEnabled: boolean) {
    if (!this.session) {
      return;
    }

    this.participantMediaStates.set(this.session.participantId, {
      participantId: this.session.participantId,
      audioEnabled,
      videoEnabled,
      screenEnabled: this.session.screenShareProducerId !== undefined
    });
    this.onRemoteStreamsChanged();

    await this.requestSignal("setMediaState", {
      audioEnabled,
      videoEnabled,
      screenEnabled: this.session.screenShareProducerId !== undefined
    });
  }

  async syncLocalTracks(localStream: MediaStream) {
    const session = this.session;

    if (!session?.sendTransport) {
      return;
    }

    const sendTransport = session.sendTransport;

    const syncTrack = async (
      mediaTag: "microphone" | "camera",
      track: MediaStreamTrack | undefined
    ) => {
      const existingProducer = Array.from(session.producers.values()).find(
        (producer) => String(producer.appData?.mediaTag ?? "") === mediaTag
      );

      if (!track || track.readyState !== "live") {
        if (existingProducer) {
          existingProducer.close();
          session.producers.delete(existingProducer.id);
        }
        return;
      }

      if (existingProducer) {
        if (existingProducer.track !== track) {
          await existingProducer.replaceTrack({ track });
        }
        return;
      }

      const producer = await sendTransport.produce({
        track,
        appData: { mediaTag }
      });

      session.producers.set(producer.id, producer);
    };

    await syncTrack("camera", localStream.getVideoTracks()[0]);
    await syncTrack("microphone", localStream.getAudioTracks()[0]);
  }

  async startScreenShare() {
    if (!this.session?.sendTransport || this.session.screenShareProducerId) {
      return;
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });
    const track = stream.getVideoTracks()[0];

    if (!track) {
      return;
    }

    track.addEventListener(
      "ended",
      () => {
        void this.stopScreenShare();
      },
      { once: true }
    );

    const producer = await this.session.sendTransport.produce({
      track,
      appData: { mediaTag: "screen" }
    });

    this.session.producers.set(producer.id, producer);
    this.session.screenShareProducerId = producer.id;
    this.session.screenShareTrack = track;
    this.session.screenShareStream = new MediaStream([track]);
    this.participantMediaStates.set(this.session.participantId, {
      participantId: this.session.participantId,
      audioEnabled: this.participantMediaStates.get(this.session.participantId)?.audioEnabled ?? true,
      videoEnabled: this.participantMediaStates.get(this.session.participantId)?.videoEnabled ?? true,
      screenEnabled: true
    });
    this.onRemoteStreamsChanged();
    await this.requestSignal("setMediaState", {
      audioEnabled: this.participantMediaStates.get(this.session.participantId)?.audioEnabled ?? true,
      videoEnabled: this.participantMediaStates.get(this.session.participantId)?.videoEnabled ?? true,
      screenEnabled: true
    });
  }

  async stopScreenShare() {
    if (!this.session?.screenShareProducerId) {
      return;
    }

    const producer = this.session.producers.get(this.session.screenShareProducerId);
    producer?.close();
    this.session.producers.delete(this.session.screenShareProducerId);
    this.session.screenShareTrack?.stop();
    this.session.screenShareTrack = null;
    this.session.screenShareStream = null;
    this.session.screenShareProducerId = undefined;
    const currentState = this.participantMediaStates.get(this.session.participantId);
    this.participantMediaStates.set(this.session.participantId, {
      participantId: this.session.participantId,
      audioEnabled: currentState?.audioEnabled ?? true,
      videoEnabled: currentState?.videoEnabled ?? true,
      screenEnabled: false
    });
    this.onRemoteStreamsChanged();
    await this.requestSignal("setMediaState", {
      audioEnabled: currentState?.audioEnabled ?? true,
      videoEnabled: currentState?.videoEnabled ?? true,
      screenEnabled: false
    });
  }

  private syncRemoteVideoElement(
    participantId: string,
    target: RemoteVideoBindingTarget = "primary"
  ) {
    const element = this.remoteVideoElements.get(`${participantId}:${target}`);
    const stream =
      target === "camera"
        ? (this.remoteCameraStreams.get(participantId) ?? null)
        : target === "screen"
          ? (this.remoteScreenStreams.get(participantId) ?? null)
          : (this.remoteStreams.get(participantId) ?? null);

    if (!element) {
      return;
    }

    if (element.srcObject !== stream) {
      element.srcObject = stream;
    }

    if (stream) {
      void element.play().catch(() => undefined);
    }
  }

  private createRequestId() {
    return crypto.randomUUID();
  }

  private async requestSignal<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!this.session) {
      throw new Error("Media session not initialized");
    }

    return new Promise<T>((resolve, reject) => {
      const requestId = this.createRequestId();

      this.session?.pendingRequests.set(requestId, (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }

        resolve(response.data as T);
      });

      this.session?.socket.send(JSON.stringify({ action, ...payload, requestId }));
    });
  }

  private rebuildRemoteStream(participantId: string) {
    const trackSet = this.remoteParticipantTracks.get(participantId);

    if (!trackSet) {
      this.remoteStreams.delete(participantId);
      this.remoteCameraStreams.delete(participantId);
      this.remoteScreenStreams.delete(participantId);
      this.syncRemoteVideoElement(participantId, "primary");
      this.syncRemoteVideoElement(participantId, "camera");
      this.syncRemoteVideoElement(participantId, "screen");
      return;
    }

    const primaryStream = new MediaStream();

    if (trackSet.audio) {
      primaryStream.addTrack(trackSet.audio);
    }

    if (trackSet.screen) {
      primaryStream.addTrack(trackSet.screen);
    } else if (trackSet.video) {
      primaryStream.addTrack(trackSet.video);
    }

    if (primaryStream.getTracks().length === 0) {
      this.remoteStreams.delete(participantId);
    } else {
      this.remoteStreams.set(participantId, primaryStream);
    }

    if (trackSet.video) {
      const cameraStream = new MediaStream();

      if (trackSet.audio) {
        cameraStream.addTrack(trackSet.audio);
      }

      cameraStream.addTrack(trackSet.video);
      this.remoteCameraStreams.set(participantId, cameraStream);
    } else {
      this.remoteCameraStreams.delete(participantId);
    }

    if (trackSet.screen) {
      const screenStream = new MediaStream();

      if (trackSet.audio) {
        screenStream.addTrack(trackSet.audio);
      }

      screenStream.addTrack(trackSet.screen);
      this.remoteScreenStreams.set(participantId, screenStream);
    } else {
      this.remoteScreenStreams.delete(participantId);
    }

    this.syncRemoteVideoElement(participantId, "primary");
    this.syncRemoteVideoElement(participantId, "camera");
    this.syncRemoteVideoElement(participantId, "screen");
  }

  private removeConsumer(consumerId: string) {
    if (!this.session) {
      return;
    }

    const consumer = this.session.consumers.get(consumerId);

    if (!consumer) {
      return;
    }

    const participantId = String(consumer.appData?.participantId ?? "");
    const mediaTag = String(consumer.appData?.mediaTag ?? "");
    const remoteTracks = this.remoteParticipantTracks.get(participantId);

    consumer.close();
    this.session.consumers.delete(consumerId);
    this.session.consumedProducerIds.delete(consumer.producerId);

    if (remoteTracks) {
      if (mediaTag === "screen") {
        delete remoteTracks.screen;
      } else if (consumer.kind === "audio") {
        delete remoteTracks.audio;
      } else {
        delete remoteTracks.video;
      }

      if (!remoteTracks.audio && !remoteTracks.video && !remoteTracks.screen) {
        this.remoteParticipantTracks.delete(participantId);
      }
    }

    this.onRemoteStreamsChanged();
    this.rebuildRemoteStream(participantId);
  }

  private async createTransport(session: MediaSessionState, direction: "send" | "recv") {
    const transportOptions = await this.requestSignal<{
      id: string;
      iceParameters: MediaSoupClientTypes.IceParameters;
      iceCandidates: MediaSoupClientTypes.IceCandidate[];
      dtlsParameters: MediaSoupClientTypes.DtlsParameters;
      sctpParameters?: MediaSoupClientTypes.SctpParameters;
    }>("createTransport", {
      direction
    });

    const transportConfiguration = {
      ...transportOptions,
      iceServers: session.iceServers
    };

    const transport =
      direction === "send"
        ? session.device.createSendTransport(transportConfiguration)
        : session.device.createRecvTransport(transportConfiguration);

    transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        this.log("transport:connect", { direction, transportId: transport.id });
        await this.requestSignal("connectTransport", {
          transportId: transport.id,
          dtlsParameters
        });
        callback();
      } catch (error) {
        logger.error("media.transport_connect_failed", {
          direction,
          transportId: transport.id,
          error
        });
        errback(error as Error);
      }
    });

    transport.on("connectionstatechange", (state) => {
      this.log("transport:state", { direction, transportId: transport.id, state });
    });

    if (direction === "send") {
      transport.on("produce", async ({ kind, rtpParameters, appData }, callback, errback) => {
        try {
          this.log("transport:produce", { transportId: transport.id, kind });
          const response = await this.requestSignal<{ id: string }>("produce", {
            transportId: transport.id,
            kind,
            rtpParameters,
            appData
          });

          callback({ id: response.id });
        } catch (error) {
          logger.error("media.transport_produce_failed", {
            transportId: transport.id,
            kind,
            error
          });
          errback(error as Error);
        }
      });

      session.sendTransport = transport;
    } else {
      session.recvTransport = transport;
    }
  }

  private async produceLocalMedia(session: MediaSessionState, localStream: MediaStream) {
    if (!session.sendTransport) {
      return;
    }

    const videoTrack = localStream.getVideoTracks()[0];
    const audioTrack = localStream.getAudioTracks()[0];

    if (videoTrack?.readyState === "live") {
      this.log("produceLocalMedia:video", {
        participantId: session.participantId,
        trackId: videoTrack.id,
        readyState: videoTrack.readyState
      });
      const producer = await session.sendTransport.produce({
        track: videoTrack,
        appData: { mediaTag: "camera" }
      });
      session.producers.set(producer.id, producer);
    } else if (videoTrack) {
      this.log("produceLocalMedia:video skipped", {
        participantId: session.participantId,
        trackId: videoTrack.id,
        readyState: videoTrack.readyState
      });
    }

    if (audioTrack?.readyState === "live") {
      this.log("produceLocalMedia:audio", {
        participantId: session.participantId,
        trackId: audioTrack.id,
        readyState: audioTrack.readyState
      });
      const producer = await session.sendTransport.produce({
        track: audioTrack,
        appData: { mediaTag: "microphone" }
      });
      session.producers.set(producer.id, producer);
    } else if (audioTrack) {
      this.log("produceLocalMedia:audio skipped", {
        participantId: session.participantId,
        trackId: audioTrack.id,
        readyState: audioTrack.readyState
      });
    }
  }

  private async consumeProducer(
    session: MediaSessionState,
    remoteProducer: { producerId: string; participantId: string; kind: string }
  ) {
    if (
      !session.recvTransport ||
      remoteProducer.participantId === session.participantId ||
      session.consumedProducerIds.has(remoteProducer.producerId)
    ) {
      return;
    }

    session.consumedProducerIds.add(remoteProducer.producerId);

    try {
      this.log("consume:start", remoteProducer);
      const consumerParameters = await this.requestSignal<{
        id: string;
        producerId: string;
        kind: MediaSoupClientTypes.MediaKind;
        rtpParameters: MediaSoupClientTypes.RtpParameters;
        participantId: string;
        mediaTag?: string | null;
      }>("consume", {
        transportId: session.recvTransport.id,
        producerId: remoteProducer.producerId,
        rtpCapabilities: session.device.rtpCapabilities
      });

      const consumer = await session.recvTransport.consume({
        id: consumerParameters.id,
        producerId: consumerParameters.producerId,
        kind: consumerParameters.kind,
        rtpParameters: consumerParameters.rtpParameters,
        appData: {
          participantId: consumerParameters.participantId,
          mediaTag: consumerParameters.mediaTag ?? undefined
        }
      });

      session.consumers.set(consumer.id, consumer);

      const remoteTracks = this.remoteParticipantTracks.get(consumerParameters.participantId) ?? {};
      const mediaTag = consumerParameters.mediaTag === "screen" ? "screen" : consumer.kind;

      if (mediaTag === "screen") {
        remoteTracks.screen = consumer.track;
      } else if (consumer.kind === "audio") {
        remoteTracks.audio = consumer.track;
      } else {
        remoteTracks.video = consumer.track;
      }

      this.remoteParticipantTracks.set(consumerParameters.participantId, remoteTracks);
      this.log("consume:ready", {
        participantId: consumerParameters.participantId,
        producerId: consumerParameters.producerId,
        consumerId: consumer.id,
        kind: consumer.kind,
        mediaTag: consumerParameters.mediaTag ?? null
      });
      this.onRemoteStreamsChanged();
      this.rebuildRemoteStream(consumerParameters.participantId);

      await this.requestSignal("resumeConsumer", {
        consumerId: consumer.id
      });
    } catch (error) {
      logger.error("media.consume_failed", { remoteProducer, error });
      session.consumedProducerIds.delete(remoteProducer.producerId);
    }
  }
}
