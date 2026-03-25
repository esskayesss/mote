import OpenAI from "openai";
import type {
  AgendaArtifact,
  AgendaExecutionStatus,
  FactCheckItem,
  RefineAgendaRequest
} from "@mote/models";
import { logger } from "../../logger";

const OPENAI_MODELS = {
  agendaRefinement: "gpt-5-nano",
  agendaStatus: "gpt-5-nano",
  factCheck: "gpt-4.1-nano"
} as const;

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
            "ownerHint",
            "dependencies",
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

const agendaRefinementSystemPrompt = [
  "You convert rough meeting agenda prompts into immutable machine-readable agenda artifacts for an AI meeting orchestration platform.",
  "Produce a locked agenda.v1 artifact that becomes the meeting source of truth.",
  "The user input may include a meeting title, agenda items, or both. Use the available input to infer what is missing.",
  "Always produce a concrete meetingTitle. If the input title is missing, infer a short, specific title from the agenda and goal. If the input title is present, keep it unless it is clearly malformed.",
  "You may rewrite parent agenda point titles for clarity, concision, and specificity. Preserve intent, scope, and domain meaning rather than surface wording.",
  "Do not preserve markdown bullets, numbering, or list punctuation in generated titles or subtopics unless the user explicitly asks for that formatting.",
  "If the input already contains a usable agenda, keep the plan close to the supplied shape. Usually keep roughly the same number of points, merging duplicates or lightly splitting overloaded points only when clearly helpful.",
  "Do not expand a short agenda into a much larger one. Avoid adding many new topics that the presenter did not imply.",
  "If the input has only a meeting title or only a vague goal with little agenda detail, generate a compact skeleton agenda, usually 3 to 5 points.",
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

const agendaStatusEvaluationSchema = {
  name: "agenda_status_evaluation",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["activeTarget", "points"],
    properties: {
      activeTarget: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "id"],
            properties: {
              kind: {
                type: "string",
                enum: ["point", "subtopic"]
              },
              id: { type: "string" }
            }
          },
          {
            type: "null"
          }
        ]
      },
      points: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "status", "subtopics"],
          properties: {
            id: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "active", "partially_completed", "completed"]
            },
            subtopics: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "status"],
                properties: {
                  id: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["pending", "active", "partially_completed", "completed"]
                  }
                }
              }
            }
          }
        }
      }
    }
  }
} as const;

const factCheckSchema = {
  name: "fact_check_result",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "severity", "claim", "correction", "rationale"],
          properties: {
            id: { type: "string" },
            severity: {
              type: "string",
              enum: ["low", "medium", "high"]
            },
            claim: { type: "string" },
            correction: { type: "string" },
            rationale: { type: "string" }
          }
        }
      }
    }
  }
} as const;

const agendaStatusSystemPrompt = [
  "You update execution statuses for an existing meeting agenda from recent presenter transcript evidence.",
  "Return only a status evaluation keyed by existing point and subtopic ids. Never rename, add, or delete agenda content.",
  "Use only these statuses: pending, active, partially_completed, completed.",
  "Exactly zero or one agenda entry may be active across the entire agenda. Use activeTarget to identify it. If no clear current focus exists, return activeTarget as null.",
  "The focusTranscriptWindow contains the latest presenter sentences and should dominate active selection.",
  "The coverageTranscriptWindow is broader and should influence partially_completed or completed judgments, not broad activation.",
  "Do not mark an item active or partially_completed when it is only mentioned as an overview, roadmap, teaser, or future topic list.",
  "Require clear elaboration for active status: usually at least two related sentences that spend time on the topic or subtopic.",
  "Use semantic matching, not only literal word overlap, but stay conservative.",
  "The meeting does not have to follow the agenda order. If the presenter clearly jumps to a later topic, that later topic may become active or partially_completed.",
  "Mark completed only when the transcript strongly indicates the point or subtopic has been substantively covered and the discussion has moved past it.",
  "Use point-level active only when the current discussion is about the broader point and not one specific subtopic.",
  "Use partially_completed for items that have been meaningfully covered already but are not the single current focus or not fully closed.",
  "For demo purposes, be somewhat aggressive about completion once the presenter clearly moves on to another topic after substantive coverage.",
  "If an introduction or setup section was active and the presenter has now shifted into the next real teaching topic, usually mark that introduction completed rather than leaving it hanging.",
  "Leave untouched future work as pending.",
  "It is acceptable for all points to remain pending if the transcript evidence is weak.",
  "Prefer conservative updates. Do not overclaim progress from passing mentions, introductions, or one-line previews.",
  "Use only evidence from the provided transcript windows.",
  "Return valid JSON that matches the schema."
].join(" ");

