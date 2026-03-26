import type { AgendaStatusPatch, FactCheckItem } from "@mote/models";

const MAX_INTERNAL_CHAT_MESSAGE_LENGTH = 2_000;

const truncateChatMessage = (value: string) =>
  value.length <= MAX_INTERNAL_CHAT_MESSAGE_LENGTH
    ? value
    : `${value.slice(0, MAX_INTERNAL_CHAT_MESSAGE_LENGTH - 1)}…`;

export class BackendTranscriptPublisher {
  constructor(
    private readonly backendUrl: string,
    private readonly internalApiSecret: string
  ) {}

  async publishSegment(
    roomCode: string,
    participantId: string,
    stage: "partial" | "final",
    text: string
  ) {
    const response = await fetch(`${this.backendUrl}/internal/transcription-events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-secret": this.internalApiSecret
      },
      body: JSON.stringify({
        roomCode,
        participantId,
        stage,
        text
      })
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "Unable to publish transcript segment.");
    }
  }

  async publishAgendaStatusPatch(roomCode: string, patch: AgendaStatusPatch) {
    const response = await fetch(`${this.backendUrl}/internal/agenda-status-patches`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-secret": this.internalApiSecret
      },
      body: JSON.stringify({
        roomCode,
        patch
      })
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "Unable to publish agenda status patch.");
    }
  }

  async publishFactCheckEvent(input: {
    roomCode: string;
    targetParticipantId?: string;
    windowStartedAt: string;
    windowEndedAt: string;
    items: FactCheckItem[];
  }) {
    const response = await fetch(`${this.backendUrl}/internal/fact-check-events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-secret": this.internalApiSecret
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "Unable to publish fact check event.");
    }
  }

  async publishChatMessage(input: {
    roomCode: string;
    message: string;
    persist?: boolean;
  }) {
    const response = await fetch(`${this.backendUrl}/internal/chat-events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-secret": this.internalApiSecret
      },
      body: JSON.stringify({
        ...input,
        message: truncateChatMessage(input.message.trim())
      })
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "Unable to publish chat message.");
    }
  }
}
