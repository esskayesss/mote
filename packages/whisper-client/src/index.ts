export interface WhisperClientOptions {
  url: string;
  model: string;
  sampleRate: number;
  language?: string;
  task?: "transcribe" | "translate";
  useVad?: boolean;
}

export interface WhisperTranscriptSegment {
  start?: number;
  end?: number;
  text: string;
  completed: boolean;
}

export interface WhisperSessionCallbacks {
  onReady?: () => void;
  onPartial?: (segment: WhisperTranscriptSegment) => void;
  onFinal?: (segment: WhisperTranscriptSegment) => void;
  onWarning?: (message: string) => void;
  onError?: (message: string) => void;
  onInfo?: (message: string) => void;
}

export interface WhisperRealtimeSession {
  connect: () => Promise<void>;
  sendAudioChunk: (chunk: Float32Array | ArrayBuffer) => void;
  close: () => void;
}

const describeClose = (event: CloseEvent) =>
  `code=${event.code}${event.reason ? ` reason=${event.reason}` : ""}`;

type WhisperLiveMessage = {
  uid?: string;
  message?: string;
  status?: "WAIT" | "ERROR" | "WARNING";
  segments?: Array<{
    start?: number;
    end?: number;
    text?: string;
    completed?: boolean;
  }>;
};

type WhisperLiveSegment = NonNullable<WhisperLiveMessage["segments"]>[number];

const normalizeSegment = (segment: WhisperLiveSegment) => ({
  start: typeof segment.start === "number" ? segment.start : undefined,
  end: typeof segment.end === "number" ? segment.end : undefined,
  text: String(segment.text ?? "").trim(),
  completed: Boolean(segment.completed)
});

export interface WhisperClient {
  describe: () => {
    provider: "whisperlive";
    model: string;
    language: string;
    sampleRate: number;
    mode: "realtime";
  };
  createRealtimeSession: (callbacks: WhisperSessionCallbacks) => WhisperRealtimeSession;
}

export const createWhisperClient = (options: WhisperClientOptions): WhisperClient => ({
  describe: () => ({
    provider: "whisperlive",
    model: options.model,
    language: options.language ?? "auto",
    sampleRate: options.sampleRate,
    mode: "realtime"
  }),
  createRealtimeSession: (callbacks) => {
    let socket: WebSocket | null = null;
    const uid = crypto.randomUUID();

    const emitMessage = (rawMessage: unknown) => {
      if (typeof rawMessage !== "string") {
        return;
      }

      let payload: WhisperLiveMessage;

      try {
        payload = JSON.parse(rawMessage) as WhisperLiveMessage;
      } catch {
        callbacks.onWarning?.(`Unrecognized transcription payload: ${rawMessage}`);
        return;
      }

      callbacks.onInfo?.(`Provider message: ${rawMessage}`);

      if (payload.message === "SERVER_READY") {
        callbacks.onReady?.();
      }

      if (payload.status === "WAIT" && payload.message) {
        callbacks.onInfo?.(`Provider wait: ${payload.message}`);
      }

      if (payload.status === "WARNING" && payload.message) {
        callbacks.onWarning?.(payload.message);
      }

      if (
        (payload.status === "ERROR" || payload.message === "DISCONNECT") &&
        payload.message
      ) {
        callbacks.onError?.(payload.message);
      }

      for (const segment of payload.segments ?? []) {
        const normalized = normalizeSegment(segment);

        if (!normalized.text) {
          continue;
        }

        if (normalized.completed) {
          callbacks.onFinal?.(normalized);
        } else {
          callbacks.onPartial?.(normalized);
        }
      }
    };

    return {
      async connect() {
        if (socket && socket.readyState <= WebSocket.OPEN) {
          return;
        }

        socket = new WebSocket(options.url);

        await new Promise<void>((resolve, reject) => {
          let settled = false;
          let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            if (settled) {
              return;
            }

            settled = true;
            reject(
              new Error(
                `Timed out connecting to transcription deployment at ${options.url}.`
              )
            );
          }, 10_000);

          const finalize = (fn: () => void) => {
            if (settled) {
              return;
            }

            settled = true;
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            fn();
          };

          socket?.addEventListener(
            "open",
            () => finalize(() => resolve()),
            { once: true }
          );
          socket?.addEventListener(
            "error",
            () =>
              finalize(() =>
                reject(
                  new Error(
                    `WebSocket error while connecting to transcription deployment at ${options.url}.`
                  )
                )
              ),
            { once: true }
          );
          socket?.addEventListener(
            "close",
            (event) =>
              finalize(() =>
                reject(
                  new Error(
                    `Transcription deployment socket closed before ready at ${options.url} (${describeClose(event)}).`
                  )
                )
              ),
            { once: true }
          );
        });

        socket.onmessage = (event) => emitMessage(event.data);
        socket.onclose = () => {
          callbacks.onInfo?.("Provider socket closed.");
          socket = null;
        };

        socket.send(
          JSON.stringify({
            uid,
            task: options.task ?? "transcribe",
            model: options.model,
            use_vad: options.useVad ?? true,
            ...(options.language === "auto"
              ? { language: null }
              : options.language
                ? { language: options.language }
                : {})
          })
        );
      },
      sendAudioChunk(chunk) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          throw new Error("Transcription socket is not connected.");
        }

        if (chunk instanceof Float32Array) {
          socket.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
          return;
        }

        socket.send(chunk);
      },
      close() {
        if (!socket) {
          return;
        }

        if (socket.readyState === WebSocket.OPEN) {
          socket.send(new TextEncoder().encode("END_OF_AUDIO"));
          socket.close();
        } else if (socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }

        socket = null;
      }
    };
  }
});
