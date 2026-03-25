import type { RefineAgendaRequest } from "@mote/models";
import type { RefineAgendaWorkflowResult } from "../workflows/agenda/refine-agenda-workflow";

export class AgendaNormalizerAgent {
  constructor(
    private readonly workflow: {
      invoke: (input: RefineAgendaRequest) => Promise<RefineAgendaWorkflowResult>;
    }
  ) {}

  async normalize(input: RefineAgendaRequest) {
    return this.workflow.invoke(input);
  }
}
