<script lang="ts">
  import type { RoomSummary } from "@mote/models";
  import { resolveParticipantDisplayName } from "../../meeting/state";
  import type { TranscriptEntry } from "../../meeting/types";

  interface Props {
    room: RoomSummary | null;
    transcriptEntries: TranscriptEntry[];
  }

  let { room, transcriptEntries }: Props = $props();
</script>

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
