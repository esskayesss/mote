<script lang="ts">
  import { Button, Input } from "@mote/ui";
  import type { ChatMessageEvent, RoomSummary } from "@mote/models";
  import { resolveParticipantDisplayName } from "../../meeting/state";

  interface Props {
    chatDraft: string;
    chatMessages: ChatMessageEvent[];
    onChatDraft: (value: string) => void;
    onSubmitChatMessage: () => void;
    room: RoomSummary | null;
  }

  let { chatDraft, chatMessages, onChatDraft, onSubmitChatMessage, room }: Props = $props();
  let chatScrollContainer = $state<HTMLDivElement | null>(null);
  let shouldAutoScroll = $state(true);
  const AUTO_SCROLL_THRESHOLD_PX = 48;

  const formatMessageTime = (createdAt: string) =>
    new Date(createdAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });

  const isMonitorMessage = (message: string) => message.startsWith("[Monitor]");

  const syncAutoScrollPreference = () => {
    if (!chatScrollContainer) {
      return;
    }

    const distanceFromBottom =
      chatScrollContainer.scrollHeight -
      chatScrollContainer.scrollTop -
      chatScrollContainer.clientHeight;

    shouldAutoScroll = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
  };

  $effect(() => {
    chatMessages.length;

    if (!chatScrollContainer || !shouldAutoScroll) {
      return;
    }

    requestAnimationFrame(() => {
      chatScrollContainer?.scrollTo({
        top: chatScrollContainer.scrollHeight,
        behavior: "smooth"
      });
    });
  });
</script>

<div class="flex h-full min-h-0 flex-col gap-4">
  {#if chatMessages.length}
    <div
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
      bind:this={chatScrollContainer}
      onscroll={syncAutoScrollPreference}
    >
      {#each chatMessages as event}
        <div
          class={`border px-4 py-4 text-sm leading-6 ${
            isMonitorMessage(event.payload.message)
              ? "border-primary/30 bg-primary/8 text-foreground"
              : "border-border bg-panel-subtle text-foreground-soft"
          }`}
        >
          <div class="mb-2 flex items-center justify-between gap-3">
            <strong class="block text-sm font-semibold text-foreground">
              {event.actorParticipantId
                ? resolveParticipantDisplayName(room, event.actorParticipantId)
                : isMonitorMessage(event.payload.message)
                  ? "Mote Monitor"
                  : "Mote"}
            </strong>
            <span class="shrink-0 text-xs uppercase tracking-[0.18em] text-subtle-foreground">
              {formatMessageTime(event.createdAt)}
            </span>
          </div>
          <p
            class={`text-sm leading-6 ${
              isMonitorMessage(event.payload.message)
                ? "whitespace-pre-wrap font-mono text-[12px] text-foreground"
                : "whitespace-pre-wrap text-foreground-soft"
            }`}
          >
            {event.payload.message}
          </p>
        </div>
      {/each}
    </div>
  {:else}
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 border border-border bg-panel-muted px-8 py-12 text-center">
      <strong class="text-lg font-semibold text-foreground">No chat yet</strong>
      <p class="text-sm leading-6 text-subtle-foreground">Messages sent on the meeting event channel will appear here immediately.</p>
    </div>
  {/if}

  <div class="mt-auto shrink-0 border-t border-border/80 bg-background/90 pt-3 backdrop-blur">
    <Input
      value={chatDraft}
      oninput={(event) => onChatDraft(event.currentTarget.value)}
      class="min-h-12 border-input bg-background-deep px-4 py-3 text-foreground placeholder:text-subtle-foreground"
      placeholder="Send a message to the room"
    />
    <Button class="mt-3 min-h-12 w-full bg-primary px-5 py-3 text-foreground hover:bg-primary-strong" onclick={onSubmitChatMessage}>Send</Button>
  </div>
</div>
