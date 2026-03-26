import type { AgendaArtifact, AgendaStatusPatch, FactCheckItem } from "@mote/models";

const MAX_MONITOR_CHAT_MESSAGE_LENGTH = 1_900;
const MAX_MONITOR_JSON_SECTION_LENGTH = 420;
const MAX_MONITOR_LAST_TURN_LENGTH = 280;
const NO_OP_FACT_CHECK_PATTERNS = [
  /\bno correction needed\b/i,
  /\bno correction required\b/i,
  /\bno factual error detected\b/i,
  /\bno factual issue detected\b/i,
  /\balready correct\b/i,
  /\bno issue detected\b/i
] as const;

export const createQueue = <TMessage>() => {
  const items: TMessage[] = [];
  let waitingResolver: ((message: TMessage) => void) | null = null;

  return {
    enqueue(message: TMessage) {
      if (waitingResolver) {
        const resolve = waitingResolver;
        waitingResolver = null;
        resolve(message);
        return;
      }

      items.push(message);
    },
    async dequeue() {
      if (items.length > 0) {
        return items.shift() as TMessage;
      }

      return await new Promise<TMessage>((resolve) => {
        waitingResolver = resolve;
      });
    }
  };
};

export const normalizeFactCheckText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ");

export const factCheckItemSignature = (
  item: Pick<FactCheckItem, "severity" | "claim" | "correction">
) =>
  JSON.stringify([
    item.severity,
    normalizeFactCheckText(item.claim),
    normalizeFactCheckText(item.correction)
  ]);

export const factCheckClaimSignature = (item: Pick<FactCheckItem, "claim">) =>
  normalizeFactCheckText(item.claim);

export const factCheckCorrectionSignature = (item: Pick<FactCheckItem, "correction">) =>
  normalizeFactCheckText(item.correction);

export const factCheckTextOverlaps = (left: string, right: string) =>
  left.length > 0 &&
  right.length > 0 &&
  (left === right || left.includes(right) || right.includes(left));

export const truncateText = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;

export const truncateChatMessage = (value: string, maxLength = MAX_MONITOR_CHAT_MESSAGE_LENGTH) =>
  truncateText(value.trim(), maxLength);

export const tokenizeFactCheckText = (value: string) =>
  normalizeFactCheckText(value)
    .split(" ")
    .filter((token) => token.length >= 4);

export const isFactCheckGroundedInTranscript = (item: FactCheckItem, transcriptText: string) => {
  const transcriptTokens = new Set(tokenizeFactCheckText(transcriptText));
  const claimTokens = tokenizeFactCheckText(item.claim);
  const overlapCount = claimTokens.filter((token) => transcriptTokens.has(token)).length;
  return overlapCount >= 2;
};

export const isActionableFactCheck = (item: FactCheckItem) => {
  const normalizedClaim = normalizeFactCheckText(item.claim);
  const normalizedCorrection = normalizeFactCheckText(item.correction);
  const normalizedRationale = normalizeFactCheckText(item.rationale);

  if (!normalizedClaim || !normalizedCorrection || normalizedClaim === normalizedCorrection) {
    return false;
  }

  return !NO_OP_FACT_CHECK_PATTERNS.some(
    (pattern) => pattern.test(item.claim) || pattern.test(item.correction) || pattern.test(item.rationale)
  );
};

export const formatMonitorSummary = (input: {
  agendaArtifact: AgendaArtifact | null;
  activeTarget: { kind: "point" | "subtopic"; id: string } | null;
  patch: AgendaStatusPatch | null;
  transcriptTurnCount: number;
  returnedFactCheckCount: number;
  groundedFactCheckCount: number;
  publishedFactCheckCount: number;
  lastTranscriptLine: string | null;
  evaluationInput: unknown;
  agendaEvaluation: unknown;
  factCheckEvaluation: unknown;
}) => {
  const resolvedActiveLabel = (() => {
    if (!input.activeTarget || !input.agendaArtifact) {
      return "none";
    }

    if (input.activeTarget.kind === "point") {
      return (
        input.agendaArtifact.points.find((point) => point.id === input.activeTarget?.id)?.title ??
        input.activeTarget.id
      );
    }

    for (const point of input.agendaArtifact.points) {
      const subtopic = point.subtopics.find((item) => item.id === input.activeTarget?.id);

      if (subtopic) {
        return `${point.title} -> ${subtopic.title}`;
      }
    }

    return input.activeTarget.id;
  })();

  const completedCount = input.patch
    ? input.patch.points.filter((point) => point.status === "completed").length
    : 0;
  const suppressedFactCheckCount = Math.max(
    0,
    input.groundedFactCheckCount - input.publishedFactCheckCount
  );

  const summary = [
    "[Monitor]",
    `active=${resolvedActiveLabel}`,
    `completed=${completedCount}/${input.patch?.points.length ?? 0}`,
    `fact_checks_returned=${input.returnedFactCheckCount}`,
    `fact_checks_grounded=${input.groundedFactCheckCount}`,
    `fact_checks_published=${input.publishedFactCheckCount}`,
    `fact_checks_suppressed=${suppressedFactCheckCount}`,
    `turns=${input.transcriptTurnCount}`,
    "",
    `last_turn: ${truncateText(input.lastTranscriptLine ?? "(none)", MAX_MONITOR_LAST_TURN_LENGTH)}`,
    "",
    "request_focus:",
    truncateText(JSON.stringify(input.evaluationInput), MAX_MONITOR_JSON_SECTION_LENGTH),
    "",
    "agenda_model_output:",
    truncateText(JSON.stringify(input.agendaEvaluation), MAX_MONITOR_JSON_SECTION_LENGTH),
    "",
    "fact_check_model_output:",
    truncateText(JSON.stringify(input.factCheckEvaluation), MAX_MONITOR_JSON_SECTION_LENGTH)
  ].join("\n");

  return truncateChatMessage(summary);
};
