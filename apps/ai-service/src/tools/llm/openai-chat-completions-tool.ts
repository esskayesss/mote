import OpenAI from "openai";
import type {
  AgendaArtifact,
  AgendaExecutionStatus,
  FactCheckItem,
  RefineAgendaRequest
} from "@mote/models";
import { logger } from "../../logger";
import {
  extractTextContent,
  getAgendaCompletionTokenBudget,
  getSourcePrompt,
  isGpt5Model
} from "./helpers";
import { OPENAI_MODELS } from "./models";
import {
  agendaRefinementSystemPrompt,
  agendaStatusFewShotMessages,
  agendaStatusSystemPrompt,
  agendaStatusUserPrompt,
  factCheckAcknowledgementSystemPrompt,
  factCheckAcknowledgementUserPrompt,
  factCheckFewShotMessages,
  factCheckSystemPrompt,
  factCheckUserPrompt,
  refineAgendaUserPrompt
} from "./prompts";
import {
  agendaArtifactSchema,
  agendaStatusEvaluationSchema,
  factCheckAcknowledgementSchema,
  factCheckSchema
} from "./schemas";

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

  private async createStructuredCompletion<T>(input: {
    operation: string;
    roomCode?: string | null;
    model: string;
    maxCompletionTokens: number;
    schema:
      | typeof agendaArtifactSchema
      | typeof agendaStatusEvaluationSchema
      | typeof factCheckSchema
      | typeof factCheckAcknowledgementSchema;
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    metadata?: Record<string, unknown>;
  }): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error("LLM API key is not configured.");
    }

    const requestLogger = logger.withContext({
      tool: "openai_chat_completions",
      operation: input.operation,
      model: input.model,
      roomCode: input.roomCode ?? null
    });
    const payload = await this.client.chat.completions.create({
      model: input.model,
      max_completion_tokens: input.maxCompletionTokens,
      ...(isGpt5Model(input.model)
        ? { reasoning_effort: "minimal" as const }
        : {}),
      response_format: {
        type: "json_schema",
        json_schema: {
          ...input.schema,
          strict: true
        }
      },
      messages: input.messages
    });

    const content = extractTextContent(payload);
    requestLogger.withMetadata({
      responseSummary: {
        id: payload.id,
        model: payload.model,
        finishReason: payload.choices?.[0]?.finish_reason ?? null,
        usage: payload.usage,
        ...(input.metadata ?? {})
      }
    }).info(`${input.operation}.response`);

    if (!content) {
      throw new Error(`${input.operation} model returned no content.`);
    }

    return JSON.parse(content) as T;
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
    const userContent = refineAgendaUserPrompt(input);

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

    let { content, finishReason } = await requestCompletion({
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

      ({ content, finishReason } = await requestCompletion({
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

      ({ content, finishReason } = await requestCompletion({
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
    return await this.createStructuredCompletion<AgendaStatusEvaluation>({
      operation: "patch_agenda_statuses",
      roomCode: input.roomCode ?? null,
      model: OPENAI_MODELS.agendaStatus,
      maxCompletionTokens: 900,
      schema: agendaStatusEvaluationSchema,
      metadata: {
        focusCharacters: input.focusTranscriptWindow.length,
        coverageCharacters: input.coverageTranscriptWindow.length
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
  }

  async evaluateFactChecks(input: {
    roomCode?: string;
    meetingTitle?: string | null;
    latestTranscriptFocus: string[];
    transcriptHistory: string[];
    issuedFactChecks: Array<{
      claim: string;
      correction: string;
    }>;
  }): Promise<FactCheckItem[]> {
    const parsed = await this.createStructuredCompletion<{ items: FactCheckItem[] }>({
      operation: "evaluate_fact_checks",
      roomCode: input.roomCode ?? null,
      model: OPENAI_MODELS.factCheck,
      maxCompletionTokens: 850,
      schema: factCheckSchema,
      metadata: {
        focusTurnCount: input.latestTranscriptFocus.length,
        transcriptTurnCount: input.transcriptHistory.length,
        issuedFactCheckCount: input.issuedFactChecks.length
      },
      messages: [
        {
          role: "system",
          content: factCheckSystemPrompt
        },
        ...factCheckFewShotMessages,
        {
          role: "user",
          content: factCheckUserPrompt({
            meetingTitle: input.meetingTitle ?? null,
            latestTranscriptFocus: input.latestTranscriptFocus,
            transcriptHistory: input.transcriptHistory,
            issuedFactChecks: input.issuedFactChecks
          })
        }
      ]
    });

    return parsed.items ?? [];
  }

  async formatFactCheckAcknowledgement(input: {
    roomCode?: string;
    meetingTitle?: string | null;
    item: FactCheckItem;
  }) {
    const parsed = await this.createStructuredCompletion<{ message: string }>({
      operation: "format_fact_check_acknowledgement",
      roomCode: input.roomCode ?? null,
      model: OPENAI_MODELS.factCheckAcknowledgement,
      maxCompletionTokens: 220,
      schema: factCheckAcknowledgementSchema,
      messages: [
        {
          role: "system",
          content: factCheckAcknowledgementSystemPrompt
        },
        {
          role: "user",
          content: factCheckAcknowledgementUserPrompt({
            meetingTitle: input.meetingTitle ?? null,
            claim: input.item.claim,
            correction: input.item.correction,
            rationale: input.item.rationale
          })
        }
      ]
    });

    return parsed.message.trim();
  }
}
