<script lang="ts">
  import { gsap } from "gsap";
  import Icon from "@iconify/svelte";
  import { Button, Input } from "@mote/ui";
  import { onMount, tick } from "svelte";
  import type {
    ChatMessageEvent,
    ParticipantMediaState,
    RoomParticipant,
    RoomSummary
  } from "@mote/models";
  import AgendaPanel from "../lib/components/meeting/agenda-panel.svelte";
  import ChatPanel from "../lib/components/meeting/chat-panel.svelte";
  import PresencePanel from "../lib/components/meeting/presence-panel.svelte";
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
    localStageName: string;
    localVideo: HTMLVideoElement | null;
    mediaSession: DemoMediaSession;
    mediaState: "idle" | "requesting" | "ready" | "blocked";
    onBackHome: () => void;
    onChatMessage: (message: string) => void;
    onDisplayName: (value: string) => void;
    onJoinMeeting: () => void;
    onModerateParticipantMedia: (
      targetParticipantId: string,
      nextState: Partial<Pick<ParticipantMediaState, "audioEnabled" | "videoEnabled">>,
      reason?: string
    ) => void;
    onRemoveParticipant: (targetParticipantId: string, reason?: string) => void;
    onRefreshMeeting: () => void;
    onToggleAudio: () => void;
    onToggleVideo: () => void;
    participantCount: number;
    participantId: string | null;
    participantMediaStates: Record<string, ParticipantMediaState>;
    remoteMediaVersion: number;
    remoteParticipants: RoomParticipant[];
    room: RoomSummary | null;
    transcriptEntries: TranscriptEntry[];
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
    localParticipant,
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
    onToggleAudio,
    onToggleVideo,
    participantCount,
    participantId,
    participantMediaStates,
    remoteMediaVersion,
    remoteParticipants,
    room,
    transcriptEntries,
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
  let headerPreviewDockElement = $state<HTMLButtonElement | null>(null);
  let statusButtonElement = $state<HTMLButtonElement | null>(null);
  let hasAnimatedShell = false;
  let lastSidebarCollapsed: boolean | null = null;
  let lastAnimatedPanel: "agenda" | "presence" | "chat" | "transcripts" | null = null;

  const pageSize = 4;
  const totalPages = $derived(Math.max(1, Math.ceil(remoteParticipants.length / pageSize)));
  const pagedParticipants = $derived(
    remoteParticipants.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize)
  );
  const pageLabel = $derived(`${pageIndex + 1}/${totalPages}`);
  const connectionLabel = $derived(
    transportState === "connected" ? "Live" : transportState === "connecting" ? "Connecting" : "Standby"
  );
  const audioStatusLabel = $derived(isAudioMuted ? "Muted" : "Mic live");
  const videoStatusLabel = $derived(isVideoMuted ? "Camera off" : "Camera live");
  const audioButtonClass = $derived(
    isAudioMuted ? "toolbar-chip toolbar-chip-inactive" : "toolbar-chip toolbar-chip-active"
  );
  const videoButtonClass = $derived(
    isVideoMuted ? "toolbar-chip toolbar-chip-inactive" : "toolbar-chip toolbar-chip-active"
  );
  const isHost = $derived(localParticipant?.role === "host");
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
    const height = 392;
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
    if (!floatingPreviewElement || !statusButtonElement) {
      floatingPreviewMinimized = true;
      return;
    }

    const sourceRect = floatingPreviewElement.getBoundingClientRect();
    const statusRect = statusButtonElement.getBoundingClientRect();
    const targetRect = {
      x: statusRect.right + 12,
      y: statusRect.top + Math.max(0, (statusRect.height - 48) / 2),
      width: 86,
      height: 48
    };

    gsap.to(floatingPreviewElement, {
      x: targetRect.x - sourceRect.x,
      y: targetRect.y - sourceRect.y,
      scaleX: targetRect.width / sourceRect.width,
      scaleY: targetRect.height / sourceRect.height,
      opacity: 0.84,
      transformOrigin: "top left",
      duration: 0.34,
      ease: "power3.inOut",
      onComplete: () => {
        gsap.set(floatingPreviewElement, { clearProps: "x,y,scaleX,scaleY,opacity" });
        floatingPreviewMinimized = true;
      }
    });
  };

  const restoreFloatingPreview = async () => {
    if (!headerPreviewDockElement) {
      floatingPreviewMinimized = false;
      return;
    }

    const dockRect = headerPreviewDockElement.getBoundingClientRect();
    floatingPreviewMinimized = false;
    await tick();

    if (!floatingPreviewElement) {
      return;
    }

    const targetRect = floatingPreviewElement.getBoundingClientRect();

    gsap.fromTo(
      floatingPreviewElement,
      {
        x: dockRect.x - targetRect.x,
        y: dockRect.y - targetRect.y,
        scaleX: dockRect.width / targetRect.width,
        scaleY: dockRect.height / targetRect.height,
        autoAlpha: 0.84,
        transformOrigin: "top left"
      },
      {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        autoAlpha: 1,
        duration: 0.36,
        ease: "power3.out",
        clearProps: "x,y,scaleX,scaleY,opacity"
      }
    );
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
</script>

<div class="meeting-shell">
  <header class="meeting-header" bind:this={meetingHeaderElement}>
    <div class="meeting-brand">
      <div class="meeting-meta">
        <span class="meeting-room-label">Room: {room?.code ?? currentCode}</span>
        <span class="meeting-subtle">{participantCount} participants</span>
      </div>
    </div>

    <div class="meeting-toolbar">
      <button
        class="toolbar-chip toolbar-chip-status"
        type="button"
        onclick={onRefreshMeeting}
        bind:this={statusButtonElement}
        use:pressable
      >
        <Icon icon="ph:arrows-clockwise" width="18" height="18" />
        <span class="button-label">{connectionLabel}</span>
      </button>
      {#if floatingPreviewMinimized}
        <button
          class="header-preview-dock"
          type="button"
          onclick={restoreFloatingPreview}
          aria-label="Restore floating preview"
          bind:this={headerPreviewDockElement}
          use:pressable
        >
          {#if mediaState === "ready"}
            <video bind:this={localVideo} autoplay muted playsinline class="header-preview-video"></video>
          {:else}
            <div class="header-preview-video header-preview-empty">
              <Icon icon="ph:video-camera-slash" width="16" height="16" />
            </div>
          {/if}
        </button>
      {/if}
      <div class="meeting-pagination">
        <span>Page {pageLabel}</span>
        <div class="meeting-pagination-controls">
          <button
            class="toolbar-chip toolbar-chip-compact"
            type="button"
            disabled={pageIndex === 0}
            onclick={() => (pageIndex = Math.max(0, pageIndex - 1))}
            use:pressable
          >
            <Icon icon="ph:caret-left" width="16" height="16" />
          </button>
          <button
            class="toolbar-chip toolbar-chip-compact"
            type="button"
            disabled={pageIndex >= totalPages - 1}
            onclick={() => (pageIndex = Math.min(totalPages - 1, pageIndex + 1))}
            use:pressable
          >
            <Icon icon="ph:caret-right" width="16" height="16" />
          </button>
        </div>
      </div>
      <button class={audioButtonClass} type="button" onclick={onToggleAudio} aria-label={audioStatusLabel} use:pressable>
        <Icon icon={isAudioMuted ? "ph:microphone-slash" : "ph:microphone"} width="18" height="18" />
      </button>
      <button class={videoButtonClass} type="button" onclick={onToggleVideo} aria-label={videoStatusLabel} use:pressable>
        <Icon icon={isVideoMuted ? "ph:video-camera-slash" : "ph:video-camera"} width="18" height="18" />
      </button>
      <button
        class="toolbar-chip"
        type="button"
        onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        use:pressable
      >
        <Icon icon={sidebarToggleIcon} width="18" height="18" />
      </button>
      <button class="toolbar-chip toolbar-chip-danger" type="button" onclick={onBackHome} use:pressable>
        <Icon icon="ph:sign-out" width="18" height="18" />
        <span class="button-label">Leave</span>
      </button>
    </div>
  </header>

  {#if isLoadingRoom}
    <div class="meeting-loading">Loading meeting…</div>
  {:else if errorMessage && !room}
    <div class="meeting-loading">
      <div class="meeting-empty-card">
        <strong>Unable to load this meeting.</strong>
        <p>{errorMessage}</p>
      </div>
    </div>
  {:else if !participantId}
    <div class="meeting-loading">
      <div class="meeting-join-panel">
        <div class="meeting-join-preview">
          {#if mediaState === "ready"}
            <video bind:this={localVideo} autoplay muted playsinline class="meeting-preview-video"></video>
          {:else}
            <div class="meeting-preview-empty">Camera preview will appear here.</div>
          {/if}
        </div>

        <div class="meeting-join-copy">
          <h1>Ready to join?</h1>
          <Input
            value={displayName}
            oninput={(event) => onDisplayName(event.currentTarget.value)}
            class="meeting-input"
            placeholder="Grace Hopper"
          />
          <div class="meeting-join-actions">
            <button class="toolbar-chip" type="button" onclick={onToggleAudio}>
              <Icon icon={isAudioMuted ? "ph:microphone-slash" : "ph:microphone"} width="18" height="18" />
            </button>
            <button class="toolbar-chip" type="button" onclick={onToggleVideo}>
              <Icon icon={isVideoMuted ? "ph:video-camera-slash" : "ph:video-camera"} width="18" height="18" />
            </button>
          </div>
          <Button class="meeting-join-button" disabled={isSubmitting || !displayName.trim()} onclick={onJoinMeeting}>
            {#if submissionMode === "join"}
              <Icon icon="ph:spinner-gap" class="animate-spin" width="18" height="18" />
            {:else}
              <Icon icon="ph:door-open" width="18" height="18" />
            {/if}
            <span class="button-label">{submissionMode === "join" ? "Joining..." : "Join meeting"}</span>
          </Button>
          <p class="meeting-subtle">Room: {room?.code ?? currentCode}</p>
          {#if errorMessage}
            <p class="meeting-inline-error">{errorMessage}</p>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <div
      class={`meeting-body ${sidebarCollapsed ? "meeting-body-sidebar-collapsed" : ""}`}
      bind:this={meetingBodyElement}
      style={`--meeting-sidebar-width: ${sidebarCollapsed ? "72px" : "480px"};`}
    >
      <section class="meeting-grid-wrap">
        <div
          class={`meeting-grid participants-${Math.max(1, Math.min(4, pagedParticipants.length || 1))}`}
          bind:this={meetingGridElement}
        >
          {#if pagedParticipants.length}
            {#each pagedParticipants as participant}
              {@const hasRemoteStream =
                remoteMediaVersion >= 0 && mediaSession.hasRemoteStream(participant.id)}
              {@const participantMediaState = participantMediaStates[participant.id] ?? null}
              <article class="participant-tile">
                {#if hasRemoteStream}
                  <video
                    autoplay
                    playsinline
                    class="participant-video"
                    use:mediaSession.bindRemoteVideo={participant.id}
                  ></video>
                {:else}
                  <div class="participant-placeholder">
                    <div class="participant-avatar">{participant.displayName.slice(0, 1).toUpperCase()}</div>
                    <p>Waiting for {participant.displayName}'s video.</p>
                  </div>
                {/if}

                <div class="participant-overlay">
                  <div class="participant-overlay-copy">
                    <span class="participant-name">{participant.displayName}</span>
                    <span class="participant-role">{participant.role}</span>
                  </div>
                  {#if participantMediaState}
                    <div class="participant-status-icons" aria-label="Participant media state">
                      <span class:participant-status-off={participantMediaState.audioEnabled === false} class="participant-status-chip">
                        <Icon
                          icon={participantMediaState.audioEnabled === false ? "ph:microphone-slash" : "ph:microphone"}
                          width="16"
                          height="16"
                        />
                      </span>
                      <span class:participant-status-off={participantMediaState.videoEnabled === false} class="participant-status-chip">
                        <Icon
                          icon={participantMediaState.videoEnabled === false ? "ph:video-camera-slash" : "ph:video-camera"}
                          width="16"
                          height="16"
                        />
                      </span>
                    </div>
                  {/if}
                </div>
              </article>
            {/each}
          {:else}
            <article class="participant-tile participant-empty">
              <div class="participant-placeholder">
                <div class="participant-avatar">+</div>
                <p>Invite another participant to populate this grid.</p>
              </div>
            </article>
          {/if}
        </div>
      </section>

      <aside class={`meeting-sidebar ${sidebarCollapsed ? "meeting-sidebar-collapsed" : ""}`} bind:this={meetingSidebarElement}>
        <div class="panel-tabs">
          {#each sidebarTabs as tab}
            <button
              class:panel-tab-active={activePanel === tab.key}
              class="panel-tab"
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
          <div class="sidebar-panel" bind:this={sidebarPanelElement}>
            {#if activePanel === "agenda"}
              <AgendaPanel
                {collapsedAgendaPoints}
                onToggleAgendaPoint={toggleAgendaPoint}
                {room}
              />
            {:else if activePanel === "presence"}
              <PresencePanel
                isHost={isHost}
                {participantId}
                participants={room?.participants ?? []}
                {onModerateParticipantMedia}
                {onRemoveParticipant}
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
              <TranscriptPanel {room} {transcriptEntries} />
            {/if}
          </div>
        {/if}

      </aside>
    </div>

    {#if !floatingPreviewMinimized}
      <div
        class="floating-preview"
        style={`transform: translate3d(${floatingPreviewPosition.x}px, ${floatingPreviewPosition.y}px, 0);`}
        bind:this={floatingPreviewElement}
      >
        <div class="floating-preview-head">
          <button
            class="floating-preview-drag"
            type="button"
            onpointerdown={startFloatingPreviewDrag}
            aria-label="Drag local preview"
            use:pressable
          >
            <Icon icon="ph:dots-three-outline" width="18" height="18" />
          </button>
          <div class="floating-preview-copy">
            <strong>{localParticipant?.displayName ?? localStageName}</strong>
            <span>{videoStatusLabel} · {audioStatusLabel}</span>
          </div>
          <button
            class="floating-preview-minimize"
            type="button"
            onclick={minimizeFloatingPreview}
            aria-label="Minimize floating preview"
            use:pressable
          >
            <Icon icon="ph:arrows-in-line-horizontal" width="18" height="18" />
          </button>
        </div>

        {#if mediaState === "ready"}
          <video bind:this={localVideo} autoplay muted playsinline class="floating-preview-video"></video>
        {:else}
          <div class="floating-preview-video floating-preview-empty">Camera unavailable</div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
