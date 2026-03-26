import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import { logger } from "../logger";

export interface NoiseSuppressedAudioSession {
  track: MediaStreamTrack;
  dispose: () => void;
}

let rnnoiseModulePromise: Promise<ArrayBuffer> | null = null;

const loadRnnoiseModule = () =>
  (rnnoiseModulePromise ??= loadRnnoise({
    url: rnnoiseWasmUrl,
    simdUrl: rnnoiseSimdWasmUrl
  }));

export const createNoiseSuppressedAudioTrack = async (
  sourceTrack: MediaStreamTrack
): Promise<NoiseSuppressedAudioSession> => {
  const AudioContextCtor = window.AudioContext;

  if (
    sourceTrack.kind !== "audio" ||
    !AudioContextCtor ||
    !("audioWorklet" in AudioContextCtor.prototype)
  ) {
    return {
      track: sourceTrack,
      dispose: () => {
        if (sourceTrack.readyState === "live") {
          sourceTrack.stop();
        }
      }
    };
  }

  let disposed = false;
  const context = new AudioContextCtor({
    sampleRate: 48_000,
    latencyHint: "interactive"
  });

  try {
    await context.audioWorklet.addModule(rnnoiseWorkletUrl);
    const wasmBinary = await loadRnnoiseModule();
    const source = context.createMediaStreamSource(new MediaStream([sourceTrack]));
    const suppressor = new RnnoiseWorkletNode(context, {
      wasmBinary,
      maxChannels: 1
    });
    const destination = context.createMediaStreamDestination();
    const processedTrack = destination.stream.getAudioTracks()[0];

    source.connect(suppressor);
    suppressor.connect(destination);
    processedTrack.enabled = sourceTrack.enabled;

    const dispose = () => {
      if (disposed) {
        return;
      }

      disposed = true;
      sourceTrack.removeEventListener("ended", handleSourceEnded);

      try {
        source.disconnect();
      } catch {}

      try {
        suppressor.disconnect();
      } catch {}

      try {
        suppressor.destroy();
      } catch {}

      if (processedTrack.readyState === "live") {
        processedTrack.stop();
      }

      if (sourceTrack.readyState === "live") {
        sourceTrack.stop();
      }

      void context.close().catch(() => undefined);
    };

    const handleSourceEnded = () => {
      dispose();
    };

    sourceTrack.addEventListener("ended", handleSourceEnded);

    return {
      track: processedTrack,
      dispose
    };
  } catch (error) {
    logger.warn("media.noise_suppression_unavailable", {
      error: error instanceof Error ? error.message : String(error)
    });
    void context.close().catch(() => undefined);
    return {
      track: sourceTrack,
      dispose: () => {
        if (sourceTrack.readyState === "live") {
          sourceTrack.stop();
        }
      }
    };
  }
};
