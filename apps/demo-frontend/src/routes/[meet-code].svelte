<script lang="ts">
  import { gsap } from "gsap";
  import Icon from "@iconify/svelte";
  import { Button, Input, cn } from "@mote/ui";
  import { onMount, tick } from "svelte";
  import type {
    ChatMessageEvent,
    ParticipantAuthorityRole,
    ParticipantMediaCapabilities,
    ParticipantMediaState,
    RoomParticipant,
    RoomSummary
  } from "@mote/models";
  import AgendaPanel from "../lib/components/meeting/agenda-panel.svelte";
  import ChatPanel from "../lib/components/meeting/chat-panel.svelte";
  import PresencePanel from "../lib/components/meeting/presence-panel.svelte";
  import ParticipantTile from "../lib/components/meeting/participant-tile.svelte";
  import TranscriptPanel from "../lib/components/meeting/transcript-panel.svelte";
  import type { DemoMediaSession } from "../lib/media/session";
  import type { TranscriptEntry } from "../lib/meeting/types";

  interface Props {
    chatMessages: ChatMessageEvent[];
    currentCode: string | null;
    displayName: string;
    errorMessage: string;
    isAudioMuted: boolean;
    isLoadingRoom: boolean;
    isSubmitting: boolean;
    submissionMode: "create" | "join" | null;
    isVideoMuted: boolean;
    localParticipant: RoomParticipant | null;
    localScreenShareActive: boolean;
    localScreenShareStream: MediaStream | null;
    localStageName: string;
    localVideo: HTMLVideoElement | null;
    mediaSession: DemoMediaSession;
    mediaState: "idle" | "requesting" | "ready" | "blocked";
    onBackHome: () => void;
    onChatMessage: (message: string) => void;
    onDisplayName: (value: string) => void;
    onJoinMeeting: () => void;
    canManageParticipantAccess: boolean;
    canModerate: boolean;
    canPublishScreen: boolean;
    onModerateParticipantMedia: (
      targetParticipantId: string,
      nextState: Partial<Pick<ParticipantMediaState, "audioEnabled" | "videoEnabled" | "screenEnabled">>,
      reason?: string
    ) => void;
    onRemoveParticipant: (targetParticipantId: string, reason?: string) => void;
    onRefreshMeeting: () => void;
    onToggleScreenShare: () => void;
    onUpdateParticipantAccess: (
      targetParticipantId: string,
      input: {
        authorityRole?: ParticipantAuthorityRole;
        isPresenter?: boolean;
        mediaCapabilities?: Partial<ParticipantMediaCapabilities>;
      }
    ) => void;
    onToggleAudio: () => void;
    onToggleVideo: () => void;
    participantCount: number;
    participantId: string | null;
    participantMediaStates: Record<string, ParticipantMediaState>;
    remoteMediaVersion: number;
    remoteParticipants: RoomParticipant[];
    room: RoomSummary | null;
    transcriptEntries: TranscriptEntry[];
    activeTranscriptParticipantIds: string[];
    transcriptionState: "idle" | "connecting" | "connected" | "error";
    transportState: "idle" | "connecting" | "connected" | "error";
  }

  let {
    chatMessages,
    currentCode,
    displayName,
    errorMessage,
    isAudioMuted,
    isLoadingRoom,
    isSubmitting,
    submissionMode,
    isVideoMuted,
    canManageParticipantAccess,
    canModerate,
    canPublishScreen,
    localParticipant,
    localScreenShareActive,
    localScreenShareStream,
    localStageName,
    localVideo = $bindable(),
    mediaSession,
    mediaState,
    onBackHome,
    onChatMessage,
    onDisplayName,
    onJoinMeeting,
    onModerateParticipantMedia,
    onRemoveParticipant,
    onRefreshMeeting,
    onToggleScreenShare,
    onUpdateParticipantAccess,
    onToggleAudio,
    onToggleVideo,
    participantCount,
    participantId,
    participantMediaStates,
    remoteMediaVersion,
    remoteParticipants,
    room,
    transcriptEntries,
    activeTranscriptParticipantIds,
    transcriptionState,
    transportState
  }: Props = $props();

  let activePanel = $state<"agenda" | "presence" | "chat" | "transcripts">("agenda");
  let pageIndex = $state(0);
  let chatDraft = $state("");
  let collapsedAgendaPoints = $state<Record<string, boolean>>({});
  let floatingPreviewPosition = $state({ x: 0, y: 0 });
  let hasPositionedFloatingPreview = $state(false);
  let floatingPreviewMinimized = $state(false);
  let sidebarCollapsed = $state(false);
  let meetingBodyElement = $state<HTMLDivElement | null>(null);
  let meetingHeaderElement = $state<HTMLElement | null>(null);
  let meetingGridElement = $state<HTMLElement | null>(null);
  let meetingSidebarElement = $state<HTMLElement | null>(null);
  let sidebarPanelElement = $state<HTMLDivElement | null>(null);
  let floatingPreviewElement = $state<HTMLDivElement | null>(null);
  let floatingScreenVideoElement = $state<HTMLVideoElement | null>(null);
  let minimizedScreenVideoElement = $state<HTMLVideoElement | null>(null);
  let floatingPreviewResizeObserver = $state<ResizeObserver | null>(null);
  let headerVideoAspectRatios = $state<Record<string, number>>({});
  let localPreviewAspectRatio = $state(1);
  let hasAnimatedShell = false;
  let lastSidebarCollapsed: boolean | null = null;
  let lastAnimatedPanel: "agenda" | "presence" | "chat" | "transcripts" | null = null;

  const floatingCameraPreviewHeight = $derived(
    Math.max(180, Math.round(300 / localPreviewAspectRatio))
  );
  const floatingPreviewHeight = $derived(
    localScreenShareActive ? floatingCameraPreviewHeight + 276 : floatingCameraPreviewHeight + 92
  );

  const pageSize = 4;
  const totalPages = $derived(Math.max(1, Math.ceil(remoteParticipants.length / pageSize)));
  const pagedParticipants = $derived(
    remoteParticipants.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize)
  );
  const pageLabel = $derived(`${pageIndex + 1}/${totalPages}`);
  const headerVideoParticipants = $derived.by(() => {
    remoteMediaVersion;
    return remoteParticipants.filter((participant) =>
      mediaSession.hasRemoteCameraStream(participant.id)
    );
  });
  const connectionLabel = $derived(
    transportState === "connected" ? "Live" : transportState === "connecting" ? "Connecting" : "Standby"
  );
  const audioStatusLabel = $derived(isAudioMuted ? "Muted" : "Mic live");
  const videoStatusLabel = $derived(isVideoMuted ? "Camera off" : "Camera live");
  const sidebarToggleIcon = $derived(
    sidebarCollapsed ? "ph:sidebar-simple" : "ph:sidebar-simple-fill"
  );
  const sidebarTabs = [
    { key: "agenda", label: "Agenda", icon: "ph:list-checks" },
    { key: "presence", label: "Presence", icon: "ph:users-three" },
    { key: "transcripts", label: "Transcript", icon: "ph:text-align-left" },
    { key: "chat", label: "Chat", icon: "ph:chat-circle-text" }
  ] as const;

  const toggleAgendaPoint = (pointId: string) => {
    collapsedAgendaPoints = {
      ...collapsedAgendaPoints,
      [pointId]: !collapsedAgendaPoints[pointId]
    };
  };

  const activateSidebarTab = (
    tab: "agenda" | "presence" | "chat" | "transcripts"
  ) => {
    activePanel = tab;

    if (sidebarCollapsed) {
      sidebarCollapsed = false;
    }
  };

  const clampFloatingPreview = (x: number, y: number) => {
    if (typeof window === "undefined") {
      return { x, y };
    }

    const width = 320;
    const height = floatingPreviewHeight;
    const padding = 20;

    return {
      x: Math.min(Math.max(x, padding), window.innerWidth - width - padding),
      y: Math.min(Math.max(y, 88), window.innerHeight - height - padding)
    };
  };

  const setDefaultFloatingPreviewPosition = () => {
    if (typeof window === "undefined") {
      return;
    }

    floatingPreviewPosition = clampFloatingPreview(
      window.innerWidth - 340,
      window.innerHeight - 420
    );
    hasPositionedFloatingPreview = true;
  };

  const keepFloatingPreviewInBounds = () => {
    if (typeof window === "undefined" || !floatingPreviewElement || floatingPreviewMinimized) {
      return;
    }

    const rect = floatingPreviewElement.getBoundingClientRect();
    const padding = 20;
    const minY = 88;
    let nextX = floatingPreviewPosition.x;
    let nextY = floatingPreviewPosition.y;

    if (rect.right > window.innerWidth - padding) {
      nextX -= rect.right - (window.innerWidth - padding);
    }

    if (rect.bottom > window.innerHeight - padding) {
      nextY -= rect.bottom - (window.innerHeight - padding);
    }

    if (rect.left < padding) {
      nextX += padding - rect.left;
    }

    if (rect.top < minY) {
      nextY += minY - rect.top;
    }

    floatingPreviewPosition = clampFloatingPreview(nextX, nextY);
  };

  const startFloatingPreviewDrag = (event: PointerEvent) => {
    event.preventDefault();

    const startPointerX = event.clientX;
    const startPointerY = event.clientY;
    const startX = floatingPreviewPosition.x;
    const startY = floatingPreviewPosition.y;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      floatingPreviewPosition = clampFloatingPreview(
        startX + (moveEvent.clientX - startPointerX),
        startY + (moveEvent.clientY - startPointerY)
      );
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const pressable = (node: HTMLElement) => {
    const animateTo = (properties: gsap.TweenVars) =>
      gsap.to(node, {
        duration: 0.18,
        ease: "power2.out",
        overwrite: "auto",
        ...properties
      });

    const handlePointerEnter = () => animateTo({ y: -1, scale: 1.01 });
    const handlePointerLeave = () => animateTo({ y: 0, scale: 1 });
    const handlePointerDown = () =>
      animateTo({ y: 0, scale: 0.97, duration: 0.12, ease: "power2.inOut" });
    const handlePointerUp = () => animateTo({ y: -1, scale: 1.01 });

    node.addEventListener("pointerenter", handlePointerEnter);
    node.addEventListener("pointerleave", handlePointerLeave);
    node.addEventListener("pointerdown", handlePointerDown);
    node.addEventListener("pointerup", handlePointerUp);
    node.addEventListener("pointercancel", handlePointerLeave);
    node.addEventListener("focus", handlePointerEnter);
    node.addEventListener("blur", handlePointerLeave);

    return {
      destroy() {
        gsap.killTweensOf(node);
        node.removeEventListener("pointerenter", handlePointerEnter);
        node.removeEventListener("pointerleave", handlePointerLeave);
        node.removeEventListener("pointerdown", handlePointerDown);
        node.removeEventListener("pointerup", handlePointerUp);
        node.removeEventListener("pointercancel", handlePointerLeave);
        node.removeEventListener("focus", handlePointerEnter);
        node.removeEventListener("blur", handlePointerLeave);
      }
    };
  };

  const animateParticipantTiles = () => {
    if (!meetingGridElement) {
      return;
    }

    const tiles = Array.from(meetingGridElement.querySelectorAll<HTMLElement>(".participant-tile"));

    if (!tiles.length) {
      return;
    }

    gsap.killTweensOf(tiles);
    gsap.fromTo(
      tiles,
      { autoAlpha: 0, y: 22, scale: 0.985 },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.42,
        ease: "power2.out",
        stagger: 0.055,
        clearProps: "all"
      }
    );
  };

  const animateMeetingShell = () => {
    if (!meetingHeaderElement || !meetingGridElement || !meetingSidebarElement || hasAnimatedShell) {
      return;
    }

    hasAnimatedShell = true;

    gsap.timeline({ defaults: { ease: "power2.out" } })
      .fromTo(
        meetingHeaderElement,
        { autoAlpha: 0, y: -18 },
        { autoAlpha: 1, y: 0, duration: 0.36, clearProps: "all" }
      )
      .fromTo(
        meetingGridElement,
        { autoAlpha: 0, y: 24 },
        { autoAlpha: 1, y: 0, duration: 0.42, clearProps: "all" },
        "-=0.18"
      )
      .fromTo(
        meetingSidebarElement,
        { autoAlpha: 0, x: 18 },
        { autoAlpha: 1, x: 0, duration: 0.38, clearProps: "all" },
        "-=0.24"
      );
  };

  const animateSidebarState = () => {
    if (!meetingBodyElement || !meetingSidebarElement) {
      return;
    }

    const nextWidth = sidebarCollapsed ? 72 : 480;

    gsap.to(meetingBodyElement, {
      duration: 0.34,
      ease: "power3.inOut",
      "--meeting-sidebar-width": `${nextWidth}px`
    });

    const tabLabels = Array.from(
      meetingSidebarElement.querySelectorAll<HTMLElement>(".panel-tab-label")
    );

    if (sidebarCollapsed) {
      if (sidebarPanelElement) {
        gsap.to(sidebarPanelElement, {
          autoAlpha: 0,
          x: 18,
          duration: 0.18,
          ease: "power2.in",
          pointerEvents: "none"
        });
      }

      if (tabLabels.length) {
        gsap.to(tabLabels, {
          autoAlpha: 0,
          x: 8,
          duration: 0.14,
          ease: "power2.in",
          stagger: 0.02
        });
      }
    } else {
      if (sidebarPanelElement) {
        gsap.fromTo(
          sidebarPanelElement,
          { autoAlpha: 0, x: 18 },
          {
            autoAlpha: 1,
            x: 0,
            duration: 0.28,
            ease: "power2.out",
            pointerEvents: "auto",
            clearProps: "pointerEvents"
          }
        );
      }

      if (tabLabels.length) {
        gsap.fromTo(
          tabLabels,
          { autoAlpha: 0, x: 8 },
          {
            autoAlpha: 1,
            x: 0,
            duration: 0.2,
            ease: "power2.out",
            stagger: 0.024
          }
        );
      }
    }
  };

  const animateSidebarPanelChange = () => {
    if (!sidebarPanelElement || sidebarCollapsed || lastAnimatedPanel === activePanel) {
      lastAnimatedPanel = activePanel;
      return;
    }

    const children = Array.from(sidebarPanelElement.children) as HTMLElement[];

    if (!children.length) {
      lastAnimatedPanel = activePanel;
      return;
    }

    lastAnimatedPanel = activePanel;

    gsap.fromTo(
      children,
      { autoAlpha: 0, y: 12 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.26,
        ease: "power2.out",
        stagger: 0.05,
        clearProps: "all"
      }
    );
  };

  const minimizeFloatingPreview = () => {
    floatingPreviewMinimized = true;
  };

  const restoreFloatingPreview = async () => {
    floatingPreviewMinimized = false;
    await tick();
  };

  const syncPreviewVideo = (element: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (!element) {
      return;
    }

    if (element.srcObject !== stream) {
      element.srcObject = stream;
    }

    if (stream) {
      void element.play().catch(() => undefined);
      return;
    }

    element.pause();
    element.srcObject = null;
  };

  $effect(() => {
    if (pageIndex > totalPages - 1) {
      pageIndex = Math.max(0, totalPages - 1);
    }
  });

  $effect(() => {
    if (!hasPositionedFloatingPreview && participantId) {
      setDefaultFloatingPreviewPosition();
    }
  });

  $effect(() => {
    localScreenShareActive;

    if (!participantId || floatingPreviewMinimized) {
      return;
    }

    tick().then(() => keepFloatingPreviewInBounds());
  });

  $effect(() => {
    syncPreviewVideo(floatingScreenVideoElement, localScreenShareStream);
  });

  $effect(() => {
    syncPreviewVideo(minimizedScreenVideoElement, localScreenShareStream);
  });

  $effect(() => {
    const observer =
      typeof ResizeObserver !== "undefined"
        ? (floatingPreviewResizeObserver ??= new ResizeObserver(() => keepFloatingPreviewInBounds()))
        : null;

    if (!observer || !floatingPreviewElement || floatingPreviewMinimized) {
      return;
    }

    const node = floatingPreviewElement;
    observer.observe(node);

    return () => {
      observer.unobserve(node);
    };
  });

  $effect(() => {
    participantId;

    if (!participantId) {
      return;
    }

    tick().then(() => {
      animateMeetingShell();
      animateParticipantTiles();
    });
  });

  $effect(() => {
    pageIndex;
    remoteMediaVersion;
    pagedParticipants.length;

    if (!participantId) {
      return;
    }

    tick().then(() => animateParticipantTiles());
  });

  $effect(() => {
    sidebarCollapsed;

    if (!meetingBodyElement || !meetingSidebarElement) {
      return;
    }

    if (lastSidebarCollapsed === sidebarCollapsed) {
      return;
    }

    lastSidebarCollapsed = sidebarCollapsed;
    tick().then(() => animateSidebarState());
  });

  $effect(() => {
    activePanel;

    if (!participantId) {
      return;
    }

    tick().then(() => animateSidebarPanelChange());
  });

  onMount(() => {
    const handleResize = () => {
      if (floatingPreviewMinimized) {
        return;
      }

      floatingPreviewPosition = clampFloatingPreview(
        floatingPreviewPosition.x,
        floatingPreviewPosition.y
      );
    };

    window.addEventListener("resize", handleResize);

    return () => {
      floatingPreviewResizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  });

  const submitChatMessage = () => {
    const nextMessage = chatDraft.trim();

    if (!nextMessage) {
      return;
    }

    onChatMessage(nextMessage);
    chatDraft = "";
  };

  const toolbarButtonBase =
    "flex min-h-12 items-center justify-center gap-2 border border-border-strong bg-accent px-4 py-3 text-sm font-medium tracking-[-0.01em] text-foreground transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45";
  const toolbarCompactButtonClass = `${toolbarButtonBase} h-10 w-10 shrink-0 px-0 py-0`;
  const panelTabClass =
    "flex min-h-14 flex-1 items-center justify-center gap-2 border-r border-border bg-panel-subtle px-4 py-4 text-sm font-medium text-muted-foreground transition last:border-r-0 hover:bg-panel hover:text-foreground";

  const getHeaderVideoWidth = (participantId: string) =>
    Math.max(48, Math.round(48 * (headerVideoAspectRatios[participantId] ?? 1)));

  const syncLocalPreviewAspectRatio = (event: Event) => {
    const video = event.currentTarget as HTMLVideoElement;

    if (!video.videoWidth || !video.videoHeight) {
      return;
    }

    localPreviewAspectRatio = video.videoWidth / video.videoHeight;
  };

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

<div class="flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground">
  <header class="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6" bind:this={meetingHeaderElement}>
    <div class="flex items-center gap-3">
      <div class="flex flex-col gap-1 text-sm">
        <span class="text-sm font-medium tracking-[-0.01em] text-foreground">{room?.meetingTitle ?? `Room: ${room?.code ?? currentCode}`}</span>
        <span class="text-xs text-subtle-foreground">
          {room?.meetingTitle
            ? `Room: ${room.code} · ${participantCount} participants`
            : `${participantCount} participants`}
        </span>
      </div>
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
            onclick={restoreFloatingPreview}
            aria-label="Restore floating camera preview"
            use:pressable
          >
            {#if mediaState === "ready"}
              <video bind:this={localVideo} autoplay muted playsinline class="h-full w-full object-cover"></video>
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
              onclick={restoreFloatingPreview}
              aria-label="Restore floating screen share preview"
              use:pressable
            >
              {#if localScreenShareStream}
                <video bind:this={minimizedScreenVideoElement} autoplay muted playsinline class="h-full w-full object-contain bg-surface"></video>
              {:else}
                <div class="flex h-full w-full items-center justify-center text-subtle-foreground">
                  <Icon icon="ph:desktop" class="shrink-0" width="16" height="16" />
                </div>
              {/if}
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
            disabled={pageIndex === 0}
            onclick={() => (pageIndex = Math.max(0, pageIndex - 1))}
            use:pressable
          >
            <Icon icon="ph:caret-left" class="shrink-0" width="16" height="16" />
          </button>
          <button
            class={toolbarCompactButtonClass}
            type="button"
            disabled={pageIndex >= totalPages - 1}
            onclick={() => (pageIndex = Math.min(totalPages - 1, pageIndex + 1))}
            use:pressable
          >
            <Icon icon="ph:caret-right" class="shrink-0" width="16" height="16" />
          </button>
        </div>
      </div>
      <button class={cn(toolbarButtonBase, isAudioMuted ? "border-destructive/35 bg-destructive-soft text-destructive-foreground" : "border-primary/70 bg-primary-soft text-foreground")} type="button" onclick={onToggleAudio} aria-label={audioStatusLabel} use:pressable>
        <Icon icon={isAudioMuted ? "ph:microphone-slash" : "ph:microphone"} width="18" height="18" />
      </button>
      <button class={cn(toolbarButtonBase, isVideoMuted ? "border-destructive/35 bg-destructive-soft text-destructive-foreground" : "border-primary/70 bg-primary-soft text-foreground")} type="button" onclick={onToggleVideo} aria-label={videoStatusLabel} use:pressable>
        <Icon icon={isVideoMuted ? "ph:video-camera-slash" : "ph:video-camera"} width="18" height="18" />
      </button>
      {#if canPublishScreen}
        <button
          class={cn(toolbarButtonBase, localScreenShareActive ? "border-primary/70 bg-primary-soft text-foreground" : "border-border-strong bg-accent text-foreground")}
          type="button"
          onclick={onToggleScreenShare}
          aria-label={localScreenShareActive ? "Stop screen share" : "Start screen share"}
          use:pressable
        >
          <Icon
            icon="ph:desktop"
            class="shrink-0"
            width="18"
            height="18"
          />
        </button>
      {/if}
      <button
        class={toolbarButtonBase}
        type="button"
        onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        use:pressable
      >
        <Icon icon={sidebarToggleIcon} width="18" height="18" />
      </button>
      <button class={cn(toolbarButtonBase, "border-destructive-strong/60 bg-destructive-strong hover:bg-destructive")} type="button" onclick={onBackHome} use:pressable>
        <Icon icon="ph:sign-out" width="18" height="18" />
        <span class="block leading-none">Leave</span>
      </button>
    </div>
  </header>

  {#if isLoadingRoom}
    <div class="flex flex-1 items-center justify-center p-8">Loading meeting…</div>
  {:else if errorMessage && !room}
    <div class="flex flex-1 items-center justify-center p-8">
      <div class="flex max-w-md flex-col gap-3 border border-border bg-panel-muted p-8 text-center">
        <strong class="text-subheading text-foreground">Unable to load this meeting.</strong>
        <p class="text-sm text-muted-foreground">{errorMessage}</p>
      </div>
    </div>
  {:else if !participantId}
    <div class="flex flex-1 items-center justify-center p-8">
      <div class="grid w-full max-w-4xl gap-12 border border-border bg-panel p-6 lg:grid-cols-[1.15fr_0.85fr] lg:p-8">
        <div class="flex items-center justify-center">
          {#if mediaState === "ready"}
            <video bind:this={localVideo} autoplay muted playsinline class="aspect-video w-full border border-border bg-surface-muted object-cover"></video>
          {:else}
            <div class="flex aspect-video w-full items-center justify-center border border-border bg-surface-muted text-sm text-subtle-foreground">Camera preview will appear here.</div>
          {/if}
        </div>

        <div class="flex flex-col justify-center gap-5">
          <h1 class="text-heading font-semibold text-foreground">Ready to join?</h1>
          <Input
            value={displayName}
            oninput={(event) => onDisplayName(event.currentTarget.value)}
            class="min-h-12 border-input bg-background-deep px-4 py-3 text-foreground placeholder:text-subtle-foreground"
            placeholder="Grace Hopper"
          />
          <div class="flex gap-2.5">
            <button class={toolbarButtonBase} type="button" onclick={onToggleAudio}>
              <Icon icon={isAudioMuted ? "ph:microphone-slash" : "ph:microphone"} width="18" height="18" />
            </button>
            <button class={toolbarButtonBase} type="button" onclick={onToggleVideo}>
              <Icon icon={isVideoMuted ? "ph:video-camera-slash" : "ph:video-camera"} width="18" height="18" />
            </button>
          </div>
          <Button class="min-h-12 w-full bg-primary px-5 py-3 text-foreground hover:bg-primary-strong" disabled={isSubmitting || !displayName.trim()} onclick={onJoinMeeting}>
            {#if submissionMode === "join"}
              <Icon icon="ph:spinner-gap" class="animate-spin" width="18" height="18" />
            {:else}
              <Icon icon="ph:door-open" width="18" height="18" />
            {/if}
            <span class="block leading-none">{submissionMode === "join" ? "Joining..." : "Join meeting"}</span>
          </Button>
          <p class="text-xs text-subtle-foreground">Room: {room?.code ?? currentCode}</p>
          {#if errorMessage}
            <p class="text-sm text-destructive-foreground">{errorMessage}</p>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <div
      class="grid min-h-0 flex-1 gap-0 overflow-hidden"
      bind:this={meetingBodyElement}
      style={`grid-template-columns: minmax(0, 1fr) var(--meeting-sidebar-width, ${sidebarCollapsed ? "72px" : "480px"}); --meeting-sidebar-width: ${sidebarCollapsed ? "72px" : "480px"};`}
    >
      <section class="flex min-h-0 min-w-0 flex-col border-r border-border">
        <div
          class={cn(
            "grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3",
            Math.max(1, Math.min(4, pagedParticipants.length || 1)) > 1 && "md:grid-cols-2"
          )}
          bind:this={meetingGridElement}
          style="grid-auto-rows: minmax(450px, 1fr);"
        >
          {#if pagedParticipants.length}
            {#each pagedParticipants as participant}
              <ParticipantTile
                {mediaSession}
                {participant}
                participantMediaState={participantMediaStates[participant.id] ?? null}
                {remoteMediaVersion}
              />
            {/each}
          {:else}
            <ParticipantTile {mediaSession} participant={null} {remoteMediaVersion} />
          {/if}
        </div>
      </section>

      <aside
        class={cn("flex min-h-0 min-w-0 flex-col overflow-hidden bg-background-elevated", sidebarCollapsed && "bg-background-deep")}
        bind:this={meetingSidebarElement}
      >
        <div class={cn("flex border-b border-border", sidebarCollapsed && "flex-col border-b-0 border-l")}>
          {#each sidebarTabs as tab}
            <button
              class={cn(panelTabClass, sidebarCollapsed && "border-b border-r-0 px-0", activePanel === tab.key && "bg-surface-strong text-foreground")}
              type="button"
              onclick={() => activateSidebarTab(tab.key)}
              aria-label={tab.label}
              use:pressable
            >
              <Icon icon={tab.icon} width="16" height="16" />
              {#if !sidebarCollapsed}
                <span class="panel-tab-label">{tab.label}</span>
              {/if}
            </button>
          {/each}
        </div>

        {#if !sidebarCollapsed}
          <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5" bind:this={sidebarPanelElement}>
            {#if activePanel === "agenda"}
              <AgendaPanel
                {collapsedAgendaPoints}
                onToggleAgendaPoint={toggleAgendaPoint}
                {room}
              />
            {:else if activePanel === "presence"}
              <PresencePanel
                {canManageParticipantAccess}
                {canModerate}
                {participantId}
                participants={room?.participants ?? []}
                {onModerateParticipantMedia}
                {onRemoveParticipant}
                {onUpdateParticipantAccess}
              />
            {:else if activePanel === "chat"}
              <ChatPanel
                {chatDraft}
                {chatMessages}
                onChatDraft={(value) => (chatDraft = value)}
                onSubmitChatMessage={submitChatMessage}
                {room}
              />
            {:else}
              <TranscriptPanel
                {room}
                {transcriptEntries}
                {activeTranscriptParticipantIds}
                {participantId}
                {transcriptionState}
              />
            {/if}
          </div>
        {/if}

      </aside>
    </div>

    {#if !floatingPreviewMinimized}
      <div
        class="fixed z-30 flex flex-col gap-3 border border-border-strong bg-background-elevated/95 p-4 backdrop-blur"
        style={`transform: translate3d(${floatingPreviewPosition.x}px, ${floatingPreviewPosition.y}px, 0); will-change: transform; transform-origin: top left;`}
        bind:this={floatingPreviewElement}
        style:box-shadow="var(--shadow-floating)"
      >
        <div class="flex items-center gap-3">
          <button
            class="flex h-9 w-9 shrink-0 cursor-grab items-center justify-center border border-border bg-panel-subtle text-muted-foreground transition hover:text-foreground active:cursor-grabbing"
            type="button"
            onpointerdown={startFloatingPreviewDrag}
            aria-label="Drag local preview"
            use:pressable
          >
            <Icon icon="ph:dots-three-outline" width="18" height="18" />
          </button>
          <div class="min-w-0">
            <strong class="block text-sm text-foreground">{localParticipant?.displayName ?? localStageName}</strong>
            <span class="text-xs uppercase tracking-[0.14em] text-subtle-foreground">{videoStatusLabel} · {audioStatusLabel}</span>
          </div>
          <button
            class="ml-auto flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-panel-subtle text-muted-foreground transition hover:text-foreground"
            type="button"
            onclick={minimizeFloatingPreview}
            aria-label="Minimize floating preview"
            use:pressable
          >
            <Icon icon="ph:arrows-in-line-horizontal" width="18" height="18" />
          </button>
        </div>

        {#if mediaState === "ready"}
          <video
            bind:this={localVideo}
            autoplay
            muted
            playsinline
            onloadedmetadata={syncLocalPreviewAspectRatio}
            class="w-[300px] bg-surface-strong object-contain"
            style={`height: ${floatingCameraPreviewHeight}px;`}
          ></video>
        {:else}
          <div
            class="flex w-[300px] items-center justify-center bg-surface-strong text-sm text-subtle-foreground"
            style={`height: ${floatingCameraPreviewHeight}px;`}
          >
            Camera unavailable
          </div>
        {/if}

        {#if localScreenShareActive}
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <strong class="text-xs uppercase tracking-[0.14em] text-subtle-foreground">Screen share</strong>
              <span class="text-[12px] text-muted-foreground">Live preview</span>
            </div>
            {#if localScreenShareStream}
              <video bind:this={floatingScreenVideoElement} autoplay muted playsinline class="h-[180px] w-full bg-surface-strong object-contain"></video>
            {:else}
              <div class="flex h-[180px] w-full items-center justify-center bg-surface-strong text-sm text-subtle-foreground">Screen share unavailable</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
