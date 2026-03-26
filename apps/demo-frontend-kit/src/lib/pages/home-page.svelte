<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import type {
    CreateRoomResponse,
    JoinRoomResponse,
    OpenAiTranscriptionModel,
    RoomPolicy,
    TranscriptionProvider,
    TranscriptionProviderStatusResponse
  } from "@mote/models";
  import { createRoomsApi } from "$lib/api/rooms";
  import { logger } from "$lib/logger";
  import {
    createNoiseSuppressedAudioTrack,
    type NoiseSuppressedAudioSession
  } from "$lib/media/audio-processing";
  import HomeView from "./home-view.svelte";
  import {
    cameraEnabledStore,
    displayNameStore,
    endMeetingOnHostExitStore,
    microphoneEnabledStore,
    openAiTranscriptionModelStore,
    participantStorageKey,
    transcriptionProviderStore
  } from "$lib/storage";

  const backendUrl =
    (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "https://joi.thrush-dab.ts.net:3001";
  const roomsApi = createRoomsApi(backendUrl);

  let displayName = $state(displayNameStore.get());
  let transcriptionProvider = $state<TranscriptionProvider>(transcriptionProviderStore.get());
  let transcriptionModel = $state<OpenAiTranscriptionModel>(openAiTranscriptionModelStore.get());
  let meetingTitleInput = $state("");
  let joinCode = $state("");
  let agendaInput = $state("");
  let endMeetingOnHostExit = $state(endMeetingOnHostExitStore.get());
  let isSubmitting = $state(false);
  let submissionMode = $state<"create" | "join" | null>(null);
  let errorMessage = $state("");
  let localStream = $state<MediaStream | null>(null);
  let noiseSuppressedAudioSession = $state<NoiseSuppressedAudioSession | null>(null);
  let isAudioMuted = $state(!microphoneEnabledStore.get());
  let isVideoMuted = $state(!cameraEnabledStore.get());
  let mediaState = $state<"idle" | "requesting" | "ready" | "blocked">("idle");
  let localVideo = $state<HTMLVideoElement | null>(null);
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
    },
    openai: {
      label: "OpenAI Realtime Transcription",
      available: false,
      reason: "Checking availability..."
    }
  });

  const normalizedMeetingTitle = $derived(meetingTitleInput.trim());
  const agendaItems = $derived(
    agendaInput
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
  );
  const readyToCreate = $derived(
    displayName.trim().length > 0 &&
      (normalizedMeetingTitle.length > 0 || agendaItems.length > 0)
  );
  const readyToJoin = $derived(displayName.trim().length > 0 && joinCode.trim().length > 0);

  const persistParticipant = (code: string, participantId: string) => {
    localStorage.setItem(participantStorageKey(code), participantId);
  };

  const ensureLocalStream = () => {
    if (!localStream) {
      localStream = new MediaStream();
    }

    return localStream;
  };

  const syncPreviewState = () => {
    const hasVideoTrack = Boolean(localStream?.getVideoTracks().length);
    const hasAnyTrack = Boolean(localStream?.getTracks().length);
    mediaState = hasVideoTrack ? "ready" : hasAnyTrack ? "idle" : "idle";
  };

  const activateLocalMedia = async () => {
    if (localStream || mediaState === "requesting") {
      return localStream;
    }

    try {
      mediaState = "requesting";
      const wantsAudio = !isAudioMuted;
      const wantsVideo = !isVideoMuted;

      if (!wantsAudio && !wantsVideo) {
        localStream = new MediaStream();
        mediaState = "idle";
        return localStream;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: wantsAudio
          ? {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          : false,
        video: wantsVideo
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: "user"
            }
          : false
      });

      localStream = stream;
      let audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];

      if (audioTrack) {
        noiseSuppressedAudioSession?.dispose();
        noiseSuppressedAudioSession = await createNoiseSuppressedAudioTrack(audioTrack);

        if (noiseSuppressedAudioSession.track !== audioTrack) {
          stream.removeTrack(audioTrack);
          audioTrack = noiseSuppressedAudioSession.track;
          stream.addTrack(audioTrack);
        }
      } else {
        noiseSuppressedAudioSession?.dispose();
        noiseSuppressedAudioSession = null;
      }

      if (audioTrack) {
        audioTrack.enabled = wantsAudio;
      }

      if (videoTrack) {
        videoTrack.enabled = wantsVideo;
      }

      isAudioMuted = !audioTrack;
      isVideoMuted = !videoTrack;
      syncPreviewState();
      return stream;
    } catch (error) {
      logger.error("media.local_access_failed", { error });
      mediaState = "blocked";
      errorMessage = "Camera or microphone access was blocked. Allow browser permissions to continue.";
      return null;
    }
  };

  const stopAndRemoveTrack = (track: MediaStreamTrack | undefined) => {
    if (!track || !localStream) {
      return;
    }

    if (track.kind === "audio" && noiseSuppressedAudioSession?.track === track) {
      localStream.removeTrack(track);
      noiseSuppressedAudioSession.dispose();
      noiseSuppressedAudioSession = null;
      return;
    }

    track.stop();
    localStream.removeTrack(track);
  };

  const requestLocalTrack = async (kind: "audio" | "video") => {
    const constraints =
      kind === "audio"
        ? {
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          }
        : {
            audio: false,
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: "user"
            }
          };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    let track = kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];

    stream.getTracks().forEach((candidate) => {
      if (candidate !== track) {
        candidate.stop();
      }
    });

    if (!track) {
      return null;
    }

    if (kind === "audio") {
      noiseSuppressedAudioSession?.dispose();
      noiseSuppressedAudioSession = await createNoiseSuppressedAudioTrack(track);

      if (noiseSuppressedAudioSession.track !== track) {
        track = noiseSuppressedAudioSession.track;
      }
    }

    ensureLocalStream().addTrack(track);
    return track;
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
      persistParticipant(data.room.code, data.participantId);
      await goto(`/${data.room.code}`);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to enter the meeting.";
    } finally {
      isSubmitting = false;
      submissionMode = null;
    }
  };

  const createMeeting = async () =>
    attachParticipant(
      roomsApi.createRoom(
        displayName,
        meetingTitleInput,
        transcriptionProvider,
        transcriptionModel,
        agendaItems,
        {
          endMeetingOnHostExit
        } satisfies Partial<RoomPolicy>
      ),
      "create"
    );

  const joinMeeting = async () => attachParticipant(roomsApi.joinRoom(joinCode, displayName), "join");

  const toggleAudio = async () => {
    const track = localStream?.getAudioTracks()[0];

    if (track) {
      stopAndRemoveTrack(track);
      isAudioMuted = true;
      syncPreviewState();
      return;
    }

    try {
      await requestLocalTrack("audio");
      isAudioMuted = false;
      errorMessage = "";
      syncPreviewState();
    } catch (error) {
      logger.error("media.local_audio_access_failed", { error });
      errorMessage = "Microphone access was blocked. Allow browser permissions to continue.";
    }
  };

  const toggleVideo = async () => {
    const track = localStream?.getVideoTracks()[0];

    if (track) {
      stopAndRemoveTrack(track);
      isVideoMuted = true;
      syncPreviewState();
      return;
    }

    try {
      await requestLocalTrack("video");
      isVideoMuted = false;
      errorMessage = "";
      syncPreviewState();
    } catch (error) {
      logger.error("media.local_video_access_failed", { error });
      errorMessage = "Camera access was blocked. Allow browser permissions to continue.";
    }
  };

  $effect(() => {
    displayNameStore.set(displayName);
  });

  $effect(() => {
    transcriptionProviderStore.set(transcriptionProvider);
  });

  $effect(() => {
    openAiTranscriptionModelStore.set(transcriptionModel);
  });

  $effect(() => {
    endMeetingOnHostExitStore.set(endMeetingOnHostExit);
  });

  $effect(() => {
    microphoneEnabledStore.set(!isAudioMuted);
  });

  $effect(() => {
    cameraEnabledStore.set(!isVideoMuted);
  });

  $effect(() => {
    if (!localVideo) {
      return;
    }

    if (localStream && localStream.getVideoTracks().length > 0) {
      localVideo.srcObject = localStream;
      void localVideo.play().catch(() => undefined);
      return;
    }

    localVideo.pause();
    localVideo.srcObject = null;
  });

  onMount(() => {
    void roomsApi
      .loadTranscriptionProviderStatuses()
      .then((status) => {
        transcriptionProviderStatuses = status.providers;
      })
      .catch((error) => {
        logger.warn("transcription.provider_status_failed", { error });
      });

    void activateLocalMedia();

    return () => {
      noiseSuppressedAudioSession?.dispose();
      noiseSuppressedAudioSession = null;
      localStream?.getTracks().forEach((track) => track.stop());
      localStream = null;
    };
  });
