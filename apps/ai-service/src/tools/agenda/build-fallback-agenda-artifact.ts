import type {
  AgendaArtifact,
  AgendaArtifactPoint,
  AgendaArtifactSubtopic,
  RefineAgendaRequest
} from "@mote/models";

const sanitizeAgendaItems = (agenda: string[]) =>
  agenda
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);

const sanitizeTitle = (value: string | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);

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

const splitFragments = (value: string) =>
  value
    .split(/,| and | with | for | to /gi)
    .map((fragment) => fragment.trim().replace(/[.:;]+$/, ""))
    .filter((fragment) => fragment.length > 3);

const shortTitle = (value: string) => {
  const cleaned = sentenceCase(value.replace(/[.:;]+$/, ""));
  return cleaned.length <= 56 ? cleaned : `${cleaned.slice(0, 53).trimEnd()}...`;
};

const inferMeetingTitle = (input: RefineAgendaRequest, agenda: string[]) => {
  const explicitTitle = sanitizeTitle(input.meetingTitle);

  if (explicitTitle) {
    return explicitTitle;
  }

  const lead = agenda[0] ?? "Working Session";
  const fragments = splitFragments(lead);
  const basis = fragments[0] ?? lead;
  return shortTitle(basis);
};

const buildSubtopicCandidates = (item: string, index: number) => {
  const fragments = splitFragments(item);
  const candidates = [
    fragments[0] ? shortTitle(fragments[0]) : null,
    fragments[1] ? shortTitle(fragments[1]) : null,
    /api|interface|contract/i.test(item) ? "Input and output contract" : null,
    /error|failure|recover|fallback|validation/i.test(item) ? "Failure and recovery paths" : null,
    /test|qa|verify/i.test(item) ? "Coverage and verification cases" : null,
    /plan|next|owner|step/i.test(item) ? "Owners and next moves" : null,
    /file|path|storage|persist/i.test(item) ? "Filesystem and persistence edges" : null,
    /class|module|component|design/i.test(item) ? "Boundaries and responsibilities" : null,
    index === 0 ? "Desired end state" : "Open implementation questions"
  ].filter((candidate): candidate is string => Boolean(candidate));

  return Array.from(new Set(candidates)).slice(0, 4);
};

const createSubtopics = (item: string, index: number): AgendaArtifactSubtopic[] =>
  buildSubtopicCandidates(item, index).map((title, subtopicIndex) => ({
    id: `agenda-point-${index + 1}-subtopic-${subtopicIndex + 1}`,
    order: subtopicIndex + 1,
    title,
    status: index === 0 && subtopicIndex === 0 ? "active" : "pending"
  }));

const createPoint = (item: string, index: number, items: string[]): AgendaArtifactPoint => ({
  id: `agenda-point-${index + 1}`,
  order: index + 1,
  title: shortTitle(sentenceCase(item.replace(/[.:;]+$/, ""))),
  objective: sentenceCase(item),
  subtopics: createSubtopics(item, index),
  status: index === 0 ? "active" : "pending",
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
  const meetingTitle = inferMeetingTitle(input, agenda);
  const meetingIntent =
    input.meetingGoal?.trim() ||
    meetingTitle ||
    "Drive the meeting through a fixed, pointwise agenda.";

  return {
    kind: "agenda.v1",
    locked: true,
    generatedAt: new Date().toISOString(),
    meetingTitle,
    sourcePrompt: agenda,
    meetingIntent,
    summary: meetingIntent,
    points: agenda.map((item, index, items) => createPoint(item, index, items))
  };
};
