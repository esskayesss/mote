export interface TranscriptEntry {
  id: string;
  text: string;
  speakerParticipantId: string | null;
  speakerDisplayName: string | null;
  createdAt: string;
  isPartial: boolean;
}
