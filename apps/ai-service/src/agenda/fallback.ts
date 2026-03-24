import type {
  AgendaArtifact,
  AgendaArtifactPoint,
  RefineAgendaRequest
} from "@mote/models";

const sanitizeAgendaItems = (agenda: string[]) =>
  agenda
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);

const sentenceCase = (value: string) =>
  value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;

const inferTags = (value: string) => {
  const normalized = value.toLowerCase();
  const tags = new Set<string>();

  if (normalized.includes("intro") || normalized.includes("introduc")) {
    tags.add("alignment");
  }

  if (normalized.includes("status") || normalized.includes("update")) {
    tags.add("status");
  }

  if (normalized.includes("blocker") || normalized.includes("risk")) {
    tags.add("risk");
  }

  if (normalized.includes("decision")) {
    tags.add("decision");
  }

  if (normalized.includes("action") || normalized.includes("owner")) {
    tags.add("execution");
  }

  if (tags.size === 0) {
    tags.add("discussion");
  }

  return Array.from(tags);
};

const createPoint = (item: string, index: number, items: string[]): AgendaArtifactPoint => ({
  id: `agenda-point-${index + 1}`,
  order: index + 1,
  title: sentenceCase(item.replace(/[.:;]+$/, "")),
  objective: sentenceCase(item),
  talkingPoints: [
    `Clarify the expected outcome for "${item}".`,
    "Identify key decisions, blockers, or follow-up actions."
  ],
  successSignals: [
    "The room agrees on the takeaway.",
    "Owners or next actions are explicit."
  ],
  estimatedDurationMinutes: Math.max(4, Math.round(30 / Math.max(items.length, 1))),
  ownerHint: index === 0 ? "host" : null,
  dependencies: index > 0 ? [`agenda-point-${index}`] : [],
  tags: inferTags(item)
});

export const buildFallbackAgendaArtifact = (
  input: RefineAgendaRequest
): AgendaArtifact => {
  const agenda = sanitizeAgendaItems(input.agenda);

  return {
    kind: "agenda.v1",
    summary:
      input.meetingGoal?.trim() ||
      input.meetingTitle?.trim() ||
      "Structured agenda prepared for guided meeting execution.",
    points: agenda.map((item, index, items) => createPoint(item, index, items))
  };
};
