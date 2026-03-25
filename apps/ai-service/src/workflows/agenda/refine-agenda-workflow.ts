import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AgendaArtifact, RefineAgendaRequest } from "@mote/models";
import { buildFallbackAgendaArtifact } from "../../tools/agenda/build-fallback-agenda-artifact";
import { OpenAiChatCompletionsTool } from "../../tools/llm/openai-chat-completions-tool";

const normalizeAgenda = (agenda: string[]) =>
  agenda
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 12);

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
    .addNode("normalize_input", ({ input }) => ({
      normalizedInput: {
        ...input,
        agenda: normalizeAgenda(input.agenda)
      }
    }))
    .addNode("materialize_source_of_truth", async ({ normalizedInput }) => {
      const input = normalizedInput ?? { agenda: [] };

      if (!llmTool.isConfigured()) {
        return {
          artifact: buildFallbackAgendaArtifact(input),
          source: "fallback" as const
        };
      }

      try {
        return {
          artifact: await llmTool.refineAgenda(input),
          source: "model" as const
        };
      } catch (error) {
        console.warn("[mote:ai-service] agenda:model failed", {
          roomCode: input.roomCode ?? null,
          error: error instanceof Error ? error.message : error
        });

        return {
          artifact: buildFallbackAgendaArtifact(input),
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
      const result = await compiled.invoke({ input });

      if (!result.artifact || !result.source) {
        throw new Error("Agenda refinement workflow produced no artifact.");
      }

      return {
        artifact: result.artifact,
        source: result.source
      };
    }
  };
};
