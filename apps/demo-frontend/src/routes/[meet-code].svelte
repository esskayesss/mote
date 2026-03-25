<script lang="ts">
  import Icon from "@iconify/svelte";
  import { Button, Input } from "@mote/ui";
  import type {
    AgendaArtifactPoint,
    AgendaArtifactSubtopic,
    AgendaExecutionStatus,
    ChatMessageEvent,
    ParticipantMediaState,
    RoomParticipant,
    RoomSummary
  } from "@mote/models";
  import type { DemoMediaSession } from "../lib/media/session";

  interface TranscriptEntry {
    id: string;
    text: string;
    speakerParticipantId: string | null;
    speakerDisplayName: string | null;
    createdAt: string;
    isPartial: boolean;
  }

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

  const getAgendaStatusIcon = (status: AgendaExecutionStatus | undefined) => {
    switch (status) {
      case "completed":
        return "ph:check-circle";
      case "active":
        return "ph:play-circle";
      default:
        return "ph:circle-dashed";
    }
  };

  const getAgendaStatusClass = (status: AgendaExecutionStatus | undefined) => {
    switch (status) {
      case "completed":
        return "agenda-entry-status agenda-entry-status-completed";
      case "active":
        return "agenda-entry-status agenda-entry-status-active";
      default:
        return "agenda-entry-status agenda-entry-status-pending";
    }
  };

  const getAgendaLabel = (kind: "topic" | "subtopic", order: number) =>
    kind === "topic" ? `${order}.` : `${String.fromCharCode(64 + order)}.`;

  const toggleAgendaPoint = (pointId: string) => {
    collapsedAgendaPoints = {
      ...collapsedAgendaPoints,
      [pointId]: !collapsedAgendaPoints[pointId]
    };
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

  const submitChatMessage = () => {
    const nextMessage = chatDraft.trim();

    if (!nextMessage) {
      return;
    }

    onChatMessage(nextMessage);
    chatDraft = "";
  };
</script>

{#snippet agendaEntryRow(
  item: AgendaArtifactPoint | AgendaArtifactSubtopic,
  kind: "topic" | "subtopic",
  collapsed = false
)}
  <div class={`agenda-entry ${kind === "subtopic" ? "agenda-entry-subtopic" : ""}`}>
    {#if kind === "topic"}
      <button
        class="agenda-entry-toggle"
        type="button"
        onclick={() => toggleAgendaPoint(item.id)}
        aria-label={collapsed ? "Expand topic" : "Collapse topic"}
      >
        <Icon icon={collapsed ? "ph:caret-right" : "ph:caret-down"} width="16" height="16" />
      </button>
    {:else}
      <div class="agenda-entry-toggle agenda-entry-toggle-spacer"></div>
    {/if}

    <span class="agenda-entry-index">{getAgendaLabel(kind, item.order)}</span>
    <span class={getAgendaStatusClass(item.status)}>
      <Icon icon={getAgendaStatusIcon(item.status)} width="16" height="16" />
    </span>
    <div class="agenda-entry-copy">
      <strong>{item.title}</strong>
    </div>
  </div>
{/snippet}

<div class="meeting-shell">
  <header class="meeting-header">
    <div class="meeting-brand">
      <div class="meeting-meta">
        <span class="meeting-room-label">Room: {room?.code ?? currentCode}</span>
        <span class="meeting-subtle">{participantCount} participants</span>
      </div>
    </div>

    <div class="meeting-toolbar">
      <button class="toolbar-chip toolbar-chip-status" type="button" onclick={onRefreshMeeting}>
        <Icon icon="ph:arrows-clockwise" width="18" height="18" />
        <span class="button-label">{connectionLabel}</span>
      </button>
      {#if floatingPreviewMinimized}
        <button
          class="header-preview-dock"
          type="button"
          onclick={() => (floatingPreviewMinimized = false)}
          aria-label="Restore floating preview"
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
          >
            <Icon icon="ph:caret-left" width="16" height="16" />
          </button>
          <button
            class="toolbar-chip toolbar-chip-compact"
            type="button"
            disabled={pageIndex >= totalPages - 1}
            onclick={() => (pageIndex = Math.min(totalPages - 1, pageIndex + 1))}
          >
            <Icon icon="ph:caret-right" width="16" height="16" />
          </button>
        </div>
      </div>
      <button class={audioButtonClass} type="button" onclick={onToggleAudio} aria-label={audioStatusLabel}>
        <Icon icon={isAudioMuted ? "ph:microphone-slash" : "ph:microphone"} width="18" height="18" />
      </button>
      <button class={videoButtonClass} type="button" onclick={onToggleVideo} aria-label={videoStatusLabel}>
        <Icon icon={isVideoMuted ? "ph:video-camera-slash" : "ph:video-camera"} width="18" height="18" />
      </button>
      <button
        class="toolbar-chip"
        type="button"
        onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <Icon icon={sidebarToggleIcon} width="18" height="18" />
      </button>
      <button class="toolbar-chip toolbar-chip-danger" type="button" onclick={onBackHome}>
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
    <div class={`meeting-body ${sidebarCollapsed ? "meeting-body-sidebar-collapsed" : ""}`}>
      <section class="meeting-grid-wrap">
        <div class={`meeting-grid participants-${Math.max(1, Math.min(4, pagedParticipants.length || 1))}`}>
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

      <aside class={`meeting-sidebar ${sidebarCollapsed ? "meeting-sidebar-collapsed" : ""}`}>
        <div class="panel-tabs">
          {#each sidebarTabs as tab}
            <button
              class:panel-tab-active={activePanel === tab.key}
              class="panel-tab"
              type="button"
              onclick={() => (activePanel = tab.key)}
              aria-label={tab.label}
            >
              <Icon icon={tab.icon} width="16" height="16" />
              {#if !sidebarCollapsed}
                <span>{tab.label}</span>
              {/if}
            </button>
          {/each}
        </div>

        {#if !sidebarCollapsed}
          <div class="sidebar-panel">
            {#if activePanel === "agenda"}
            {#if room?.agendaArtifact?.points?.length}
              <div class="sidebar-list">
                {#each room.agendaArtifact.points as point}
                  <div class="agenda-group">
                    {@render agendaEntryRow(point, "topic", collapsedAgendaPoints[point.id] ?? false)}
                    {#if !(collapsedAgendaPoints[point.id] ?? false) && point.subtopics.length}
                      <div class="agenda-group-children">
                        {#each point.subtopics as subtopic}
                          {@render agendaEntryRow(subtopic, "subtopic")}
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else if room?.agenda?.length}
              <div class="sidebar-list">
                {#each room.agenda as topic, index}
                  <div class="agenda-entry">
                    <div class="agenda-entry-toggle agenda-entry-toggle-spacer"></div>
                    <span class="agenda-entry-index">{index + 1}.</span>
                    <span class="agenda-entry-status agenda-entry-status-pending">
                      <Icon icon="ph:circle-dashed" width="16" height="16" />
                    </span>
                    <div class="agenda-entry-copy">
                      <strong>{topic}</strong>
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="sidebar-empty">
                <strong>No agenda set</strong>
                <p>This meeting has no agenda source of truth yet.</p>
              </div>
            {/if}
            {:else if activePanel === "presence"}
            <div class="sidebar-presence">
              {#each room?.participants ?? [] as participant}
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
                            onModerateParticipantMedia(
                              participant.id,
                              { audioEnabled: false },
                              "Muted by host"
                            )}
                        >
                          <Icon icon="ph:microphone-slash" width="16" height="16" />
                        </button>
                        <button
                          class="toolbar-chip toolbar-chip-compact"
                          type="button"
                          onclick={() =>
                            onModerateParticipantMedia(
                              participant.id,
                              { videoEnabled: false },
                              "Camera paused by host"
                            )}
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
            {:else if activePanel === "chat"}
            <div class="sidebar-chat">
              {#if chatMessages.length}
                <div class="sidebar-chat-list">
                  {#each chatMessages as event}
                    <div class="sidebar-chat-row">
                      <strong>{room?.participants.find((participant) => participant.id === event.actorParticipantId)?.displayName ?? "Participant"}</strong>
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
                  oninput={(event) => (chatDraft = event.currentTarget.value)}
                  class="meeting-input"
                  placeholder="Send a message to the room"
                />
                <Button class="meeting-join-button" onclick={submitChatMessage}>Send</Button>
              </div>
            </div>
            {:else}
            {#if transcriptEntries.length}
              <div class="sidebar-transcript-list">
                {#each transcriptEntries as entry}
                  <div class:sidebar-transcript-partial={entry.isPartial} class="sidebar-chat-row">
                    <strong>
                      {entry.speakerDisplayName ??
                        room?.participants.find((participant) => participant.id === entry.speakerParticipantId)?.displayName ??
                        "Participant"}
                    </strong>
                    <p>{entry.text}</p>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="sidebar-empty">
                <strong>No transcript yet</strong>
                <p>Finalized transcript segments will land here once the transcription pipeline starts publishing events.</p>
              </div>
            {/if}
            {/if}
          </div>
        {/if}

      </aside>
    </div>

    {#if !floatingPreviewMinimized}
      <div
        class="floating-preview"
        style={`transform: translate3d(${floatingPreviewPosition.x}px, ${floatingPreviewPosition.y}px, 0);`}
      >
        <div class="floating-preview-head">
          <button
            class="floating-preview-drag"
            type="button"
            onpointerdown={startFloatingPreviewDrag}
            aria-label="Drag local preview"
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
            onclick={() => (floatingPreviewMinimized = true)}
            aria-label="Minimize floating preview"
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