const agendaStatusFewShotMessages = [
  {
    role: "user" as const,
    content: JSON.stringify(
      {
        meetingTitle: "Python File I/O",
        focusTranscriptWindow:
          "Presenter: Welcome to the class. Today we will cover reading files, encodings, and error handling. Presenter: First, let me introduce what file I/O is and why it matters.",
        coverageTranscriptWindow:
          "Presenter: Welcome to the class. Today we will cover reading files, encodings, and error handling. Presenter: First, let me introduce what file I/O is and why it matters. Presenter: We will get to Unicode errors later.",
        agendaArtifact: {
          meetingTitle: "Python File I/O",
          meetingIntent: "Teach file reading and writing.",
          summary: "A lecture about practical file handling in Python.",
          points: [
            {
              id: "intro",
              order: 1,
              title: "Introduction and scope",
              objective: "Set up the lecture.",
              status: "active",
              talkingPoints: [],
              successSignals: [],
              tags: ["intro"],
              subtopics: [
                { id: "intro-1", order: 1, title: "What file I/O means", status: "active" }
              ]
            },
            {
              id: "encoding",
              order: 2,
              title: "Unicode and encoding errors",
              objective: "Cover encoding pitfalls.",
              status: "pending",
              talkingPoints: [],
              successSignals: [],
              tags: ["encoding"],
              subtopics: [
                { id: "encoding-1", order: 1, title: "Decode failures", status: "pending" }
              ]
            }
          ]
        }
      },
      null,
      2
    )
  },
  {
    role: "assistant" as const,
    content: JSON.stringify(
      {
        activeTarget: { kind: "point", id: "intro" },
        points: [
          {
            id: "intro",
            status: "active",
            subtopics: [{ id: "intro-1", status: "active" }]
          },
          {
            id: "encoding",
            status: "pending",
            subtopics: [{ id: "encoding-1", status: "pending" }]
          }
        ]
      },
      null,
      2
    )
  },
  {
    role: "user" as const,
    content: JSON.stringify(
      {
        meetingTitle: "Python File I/O",
        focusTranscriptWindow:
          "Presenter: Now let us look at UnicodeDecodeError and why UTF-8 files sometimes fail under the wrong codec. Presenter: If you open the file with the wrong encoding, Python raises a decode error.",
        coverageTranscriptWindow:
          "Presenter: We finished the introduction to file I/O. Presenter: Now let us look at UnicodeDecodeError and why UTF-8 files sometimes fail under the wrong codec. Presenter: If you open the file with the wrong encoding, Python raises a decode error.",
        agendaArtifact: {
          meetingTitle: "Python File I/O",
          meetingIntent: "Teach file reading and writing.",
          summary: "A lecture about practical file handling in Python.",
          points: [
            {
              id: "intro",
              order: 1,
              title: "Introduction and scope",
              objective: "Set up the lecture.",
              status: "active",
              talkingPoints: [],
              successSignals: [],
              tags: ["intro"],
              subtopics: [
                { id: "intro-1", order: 1, title: "What file I/O means", status: "active" }
              ]
            },
            {
              id: "encoding",
              order: 2,
              title: "Unicode and encoding errors",
              objective: "Cover encoding pitfalls.",
              status: "pending",
              talkingPoints: [],
              successSignals: [],
              tags: ["encoding"],
              subtopics: [
                { id: "encoding-1", order: 1, title: "Decode failures", status: "pending" }
              ]
            }
          ]
        }
      },
      null,
      2
    )
  },
  {
    role: "assistant" as const,
    content: JSON.stringify(
      {
        activeTarget: { kind: "point", id: "encoding" },
        points: [
          {
            id: "intro",
            status: "completed",
            subtopics: [{ id: "intro-1", status: "completed" }]
          },
          {
            id: "encoding",
            status: "active",
            subtopics: [{ id: "encoding-1", status: "active" }]
          }
        ]
      },
      null,
      2
    )
  }
] as const;

