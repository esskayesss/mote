import type { TranscriptEntry } from "./types";

const normalizeTranscriptText = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ");

const SPEAKER_MERGE_WINDOW_MS = 12_000;
const MAX_INTERVENING_ENTRIES = 2;

const mergeTranscriptText = (existingText: string, incomingText: string) => {
  const existing = normalizeTranscriptText(existingText);
  const incoming = normalizeTranscriptText(incomingText);

  if (!existing) {
    return incoming;
  }

  if (!incoming) {
    return existing;
  }

  if (incoming.startsWith(existing)) {
    return incoming;
  }

  if (existing.startsWith(incoming)) {
    return existing;
  }

  const maxOverlap = Math.min(existing.length, incoming.length);

  for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
    if (existing.slice(-overlap).toLowerCase() === incoming.slice(0, overlap).toLowerCase()) {
      return `${existing}${incoming.slice(overlap)}`.trim();
    }
  }

  return `${existing} ${incoming}`.trim();
};

export const collapseTranscriptEntries = (entries: TranscriptEntry[]) => {
  const collapsed: TranscriptEntry[] = [];

  for (const entry of entries) {
    const normalizedText = normalizeTranscriptText(entry.text);

    if (!normalizedText) {
      continue;
    }

    let mergeTargetIndex = -1;

    if (entry.speakerParticipantId) {
      for (let index = collapsed.length - 1; index >= 0; index -= 1) {
        const candidate = collapsed[index];

        if (candidate.speakerParticipantId !== entry.speakerParticipantId) {
          continue;
        }

        const interveningEntries = collapsed.length - 1 - index;

        if (interveningEntries > MAX_INTERVENING_ENTRIES) {
          break;
        }

        const ageMs =
          new Date(entry.createdAt).getTime() - new Date(candidate.createdAt).getTime();

        if (ageMs > SPEAKER_MERGE_WINDOW_MS) {
          break;
        }

        mergeTargetIndex = index;
        break;
      }
    }

    if (mergeTargetIndex >= 0) {
      const mergeTarget = collapsed[mergeTargetIndex];
      mergeTarget.text = mergeTranscriptText(mergeTarget.text, normalizedText);
      mergeTarget.id = entry.id;
      mergeTarget.isPartial = entry.isPartial;
      mergeTarget.speakerDisplayName = entry.speakerDisplayName ?? mergeTarget.speakerDisplayName;
      continue;
    }

    collapsed.push({
      ...entry,
      text: normalizedText
    });
  }

  return collapsed;
};

export const createTranscriptEntry = (input: {
  id: string;
  text: string;
  speakerParticipantId: string | null;
  speakerDisplayName: string | null;
  createdAt: string;
  isPartial: boolean;
}): TranscriptEntry => ({
  ...input,
  text: normalizeTranscriptText(input.text)
});
