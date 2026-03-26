<script lang="ts">
  import Icon from "@iconify/svelte";
  import type { FactCheckPrivateEvent } from "@mote/models";

  interface Props {
    factCheckToasts: FactCheckPrivateEvent[];
    acknowledgingFactCheckEventIds: string[];
    onDismissFactCheck: (eventId: string) => void;
    onAcknowledgeFactCheck: (event: FactCheckPrivateEvent) => void;
  }

  let {
    factCheckToasts,
    acknowledgingFactCheckEventIds,
    onDismissFactCheck,
    onAcknowledgeFactCheck
  }: Props = $props();

  const noOpPattern =
    /\bno correction needed\b|\bno correction required\b|\bno factual error detected\b/i;
  const visibleFactCheckToasts = $derived(
    factCheckToasts
      .map((event) => ({
        ...event,
        payload: {
          ...event.payload,
          items: event.payload.items.filter(
            (item) =>
              !noOpPattern.test(item.claim) &&
              !noOpPattern.test(item.correction) &&
              !noOpPattern.test(item.rationale)
          )
        }
      }))
      .filter((event) => event.payload.items.length > 0)
  );
</script>

{#if visibleFactCheckToasts.length}
  <div class="pointer-events-none fixed left-1/2 top-6 z-50 flex w-[min(92vw,720px)] -translate-x-1/2 flex-col gap-3">
    {#each visibleFactCheckToasts as event (event.id)}
      <div class="pointer-events-auto border border-amber-400/45 bg-amber-100/95 px-4 py-4 text-amber-950 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.55)] backdrop-blur">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 space-y-2">
            <div class="text-xs font-semibold uppercase tracking-[0.18em] text-amber-900/75">
              Presenter Fact Check
            </div>
            {#each event.payload.items as item}
              <div class="space-y-1">
                <p class="text-sm font-semibold leading-6">{item.claim}</p>
                <p class="text-sm leading-6">Correction: {item.correction}</p>
                <p class="text-sm leading-6 text-amber-950/80">Why: {item.rationale}</p>
              </div>
            {/each}
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              class="flex h-10 w-10 items-center justify-center border border-amber-900/20 bg-white/70 text-amber-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onclick={() => onAcknowledgeFactCheck(event)}
              disabled={acknowledgingFactCheckEventIds.includes(event.id)}
              aria-label="Send acknowledgement to room chat"
            >
              <Icon icon="ph:paper-plane-tilt" width="18" height="18" />
            </button>
            <button
              class="flex h-10 w-10 items-center justify-center border border-amber-900/20 bg-white/70 text-amber-950 transition hover:bg-white"
              type="button"
              onclick={() => onDismissFactCheck(event.id)}
              aria-label="Dismiss fact check"
            >
              <Icon icon="ph:check" width="18" height="18" />
            </button>
          </div>
        </div>
      </div>
    {/each}
  </div>
{/if}
