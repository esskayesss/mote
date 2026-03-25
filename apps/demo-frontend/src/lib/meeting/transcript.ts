import type { TranscriptEntry } from "./types";

const normalizeTranscriptText = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ");

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

    const lastEntry = collapsed[collapsed.length - 1];

    if (
      lastEntry &&
      lastEntry.speakerParticipantId &&
      entry.speakerParticipantId &&
      lastEntry.speakerParticipantId === entry.speakerParticipantId
    ) {
      lastEntry.text = mergeTranscriptText(lastEntry.text, normalizedText);
      lastEntry.id = entry.id;
      lastEntry.createdAt = entry.createdAt;
      lastEntry.isPartial = entry.isPartial;
      lastEntry.speakerDisplayName = entry.speakerDisplayName ?? lastEntry.speakerDisplayName;
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
