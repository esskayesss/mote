export interface TranscriptionSegment {
  start?: number;
  end?: number;
  text: string;
  completed: boolean;
}

export interface RealtimeTranscriptionCallbacks {
  onReady?: () => void;
  onPartial?: (segment: TranscriptionSegment) => void;
  onFinal?: (segment: TranscriptionSegment) => void;
  onWarning?: (message: string) => void;
  onError?: (message: string) => void;
  onInfo?: (message: string) => void;
}

export interface RealtimeTranscriptionProviderSession {
  connect: () => Promise<void>;
  sendAudioChunk: (chunk: ArrayBuffer) => void;
  close: () => void;
}
