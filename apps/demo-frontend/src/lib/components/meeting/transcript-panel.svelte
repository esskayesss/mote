<script lang="ts">
  import type { RoomSummary } from "@mote/models";
  import { resolveParticipantDisplayName } from "../../meeting/state";
  import type { TranscriptEntry } from "../../meeting/types";

  interface Props {
    activeTranscriptParticipantIds: string[];
    participantId: string | null;
    room: RoomSummary | null;
    transcriptionState: "idle" | "connecting" | "connected" | "error";
    transcriptEntries: TranscriptEntry[];
  }

  let {
    activeTranscriptParticipantIds,
    participantId,
    room,
    transcriptionState,
    transcriptEntries
  }: Props = $props();

  const isParticipantLive = (targetParticipantId: string) =>
    activeTranscriptParticipantIds.includes(targetParticipantId);

  const isLocalParticipantLive = (targetParticipantId: string) =>
    targetParticipantId === participantId &&
    (transcriptionState === "connected" || isParticipantLive(targetParticipantId));
</script>

<div class="sidebar-transcript-presence">
  {#each room?.participants ?? [] as participant}
    <div class="sidebar-transcript-presence-row">
      <span
        class={`sidebar-transcript-dot ${
          participant.id === participantId
            ? isLocalParticipantLive(participant.id)
              ? "sidebar-transcript-dot-live"
              : "sidebar-transcript-dot-idle"
            : isParticipantLive(participant.id)
              ? "sidebar-transcript-dot-live"
              : "sidebar-transcript-dot-idle"
        }`}
      ></span>
      <span>{participant.displayName}</span>
    </div>
  {/each}
</div>

{#if transcriptEntries.length}
  <div class="sidebar-transcript-list">
    {#each transcriptEntries as entry}
      <div class:sidebar-transcript-partial={entry.isPartial} class="sidebar-chat-row">
        <strong>{entry.speakerDisplayName ?? resolveParticipantDisplayName(room, entry.speakerParticipantId)}</strong>
        <p>{entry.text}</p>
      </div>
    {/each}
  </div>
{:else}
  <div class="sidebar-empty">
    <strong>No transcript yet</strong>
    <p>Finalized transcript segments will land here once the transcription pipeline starts publishing events.</p>
  </div>
{/if}
