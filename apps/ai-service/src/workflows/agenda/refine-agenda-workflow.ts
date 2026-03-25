import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AgendaArtifact, RefineAgendaRequest } from "@mote/models";
import { logger } from "../../logger";
import { buildFallbackAgendaArtifact } from "../../tools/agenda/build-fallback-agenda-artifact";
import { OpenAiChatCompletionsTool } from "../../tools/llm/openai-chat-completions-tool";

const normalizeAgenda = (agenda: string[]) =>
  agenda
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 12);

const normalizeOptionalText = (value: string | undefined, maxLength: number) => {
  const cleaned = (value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return cleaned.length ? cleaned : undefined;
};

const AgendaRefinementState = Annotation.Root({
  input: Annotation<RefineAgendaRequest>(),
  normalizedInput: Annotation<RefineAgendaRequest | null>({
    reducer: (_, right) => right,
    default: () => null
  }),
  artifact: Annotation<AgendaArtifact | null>({
    reducer: (_, right) => right,
    default: () => null
  }),
  source: Annotation<"model" | "fallback" | null>({
    reducer: (_, right) => right,
    default: () => null
  })
});

export interface RefineAgendaWorkflowResult {
  artifact: AgendaArtifact;
  source: "model" | "fallback";
}

export const createRefineAgendaWorkflow = (llmTool: OpenAiChatCompletionsTool) => {
  const graph = new StateGraph(AgendaRefinementState)
    .addNode("normalize_input", ({ input }) => {
      const normalizedInput = {
        ...input,
        agenda: normalizeAgenda(input.agenda),
        meetingTitle: normalizeOptionalText(input.meetingTitle, 120),
        meetingGoal: normalizeOptionalText(input.meetingGoal, 240),
        roomCode: normalizeOptionalText(input.roomCode, 80)
      };

      logger.withContext({
        workflow: "agenda_refinement",
        roomCode: normalizedInput.roomCode ?? null
      }).withMetadata({
        inputSummary: {
          meetingTitle: input.meetingTitle ?? null,
          meetingGoal: input.meetingGoal ?? null,
          agendaTopicCount: input.agenda.length
        },
        normalizedInputSummary: {
          meetingTitle: normalizedInput.meetingTitle ?? null,
          meetingGoal: normalizedInput.meetingGoal ?? null,
          agendaTopics: normalizedInput.agenda
        }
      }).info("agenda.normalize_input");

      return {
        normalizedInput
      };
    })
    .addNode("materialize_source_of_truth", async ({ normalizedInput }) => {
      const input = normalizedInput ?? { agenda: [] };
      const agendaLogger = logger.withContext({
        workflow: "agenda_refinement",
        roomCode: input.roomCode ?? null
      }).withMetadata({
        normalizedInputSummary: {
          meetingTitle: input.meetingTitle ?? null,
          meetingGoal: input.meetingGoal ?? null,
          agendaTopics: input.agenda
        }
      });

      if (!llmTool.isConfigured()) {
        const artifact = buildFallbackAgendaArtifact(input);
        agendaLogger.warn("agenda.model_skipped", {
          reason: "llm-not-configured",
          fallbackSummary: {
            meetingTitle: artifact.meetingTitle,
            pointCount: artifact.points.length
          }
        });
        return {
          artifact,
          source: "fallback" as const
        };
      }

      try {
        agendaLogger.info("agenda.model_requested");
        const artifact = await llmTool.refineAgenda(input);
        agendaLogger.withMetadata({
          artifactSummary: {
            meetingTitle: artifact.meetingTitle,
            pointCount: artifact.points.length,
            pointTitles: artifact.points.map((point) => point.title)
          }
        }).info("agenda.model_succeeded");
        return {
          artifact,
          source: "model" as const
        };
      } catch (error) {
        const artifact = buildFallbackAgendaArtifact(input);
        agendaLogger.error("agenda.model_failed", { error });
        agendaLogger.withMetadata({
          fallbackSummary: {
            meetingTitle: artifact.meetingTitle,
            pointCount: artifact.points.length
          }
        }).warn("agenda.fallback_built");

        return {
          artifact,
          source: "fallback" as const
        };
      }
    })
    .addEdge(START, "normalize_input")
    .addEdge("normalize_input", "materialize_source_of_truth")
    .addEdge("materialize_source_of_truth", END);

  const compiled = graph.compile();

  return {
    async invoke(input: RefineAgendaRequest): Promise<RefineAgendaWorkflowResult> {
      logger.withContext({
        workflow: "agenda_refinement",
        roomCode: input.roomCode ?? null
      }).withMetadata({
        inputSummary: {
          meetingTitle: input.meetingTitle ?? null,
          meetingGoal: input.meetingGoal ?? null,
          agendaTopics: input.agenda
        }
      }).info("agenda.workflow_invoked");

      const result = await compiled.invoke({ input });

      if (!result.artifact || !result.source) {
        throw new Error("Agenda refinement workflow produced no artifact.");
      }

      logger.withContext({
        workflow: "agenda_refinement",
        roomCode: input.roomCode ?? null
      }).withMetadata({
        source: result.source,
        artifactSummary: {
          meetingTitle: result.artifact.meetingTitle,
          pointCount: result.artifact.points.length,
          pointTitles: result.artifact.points.map((point) => point.title)
        }
      }).info("agenda.workflow_completed");

      return {
        artifact: result.artifact,
        source: result.source
      };
    }
  };
};
