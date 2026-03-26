import { describe, expect, it } from "bun:test";
import type { TranscriptionProvider } from "@mote/models";
import type { RealtimeTranscriptionCallbacks } from "./providers/types";
import { ParticipantTranscriptionSession, type BrowserSocket } from "./session";

const createPublisherStub = () =>
  ({
    publishSegment: async () => undefined
  }) as const;

const createMonitoringStub = () =>
  ({
    observePartialTranscript: () => undefined,
    observeFinalTranscript: () => undefined
  }) as const;

const createSocketStub = () => {
  const sent: string[] = [];

  const socket: BrowserSocket = {
    readyState: WebSocket.OPEN,
    send(data: string) {
      sent.push(data);
    },
    close() {
      socket.readyState = WebSocket.CLOSED;
    }
  };

  return { socket, sent };
};

const createSession = () => {
  let callbacks: RealtimeTranscriptionCallbacks | null = null;
  let providerCloseCalls = 0;

  const session = new ParticipantTranscriptionSession(
    "room-key-1",
    "room-1",
    "participant-1",
    createPublisherStub() as never,
    createMonitoringStub() as never,
    "whisperlive" satisfies TranscriptionProvider,
    "ws://provider",
    (nextCallbacks: RealtimeTranscriptionCallbacks) => {
      callbacks = nextCallbacks;

      return {
        connect: async () => undefined,
        sendAudioChunk: () => undefined,
        close: () => {
          providerCloseCalls += 1;
        }
      };
    }
  );

  return {
    session,
    getCallbacks: () => callbacks,
    getProviderCloseCalls: () => providerCloseCalls
  };
};

describe("ParticipantTranscriptionSession", () => {
  it("does not send a closed payload when the session is closed", async () => {
    const { session } = createSession();
    const { socket, sent } = createSocketStub();

    await session.attachBrowserSocket(socket);
    expect(sent).toEqual([JSON.stringify({ type: "connecting" })]);

    session.close("client-disconnected");

    expect(sent).toEqual([JSON.stringify({ type: "connecting" })]);
  });

  it("ignores provider callbacks after close", async () => {
    const { session, getCallbacks, getProviderCloseCalls } = createSession();
    const { socket, sent } = createSocketStub();

    await session.attachBrowserSocket(socket);
    session.close("cleanup");

    const callbacks = getCallbacks();
    expect(callbacks).not.toBeNull();

    callbacks?.onReady?.();
    callbacks?.onWarning?.("late-warning");
    callbacks?.onError?.("late-error");
    callbacks?.onFinal?.({
      text: "late final",
      completed: true
    });

    expect(getProviderCloseCalls()).toBe(1);
    expect(sent).toEqual([JSON.stringify({ type: "connecting" })]);
  });

  it("handles duplicate close calls idempotently", async () => {
    const { session, getProviderCloseCalls } = createSession();
    const { socket } = createSocketStub();

    await session.attachBrowserSocket(socket);
    session.close("first");
    session.close("second");

    expect(getProviderCloseCalls()).toBe(1);
  });
});
