import type {
  AgendaArtifact,
  AgendaArtifactPoint,
  AgendaArtifactSubtopic,
  AgendaExecutionStatus,
  AgendaStatusPatch
} from "@mote/models";

export const statusSignature = (artifact: AgendaArtifact) =>
  JSON.stringify(
    artifact.points.map((point) => ({
      id: point.id,
      status: point.status ?? "pending",
      subtopics: point.subtopics.map((subtopic) => ({
        id: subtopic.id,
        status: subtopic.status ?? "pending"
      }))
    }))
  );

export const applyAgendaStatusPatchLocally = (
  agendaArtifact: AgendaArtifact,
  patch: AgendaStatusPatch
): AgendaArtifact => {
  const pointPatchMap = new Map(patch.points.map((point) => [point.id, point]));

  return {
    ...agendaArtifact,
    points: agendaArtifact.points.map((point) => {
      const pointPatch = pointPatchMap.get(point.id);
      const subtopicPatchMap = new Map(
        (pointPatch?.subtopics ?? []).map((subtopic) => [subtopic.id, subtopic.status] as const)
      );

      return {
        ...point,
        status: pointPatch?.status ?? point.status,
        subtopics: point.subtopics.map((subtopic) => ({
          ...subtopic,
          status: subtopicPatchMap.get(subtopic.id) ?? subtopic.status
        }))
      };
    })
  };
};

export const normalizeAgendaPatch = (
  artifact: AgendaArtifact,
  evaluation: {
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
  }
): AgendaStatusPatch => {
  const pointPatchMap = new Map(evaluation.points.map((point) => [point.id, point]));
  const activeTarget = evaluation.activeTarget;

  return {
    points: artifact.points.map((point) => {
      const pointPatch = pointPatchMap.get(point.id);
      const subtopicPatchMap = new Map(
        (pointPatch?.subtopics ?? []).map((subtopic) => [subtopic.id, subtopic.status] as const)
      );
      const normalizedSubtopicStatuses = point.subtopics.map((subtopic) => {
        const previousStatus = subtopic.status ?? "pending";
        const requestedStatus = subtopicPatchMap.get(subtopic.id) ?? previousStatus;

        if (previousStatus === "completed" || requestedStatus === "completed") {
          return "completed";
        }

        if (activeTarget?.kind === "subtopic" && activeTarget.id === subtopic.id) {
          return "active";
        }

        if (
          previousStatus === "partially_completed" ||
          previousStatus === "active" ||
          requestedStatus === "partially_completed" ||
          requestedStatus === "active"
        ) {
          return "partially_completed";
        }

        return "pending";
      }) as AgendaExecutionStatus[];

      const previousPointStatus = point.status ?? "pending";
      const requestedPointStatus = pointPatch?.status ?? previousPointStatus;
      const hasActiveSubtopic = normalizedSubtopicStatuses.includes("active");
      const hasProgressSubtopic = normalizedSubtopicStatuses.some(
        (status) =>
          status === "active" || status === "partially_completed" || status === "completed"
      );
      const allSubtopicsCompleted =
        point.subtopics.length > 0 &&
        normalizedSubtopicStatuses.every((status) => status === "completed");
      const pointLostFocus =
        previousPointStatus === "active" &&
        activeTarget !== null &&
        !(
          (activeTarget.kind === "point" && activeTarget.id === point.id) ||
          (activeTarget.kind === "subtopic" &&
            point.subtopics.some((subtopic) => subtopic.id === activeTarget.id))
        );

      let normalizedPointStatus: AgendaExecutionStatus = "pending";

      if (
        previousPointStatus === "completed" ||
        requestedPointStatus === "completed" ||
        allSubtopicsCompleted
      ) {
        normalizedPointStatus = "completed";
      } else if (activeTarget?.kind === "point" && activeTarget.id === point.id) {
        normalizedPointStatus = "active";
      } else if (
        pointLostFocus &&
        (hasProgressSubtopic || point.subtopics.length === 0)
      ) {
        normalizedPointStatus = "completed";
      } else if (
        previousPointStatus === "partially_completed" ||
        previousPointStatus === "active" ||
        requestedPointStatus === "partially_completed" ||
        requestedPointStatus === "active" ||
        hasActiveSubtopic ||
        hasProgressSubtopic
      ) {
        normalizedPointStatus = "partially_completed";
      }

      return {
        id: point.id,
        status: normalizedPointStatus,
        subtopics: point.subtopics.map((subtopic, index) => ({
          id: subtopic.id,
          status: normalizedSubtopicStatuses[index] ?? "pending"
        }))
      };
    })
  };
};

export const patchChangesArtifact = (artifact: AgendaArtifact, patch: AgendaStatusPatch) => {
  const currentPatchShape = {
    points: artifact.points.map((point) => ({
      id: point.id,
      status: point.status ?? "pending",
      subtopics: point.subtopics.map((subtopic) => ({
        id: subtopic.id,
        status: subtopic.status ?? "pending"
      }))
    }))
  };

  return JSON.stringify(patch.points) !== JSON.stringify(currentPatchShape.points);
};

const normalizeText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ");

const tokenize = (value: string) =>
  normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 4);

const toEvidenceSentences = (lines: string[]) =>
  lines
    .flatMap((line) =>
      line
        .split(/(?<=[.!?])\s+/u)
        .map((sentence) => sentence.trim())
        .filter(Boolean)
    )
    .map((sentence) => normalizeText(sentence))
    .filter(Boolean);