const factCheckSystemPrompt = [
  "You review a recent presenter transcript window and flag only obvious factual mistakes or high-confidence corrections.",
  "Be conservative. If the transcript does not contain an obvious error, return an empty items array.",
  "Obvious contradictions to common knowledge should be flagged. Example: 'the sun rises in the west' should be corrected.",
  "Do not nitpick style, opinion, strategy, or ambiguous claims.",
  "Only flag mistakes you can correct with high confidence from general knowledge or direct contradiction in the transcript.",
  "Keep each claim, correction, and rationale short and concrete.",
  "Return valid JSON that matches the schema."
].join(" ");

const userPrompt = (input: RefineAgendaRequest) =>
  JSON.stringify(
    {
      roomCode: input.roomCode ?? null,
      meetingTitle: input.meetingTitle ?? null,
      meetingGoal: input.meetingGoal ?? null,
      agendaPrompt: input.agenda ?? []
    },
    null,
    2
  );

const agendaStatusUserPrompt = (input: {
  meetingTitle: string | null;
  focusTranscriptWindow: string;
  coverageTranscriptWindow: string;
  agendaArtifact: AgendaArtifact;
}) =>
  JSON.stringify(
    {
      meetingTitle: input.meetingTitle,
      focusTranscriptWindow: input.focusTranscriptWindow,
      coverageTranscriptWindow: input.coverageTranscriptWindow,
      agendaArtifact: {
        meetingTitle: input.agendaArtifact.meetingTitle,
        meetingIntent: input.agendaArtifact.meetingIntent,
        summary: input.agendaArtifact.summary,
        points: input.agendaArtifact.points.map((point) => ({
          id: point.id,
          order: point.order,
          title: point.title,
          objective: point.objective,
          status: point.status ?? "pending",
          talkingPoints: point.talkingPoints,
          successSignals: point.successSignals,
          tags: point.tags,
          subtopics: point.subtopics.map((subtopic) => ({
            id: subtopic.id,
            order: subtopic.order,
            title: subtopic.title,
            status: subtopic.status ?? "pending"
          }))
        }))
      }
    },
    null,
    2
  );

const factCheckUserPrompt = (input: {
  meetingTitle: string | null;
  transcriptWindow: string;
}) =>
  JSON.stringify(
    {
      meetingTitle: input.meetingTitle,
      transcriptWindow: input.transcriptWindow
    },
    null,
    2
  );

const getSourcePrompt = (input: RefineAgendaRequest) => {
  const agenda = (input.agenda ?? []).map((item) => item.trim()).filter(Boolean);

  if (agenda.length > 0) {
    return agenda;
  }

  return [input.meetingTitle?.trim(), input.meetingGoal?.trim()].filter(
    (value): value is string => Boolean(value)
  );
};

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

