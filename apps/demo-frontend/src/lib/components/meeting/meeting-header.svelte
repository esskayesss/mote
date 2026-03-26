<script lang="ts">
  import Icon from "@iconify/svelte";
  import { cn } from "@mote/ui";
  import type { RoomParticipant, RoomSummary } from "@mote/models";
  import type { DemoMediaSession } from "../../media/session";
  import { pressable } from "../../meeting/pressable";

  interface Props {
    room: RoomSummary | null;
    currentCode: string | null;
    participantCount: number;
    headerVideoParticipants: RoomParticipant[];
    mediaSession: DemoMediaSession;
    connectionLabel: string;
    showMoteMonitorMessages: boolean;
    moteMonitorTurnCount: number;
    onToggleMoteMonitorMessages: () => void;
    onRefreshMeeting: () => void;
    toolbarButtonBase: string;
    floatingPreviewMinimized: boolean;
    mediaState: "idle" | "requesting" | "ready" | "blocked";
    onRestoreFloatingPreview: () => void;
    localScreenShareActive: boolean;
    pageLabel: string;
    toolbarCompactButtonClass: string;
    canGoPrevious: boolean;
    canGoNext: boolean;
    onPreviousPage: () => void;
    onNextPage: () => void;
    isAudioMuted: boolean;
    audioStatusLabel: string;
    onToggleAudio: () => void;
    isVideoMuted: boolean;
    videoStatusLabel: string;
    onToggleVideo: () => void;
    canPublishScreen: boolean;
    onToggleScreenShare: () => void;
    sidebarToggleIcon: string;
    onToggleSidebar: () => void;
    onBackHome: () => void;
    meetingHeaderElement?: HTMLElement | null;
    localVideo?: HTMLVideoElement | null;
    minimizedScreenVideoElement?: HTMLVideoElement | null;
  }

  let {
    room,
    currentCode,
    participantCount,
    headerVideoParticipants,
    mediaSession,
    connectionLabel,
    showMoteMonitorMessages,
    moteMonitorTurnCount,
    onToggleMoteMonitorMessages,
    onRefreshMeeting,
    toolbarButtonBase,
    floatingPreviewMinimized,
    mediaState,
    onRestoreFloatingPreview,
    localScreenShareActive,
    pageLabel,
    toolbarCompactButtonClass,
    canGoPrevious,
    canGoNext,
    onPreviousPage,
    onNextPage,
    isAudioMuted,
    audioStatusLabel,
    onToggleAudio,
    isVideoMuted,
    videoStatusLabel,
    onToggleVideo,
    canPublishScreen,
    onToggleScreenShare,
    sidebarToggleIcon,
    onToggleSidebar,
    onBackHome,
    meetingHeaderElement = $bindable(),
    localVideo = $bindable(),
    minimizedScreenVideoElement = $bindable()
  }: Props = $props();

  let headerVideoAspectRatios = $state<Record<string, number>>({});

  const getHeaderVideoWidth = (participantId: string) =>
    Math.max(48, Math.round(48 * (headerVideoAspectRatios[participantId] ?? 1)));

  const syncHeaderVideoAspectRatio = (participantId: string, event: Event) => {
    const video = event.currentTarget as HTMLVideoElement;

    if (!video.videoWidth || !video.videoHeight) {
      return;
    }

    headerVideoAspectRatios = {
      ...headerVideoAspectRatios,
      [participantId]: video.videoWidth / video.videoHeight
    };
  };
</script>

<header
  class="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6"
  bind:this={meetingHeaderElement}
