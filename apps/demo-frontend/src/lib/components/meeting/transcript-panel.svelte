<script lang="ts">
  import { cn } from "@mote/ui";
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
  let transcriptScrollContainer = $state<HTMLDivElement | null>(null);
  let shouldAutoScroll = $state(true);
  const AUTO_SCROLL_THRESHOLD_PX = 48;

  const isParticipantLive = (targetParticipantId: string) =>
    activeTranscriptParticipantIds.includes(targetParticipantId);

  const isLocalParticipantLive = (targetParticipantId: string) =>
    targetParticipantId === participantId &&
    (transcriptionState === "connected" || isParticipantLive(targetParticipantId));

  const syncAutoScrollPreference = () => {
    if (!transcriptScrollContainer) {
      return;
    }

    const distanceFromBottom =
      transcriptScrollContainer.scrollHeight -
      transcriptScrollContainer.scrollTop -
      transcriptScrollContainer.clientHeight;

    shouldAutoScroll = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
  };

  $effect(() => {
    transcriptEntries.length;

    if (!transcriptScrollContainer || !shouldAutoScroll) {
      return;
    }

    requestAnimationFrame(() => {
      transcriptScrollContainer?.scrollTo({
        top: transcriptScrollContainer.scrollHeight,
        behavior: "smooth"
      });
    });
  });
</script>

<div class="flex flex-wrap gap-2">
  {#each room?.participants ?? [] as participant}
    <div class="inline-flex items-center gap-2 border border-border bg-panel-muted px-3 py-2 text-xs text-foreground-soft">
      <span
        class={`ui-status-dot ${
          participant.id === participantId
            ? isLocalParticipantLive(participant.id)
              ? "ui-status-dot-live"
              : "ui-status-dot-idle"
            : isParticipantLive(participant.id)
              ? "ui-status-dot-live"
              : "ui-status-dot-idle"
        }`}
      ></span>
      <span>{participant.displayName}</span>
    </div>
  {/each}
</div>

{#if transcriptEntries.length}
  <div
    class="flex max-h-[calc(100vh-18rem)] flex-col gap-3 overflow-y-auto pr-1"
    bind:this={transcriptScrollContainer}
    onscroll={syncAutoScrollPreference}
  >
    {#each transcriptEntries as entry}
      <div
        class={cn(
          "border border-border bg-panel-subtle px-4 py-4 text-sm leading-6 text-foreground-soft",
          entry.isPartial && "border-dashed border-info/20"
        )}
      >
        <strong class="mb-1 block text-sm font-semibold text-foreground">
          {entry.speakerDisplayName ?? resolveParticipantDisplayName(room, entry.speakerParticipantId)}
        </strong>
        <p class="text-sm leading-6 text-foreground-soft">{entry.text}</p>
      </div>
    {/each}
  </div>
{:else}
  <div class="flex min-h-full flex-col items-center justify-center gap-3 border border-border bg-panel-muted px-8 py-12 text-center">
    <strong class="text-lg font-semibold text-foreground">No transcript yet</strong>
    <p class="text-sm leading-6 text-subtle-foreground">Finalized transcript segments will land here once the transcription pipeline starts publishing events.</p>
  </div>
{/if}