type AgendaStatusEvaluation = {
  activeTarget: {
    kind: "point" | "subtopic";
    id: string;
  } | null;
  points: Array<{
    id: string;
    status: AgendaExecutionStatus;
    subtopics: Array<{
      id: string;
      status: AgendaExecutionStatus;
    }>;
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

const isGpt5Model = (model: string) => /^gpt-5/i.test(model.trim());

const getAgendaCompletionTokenBudget = (
  input: RefineAgendaRequest,
  multiplier = 1
) => {
  const topicCount = Math.max(input.agenda?.length ?? 0, 1);
  const baseBudget = 2200 + topicCount * 250;
  return Math.min(Math.round(baseBudget * multiplier), 4800);
};

export class OpenAiChatCompletionsTool {
  private readonly client: OpenAI;

  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
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

  getModels() {
    return OPENAI_MODELS;
  }

  async refineAgenda(input: RefineAgendaRequest): Promise<AgendaArtifact> {
    if (!this.isConfigured()) {
      throw new Error("LLM API key is not configured.");
    }

    const model = OPENAI_MODELS.agendaRefinement;
    const requestLogger = logger.withContext({
      tool: "openai_chat_completions",
      operation: "refine_agenda",
      model,
      roomCode: input.roomCode ?? null
    });
    const systemContent = agendaRefinementSystemPrompt;
    const userContent = userPrompt(input);

    requestLogger.withMetadata({
      requestSummary: {
        meetingTitle: input.meetingTitle ?? null,
        meetingGoal: input.meetingGoal ?? null,
        agendaTopicCount: input.agenda?.length ?? 0,
        agendaTopics: input.agenda ?? []
      }
    }).info("agenda.llm_request");

    const baseCompletionBudget = getAgendaCompletionTokenBudget(input);
    const baseRequest = {
      model,
      max_completion_tokens: baseCompletionBudget,
      ...(isGpt5Model(model)
        ? { reasoning_effort: "minimal" as const }
        : {}),
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

    const requestCompletion = async ({
      strategy,
      maxCompletionTokens,
      useStrictSchema
    }: {
      strategy: "json_schema" | "json_object";
      maxCompletionTokens: number;
      useStrictSchema: boolean;
    }) => {
      const payload = await this.client.chat.completions.create({
        ...baseRequest,
        max_completion_tokens: maxCompletionTokens,
        response_format: useStrictSchema
          ? {
              type: "json_schema",
              json_schema: {
                ...agendaArtifactSchema,
                strict: true
              }
            }
          : {
              type: "json_object"
            }
      });

      const finishReason = payload.choices?.[0]?.finish_reason ?? null;
      const content = extractTextContent(payload);

      requestLogger.withMetadata({
        responseSummary: {
          strategy,
          id: payload.id,
          model: payload.model,
          finishReason,
          maxCompletionTokens,
          usage: payload.usage
        }
      }).info("agenda.llm_response");

      return {
        payload,
        content,
        finishReason
      };
    };

    let { payload, content, finishReason } = await requestCompletion({
      strategy: "json_schema",
      maxCompletionTokens: baseCompletionBudget,
      useStrictSchema: true
    });

    if (!content && finishReason === "length") {
      const expandedBudget = getAgendaCompletionTokenBudget(input, 1.7);
      requestLogger.warn("agenda.llm_empty_content_retrying", {
        retryStrategy: "json_schema",
        retryReason: "token_budget_exhausted",
        finishReason,
        previousMaxCompletionTokens: baseCompletionBudget,
        nextMaxCompletionTokens: expandedBudget
      });

      ({ payload, content, finishReason } = await requestCompletion({
        strategy: "json_schema",
        maxCompletionTokens: expandedBudget,
        useStrictSchema: true
      }));
    }

    if (!content) {
      const fallbackBudget = getAgendaCompletionTokenBudget(input, 1.7);
      requestLogger.warn("agenda.llm_empty_content_retrying", {
        retryStrategy: "json_object",
        retryReason:
          finishReason === "length" ? "structured_output_budget_exhausted" : "empty_content",
        finishReason,
        nextMaxCompletionTokens: fallbackBudget
      });

      ({ payload, content, finishReason } = await requestCompletion({
        strategy: "json_object",
        maxCompletionTokens: fallbackBudget,
        useStrictSchema: false
      }));
    }

    if (!content) {
      if (finishReason === "length") {
        throw new Error(
          "Agenda refinement model exhausted its completion token budget before emitting content."
        );
      }

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
      artifact.sourcePrompt = getSourcePrompt(input);
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

  async evaluateAgendaStatuses(input: {
    roomCode?: string;
    meetingTitle?: string | null;
    focusTranscriptWindow: string;
    coverageTranscriptWindow: string;
    agendaArtifact: AgendaArtifact;
  }): Promise<AgendaStatusEvaluation> {
    if (!this.isConfigured()) {
      throw new Error("LLM API key is not configured.");
    }

    const model = OPENAI_MODELS.agendaStatus;
    const requestLogger = logger.withContext({
      tool: "openai_chat_completions",
      operation: "patch_agenda_statuses",
      model,
      roomCode: input.roomCode ?? null
    });
    const payload = await this.client.chat.completions.create({
      model,
      max_completion_tokens: 900,
      ...(isGpt5Model(model)
        ? { reasoning_effort: "minimal" as const }
        : {}),
      response_format: {
        type: "json_schema",
        json_schema: {
          ...agendaStatusEvaluationSchema,
          strict: true
        }
      },
      messages: [
        {
          role: "system",
          content: agendaStatusSystemPrompt
        },
        ...agendaStatusFewShotMessages,
        {
          role: "user",
          content: agendaStatusUserPrompt({
            meetingTitle: input.meetingTitle ?? null,
            focusTranscriptWindow: input.focusTranscriptWindow,
            coverageTranscriptWindow: input.coverageTranscriptWindow,
            agendaArtifact: input.agendaArtifact
          })
        }
      ]
    });

    const content = extractTextContent(payload as ChatCompletionPayload);
    requestLogger.withMetadata({
      responseSummary: {
        id: payload.id,
        model: payload.model,
        finishReason: payload.choices?.[0]?.finish_reason ?? null,
        usage: payload.usage
      }
    }).info("agenda.status_patch_response");

    if (!content) {
      throw new Error("Agenda status model returned no content.");
    }

    return JSON.parse(content) as AgendaStatusEvaluation;
  }

  async factCheckTranscriptWindow(input: {
    roomCode?: string;
    meetingTitle?: string | null;
    transcriptWindow: string;
  }): Promise<FactCheckItem[]> {
    if (!this.isConfigured()) {
      throw new Error("LLM API key is not configured.");
    }

    const model = OPENAI_MODELS.factCheck;
    const requestLogger = logger.withContext({
      tool: "openai_chat_completions",
      operation: "fact_check_transcript_window",
      model,
      roomCode: input.roomCode ?? null
    });
    const payload = await this.client.chat.completions.create({
      model,
      max_completion_tokens: 800,
      response_format: {
        type: "json_schema",
        json_schema: {
          ...factCheckSchema,
          strict: true
        }
      },
      messages: [
        {
          role: "system",
          content: factCheckSystemPrompt
        },
        {
          role: "user",
          content: factCheckUserPrompt({
            meetingTitle: input.meetingTitle ?? null,
            transcriptWindow: input.transcriptWindow
          })
        }
      ]
    });

    const content = extractTextContent(payload as ChatCompletionPayload);
    requestLogger.withMetadata({
      responseSummary: {
        id: payload.id,
        model: payload.model,
        finishReason: payload.choices?.[0]?.finish_reason ?? null,
        usage: payload.usage
      }
    }).info("fact_check.response");

    if (!content) {
      throw new Error("Fact check model returned no content.");
    }

    const parsed = JSON.parse(content) as { items: FactCheckItem[] };
    return parsed.items ?? [];
  }
}
