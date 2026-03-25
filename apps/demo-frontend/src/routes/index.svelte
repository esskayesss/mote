<script lang="ts">
  import Icon from "@iconify/svelte";
  import { Button, Input, Select, Textarea } from "@mote/ui";
  import type { TranscriptionProvider } from "@mote/models";

  interface Props {
    agendaInput: string;
    displayName: string;
    endMeetingOnHostExit: boolean;
    errorMessage: string;
    isAudioMuted: boolean;
    isSubmitting: boolean;
    isVideoMuted: boolean;
    joinCode: string;
    localVideo: HTMLVideoElement | null;
    mediaState: "idle" | "requesting" | "ready" | "blocked";
    meetingTitle: string;
    transcriptionProvider: TranscriptionProvider;
    transcriptionProviderStatuses: Record<
      TranscriptionProvider,
      {
        label: string;
        available: boolean;
        reason?: string | null;
      }
    >;
    submissionMode: "create" | "join" | null;
    onAgendaInput: (value: string) => void;
    onCreateMeeting: () => void;
    onDisplayName: (value: string) => void;
    onEndMeetingOnHostExit: (value: boolean) => void;
    onJoinCode: (value: string) => void;
    onJoinMeeting: () => void;
    onMeetingTitle: (value: string) => void;
    onToggleAudio: () => void;
    onToggleVideo: () => void;
    onTranscriptionProvider: (value: TranscriptionProvider) => void;
    readyToCreate: boolean;
    readyToJoin: boolean;
  }

  let {
    agendaInput,
    displayName,
    endMeetingOnHostExit,
    errorMessage,
    isAudioMuted,
    isSubmitting,
    isVideoMuted,
    joinCode,
    localVideo = $bindable(),
    mediaState,
    meetingTitle,
    transcriptionProvider,
    transcriptionProviderStatuses,
    submissionMode,
    onAgendaInput,
    onCreateMeeting,
    onDisplayName,
    onEndMeetingOnHostExit,
    onJoinCode,
    onJoinMeeting,
    onMeetingTitle,
    onToggleAudio,
    onToggleVideo,
    onTranscriptionProvider,
    readyToCreate,
    readyToJoin
  }: Props = $props();

  const providerOrder = ["none", "whisperlive", "sarvam"] as TranscriptionProvider[];
  const providerStatus = (
    provider: TranscriptionProvider
  ): "ready" | "unavailable" | "neutral" => {
    if (provider === "none") {
      return "neutral";
    }

    return transcriptionProviderStatuses[provider]?.available ? "ready" : "unavailable";
  };

  const providerOptions = $derived(
    providerOrder.map((provider) => ({
      value: provider,
      label: transcriptionProviderStatuses[provider]?.label ?? provider,
      status: providerStatus(provider)
    }))
  );
  const isJoinMode = $derived(joinCode.trim().length > 0);
  const primaryActionDisabled = $derived(
    isJoinMode ? isSubmitting || !readyToJoin : isSubmitting || !readyToCreate
  );
  const primaryAction = () => {
    if (isJoinMode) {
      onJoinMeeting();
      return;
    }

    onCreateMeeting();
  };
</script>