const countPhraseMentions = (lines: string[], phrase: string) => {
  const phraseTokens = tokenize(phrase);

  if (phraseTokens.length === 0) {
    return 0;
  }

  const minimumOverlap = Math.min(2, phraseTokens.length);

  return lines.filter((line) => {
    const lineTokens = new Set(tokenize(line));
    const overlap = phraseTokens.filter((token) => lineTokens.has(token)).length;
    return overlap >= minimumOverlap;
  }).length;
};

const uniqueSignals = (signals: string[]) =>
  Array.from(new Set(signals.map((signal) => signal.trim()).filter(Boolean)));

const getPointSignals = (point: AgendaArtifactPoint) =>
  uniqueSignals([
    point.title,
    point.objective,
    ...point.talkingPoints,
    ...point.successSignals
  ]);

const getSubtopicSignals = (
  point: AgendaArtifactPoint,
  subtopic: AgendaArtifactSubtopic
) =>
  uniqueSignals([
    subtopic.title,
    ...(subtopic.talkingPoints ?? []),
    point.title
  ]);

const getSignalEvidence = (signals: string[], lines: string[]) => {
  const mentionCounts = signals.map((signal) => countPhraseMentions(lines, signal));
  const matchedSignals = mentionCounts.filter((count) => count > 0).length;
  const repeatedSignals = mentionCounts.filter((count) => count >= 2).length;
  const totalMentions = mentionCounts.reduce((sum, count) => sum + count, 0);

  return {
    matchedSignals,
    repeatedSignals,
    totalMentions
  };
};

const getTalkingPointMentionCounts = (talkingPoints: string[], lines: string[]) =>
  talkingPoints.map((talkingPoint) => countPhraseMentions(lines, talkingPoint));

const hasTalkingPointCompletionEvidence = (talkingPoints: string[], lines: string[]) => {
  if (talkingPoints.length === 0) {
    return false;
  }

  const mentionCounts = getTalkingPointMentionCounts(talkingPoints, lines);
  const allCovered = mentionCounts.every((count) => count >= 1);
  const repeatedTalkingPoints = mentionCounts.filter((count) => count >= 2).length;
  const totalMentions = mentionCounts.reduce((sum, count) => sum + count, 0);

  return allCovered && (repeatedTalkingPoints >= 1 || totalMentions >= talkingPoints.length + 1);
};

const hasAggressiveCompletionEvidence = (signals: string[], lines: string[]) => {
  const evidence = getSignalEvidence(signals, lines);
  const requiredSignals = Math.min(Math.max(1, signals.length), 2);

  return (
    (evidence.matchedSignals >= requiredSignals && evidence.totalMentions >= 2) ||
    evidence.repeatedSignals >= 2
  );
};

const hasPartialEvidence = (signals: string[], lines: string[]) => {
  const evidence = getSignalEvidence(signals, lines);
  return evidence.matchedSignals >= 1 || evidence.totalMentions >= 1;
};

export const applyHeuristicAgendaProgress = (
  artifact: AgendaArtifact,
  patch: AgendaStatusPatch,
  transcriptLines: string[]
): AgendaStatusPatch => {
  if (transcriptLines.length === 0) {
    return patch;
  }

  const evidenceLines = toEvidenceSentences(transcriptLines);

  if (evidenceLines.length === 0) {
    return patch;
  }

  return {
    points: patch.points.map((pointPatch) => {
      const point = artifact.points.find((candidate) => candidate.id === pointPatch.id);

      if (!point) {
        return pointPatch;
      }

      const nextSubtopics: AgendaStatusPatch["points"][number]["subtopics"] = pointPatch.subtopics.map((subtopicPatch) => {
        const subtopic = point.subtopics.find((candidate) => candidate.id === subtopicPatch.id);

        if (!subtopic || subtopicPatch.status === "completed" || subtopicPatch.status === "active") {
          return subtopicPatch;
        }

        const subtopicSignals = getSubtopicSignals(point, subtopic);
        const subtopicTalkingPoints = subtopic.talkingPoints ?? [];

        if (
          hasTalkingPointCompletionEvidence(subtopicTalkingPoints, evidenceLines) ||
          hasAggressiveCompletionEvidence(subtopicSignals, evidenceLines)
        ) {
          return {
            ...subtopicPatch,
            status: "completed"
          };
        }

        if (subtopicPatch.status === "pending" && hasPartialEvidence(subtopicSignals, evidenceLines)) {
          return {
            ...subtopicPatch,
            status: "partially_completed"
          };
        }

        return subtopicPatch;
      });

      if (pointPatch.status === "completed" || pointPatch.status === "active") {
        return {
          ...pointPatch,
          subtopics: nextSubtopics
        };
      }

      const pointSignals = getPointSignals(point);
      const allSubtopicsCompleted =
        nextSubtopics.length > 0 && nextSubtopics.every((subtopic) => subtopic.status === "completed");
      let nextPointStatus: AgendaExecutionStatus = pointPatch.status;

      if (
        allSubtopicsCompleted ||
        hasTalkingPointCompletionEvidence(point.talkingPoints, evidenceLines) ||
        hasAggressiveCompletionEvidence(pointSignals, evidenceLines)
      ) {
        nextPointStatus = "completed";
      } else if (
        nextPointStatus === "pending" &&
        (nextSubtopics.some((subtopic) => subtopic.status !== "pending") ||
          hasPartialEvidence(pointSignals, evidenceLines))
      ) {
        nextPointStatus = "partially_completed";
      }

      return {
        ...pointPatch,
        status: nextPointStatus,
        subtopics: nextSubtopics
      };
    })
  };
};
