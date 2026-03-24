type TranscriptionConnectionState = "idle" | "connecting" | "connected" | "error";

type RuntimeSession = {
  roomCode: string;
  participantId: string;
  url: string;
  targetSampleRate: number;
  socket: WebSocket;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  gainNode: GainNode;
  forwardedChunkCount: number;
};

const resamplePcm = (
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
) => {
  if (sourceSampleRate === targetSampleRate) {
    return input;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const interpolation = position - leftIndex;
    output[index] =
      input[leftIndex] + (input[rightIndex] - input[leftIndex]) * interpolation;
  }

  return output;
};

export class DemoTranscriptionSession {
  private session: RuntimeSession | null = null;

  constructor(
    private readonly onConnectionState: (state: TranscriptionConnectionState) => void,
    private readonly onError: (message: string) => void
  ) {}

  private log(message: string, details?: Record<string, unknown>) {
    console.info("[mote:transcription]", message, details ?? {});
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

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;
    this.log("audio:context", {
      roomCode,
      participantId,
      actualSampleRate: audioContext.sampleRate,
      targetSampleRate: sampleRate
    });

    processor.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (audioTrack.readyState !== "live" || !audioTrack.enabled) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const captureChunk = new Float32Array(input.length);
      captureChunk.set(input);
      const resampledChunk = resamplePcm(
        captureChunk,
        audioContext.sampleRate,
        sampleRate
      );

      socket.send(resampledChunk.buffer);

      if (!this.session) {
        return;
      }

      this.session.forwardedChunkCount += 1;

      if (
        this.session.forwardedChunkCount === 1 ||
        this.session.forwardedChunkCount % 100 === 0
      ) {
        this.log("audio:chunk", {
          roomCode,
          participantId,
          chunkCount: this.session.forwardedChunkCount,
          inputSamples: captureChunk.length,
          outputSamples: resampledChunk.length,
          actualSampleRate: audioContext.sampleRate,
          targetSampleRate: sampleRate
        });
      }
    };

    source.connect(processor);
    processor.connect(gainNode);
    gainNode.connect(audioContext.destination);

    this.session = {
      roomCode,
      participantId,
      url: endpointUrl,
      targetSampleRate: sampleRate,
      socket,
      audioContext,
      source,
      processor,
      gainNode,
      forwardedChunkCount: 0
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
        console.error("[mote:transcription] socket:onmessage failed", error);
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

    this.session.processor.disconnect();
    this.session.source.disconnect();
    this.session.gainNode.disconnect();
    void this.session.audioContext.close();

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