>
  <div class="flex items-center gap-3">
    <div class="flex flex-col gap-1 text-sm">
      <span class="text-sm font-medium tracking-[-0.01em] text-foreground">
        {room?.meetingTitle ?? `Room: ${room?.code ?? currentCode}`}
      </span>
      <span class="text-xs text-subtle-foreground">
        {room?.meetingTitle
          ? `Room: ${room.code} · ${participantCount} participants`
          : `${participantCount} participants`}
      </span>
    </div>
    <button
      class={cn(
        "inline-flex min-h-9 items-center gap-2 border px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] transition",
        showMoteMonitorMessages
          ? "border-primary/60 bg-primary-soft text-foreground"
          : "border-border bg-panel-subtle text-subtle-foreground hover:text-foreground"
      )}
      type="button"
      onclick={onToggleMoteMonitorMessages}
      use:pressable
    >
      <Icon
        icon={showMoteMonitorMessages ? "ph:toggle-right-fill" : "ph:toggle-left"}
        width="18"
        height="18"
      />
      <span>Mote Monitor</span>
      <span class="rounded-full bg-background/80 px-2 py-0.5 text-[11px] tracking-[0.08em] text-foreground">
        {moteMonitorTurnCount}
      </span>
    </button>
  </div>

  <div class="flex flex-wrap items-center justify-end gap-2.5">
    {#if headerVideoParticipants.length}
      <div class="flex max-w-[42vw] items-center gap-2 overflow-x-auto">
        {#each headerVideoParticipants as participant}
          <div
            class="flex h-12 w-12 shrink-0 overflow-hidden border border-border-strong bg-panel-subtle-2"
            aria-label={`${participant.displayName} camera preview`}
            title={participant.displayName}
            style={`width: ${getHeaderVideoWidth(participant.id)}px;`}
          >
            <video
              autoplay
              playsinline
              class="h-full w-auto max-w-none object-cover"
              use:mediaSession.bindRemoteVideo={{ participantId: participant.id, target: "camera" }}
              onloadedmetadata={(event) => syncHeaderVideoAspectRatio(participant.id, event)}
            ></video>
          </div>
        {/each}
      </div>
    {/if}
    <button
      class={cn(toolbarButtonBase, "min-w-32 justify-start")}
      type="button"
      onclick={onRefreshMeeting}
      use:pressable
    >
      <Icon icon="ph:arrows-clockwise" width="18" height="18" />
      <span class="block leading-none">{connectionLabel}</span>
    </button>
    {#if floatingPreviewMinimized}
      <div class="flex items-center gap-2">
        <button
          class="flex h-12 w-[86px] shrink-0 overflow-hidden border border-border-strong bg-panel-subtle-2"
          type="button"
          onclick={onRestoreFloatingPreview}
          aria-label="Restore floating camera preview"
          use:pressable
        >
          {#if mediaState === "ready"}
            <video
              bind:this={localVideo}
              autoplay
              muted
              playsinline
              class="h-full w-full object-cover"
            ></video>
          {:else}
            <div class="flex h-full w-full items-center justify-center text-subtle-foreground">
              <Icon icon="ph:video-camera-slash" class="shrink-0" width="16" height="16" />
            </div>
          {/if}
        </button>
        {#if localScreenShareActive}
          <button
            class="flex h-12 w-[86px] shrink-0 overflow-hidden border border-border-strong bg-panel-subtle-2"
            type="button"
            onclick={onRestoreFloatingPreview}
            aria-label="Restore floating screen share preview"
            use:pressable
          >
            <video
              bind:this={minimizedScreenVideoElement}
              autoplay
              muted
              playsinline
              class="h-full w-full object-contain bg-surface"
            ></video>
          </button>
        {/if}
      </div>
    {/if}
    <div class="flex items-center gap-3 text-xs uppercase tracking-[0.16em] text-subtle-foreground">
      <span>Page {pageLabel}</span>
      <div class="flex items-center gap-2">
        <button
          class={toolbarCompactButtonClass}
          type="button"
          disabled={!canGoPrevious}
          onclick={onPreviousPage}
          use:pressable
        >
          <Icon icon="ph:caret-left" class="shrink-0" width="16" height="16" />
        </button>
        <button
          class={toolbarCompactButtonClass}
          type="button"
          disabled={!canGoNext}
          onclick={onNextPage}
          use:pressable
        >
          <Icon icon="ph:caret-right" class="shrink-0" width="16" height="16" />
        </button>
      </div>
    </div>
    <button
      class={cn(
        toolbarButtonBase,
        isAudioMuted
          ? "border-destructive/35 bg-destructive-soft text-destructive-foreground"
          : "border-primary/70 bg-primary-soft text-foreground"
      )}
      type="button"
      onclick={onToggleAudio}
      aria-label={audioStatusLabel}
      use:pressable
    >
      <Icon icon={isAudioMuted ? "ph:microphone-slash" : "ph:microphone"} width="18" height="18" />
    </button>
    <button
      class={cn(
        toolbarButtonBase,
        isVideoMuted
          ? "border-destructive/35 bg-destructive-soft text-destructive-foreground"
          : "border-primary/70 bg-primary-soft text-foreground"
      )}
      type="button"
      onclick={onToggleVideo}
      aria-label={videoStatusLabel}
      use:pressable
    >
      <Icon icon={isVideoMuted ? "ph:video-camera-slash" : "ph:video-camera"} width="18" height="18" />
    </button>
    {#if canPublishScreen}
      <button
        class={cn(
          toolbarButtonBase,
          localScreenShareActive
            ? "border-primary/70 bg-primary-soft text-foreground"
            : "border-border-strong bg-accent text-foreground"
        )}
        type="button"
        onclick={onToggleScreenShare}
        aria-label={localScreenShareActive ? "Stop screen share" : "Start screen share"}
        use:pressable
      >
        <Icon icon="ph:desktop" class="shrink-0" width="18" height="18" />
      </button>
    {/if}
    <button
      class={toolbarButtonBase}
      type="button"
      onclick={onToggleSidebar}
      aria-label="Toggle sidebar"
      use:pressable
    >
      <Icon icon={sidebarToggleIcon} width="18" height="18" />
    </button>
    <button
      class={cn(
        toolbarButtonBase,
        "border-destructive-strong/60 bg-destructive-strong hover:bg-destructive"
      )}
      type="button"
      onclick={onBackHome}
      use:pressable
    >
      <Icon icon="ph:sign-out" width="18" height="18" />
      <span class="block leading-none">Leave</span>
    </button>
  </div>
</header>
