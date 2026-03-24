import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AgendaArtifact, RefineAgendaRequest } from "@mote/models";
import { buildFallbackAgendaArtifact } from "./fallback";
import { AgendaModelClient } from "./model-client";

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

export interface RefineAgendaGraphResult {
  artifact: AgendaArtifact;
  source: "model" | "fallback";
}

export const createRefineAgendaGraph = (modelClient: AgendaModelClient) => {
  const graph = new StateGraph(AgendaRefinementState)
    .addNode("normalize_input", ({ input }) => ({
      normalizedInput: {
        ...input,
        agenda: normalizeAgenda(input.agenda)
      }
    }))
    .addNode("refine_agenda", async ({ normalizedInput }) => {
      const input = normalizedInput ?? { agenda: [] };

      if (!modelClient.isConfigured()) {
        return {
          artifact: buildFallbackAgendaArtifact(input),
          source: "fallback" as const
        };
      }

      try {
        return {
          artifact: await modelClient.refineAgenda(input),
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
    .addEdge("normalize_input", "refine_agenda")
    .addEdge("refine_agenda", END);

  const compiled = graph.compile();

  return {
    async invoke(input: RefineAgendaRequest): Promise<RefineAgendaGraphResult> {
      const result = await compiled.invoke({ input });

      if (!result.artifact || !result.source) {
        throw new Error("Agenda refinement graph produced no artifact.");
      }

      return {
        artifact: result.artifact,
        source: result.source
      };
    }
  };
};
