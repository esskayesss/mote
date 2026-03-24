import type { AgendaArtifact, RefineAgendaRequest } from "@mote/models";

const agendaArtifactSchema = {
  name: "agenda_artifact",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "summary", "points"],
    properties: {
      kind: {
        type: "string",
        enum: ["agenda.v1"]
      },
      summary: {
        type: "string"
      },
      points: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "order",
            "title",
            "objective",
            "talkingPoints",
            "successSignals",
            "estimatedDurationMinutes",
            "tags"
          ],
          properties: {
            id: { type: "string" },
            order: { type: "number" },
            title: { type: "string" },
            objective: { type: "string" },
            talkingPoints: {
              type: "array",
              items: { type: "string" }
            },
            successSignals: {
              type: "array",
              items: { type: "string" }
            },
            estimatedDurationMinutes: { type: "number" },
            ownerHint: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            dependencies: {
              type: "array",
              items: { type: "string" }
            },
            tags: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      }
    }
  }
} as const;

const systemPrompt = [
  "You refine meeting agendas into strict machine-readable artifacts for an AI meeting orchestration platform.",
  "Turn rough topics into ordered agenda points with clear objectives, talking points, success signals, estimated durations, dependencies, and tags.",
  "Be concise, concrete, and operational.",
  "Return only valid JSON that matches the requested schema."
].join(" ");

const userPrompt = (input: RefineAgendaRequest) =>
  JSON.stringify(
    {
      roomCode: input.roomCode ?? null,
      meetingTitle: input.meetingTitle ?? null,
      meetingGoal: input.meetingGoal ?? null,
      agenda: input.agenda
    },
    null,
    2
  );

export class AgendaModelClient {
  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      model: string;
    }
  ) {}

  isConfigured() {
    return Boolean(this.config.apiKey.trim());
  }

  async refineAgenda(input: RefineAgendaRequest): Promise<AgendaArtifact> {
    if (!this.isConfigured()) {
      throw new Error("LLM API key is not configured.");
    }

    const response = await fetch(this.config.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.2,
        response_format: {
          type: "json_schema",
          json_schema: agendaArtifactSchema
        },
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt(input)
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Agenda refinement model request failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const content = payload.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("Agenda refinement model returned no content.");
    }

    return JSON.parse(content) as AgendaArtifact;
  }
}