</script>

<HomeView
  bind:localVideo
  agendaInput={agendaInput}
  displayName={displayName}
  endMeetingOnHostExit={endMeetingOnHostExit}
  errorMessage={errorMessage}
  isAudioMuted={isAudioMuted}
  isSubmitting={isSubmitting}
  isVideoMuted={isVideoMuted}
  joinCode={joinCode}
  mediaState={mediaState}
  meetingTitle={meetingTitleInput}
  transcriptionProvider={transcriptionProvider}
  transcriptionModel={transcriptionModel}
  transcriptionProviderStatuses={transcriptionProviderStatuses}
  submissionMode={submissionMode}
  onAgendaInput={(value) => (agendaInput = value)}
  onCreateMeeting={() => void createMeeting()}
  onDisplayName={(value) => (displayName = value)}
  onEndMeetingOnHostExit={(value) => (endMeetingOnHostExit = value)}
  onJoinCode={(value) => (joinCode = value)}
  onJoinMeeting={() => void joinMeeting()}
  onMeetingTitle={(value) => (meetingTitleInput = value)}
  onTranscriptionModel={(value) => (transcriptionModel = value)}
  onToggleAudio={() => void toggleAudio()}
  onToggleVideo={() => void toggleVideo()}
  onTranscriptionProvider={(value) => (transcriptionProvider = value)}
  readyToCreate={readyToCreate}
  readyToJoin={readyToJoin}
/>
