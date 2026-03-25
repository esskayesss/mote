<script lang="ts">
  import Icon from "@iconify/svelte";
  import { cn } from "@mote/ui";
  import type { ParticipantMediaState, RoomParticipant } from "@mote/models";
  import type { DemoMediaSession } from "../../media/session";

  interface Props {
    mediaSession: DemoMediaSession;
    participant: RoomParticipant | null;
    participantMediaState?: ParticipantMediaState | null;
    remoteMediaVersion: number;
  }

  let {
    mediaSession,
    participant,
    participantMediaState = null,
    remoteMediaVersion
  }: Props = $props();

  const hasRemoteStream = $derived(
    participant ? remoteMediaVersion >= 0 && mediaSession.hasRemoteStream(participant.id) : false
  );
  const hasRemoteScreenStream = $derived(
    participant ? remoteMediaVersion >= 0 && mediaSession.hasRemoteScreenStream(participant.id) : false
  );

  const mediaChipClass = (enabled: boolean | undefined) =>
    cn(
      "flex h-9 w-9 items-center justify-center border border-border-strong bg-overlay text-foreground",
      enabled === false && "border-destructive/35 bg-destructive-soft text-destructive-foreground"
    );
</script>

<article class={cn("participant-tile relative min-h-[450px] overflow-hidden border border-border bg-surface-muted", !participant && "bg-surface")}>
  {#if participant}
    {#if hasRemoteStream}
      <video
        autoplay
        playsinline
        class={cn("h-full w-full", hasRemoteScreenStream ? "object-contain bg-surface" : "object-cover")}
        use:mediaSession.bindRemoteVideo={{ participantId: participant.id, target: "primary" }}
      ></video>
    {:else}
      <div class="flex h-full flex-col items-center justify-center gap-6 bg-surface-muted px-8 text-center text-muted-foreground">
        <div class="flex h-36 w-36 items-center justify-center bg-neutral text-5xl font-semibold text-foreground-soft">
          {participant.displayName.slice(0, 1).toUpperCase()}
        </div>
        <p>Waiting for {participant.displayName}'s video.</p>
      </div>
    {/if}

    <div
      class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-5 py-4"
      style="background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--color-shadow) 78%, transparent));"
    >
      <div class="flex min-w-0 flex-col gap-1">
        <span class="text-sm font-medium text-foreground">{participant.displayName}</span>
        <span class="text-xs uppercase tracking-[0.14em] text-muted-foreground">{participant.role}</span>
      </div>

      {#if participantMediaState}
        <div class="flex items-center gap-2" aria-label="Participant media state">
          <span class={mediaChipClass(participantMediaState.audioEnabled)}>
            <Icon
              icon={participantMediaState.audioEnabled === false ? "ph:microphone-slash" : "ph:microphone"}
              width="16"
              height="16"
            />
          </span>
          <span class={mediaChipClass(participantMediaState.videoEnabled)}>
            <Icon
              icon={participantMediaState.videoEnabled === false ? "ph:video-camera-slash" : "ph:video-camera"}
              width="16"
              height="16"
            />
          </span>
          <span class={mediaChipClass(participantMediaState.screenEnabled === true)}>
            <Icon icon="ph:desktop" width="16" height="16" />
          </span>
        </div>
      {/if}
    </div>
  {:else}
    <div class="flex h-full flex-col items-center justify-center gap-6 bg-surface-muted px-8 text-center text-muted-foreground">
      <div class="flex h-36 w-36 items-center justify-center bg-neutral text-5xl font-semibold text-foreground-soft">+</div>
      <p>Invite another participant to populate this grid.</p>
    </div>
  {/if}
</article>
