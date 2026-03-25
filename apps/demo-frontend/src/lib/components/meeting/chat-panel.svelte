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
</script>

<div class="sidebar-chat">
  {#if chatMessages.length}
    <div class="sidebar-chat-list">
      {#each chatMessages as event}
        <div class="sidebar-chat-row">
          <strong>{resolveParticipantDisplayName(room, event.actorParticipantId)}</strong>
          <p>{event.payload.message}</p>
        </div>
      {/each}
    </div>
  {:else}
    <div class="sidebar-empty">
      <strong>No chat yet</strong>
      <p>Messages sent on the meeting event channel will appear here immediately.</p>
    </div>
  {/if}

  <div class="sidebar-chat-compose">
    <Input
      value={chatDraft}
      oninput={(event) => onChatDraft(event.currentTarget.value)}
      class="meeting-input"
      placeholder="Send a message to the room"
    />
    <Button class="meeting-join-button" onclick={onSubmitChatMessage}>Send</Button>
  </div>
</div>
