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
}
