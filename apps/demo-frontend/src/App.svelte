<script lang="ts">
  import "./app.css";
  import { onMount } from "svelte";
  import {
    DEFAULT_AGENDA_TOPICS,
    type ChatMessageEvent,
    type CreateRoomResponse,
    type JoinRoomResponse,
    type MeetingEvent,
    type MeetingSnapshot,
    type ParticipantMediaState,
    type RoomSummary
  } from "@mote/models";
  import { createRoomsApi } from "./lib/api/rooms";
  import { DemoMeetingEventsClient } from "./lib/events/client";
  import { DemoMediaSession } from "./lib/media/session";
  import { DemoTranscriptionSession } from "./lib/transcription/session";
  import { meetingCodeFromPathname, normalizePathname } from "./lib/router";
  import { participantStorageKey, savedNameKey } from "./lib/storage";
  import HomeRoute from "./routes/index.svelte";
  import MeetingRoute from "./routes/[meet-code].svelte";

  type TranscriptEntry = {
    id: string;
    text: string;
    speakerParticipantId: string | null;
    speakerDisplayName: string | null;
    createdAt: string;
    isPartial: boolean;
  };

  const normalizeTranscriptText = (value: string) =>
    value
      .trim()
      .replace(/\s+/g, " ");

  const mergeTranscriptText = (existingText: string, incomingText: string) => {
    const existing = normalizeTranscriptText(existingText);
    const incoming = normalizeTranscriptText(incomingText);

    if (!existing) {
      return incoming;
    }

    if (!incoming) {
      return existing;
    }

    if (incoming.startsWith(existing)) {
      return incoming;
    }

    if (existing.startsWith(incoming)) {
      return existing;
    }

    const maxOverlap = Math.min(existing.length, incoming.length);

    for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
      if (
        existing.slice(-overlap).toLowerCase() === incoming.slice(0, overlap).toLowerCase()
      ) {
        return `${existing}${incoming.slice(overlap)}`.trim();
      }
    }

    return `${existing} ${incoming}`.trim();
  };

  const collapseTranscriptEntries = (entries: TranscriptEntry[]) => {
    const collapsed: TranscriptEntry[] = [];

    for (const entry of entries) {
      const normalizedText = normalizeTranscriptText(entry.text);

      if (!normalizedText) {
        continue;
      }

      const lastEntry = collapsed[collapsed.length - 1];

      if (
        lastEntry &&
        lastEntry.speakerParticipantId &&
        entry.speakerParticipantId &&
        lastEntry.speakerParticipantId === entry.speakerParticipantId
      ) {
        lastEntry.text = mergeTranscriptText(lastEntry.text, normalizedText);
        lastEntry.id = entry.id;
        lastEntry.createdAt = entry.createdAt;
        lastEntry.isPartial = entry.isPartial;
        lastEntry.speakerDisplayName =
          entry.speakerDisplayName ?? lastEntry.speakerDisplayName;
        continue;
      }

      collapsed.push({
        ...entry,
        text: normalizedText
      });
    }

    return collapsed;
  };

  const backendUrl =
    (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "https://joi.thrush-dab.ts.net:3001";
  const websocketBaseUrl = backendUrl.replace(/^http/, "ws");
  const roomsApi = createRoomsApi(backendUrl);

  let pathname = $state("/");
  let displayName = $state("");
  let joinCode = $state("");
  let agendaInput = $state(DEFAULT_AGENDA_TOPICS.join("\n"));
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
  let eventsConnectionState = $state<"idle" | "connecting" | "connected" | "error">("idle");
  let transcriptionState = $state<"idle" | "connecting" | "connected" | "error">("idle");
  let transcriptionConfig = $state<{
    url: string;
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

  const setParticipantMediaState = (state: ParticipantMediaState) => {
    participantMediaStates = {
      ...participantMediaStates,
      [state.participantId]: state
    };
  };

  const removeParticipantMediaState = (nextParticipantId: string) => {
    const { [nextParticipantId]: _removed, ...rest } = participantMediaStates;
    participantMediaStates = rest;
  };

  const sendMeetingAction = (action: Parameters<typeof eventsClient.send>[0]) => {
    try {
      eventsClient.send(action);
    } catch (error) {
      console.warn("[mote:events] send skipped", error);
    }
  };

  const applyMeetingSnapshot = (snapshot: MeetingSnapshot) => {
    room = snapshot.room;
    mediaSession.pruneRemoteStreams(snapshot.room.participants.map((participant) => participant.id));
    participantMediaStates = Object.fromEntries(
      snapshot.participantMediaStates.map((state) => [state.participantId, state])
    );
    chatMessages = snapshot.recentEvents.filter((event): event is ChatMessageEvent => event.type === "chat.message");
    transcriptEntries = snapshot.recentEvents
      .filter((event) => event.type === "transcript.final")
      .map((event) => ({
        id: event.id,
        text: normalizeTranscriptText(event.payload.text),
        speakerParticipantId: event.payload.speakerParticipantId ?? null,
        speakerDisplayName: event.payload.speakerDisplayName ?? null,
        createdAt: event.createdAt,
        isPartial: false
      }));
    liveTranscriptEntries = {};
  };

  const applyMeetingEvent = (event: MeetingEvent) => {
    switch (event.type) {
      case "presence.joined": {
        if (!room) {
          break;
        }

        const nextParticipants = room.participants.filter(
          (participant) => participant.id !== event.payload.participant.id
        );
        nextParticipants.push(event.payload.participant);
        nextParticipants.sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));
        room = { ...room, participants: nextParticipants };
        break;
      }

      case "presence.left":
      case "moderation.participant_removed": {
        if (!room) {
          break;
        }

        const nextParticipantId =
          event.type === "presence.left" ? event.payload.participantId : event.payload.participantId;

        room = {
          ...room,
          participants: room.participants.filter((participant) => participant.id !== nextParticipantId)
        };
        removeParticipantMediaState(nextParticipantId);
        const { [nextParticipantId]: _removedTranscript, ...restTranscripts } = liveTranscriptEntries;
        liveTranscriptEntries = restTranscripts;
        mediaSession.pruneRemoteStreams(room.participants.map((participant) => participant.id));

        if (event.type === "moderation.participant_removed" && nextParticipantId === participantId) {
          errorMessage = "You were removed from the meeting by the host.";
          leaveMeeting();
        }
        break;
      }

      case "agenda.updated": {
        if (room) {
          room = {
            ...room,
            agenda: event.payload.agenda,
            agendaArtifact: event.payload.agendaArtifact ?? null
          };
        }
        break;
      }

      case "chat.message": {
        chatMessages = [...chatMessages, event];
        break;
      }

      case "participant.media_state":
      case "moderation.media_state_changed": {
        setParticipantMediaState({
          participantId: event.payload.participantId,
          audioEnabled: event.payload.audioEnabled,
          videoEnabled: event.payload.videoEnabled
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
        }
        break;
      }

      case "transcript.final": {
        transcriptEntries = [
          ...transcriptEntries,
          {
            id: event.id,
            text: normalizeTranscriptText(event.payload.text),
            speakerParticipantId: event.payload.speakerParticipantId ?? null,
            speakerDisplayName: event.payload.speakerDisplayName ?? null,
            createdAt: event.createdAt,
            isPartial: false
          }
        ];

        if (event.payload.speakerParticipantId) {
          const { [event.payload.speakerParticipantId]: _removed, ...rest } = liveTranscriptEntries;
          liveTranscriptEntries = rest;
        }
        break;
      }

      case "transcript.partial": {
        const speakerParticipantId = event.payload.speakerParticipantId ?? event.actorParticipantId ?? null;

        if (!speakerParticipantId) {
          break;
        }

        liveTranscriptEntries = {
          ...liveTranscriptEntries,
          [speakerParticipantId]: {
            id: event.id,
            text: normalizeTranscriptText(event.payload.text),
            speakerParticipantId,
            speakerDisplayName: event.payload.speakerDisplayName ?? null,
            createdAt: event.createdAt,
            isPartial: true
          }
        };
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
      return;
    }

    try {
      mediaState = "requesting";
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        }
      });
      isAudioMuted = false;
      isVideoMuted = false;
      mediaState = "ready";
    } catch (error) {
      console.error(error);
      mediaState = "blocked";
      errorMessage = "Camera or microphone access was blocked. Allow browser permissions to continue.";
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
      navigateTo(`/${data.room.code}`);
      await activateLocalMedia();

      if (mode === "create") {
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
    attachParticipant(roomsApi.createRoom(displayName, agendaItems), "create");

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
  };

  const toggleAudio = () => {
    const track = localStream?.getAudioTracks()[0];

    if (!track) {
      return;
    }

    track.enabled = !track.enabled;
    isAudioMuted = !track.enabled;
    if (participantId) {
      setParticipantMediaState({
        participantId,
        audioEnabled: localStream?.getAudioTracks()[0]?.enabled ?? false,
        videoEnabled: localStream?.getVideoTracks()[0]?.enabled ?? false
      });
    }
    sendMeetingAction({
      action: "participant.media_state",
      audioEnabled: localStream?.getAudioTracks()[0]?.enabled ?? false,
      videoEnabled: localStream?.getVideoTracks()[0]?.enabled ?? false
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
      setParticipantMediaState({
        participantId,
        audioEnabled: localStream?.getAudioTracks()[0]?.enabled ?? false,
        videoEnabled: localStream?.getVideoTracks()[0]?.enabled ?? false
      });
    }
    sendMeetingAction({
      action: "participant.media_state",
      audioEnabled: localStream?.getAudioTracks()[0]?.enabled ?? false,
      videoEnabled: localStream?.getVideoTracks()[0]?.enabled ?? false
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
    nextState: Partial<Pick<ParticipantMediaState, "audioEnabled" | "videoEnabled">>,
    reason?: string
  ) => {
    sendMeetingAction({
      action: "moderation.set_media_state",
      targetParticipantId,
      audioEnabled: nextState.audioEnabled,
      videoEnabled: nextState.videoEnabled,
      reason
    });
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
      void localVideo.play();
    }
  });

  $effect(() => {
    if (!currentCode || isHomeRoute) {
      return;
    }

    void loadMeeting(currentCode);
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
    if (!currentCode || !participantId || !localStream || !transcriptionConfig) {
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
      videoEnabled: localStream.getVideoTracks()[0]?.enabled ?? false
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

    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
      resetMedia();
    };
  });
</script>

<svelte:head>
  <title>{isHomeRoute ? "Mote" : `${currentCode} · Mote`}</title>
  <meta
    name="description"
    content="Meeting bootstrap and room surface for the Mote orchestration demo."
  />
</svelte:head>

{#if isHomeRoute}
  <HomeRoute
    agendaInput={agendaInput}
    displayName={displayName}
    errorMessage={errorMessage}
    isSubmitting={isSubmitting}
    submissionMode={submissionMode}
    joinCode={joinCode}
    onAgendaInput={(value) => (agendaInput = value)}
    onCreateMeeting={() => void createMeeting()}
    onDisplayName={(value) => (displayName = value)}
    onJoinCode={(value) => (joinCode = value)}
    onJoinMeeting={() => void joinMeeting()}
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
    onToggleAudio={toggleAudio}
    onToggleVideo={toggleVideo}
    participantCount={participantCount}
    participantId={participantId}
    participantMediaStates={eventBackedParticipantMediaStates}
    chatMessages={chatMessages}
    remoteMediaVersion={remoteMediaVersion}
    remoteParticipants={remoteParticipants}
    room={room}
    transcriptEntries={renderedTranscriptEntries}
    transportState={transportState}
  />
{/if}
