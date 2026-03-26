import type {
  AgendaArtifact,
  AgendaArtifactPoint,
  AgendaArtifactSubtopic,
  AgendaExecutionStatus,
  RoomSummary
} from "@mote/models";
import type { TranscriptEntry } from "./types";

const TRANSCRIPT_WINDOW_ENTRY_COUNT = 8;
const TRANSCRIPT_WINDOW_CHAR_LIMIT = 3200;
const TOKEN_MIN_LENGTH = 3;
const TOKEN_PATTERN = /[a-z0-9]+/g;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "being",
  "between",
  "could",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "most",
  "only",
  "other",
  "over",
  "same",
  "some",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "through",
  "very",
  "what",
  "when",
  "with",
  "would",
  "your"
]);

const normalizeText = (value: string) => value.toLowerCase();

const tokenize = (value: string) =>
  Array.from(new Set(normalizeText(value).match(TOKEN_PATTERN) ?? [])).filter(
    (token) => token.length >= TOKEN_MIN_LENGTH && !STOP_WORDS.has(token)
  );

const buildTextWindow = (entries: TranscriptEntry[]) => {
  let windowText = "";

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const next = entries[index]?.text?.trim();

    if (!next) {
      continue;
    }

    const candidate = windowText.length > 0 ? `${next} ${windowText}` : next;

    if (candidate.length > TRANSCRIPT_WINDOW_CHAR_LIMIT && windowText.length > 0) {
      break;
    }

    windowText = candidate.slice(-TRANSCRIPT_WINDOW_CHAR_LIMIT);
  }

  return normalizeText(windowText);
};

const keywordScore = (windowText: string, segments: string[]) => {
  if (!windowText) {
    return 0;
  }

  let score = 0;

  for (const segment of segments) {
    const tokens = tokenize(segment);

    if (tokens.length === 0) {
      continue;
    }

    const matches = tokens.filter((token) => windowText.includes(token)).length;
    score += matches / tokens.length;
  }

  return score;
};

const deriveSubtopics = (
  subtopics: AgendaArtifactSubtopic[],
  transcriptWindow: string,
  pointIsActive: boolean,
  pointIsCompleted: boolean
) => {
  if (subtopics.length === 0) {
    return subtopics;
  }

  const scores = subtopics.map((subtopic) =>
    keywordScore(transcriptWindow, [subtopic.title])
  );
  const activeIndex = pointIsActive
    ? scores.reduce(
        (bestIndex, score, index, allScores) =>
          score > (allScores[bestIndex] ?? 0) ? index : bestIndex,
        0
      )
    : -1;

  return subtopics.map((subtopic, index) => {
    let status: AgendaExecutionStatus = "pending";

    if (pointIsCompleted) {
      status = "completed";
    } else if (pointIsActive) {
      if (index < activeIndex && scores[index] > 0.18) {
        status = "completed";
      } else if (index === activeIndex && scores[index] > 0.12) {
        status = "active";
      }
    }

    return {
      ...subtopic,
      status
    };
  });
};

export const getPresenterTranscriptWindow = (
  room: RoomSummary | null,
  transcriptEntries: TranscriptEntry[]
) => {
  if (!room) {
    return [];
  }

  const presenterIds = new Set(
    room.participants.filter((participant) => participant.isPresenter).map((participant) => participant.id)
  );

  return transcriptEntries
    .filter(
      (entry) => !entry.isPartial && entry.speakerParticipantId && presenterIds.has(entry.speakerParticipantId)
    )
    .slice(-TRANSCRIPT_WINDOW_ENTRY_COUNT);
};

export const deriveAgendaArtifactExecutionState = (
  artifact: AgendaArtifact | null | undefined,
  presenterTranscriptWindow: TranscriptEntry[]
) => {
  if (!artifact) {
    return null;
  }

  const transcriptWindow = buildTextWindow(presenterTranscriptWindow);

  if (!transcriptWindow) {
    return artifact;
  }

  const pointScores = artifact.points.map((point) =>
    keywordScore(transcriptWindow, [
      point.title,
      point.objective,
      ...point.subtopics.map((subtopic) => subtopic.title),
      ...point.talkingPoints
    ])
  );

  const activePointIndex = pointScores.reduce(
    (bestIndex, score, index, allScores) =>
      score > (allScores[bestIndex] ?? 0) ? index : bestIndex,
    0
  );
  const hasActivePoint = (pointScores[activePointIndex] ?? 0) > 0.16;

  return {
    ...artifact,
    points: artifact.points.map((point, index): AgendaArtifactPoint => {
      const isCompleted = hasActivePoint && index < activePointIndex;
      const isActive = hasActivePoint && index === activePointIndex;

      return {
        ...point,
        status: isCompleted ? "completed" : isActive ? "active" : "pending",
        subtopics: deriveSubtopics(point.subtopics, transcriptWindow, isActive, isCompleted)
      };
    })
  };
};
