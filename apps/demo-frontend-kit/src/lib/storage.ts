import { persistentAtom, persistentBoolean } from "@nanostores/persistent";
import type { OpenAiTranscriptionModel, TranscriptionProvider } from "@mote/models";

const normalizeOpenAiTranscriptionModel = (
  value: OpenAiTranscriptionModel
): OpenAiTranscriptionModel => "whisper-1";

export const displayNameStore = persistentAtom<string>("mote:display-name", "");
export const transcriptionProviderStore = persistentAtom<TranscriptionProvider>(
  "mote:stt-provider",
  "whisperlive"
);
export const openAiTranscriptionModelStore = persistentAtom<OpenAiTranscriptionModel>(
  "mote:openai-stt-model",
  "whisper-1",
  {
    decode: (value) =>
      normalizeOpenAiTranscriptionModel(value as OpenAiTranscriptionModel),
    encode: (value) => normalizeOpenAiTranscriptionModel(value)
  }
);
export const endMeetingOnHostExitStore = persistentBoolean(
  "mote:end-meeting-on-host-exit",
  true
);
export const microphoneEnabledStore = persistentBoolean("mote:microphone-enabled", true);
export const cameraEnabledStore = persistentBoolean("mote:camera-enabled", true);

export const participantStorageKey = (code: string) => `mote:participant:${code}`;
