import type {
  AgendaArtifact,
  RefineAgendaRequest,
  RefineAgendaResponse
} from "@mote/models";

const toPointwiseAgenda = (artifact: AgendaArtifact) =>
  artifact.points
    .map((point) => point.title.trim())
    .filter(Boolean)
    .slice(0, 8);

export class AgendaRefinementClient {
  constructor(private readonly aiServiceUrl: string) {}

  async refine(input: RefineAgendaRequest): Promise<RefineAgendaResponse> {
    const response = await fetch(`${this.aiServiceUrl}/artifacts/agenda/refine`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Agenda refinement request failed: ${response.status} ${body}`);
    }

    return (await response.json()) as RefineAgendaResponse;
  }

  toPointwiseAgenda(artifact: AgendaArtifact) {
    return toPointwiseAgenda(artifact);
  }
}
