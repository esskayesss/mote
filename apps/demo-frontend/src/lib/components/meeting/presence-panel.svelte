<script lang="ts">
  import Icon from "@iconify/svelte";
  import type {
    ParticipantAuthorityRole,
    ParticipantMediaCapabilities,
    ParticipantMediaState,
    RoomParticipant
  } from "@mote/models";

  interface Props {
    canManageParticipantAccess: boolean;
    canModerate: boolean;
    participantId: string | null;
    participants: RoomParticipant[];
    onModerateParticipantMedia: (
      targetParticipantId: string,
      nextState: Partial<Pick<ParticipantMediaState, "audioEnabled" | "videoEnabled" | "screenEnabled">>,
      reason?: string
    ) => void;
    onRemoveParticipant: (targetParticipantId: string, reason?: string) => void;
    onUpdateParticipantAccess: (
      targetParticipantId: string,
      input: {
        authorityRole?: ParticipantAuthorityRole;
        isPresenter?: boolean;
        mediaCapabilities?: Partial<ParticipantMediaCapabilities>;
      }
    ) => void;
  }

  let {
    canManageParticipantAccess,
    canModerate,
    participantId,
    participants,
    onModerateParticipantMedia,
    onRemoveParticipant,
    onUpdateParticipantAccess
  }: Props = $props();
</script>

<div class="sidebar-presence">
  {#each participants as participant}
    <div class="sidebar-presence-row">
      <div class="sidebar-presence-copy">
        <strong>{participant.displayName}</strong>
        <span>{participant.authorityRole}{participant.isPresenter ? " · presenter" : ""}</span>
      </div>
      <div class="sidebar-presence-meta">
        <span>{new Date(participant.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        {#if canModerate && participant.id !== participantId}
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
              class="toolbar-chip toolbar-chip-compact"
              type="button"
              onclick={() =>
                onModerateParticipantMedia(participant.id, { screenEnabled: false }, "Screen share stopped by admin")}
            >
              <Icon icon="ph:desktop" width="16" height="16" />
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

    {#if canManageParticipantAccess && participant.id !== participantId}
      <div class="sidebar-presence-access">
        <label class="sidebar-presence-access-row">
          <span>Authority</span>
          <select
            class="home-input home-select"
            value={participant.authorityRole}
            onchange={(event) =>
              onUpdateParticipantAccess(participant.id, {
                authorityRole: event.currentTarget.value as ParticipantAuthorityRole
              })}
          >
            <option value="participant">Participant</option>
            <option value="admin">Admin</option>
          </select>
        </label>

        <label class="sidebar-presence-access-toggle">
          <input
            type="checkbox"
            checked={participant.isPresenter}
            onchange={(event) =>
              onUpdateParticipantAccess(participant.id, {
                isPresenter: event.currentTarget.checked
              })}
          />
          <span>Presenter</span>
        </label>

        <div class="sidebar-presence-capability-grid">
          <label class="sidebar-presence-access-toggle">
            <input
              type="checkbox"
              checked={participant.mediaCapabilities.publishAudio}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { publishAudio: event.currentTarget.checked }
                })}
            />
            <span>Publish voice</span>
          </label>
          <label class="sidebar-presence-access-toggle">
            <input
              type="checkbox"
              checked={participant.mediaCapabilities.publishVideo}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { publishVideo: event.currentTarget.checked }
                })}
            />
            <span>Publish camera</span>
          </label>
          <label class="sidebar-presence-access-toggle">
            <input
              type="checkbox"
              checked={participant.mediaCapabilities.publishScreen}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { publishScreen: event.currentTarget.checked }
                })}
            />
            <span>Publish screen</span>
          </label>
          <label class="sidebar-presence-access-toggle">
            <input
              type="checkbox"
              checked={participant.mediaCapabilities.subscribeAudio}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { subscribeAudio: event.currentTarget.checked }
                })}
            />
            <span>Subscribe voice</span>
          </label>
          <label class="sidebar-presence-access-toggle">
            <input
              type="checkbox"
              checked={participant.mediaCapabilities.subscribeVideo}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { subscribeVideo: event.currentTarget.checked }
                })}
            />
            <span>Subscribe camera</span>
          </label>
          <label class="sidebar-presence-access-toggle">
            <input
              type="checkbox"
              checked={participant.mediaCapabilities.subscribeScreen}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { subscribeScreen: event.currentTarget.checked }
                })}
            />
            <span>Subscribe screen</span>
          </label>
        </div>
      </div>
    {/if}
  {/each}
</div>
