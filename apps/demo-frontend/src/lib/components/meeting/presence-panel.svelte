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

<div class="flex flex-col gap-3">
  {#each participants as participant}
    <div class="flex items-center justify-between gap-3 border border-border bg-panel-subtle px-4 py-4 text-sm">
      <div class="min-w-0">
        <strong class="block text-foreground">{participant.displayName}</strong>
        <span class="text-xs uppercase tracking-[0.14em] text-subtle-foreground">
          {participant.authorityRole}{participant.isPresenter ? " · presenter" : ""}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-foreground-soft">{new Date(participant.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        {#if canModerate && participant.id !== participantId}
          <div class="flex items-center gap-2">
            <button
              class="flex h-10 w-10 items-center justify-center border border-border-strong bg-accent text-foreground transition hover:bg-accent-hover"
              type="button"
              onclick={() =>
                onModerateParticipantMedia(participant.id, { audioEnabled: false }, "Muted by host")}
            >
              <Icon icon="ph:microphone-slash" width="16" height="16" />
            </button>
            <button
              class="flex h-10 w-10 items-center justify-center border border-border-strong bg-accent text-foreground transition hover:bg-accent-hover"
              type="button"
              onclick={() =>
                onModerateParticipantMedia(participant.id, { videoEnabled: false }, "Camera paused by host")}
            >
              <Icon icon="ph:video-camera-slash" width="16" height="16" />
            </button>
            <button
              class="flex h-10 w-10 items-center justify-center border border-border-strong bg-accent text-foreground transition hover:bg-accent-hover"
              type="button"
              onclick={() =>
                onModerateParticipantMedia(participant.id, { screenEnabled: false }, "Screen share stopped by admin")}
            >
              <Icon icon="ph:desktop" width="16" height="16" />
            </button>
            <button
              class="flex h-10 w-10 items-center justify-center border border-destructive-strong/60 bg-destructive-strong text-foreground transition hover:bg-destructive"
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
      <div class="-mt-2 flex flex-col gap-3 border border-t-0 border-border bg-surface px-4 py-4">
        <label class="flex items-center justify-between gap-3 text-sm text-foreground-soft">
          <span class="text-xs uppercase tracking-[0.14em] text-subtle-foreground">Authority</span>
          <select
            class="min-h-12 border border-input bg-background-deep px-4 py-3 text-foreground"
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

        <label class="inline-flex items-center gap-2 text-sm text-foreground-soft">
          <input
            type="checkbox"
            class="h-4 w-4 accent-primary"
            checked={participant.isPresenter}
            onchange={(event) =>
              onUpdateParticipantAccess(participant.id, {
                isPresenter: event.currentTarget.checked
              })}
          />
          <span>Presenter</span>
        </label>

        <div class="grid gap-2 sm:grid-cols-2">
          <label class="inline-flex items-center gap-2 text-sm text-foreground-soft">
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary"
              checked={participant.mediaCapabilities.publishAudio}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { publishAudio: event.currentTarget.checked }
                })}
            />
            <span>Publish voice</span>
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-foreground-soft">
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary"
              checked={participant.mediaCapabilities.publishVideo}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { publishVideo: event.currentTarget.checked }
                })}
            />
            <span>Publish camera</span>
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-foreground-soft">
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary"
              checked={participant.mediaCapabilities.publishScreen}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { publishScreen: event.currentTarget.checked }
                })}
            />
            <span>Publish screen</span>
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-foreground-soft">
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary"
              checked={participant.mediaCapabilities.subscribeAudio}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { subscribeAudio: event.currentTarget.checked }
                })}
            />
            <span>Subscribe voice</span>
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-foreground-soft">
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary"
              checked={participant.mediaCapabilities.subscribeVideo}
              onchange={(event) =>
                onUpdateParticipantAccess(participant.id, {
                  mediaCapabilities: { subscribeVideo: event.currentTarget.checked }
                })}
            />
            <span>Subscribe camera</span>
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-foreground-soft">
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary"
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
