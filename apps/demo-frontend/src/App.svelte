<script lang="ts">
  import "./app.css";
  import { onMount } from "svelte";
  import {
    DEFAULT_AGENDA_TOPICS,
    type ChatMessageEvent,
    type CreateRoomResponse,
    type JoinRoomResponse,
    type MeetingEvent,
    type ParticipantAuthorityRole,
    type ParticipantMediaCapabilities,
    type ParticipantMediaState,
    type RoomSummary,
    type TranscriptionProvider,
    type TranscriptionProviderStatusResponse
  } from "@mote/models";
  import { createRoomsApi } from "./lib/api/rooms";
  import { DemoMeetingEventsClient } from "./lib/events/client";
  import { logger } from "./lib/logger";
  import { DemoMediaSession } from "./lib/media/session";
  import {
    applyAgendaUpdated,
    applyMeetingSnapshotState,
    createTranscriptEntryFromEvent,
    removeLiveTranscriptEntry,
    removeParticipantFromRoom,
    removeParticipantMediaStateRecord,
    setParticipantMediaStateRecord,
    upsertParticipantInRoom
  } from "./lib/meeting/state";
  import { collapseTranscriptEntries } from "./lib/meeting/transcript";
  import type { TranscriptEntry } from "./lib/meeting/types";
  import { DemoTranscriptionSession } from "./lib/transcription/session";
  import { meetingCodeFromPathname, normalizePathname } from "./lib/router";
  import { participantStorageKey, savedNameKey } from "./lib/storage";
  import HomeRoute from "./routes/index.svelte";
  import MeetingRoute from "./routes/[meet-code].svelte";

  const backendUrl =
    (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "https://joi.thrush-dab.ts.net:3001";
  const websocketBaseUrl = backendUrl.replace(/^http/, "ws");
  const roomsApi = createRoomsApi(backendUrl);
  const TRANSCRIPT_ACTIVITY_WINDOW_MS = 6000;
  const transcriptActivityTimeoutIds = new Map<string, ReturnType<typeof setTimeout>>();

  let pathname = $state("/");
  let displayName = $state("");
  let transcriptionProvider = $state<TranscriptionProvider>("whisperlive");
  let meetingTitleInput = $state("");
  let joinCode = $state("");
  let agendaInput = $state("");
  let endMeetingOnHostExit = $state(true);
  let room = $state<RoomSummary | null>(null);
  let participantId = $state<string | null>(null);
  let isSubmitting = $state(false);
  let submissionMode = $state<"create" | "join" | null>(null);
  let isLoadingRoom = $state(false);
  let errorMessage = $state("");
  let localStream = $state<MediaStream | null>(null);
  let rtcIceServers = $state<RTCIceServer[]>([]);
  let isAudioMuted = $state(false);
  let isVideoMuted = $state(false);
  let mediaState = $state<"idle" | "requesting" | "ready" | "blocked">("idle");
  let transportState = $state<"idle" | "connecting" | "connected" | "error">("idle");
  let localVideo = $state<HTMLVideoElement | null>(null);
  let remoteMediaVersion = $state(0);
  let participantMediaStates = $state<Record<string, ParticipantMediaState>>({});
  let chatMessages = $state<ChatMessageEvent[]>([]);
  let transcriptEntries = $state<TranscriptEntry[]>([]);
  let liveTranscriptEntries = $state<Record<string, TranscriptEntry>>({});
  let activeTranscriptParticipantIds = $state<string[]>([]);
  let eventsConnectionState = $state<"idle" | "connecting" | "connected" | "error">("idle");
  let transcriptionState = $state<"idle" | "connecting" | "connected" | "error">("idle");
  let transcriptionProviderStatuses = $state<TranscriptionProviderStatusResponse["providers"]>({
    none: {
      label: "Disabled",
      available: true,
      reason: "Transcription disabled for the room."
    },
    whisperlive: {
      label: "WhisperLive",
      available: false,
      reason: "Checking availability..."
    },
    sarvam: {
      label: "Sarvam Saaras v3",
      available: false,
      reason: "Checking availability..."
    }
  });
  let transcriptionConfig = $state<{
    url: string;
    provider: TranscriptionProvider;
    sampleRate: number;
    language: string;
    model: string;
  } | null>(null);

  const mediaSession = new DemoMediaSession(
    websocketBaseUrl,
    (state) => {
      transportState = state;
    },
    (message) => {
      errorMessage = message;
    },
    () => {
      remoteMediaVersion += 1;
    }
  );
  const eventsClient = new DemoMeetingEventsClient(
    websocketBaseUrl,
    (snapshot) => applyMeetingSnapshot(snapshot),
    (event) => applyMeetingEvent(event),
    (state) => {
      eventsConnectionState = state;
    },
    (message) => {
      errorMessage = message;
    }
  );
  const transcriptionSession = new DemoTranscriptionSession(
    (state) => {
      transcriptionState = state;
    },
    (message) => {
      errorMessage = message;
    }
  );

  const currentCode = $derived(meetingCodeFromPathname(pathname));
  const isHomeRoute = $derived(pathname === "/");
  const agendaItems = $derived(
    agendaInput
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
  );
  const localParticipant = $derived(
    room?.participants.find((candidate) => candidate.id === participantId) ?? null
  );
  const localStageName = $derived((localParticipant?.displayName ?? displayName) || "You");
  const remoteParticipants = $derived(
    room?.participants.filter((candidate) => candidate.id !== participantId) ?? room?.participants ?? []
  );
  const participantCount = $derived(room?.participants.length ?? 0);
  const canModerate = $derived(
    localParticipant?.authorityRole === "host" || localParticipant?.authorityRole === "admin"
  );
  const canManageParticipantAccess = $derived(localParticipant?.authorityRole === "host");
  const canPublishScreen = $derived(localParticipant?.mediaCapabilities.publishScreen ?? false);
  const readyToCreate = $derived(displayName.trim().length > 0 && agendaItems.length > 0);
  const readyToJoin = $derived(displayName.trim().length > 0 && joinCode.trim().length > 0);
  const eventBackedParticipantMediaStates = $derived(participantMediaStates);
  const renderedTranscriptEntries = $derived(
    collapseTranscriptEntries(
      [...transcriptEntries, ...Object.values(liveTranscriptEntries)].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt)
      )
    )
  );

  const clearTranscriptParticipantActivity = (targetParticipantId: string) => {
    const timeoutId = transcriptActivityTimeoutIds.get(targetParticipantId);

    if (timeoutId) {
      clearTimeout(timeoutId);
      transcriptActivityTimeoutIds.delete(targetParticipantId);
    }

    activeTranscriptParticipantIds = activeTranscriptParticipantIds.filter(
      (participantId) => participantId !== targetParticipantId
    );
  };

  const markTranscriptParticipantActive = (targetParticipantId: string) => {
    if (!activeTranscriptParticipantIds.includes(targetParticipantId)) {
      activeTranscriptParticipantIds = [...activeTranscriptParticipantIds, targetParticipantId];
    }

    const existingTimeoutId = transcriptActivityTimeoutIds.get(targetParticipantId);

    if (existingTimeoutId) {
      clearTimeout(existingTimeoutId);
    }

    const timeoutId = setTimeout(() => {
      transcriptActivityTimeoutIds.delete(targetParticipantId);
      activeTranscriptParticipantIds = activeTranscriptParticipantIds.filter(
        (participantId) => participantId !== targetParticipantId
      );
    }, TRANSCRIPT_ACTIVITY_WINDOW_MS);

    transcriptActivityTimeoutIds.set(targetParticipantId, timeoutId);
  };

  const clearAllTranscriptParticipantActivity = () => {
    for (const timeoutId of transcriptActivityTimeoutIds.values()) {
      clearTimeout(timeoutId);
    }

    transcriptActivityTimeoutIds.clear();
    activeTranscriptParticipantIds = [];
  };

  const sendMeetingAction = (action: Parameters<typeof eventsClient.send>[0]) => {
    try {
      eventsClient.send(action);
    } catch (error) {
      logger.warn("events.send_skipped", { action: action.action, error });
    }
  };

  const updateParticipantAccess = (
    targetParticipantId: string,
    input: {
      authorityRole?: ParticipantAuthorityRole;
      isPresenter?: boolean;
      mediaCapabilities?: Partial<ParticipantMediaCapabilities>;
    }
  ) => {
    sendMeetingAction({
      action: "moderation.update_participant_access",
      targetParticipantId,
      ...input
    });
  };

  const applyMeetingSnapshot = (snapshot: Parameters<typeof applyMeetingSnapshotState>[0]) => {
    const nextState = applyMeetingSnapshotState(snapshot);
    room = nextState.room;
    mediaSession.pruneRemoteStreams(snapshot.room.participants.map((participant) => participant.id));
    participantMediaStates = nextState.participantMediaStates;
    chatMessages = nextState.chatMessages;
    transcriptEntries = nextState.transcriptEntries;
    liveTranscriptEntries = {};
    clearAllTranscriptParticipantActivity();
  };

  const applyMeetingEvent = (event: MeetingEvent) => {
    switch (event.type) {
      case "presence.joined": {
        if (!room) {
          break;
        }

        room = upsertParticipantInRoom(room, event.payload.participant);
        break;
      }

      case "participant.updated": {
        if (!room) {
          break;
        }

        room = upsertParticipantInRoom(room, event.payload.participant);
        break;
      }

      case "presence.left":
      case "moderation.participant_removed": {
        if (!room) {
          break;
        }

        const nextParticipantId =
          event.type === "presence.left" ? event.payload.participantId : event.payload.participantId;

        room = removeParticipantFromRoom(room, nextParticipantId);
        participantMediaStates = removeParticipantMediaStateRecord(
          participantMediaStates,
          nextParticipantId
        );
        liveTranscriptEntries = removeLiveTranscriptEntry(liveTranscriptEntries, nextParticipantId);
        clearTranscriptParticipantActivity(nextParticipantId);
        mediaSession.pruneRemoteStreams(room.participants.map((participant) => participant.id));

        if (event.type === "moderation.participant_removed" && nextParticipantId === participantId) {
          errorMessage = "You were removed from the meeting by the host.";
          leaveMeeting();
        }
        break;
      }

      case "agenda.updated": {
        if (room) {
          room = applyAgendaUpdated(room, event.payload.agenda, event.payload.agendaArtifact ?? null);
        }
        break;
      }

      case "chat.message": {
        chatMessages = [...chatMessages, event];
        break;
      }

      case "participant.media_state":
      case "moderation.media_state_changed": {
        participantMediaStates = setParticipantMediaStateRecord(participantMediaStates, {
          participantId: event.payload.participantId,
          audioEnabled: event.payload.audioEnabled,
          videoEnabled: event.payload.videoEnabled,
          screenEnabled: event.payload.screenEnabled ?? false
        });

        if (event.payload.participantId === participantId && localStream) {
          const audioTrack = localStream.getAudioTracks()[0];
          const videoTrack = localStream.getVideoTracks()[0];

          if (audioTrack) {
            audioTrack.enabled = event.payload.audioEnabled;
            isAudioMuted = !event.payload.audioEnabled;
          }

          if (videoTrack) {
            videoTrack.enabled = event.payload.videoEnabled;
            isVideoMuted = !event.payload.videoEnabled;
          }

          if (event.payload.screenEnabled === false && mediaSession.isScreenShareActive()) {
            void mediaSession.stopScreenShare();
          }
        }
        break;
      }

      case "transcript.final": {
        const transcriptEntry = createTranscriptEntryFromEvent(event);
        transcriptEntries = [...transcriptEntries, transcriptEntry];

        const speakerParticipantId =
          event.payload.speakerParticipantId ?? event.actorParticipantId ?? null;

        if (speakerParticipantId) {
          markTranscriptParticipantActive(speakerParticipantId);
          liveTranscriptEntries = removeLiveTranscriptEntry(
            liveTranscriptEntries,
            speakerParticipantId
          );
        }
        break;
      }

      case "transcript.partial": {
        const speakerParticipantId = event.payload.speakerParticipantId ?? event.actorParticipantId ?? null;

        if (!speakerParticipantId) {
          break;
        }

        markTranscriptParticipantActive(speakerParticipantId);
        liveTranscriptEntries = {
          ...liveTranscriptEntries,
          [speakerParticipantId]: createTranscriptEntryFromEvent(event)
        };
        break;
      }

      case "meeting.ended": {
        errorMessage = event.payload.reason;
        leaveMeeting();
        break;
      }
    }
  };

  const updatePathname = () => {
    pathname = normalizePathname(window.location.pathname);
  };

  const navigateTo = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }

    updatePathname();
  };

  const persistDisplayName = () => {
    if (displayName.trim()) {
      localStorage.setItem(savedNameKey, displayName.trim());
    }
  };

  const persistParticipant = (code: string, nextParticipantId: string) => {
    localStorage.setItem(participantStorageKey(code), nextParticipantId);
  };

  const syncRoom = async (code: string) => {
    const storedParticipantId = localStorage.getItem(participantStorageKey(code));
    const requestedParticipantId = storedParticipantId ?? participantId;
    const data = await roomsApi.loadRoom(code, requestedParticipantId);
    room = data.room;
    rtcIceServers = DemoMediaSession.toRtcIceServers(data.ice.servers);
    transcriptionConfig = data.transcription;

    if (storedParticipantId && data.room.participants.some((participant) => participant.id === storedParticipantId)) {
      participantId = storedParticipantId;
    } else if (participantId && data.room.participants.some((participant) => participant.id === participantId)) {
      participantId = participantId;
    } else {
      participantId = null;
    }

    mediaSession.pruneRemoteStreams((data.room.participants ?? []).map((participant) => participant.id));
  };

  const activateLocalMedia = async () => {
    if (localStream || mediaState === "requesting") {
      return localStream;
    }

    try {
      mediaState = "requesting";
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        }
      });
      localStream = stream;
      isAudioMuted = false;
      isVideoMuted = false;
      mediaState = "ready";
      return stream;
    } catch (error) {
      logger.error("media.local_access_failed", { error });
      mediaState = "blocked";
      errorMessage = "Camera or microphone access was blocked. Allow browser permissions to continue.";
      return null;
    }
  };

  const attachParticipant = async (
    request: Promise<CreateRoomResponse | JoinRoomResponse>,
    mode: "create" | "join"
  ) => {
    isSubmitting = true;
    submissionMode = mode;
    errorMessage = "";

    try {
      const data = await request;
      room = data.room;
      participantId = data.participantId;
      rtcIceServers = DemoMediaSession.toRtcIceServers(data.ice.servers);
      transcriptionConfig = data.transcription;
      joinCode = data.room.code;
      persistDisplayName();
      persistParticipant(data.room.code, data.participantId);
      const stream = await activateLocalMedia();

      if (stream) {
        await transcriptionSession.connect(
          data.transcription.url,
          data.room.code,
          data.participantId,
          stream,
          data.transcription.sampleRate
        );
      }

      navigateTo(`/${data.room.code}`);

      if (mode === "create") {
        meetingTitleInput = data.room.meetingTitle ?? meetingTitleInput;
        transcriptionProvider = data.room.transcriptionProvider;
        agendaInput = data.room.agenda.join("\n");
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to enter the meeting.";
    } finally {
      isSubmitting = false;
      submissionMode = null;
    }
  };

  const createMeeting = async () =>
    attachParticipant(
      roomsApi.createRoom(displayName, meetingTitleInput, transcriptionProvider, agendaItems, {
        endMeetingOnHostExit
      }),
      "create"
    );

  const joinMeeting = async (code = joinCode) =>
    attachParticipant(roomsApi.joinRoom(code, displayName), "join");

  const resetMedia = () => {
    eventsClient.close();
    mediaSession.close();
    transcriptionSession.close();
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    isAudioMuted = false;
    isVideoMuted = false;
    mediaState = "idle";
    participantMediaStates = {};
    chatMessages = [];
    transcriptEntries = [];
    liveTranscriptEntries = {};
    clearAllTranscriptParticipantActivity();
  };

  const toggleAudio = () => {
    const track = localStream?.getAudioTracks()[0];

    if (!track) {
      return;
    }

    track.enabled = !track.enabled;
    isAudioMuted = !track.enabled;
    if (participantId) {
      participantMediaStates = setParticipantMediaStateRecord(participantMediaStates, {
        participantId,
        audioEnabled: localStream?.getAudioTracks()[0]?.enabled ?? false,
        videoEnabled: localStream?.getVideoTracks()[0]?.enabled ?? false,
        screenEnabled: mediaSession.isScreenShareActive()
      });
    }
    sendMeetingAction({
      action: "participant.media_state",
      audioEnabled: localStream?.getAudioTracks()[0]?.enabled ?? false,
      videoEnabled: localStream?.getVideoTracks()[0]?.enabled ?? false,
      screenEnabled: mediaSession.isScreenShareActive()
    });
  };

  const toggleVideo = () => {
    const track = localStream?.getVideoTracks()[0];

    if (!track) {
      return;
    }

    track.enabled = !track.enabled;
    isVideoMuted = !track.enabled;
    if (participantId) {
      participantMediaStates = setParticipantMediaStateRecord(participantMediaStates, {
        participantId,
        audioEnabled: localStream?.getAudioTracks()[0]?.enabled ?? false,
        videoEnabled: localStream?.getVideoTracks()[0]?.enabled ?? false,
        screenEnabled: mediaSession.isScreenShareActive()
      });
    }
    sendMeetingAction({
      action: "participant.media_state",
      audioEnabled: localStream?.getAudioTracks()[0]?.enabled ?? false,
      videoEnabled: localStream?.getVideoTracks()[0]?.enabled ?? false,
      screenEnabled: mediaSession.isScreenShareActive()
    });
  };

  const sendChatMessage = (message: string) => {
    sendMeetingAction({
      action: "chat.send",
      message
    });
  };

  const moderateParticipantMedia = (
    targetParticipantId: string,
    nextState: Partial<Pick<ParticipantMediaState, "audioEnabled" | "videoEnabled" | "screenEnabled">>,
    reason?: string
  ) => {
    sendMeetingAction({
      action: "moderation.set_media_state",
      targetParticipantId,
      audioEnabled: nextState.audioEnabled,
      videoEnabled: nextState.videoEnabled,
      screenEnabled: nextState.screenEnabled,
      reason
    });
  };

  const toggleScreenShare = async () => {
    try {
      if (mediaSession.isScreenShareActive()) {
        await mediaSession.stopScreenShare();
      } else {
        await mediaSession.startScreenShare();
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to toggle screen share.";
    }
  };

  const removeParticipantFromMeeting = (targetParticipantId: string, reason?: string) => {
    sendMeetingAction({
      action: "moderation.remove_participant",
      targetParticipantId,
      reason
    });
  };

  const leaveMeeting = () => {
    const code = currentCode;
    const activeParticipantId = participantId;

    if (code && activeParticipantId) {
      void roomsApi.leaveRoom(code, activeParticipantId);
      localStorage.removeItem(participantStorageKey(code));
    }

    resetMedia();
    room = null;
    participantId = null;
    errorMessage = "";
    rtcIceServers = [];
    navigateTo("/");
  };

  const refreshMeeting = () => {
    if (currentCode) {
      void syncRoom(currentCode);
    }
  };

  const loadMeeting = async (code: string) => {
    isLoadingRoom = true;
    errorMessage = "";

    try {
      await syncRoom(code);
    } catch (error) {
      room = null;
      participantId = null;
      errorMessage = error instanceof Error ? error.message : "Unable to load the meeting.";
    } finally {
      isLoadingRoom = false;
    }
  };

  $effect(() => {
    if (localVideo && localStream) {
      localVideo.srcObject = localStream;
      void localVideo.play().catch(() => undefined);
    }
  });

  $effect(() => {
    if (!currentCode || isHomeRoute) {
      return;
    }

    void loadMeeting(currentCode);
  });

  $effect(() => {
    if (!isHomeRoute || localStream || mediaState === "requesting" || mediaState === "blocked") {
      return;
    }

    void activateLocalMedia();
  });

  $effect(() => {
    if (isHomeRoute || !currentCode || localStream || mediaState === "requesting" || mediaState === "blocked") {
      return;
    }

    void activateLocalMedia();
  });

  $effect(() => {
    if (!currentCode || !participantId || !localStream) {
      return;
    }

    void mediaSession.connect(currentCode, participantId, localStream, rtcIceServers);
  });

  $effect(() => {
    if (transcriptionConfig?.provider === "none") {
      transcriptionSession.close();
      return;
    }
  });

  $effect(() => {
    if (
      !currentCode ||
      !participantId ||
      !localStream ||
      !transcriptionConfig ||
      transcriptionConfig.provider === "none"
    ) {
      return;
    }

    void transcriptionSession.connect(
      transcriptionConfig.url,
      currentCode,
      participantId,
      localStream,
      transcriptionConfig.sampleRate
    );
  });

  $effect(() => {
    if (!currentCode || !participantId) {
      return;
    }

    void eventsClient.connect(currentCode, participantId);
  });

  $effect(() => {
    if (!participantId || !localStream || eventsConnectionState !== "connected") {
      return;
    }

    sendMeetingAction({
      action: "participant.media_state",
      audioEnabled: localStream.getAudioTracks()[0]?.enabled ?? false,
      videoEnabled: localStream.getVideoTracks()[0]?.enabled ?? false,
      screenEnabled: mediaSession.isScreenShareActive()
    });
  });

  onMount(() => {
    updatePathname();

    const savedName = localStorage.getItem(savedNameKey);
    if (savedName) {
      displayName = savedName;
    }

    const onPopState = () => updatePathname();
    const onBeforeUnload = () => {
      const code = meetingCodeFromPathname(window.location.pathname);
      const activeParticipantId = localStorage.getItem(participantStorageKey(code ?? ""));

      if (!code || !activeParticipantId) {
        return;
      }

      navigator.sendBeacon(
        `${backendUrl}/rooms/${code}/leave`,
        new Blob([JSON.stringify({ participantId: activeParticipantId })], {
          type: "application/json"
        })
      );
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);
    void roomsApi
      .loadTranscriptionProviderStatuses()
      .then((status) => {
        transcriptionProviderStatuses = status.providers;
      })
      .catch((error) => {
        logger.warn("transcription.provider_status_failed", { error });
      });

    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
      resetMedia();
    };
  });
</script>

<svelte:head>
  <title>{isHomeRoute ? "Mote" : `${room?.meetingTitle ?? currentCode} · Mote`}</title>
  <meta
    name="description"
    content="Meeting bootstrap and room surface for the Mote orchestration demo."
  />
</svelte:head>

{#if isHomeRoute}
  <HomeRoute
    agendaInput={agendaInput}
    bind:localVideo
    displayName={displayName}
    endMeetingOnHostExit={endMeetingOnHostExit}
    errorMessage={errorMessage}
    isAudioMuted={isAudioMuted}
    isSubmitting={isSubmitting}
    isVideoMuted={isVideoMuted}
    mediaState={mediaState}
    meetingTitle={meetingTitleInput}
    transcriptionProvider={transcriptionProvider}
    transcriptionProviderStatuses={transcriptionProviderStatuses}
    submissionMode={submissionMode}
    joinCode={joinCode}
    onAgendaInput={(value) => (agendaInput = value)}
    onCreateMeeting={() => void createMeeting()}
    onDisplayName={(value) => (displayName = value)}
    onEndMeetingOnHostExit={(value) => (endMeetingOnHostExit = value)}
    onMeetingTitle={(value) => (meetingTitleInput = value)}
    onTranscriptionProvider={(value) => (transcriptionProvider = value)}
    onJoinCode={(value) => (joinCode = value)}
    onJoinMeeting={() => void joinMeeting()}
    onToggleAudio={toggleAudio}
    onToggleVideo={toggleVideo}
    readyToCreate={readyToCreate}
    readyToJoin={readyToJoin}
  />
{:else}
  <MeetingRoute
    bind:localVideo
    currentCode={currentCode}
    displayName={displayName}
    errorMessage={errorMessage}
    isLoadingRoom={isLoadingRoom}
    isSubmitting={isSubmitting}
    submissionMode={submissionMode}
    localParticipant={localParticipant}
    localStageName={localStageName}
    isAudioMuted={isAudioMuted}
    mediaSession={mediaSession}
    mediaState={mediaState}
    isVideoMuted={isVideoMuted}
    onBackHome={leaveMeeting}
    onChatMessage={sendChatMessage}
    onDisplayName={(value) => (displayName = value)}
    onJoinMeeting={() => void joinMeeting(currentCode ?? "")}
    onModerateParticipantMedia={moderateParticipantMedia}
    onRemoveParticipant={removeParticipantFromMeeting}
    onRefreshMeeting={refreshMeeting}
    onToggleScreenShare={() => void toggleScreenShare()}
    onUpdateParticipantAccess={updateParticipantAccess}
    onToggleAudio={toggleAudio}
    onToggleVideo={toggleVideo}
    canManageParticipantAccess={canManageParticipantAccess}
    canModerate={canModerate}
    canPublishScreen={canPublishScreen}
    participantCount={participantCount}
    participantId={participantId}
    participantMediaStates={eventBackedParticipantMediaStates}
    chatMessages={chatMessages}
    remoteMediaVersion={remoteMediaVersion}
    remoteParticipants={remoteParticipants}
    room={room}
    transcriptEntries={renderedTranscriptEntries}
    activeTranscriptParticipantIds={activeTranscriptParticipantIds}
    transcriptionState={transcriptionState}
    transportState={transportState}
  />
{/if}
