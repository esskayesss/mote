import type {
  MeetingClientAction,
  MeetingEvent,
  MeetingServerMessage,
  MeetingSnapshot
} from "@mote/models";
import { logger } from "../logger";

type ConnectionState = "idle" | "connecting" | "connected" | "error";

export class DemoMeetingEventsClient {
  private socket: WebSocket | null = null;

  constructor(
    private readonly websocketBaseUrl: string,
    private readonly onSnapshot: (snapshot: MeetingSnapshot) => void,
    private readonly onEvent: (event: MeetingEvent) => void,
    private readonly onConnectionState: (state: ConnectionState) => void,
    private readonly onError: (message: string) => void
  ) {}

  async connect(roomCode: string, participantId: string) {
    if (
      this.socket &&
      this.socket.readyState <= WebSocket.OPEN &&
      this.socket.url.endsWith(`/events/${roomCode}/${participantId}`)
    ) {
      return;
    }

    this.close();
    this.onConnectionState("connecting");

    const socket = new WebSocket(`${this.websocketBaseUrl}/events/${roomCode}/${participantId}`);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Unable to connect meeting events")), {
        once: true
      });
    });

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as MeetingServerMessage;

        if (message.type === "snapshot") {
          this.onSnapshot(message.snapshot);
          this.onConnectionState("connected");
          return;
        }

        if (message.type === "event") {
          this.onEvent(message.event);
          return;
        }

        if (message.type === "error") {
          this.onConnectionState("error");
          this.onError(message.message);
        }
      } catch (error) {
        logger.error("events.socket_message_failed", { error });
        this.onConnectionState("error");
        this.onError(error instanceof Error ? error.message : "Meeting events failed.");
      }
    };

    socket.onclose = () => {
      this.onConnectionState("idle");
    };
  }

  close() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      this.socket.close();
    }

    this.socket = null;
    this.onConnectionState("idle");
  }

  send(action: MeetingClientAction) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Meeting events socket is not connected.");
    }

    this.socket.send(JSON.stringify(action));
  }
}
