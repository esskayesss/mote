import OpenAI from "openai";
import type { AgendaArtifact, RefineAgendaRequest } from "@mote/models";
import { logger } from "../../logger";

const agendaArtifactSchema = {
  name: "agenda_artifact",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "kind",
      "locked",
      "generatedAt",
      "meetingTitle",
      "sourcePrompt",
      "meetingIntent",
      "summary",
      "points"
    ],
    properties: {
      kind: {
        type: "string",
        enum: ["agenda.v1"]
      },
      locked: {
        type: "boolean",
        enum: [true]
      },
      generatedAt: {
        type: "string"
      },
      meetingTitle: {
        type: "string"
      },
      sourcePrompt: {
        type: "array",
        items: { type: "string" }
      },
      meetingIntent: {
        type: "string"
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
            "subtopics",
            "status",
            "talkingPoints",
            "successSignals",
            "estimatedDurationMinutes",
            "tags"
          ],
          properties: {
            id: { type: "string" },
            order: { type: "number" },
            title: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "active", "completed"]
            },
            objective: { type: "string" },
            subtopics: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "order", "title", "status"],
                properties: {
                  id: { type: "string" },
                  order: { type: "number" },
                  title: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["pending", "active", "completed"]
                  }
                }
              }
            },
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
  "You convert rough meeting agenda prompts into immutable machine-readable agenda artifacts for an AI meeting orchestration platform.",
  "Treat the user agenda as the source prompt, then produce a locked agenda.v1 artifact that becomes the meeting source of truth.",
  "Always produce a concrete meetingTitle. If the input title is missing, infer a short, specific title from the agenda and goal. If the input title is present, keep it unless it is clearly malformed.",
  "Each agenda point must include concise subtopic objects with id, order, title, and status, plus a point-level status, objective, talking points, success signals, dependencies, estimated duration, and tags.",
  "Subtopics must be contextual, domain-specific, and downstream-useful. Expand the actual subject matter of the point instead of using generic scaffolding.",
  "Do not use generic filler such as 'Context framing', 'Key decision', 'Takeaway', 'Risks', or 'Questions' unless the source prompt explicitly asks for those topics.",
  "Use only entities, nouns, and domain terms that appear in the user input. Do not invent example domains or echo internal app/demo scaffolding.",
  "Never mention FileBackedNotesManager, Notes Manager, or NotesManager unless those exact terms appear in the user input.",
  "Prefer 2 to 4 short subtopics per point. Each subtopic should read like a specific discussion lane, implementation concern, edge case, or decision surface.",
  "Keep point titles short and concrete, usually 3 to 8 words. Avoid repeating the full objective verbatim in multiple fields.",
  "Keep the artifact compact. Use short objectives and keep talking points, success signals, and dependencies brief.",
  "Default the first topic and its first subtopic to active when no better execution state is implied. Use pending for future work and completed only when the prompt clearly implies it.",
  "Do not add filler. Keep the agenda structured, sequenced, and execution-ready.",
  "Return only valid JSON that matches the requested schema."
].join(" ");

const userPrompt = (input: RefineAgendaRequest) =>
  JSON.stringify(
    {
      roomCode: input.roomCode ?? null,
      meetingTitle: input.meetingTitle ?? null,
      meetingGoal: input.meetingGoal ?? null,
      agendaPrompt: input.agenda
    },
    null,
    2
  );

type ChatCompletionPayload = {
  id?: string;
  model?: string;
  usage?: unknown;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<string | { text?: string }> | null;
      refusal?: string | null;
    } | null;
  }>;
};

const extractTextContent = (payload: ChatCompletionPayload) => {
  const message = payload.choices?.[0]?.message;
  const content = message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if ("text" in part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("")
      .trim();
  }

  if ("refusal" in (message ?? {}) && typeof message?.refusal === "string") {
    return message.refusal.trim();
  }

  return "";
};

export class OpenAiChatCompletionsTool {
  private readonly client: OpenAI;

  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      model: string;
    }
  ) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl.replace(/\/chat\/completions$/, "")
    });
  }

  isConfigured() {
    return Boolean(this.config.apiKey.trim());
  }

  async refineAgenda(input: RefineAgendaRequest): Promise<AgendaArtifact> {
    if (!this.isConfigured()) {
      throw new Error("LLM API key is not configured.");
    }

    const requestLogger = logger.withContext({
      tool: "openai_chat_completions",
      operation: "refine_agenda",
      model: this.config.model,
      roomCode: input.roomCode ?? null
    });
    const systemContent = systemPrompt;
    const userContent = userPrompt(input);

    requestLogger.withMetadata({
      requestSummary: {
        meetingTitle: input.meetingTitle ?? null,
        meetingGoal: input.meetingGoal ?? null,
        agendaTopicCount: input.agenda.length,
        agendaTopics: input.agenda
      }
    }).info("agenda.llm_request");

    const baseRequest = {
      model: this.config.model,
      max_completion_tokens: 1800,
      messages: [
        {
          role: "system" as const,
          content: systemContent
        },
        {
          role: "user" as const,
          content: userContent
        }
      ]
    };

    let payload = await this.client.chat.completions.create({
      ...baseRequest,
      response_format: {
        type: "json_schema",
        json_schema: {
          ...agendaArtifactSchema,
          strict: true
        }
      }
    });

    let content = extractTextContent(payload);

    requestLogger.withMetadata({
      responseSummary: {
        strategy: "json_schema",
        id: payload.id,
        model: payload.model,
        finishReason: payload.choices?.[0]?.finish_reason ?? null,
        usage: payload.usage
      }
    }).info("agenda.llm_response");

    if (!content) {
      requestLogger.warn("agenda.llm_empty_content_retrying", {
        retryStrategy: "json_object",
        finishReason: payload.choices?.[0]?.finish_reason ?? null
      });

      payload = await this.client.chat.completions.create({
        ...baseRequest,
        response_format: {
          type: "json_object"
        }
      });

      content = extractTextContent(payload);

      requestLogger.withMetadata({
        responseSummary: {
          strategy: "json_object",
          id: payload.id,
          model: payload.model,
          finishReason: payload.choices?.[0]?.finish_reason ?? null,
          usage: payload.usage
        }
      }).info("agenda.llm_response");
    }

    if (!content) {
      throw new Error("Agenda refinement model returned no content.");
    }

    requestLogger.withMetadata({
      contentSummary: {
        length: content.length,
        preview: content.slice(0, 280)
      }
    }).info("agenda.llm_response_content");

    try {
      const artifact = JSON.parse(content) as AgendaArtifact;
      requestLogger.withMetadata({
        artifactSummary: {
          meetingTitle: artifact.meetingTitle,
          pointCount: artifact.points.length,
          pointTitles: artifact.points.map((point) => point.title)
        }
      }).info("agenda.llm_response_parsed");
      return artifact;
    } catch (error) {
      requestLogger.error("agenda.llm_response_parse_failed", {
        error,
        contentSummary: {
          length: content.length,
          preview: content.slice(0, 280)
        }
      });
      throw error;
    }
  }
}