<div class="home-shell">
  <div class="meeting-brand absolute top-8 left-8">
    <img class="meeting-brand-logo mix-blend-color-dodge" src="/src/lib/media/favicon.png" alt="Mote" />
  </div>

  <main class="home-main home-main-hero">
    <section class="home-hero home-hero-full panel-ink">
      <div class="home-config-column">
        <div class="home-section-head">
          <span class="home-kicker">Meeting configuration</span>
          <p>Choose transcription behavior, define the agenda, and decide how the room should behave if the host drops.</p>
        </div>

        <div class="home-config-grid">
          <label class="field">
            <span class="field-label field-label-dark">Meeting title</span>
            <Input
              value={meetingTitle}
              oninput={(event) => onMeetingTitle(event.currentTarget.value)}
              class="home-input p-4"
              placeholder="Optional. AI can generate this from the agenda."
            />
          </label>

          <label class="field">
            <span class="field-label field-label-dark">Speech-to-text</span>
            <Select
              class="home-input home-select-trigger"
              contentClass="home-select-content"
              value={transcriptionProvider}
              options={providerOptions}
              placeholder="Choose transcription"
              onValueChange={(value: string) => onTranscriptionProvider(value as TranscriptionProvider)}
            />
          </label>
        </div>

        <label class="field">
          <span class="field-label field-label-dark">Agenda</span>
          <Textarea
            value={agendaInput}
            oninput={(event) => onAgendaInput(event.currentTarget.value)}
            class="home-textarea"
            placeholder={
              "Define the FileBackedNotesManager class responsibilities and public API\nPlan read and write flows for opening, creating, and updating note files\nHandle path validation, file errors, and recovery behavior\nDesign tests for temporary directories, missing files, and corrupted input\nAgree on next implementation steps and ownership"
            }
          />
          <span class="field-hint text-stone-500">One line per topic. The room opens immediately; AI refinement can happen after entry.</span>
        </label>

        <div class="home-policy-stack">
          <label class="home-policy-toggle">
            <input
              type="checkbox"
              checked={endMeetingOnHostExit}
              onchange={(event) => onEndMeetingOnHostExit(event.currentTarget.checked)}
            />
            <div class="home-policy-copy">
              <strong>End meeting when host leaves</strong>
              <span>Disconnect everyone and close the room as soon as the host exits.</span>
            </div>
          </label>
        </div>
      </div>

      <div class="home-presence-column">
        <div class="home-section-head">
          <span class="home-kicker home-kicker-muted">You before entry</span>
          <p>Preview camera, mute devices before joining, and either create a room or join an existing one.</p>
        </div>

        <div class="home-preview-shell">
          {#if mediaState === "ready"}
            <video bind:this={localVideo} autoplay muted playsinline class="home-preview-video"></video>
          {:else if mediaState === "requesting"}
            <div class="home-preview-empty">Requesting camera and microphone…</div>
          {:else if mediaState === "blocked"}
            <div class="home-preview-empty">Camera or microphone access was blocked.</div>
          {:else}
            <div class="home-preview-empty">Preview will appear here once device access is granted.</div>
          {/if}
        </div>

        <div class="home-device-row gap-4">
          <div class="flex flex-col gap-2 h-full">
            <span class="home-device-copy whitespace-nowrap">
              {isAudioMuted ? "Mic off" : "Mic on"} · {isVideoMuted ? "Camera off" : "Camera on"}
            </span>
            <div class="flex items-center gap-2">
              <button class="toolbar-chip" type="button" onclick={onToggleAudio}>
                <Icon icon={isAudioMuted ? "ph:microphone-slash" : "ph:microphone"} width="18" height="18" />
              </button>
              <button class="toolbar-chip" type="button" onclick={onToggleVideo}>
                <Icon icon={isVideoMuted ? "ph:video-camera-slash" : "ph:video-camera"} width="18" height="18" />
              </button>
            </div>
          </div>

          <label class="field ml-auto w-full">
            <span class="field-label field-label-dark">Your name</span>
            <Input
              value={displayName}
              oninput={(event) => onDisplayName(event.currentTarget.value)}
              class="home-input p-4"
              placeholder="Ada Lovelace"
            />
          </label>
        </div>

        <div class="home-join-stack">
          <label class="field">
            <span class="field-label field-label-dark">Join existing room</span>
            <Input
              value={joinCode}
              oninput={(event) => onJoinCode(event.currentTarget.value)}
              class="home-input home-code-input"
              placeholder="lunar-studio-thread"
            />
          </label>
        </div>

        <Button class="home-primary-button" disabled={primaryActionDisabled} onclick={primaryAction}>
          {#if submissionMode === "join"}
            <Icon icon="ph:spinner-gap" class="animate-spin" width="18" height="18" />
          {:else if submissionMode === "create"}
            <Icon icon="ph:spinner-gap" class="animate-spin" width="18" height="18" />
          {:else if isJoinMode}
            <Icon icon="ph:sign-in" width="18" height="18" />
          {:else}
            <Icon icon="ph:video-camera" width="18" height="18" />
          {/if}
          <span class="button-label">
            {submissionMode === "join"
              ? "Joining room"
              : submissionMode === "create"
                ? "Opening room"
                : isJoinMode
                  ? "Join room"
                  : "Create meeting"}
          </span>
        </Button>

        {#if errorMessage}
          <p class="alert alert-dark">{errorMessage}</p>
        {/if}
      </div>
    </section>
  </main>
</div>
