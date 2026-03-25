<script lang="ts">
  import Icon from "@iconify/svelte";
  import type { ParticipantMediaState, RoomParticipant } from "@mote/models";

  interface Props {
    isHost: boolean;
    participantId: string | null;
    participants: RoomParticipant[];
    onModerateParticipantMedia: (
      targetParticipantId: string,
      nextState: Partial<Pick<ParticipantMediaState, "audioEnabled" | "videoEnabled">>,
      reason?: string
    ) => void;
    onRemoveParticipant: (targetParticipantId: string, reason?: string) => void;
  }

  let {
    isHost,
    participantId,
    participants,
    onModerateParticipantMedia,
    onRemoveParticipant
  }: Props = $props();
</script>

<div class="sidebar-presence">
  {#each participants as participant}
    <div class="sidebar-presence-row">
      <div class="sidebar-presence-copy">
        <strong>{participant.displayName}</strong>
        <span>{participant.role}</span>
      </div>
      <div class="sidebar-presence-meta">
        <span>{new Date(participant.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        {#if isHost && participant.id !== participantId}
          <div class="sidebar-presence-actions">
            <button
              class="toolbar-chip toolbar-chip-compact"
              type="button"
              onclick={() =>
                onModerateParticipantMedia(participant.id, { audioEnabled: false }, "Muted by host")}
            >
              <Icon icon="ph:microphone-slash" width="16" height="16" />
            </button>
            <button
              class="toolbar-chip toolbar-chip-compact"
              type="button"
              onclick={() =>
                onModerateParticipantMedia(participant.id, { videoEnabled: false }, "Camera paused by host")}
            >
              <Icon icon="ph:video-camera-slash" width="16" height="16" />
            </button>
            <button
              class="toolbar-chip toolbar-chip-compact toolbar-chip-danger"
              type="button"
              onclick={() => onRemoveParticipant(participant.id, "Removed by host")}
            >
              <Icon icon="ph:user-minus" width="16" height="16" />
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>
