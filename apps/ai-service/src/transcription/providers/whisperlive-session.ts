import { createWhisperClient } from "@mote/whisper-client";
import type {
  RealtimeTranscriptionCallbacks,
  RealtimeTranscriptionProviderSession
} from "./types";

export const createWhisperLiveSession = (
  config: {
    url: string;
    model: string;
    language: string;
    sampleRate: number;
  },
  callbacks: RealtimeTranscriptionCallbacks
): RealtimeTranscriptionProviderSession => {
  const client = createWhisperClient(config);
  return client.createRealtimeSession(callbacks);
};
