<script lang="ts">
  import Icon from "@iconify/svelte";
  import { Button, Input, Select, Textarea, cn } from "@mote/ui";
  import type { OpenAiTranscriptionModel, TranscriptionProvider } from "@mote/models";

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
    transcriptionModel: OpenAiTranscriptionModel;
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
    onTranscriptionModel: (value: OpenAiTranscriptionModel) => void;
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
    transcriptionModel,
    transcriptionProviderStatuses,
    submissionMode,
    onAgendaInput,
    onCreateMeeting,
    onDisplayName,
    onEndMeetingOnHostExit,
    onJoinCode,
    onJoinMeeting,
    onMeetingTitle,
    onTranscriptionModel,
    onToggleAudio,
    onToggleVideo,
    onTranscriptionProvider,
    readyToCreate,
    readyToJoin
  }: Props = $props();

  const providerOrder = ["none", "whisperlive", "sarvam", "openai"] as TranscriptionProvider[];
  const providerLabelOverrides: Partial<Record<TranscriptionProvider, string>> = {
    openai: "OpenAI Whisper"
  };
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
      label:
        providerLabelOverrides[provider] ??
        transcriptionProviderStatuses[provider]?.label ??
        provider,
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

  const shellPanelClass =
    "grid gap-8 border border-border-soft bg-panel px-6 py-6 text-foreground shadow-2xl shadow-shadow/30 lg:grid-cols-[1.12fr_0.88fr] lg:px-8 lg:py-8 min-h-80dvh";
  const sectionHeadClass = "flex flex-col gap-3";
  const fieldClass = "flex flex-col grow gap-2";
  const fieldLabelClass = "text-sm text-subtle-foreground font-mono uppercase";
  const inputClass = "min-h-12 border-input bg-background-deep px-4 py-3 text-foreground placeholder:text-subtle-foreground";
  const toggleButtonClass = "flex h-12 w-12 items-center justify-center border border-border-strong bg-accent text-foreground transition hover:bg-accent-hover";
</script>

<div class="min-h-screen flex bg-background text-foreground">
  <div class="absolute left-10 top-4 flex items-center gap-3">
    <img class="block h-10 w-10 object-contain mix-blend-color-dodge" src="/src/lib/media/favicon.png" alt="Mote" />
  </div>

  <main class="mx-auto my-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <section class={shellPanelClass}>
      <div class="flex min-h-0 flex-col gap-6">
        <div class={sectionHeadClass}>
          <span class="inline-flex min-h-9 items-center border border-border bg-surface-strong px-3 py-2 text-label font-semibold uppercase text-muted-foreground">Meeting configuration</span>
          <p class="max-w-3xl text-body text-muted-foreground">Choose transcription behavior, provide either a meeting title or an agenda, and decide how the room should behave if the host drops.</p>
        </div>

        <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <label class={fieldClass}>
            <span class={fieldLabelClass}>Meeting title</span>
            <Input
              value={meetingTitle}
              oninput={(event) => onMeetingTitle(event.currentTarget.value)}
              class={inputClass}
              placeholder="Optional if you provide an agenda. AI can use this to generate one."
            />
          </label>

          <label class={fieldClass}>
            <span class={fieldLabelClass}>STT model</span>
            <Select
              class={cn(inputClass, "font-mono text-sm tracking-[0.08em]")}
              contentClass="font-mono tracking-[0.08em]"
              value={transcriptionProvider}
              options={providerOptions}
              placeholder="Choose transcription"
              onValueChange={(value: string) => onTranscriptionProvider(value as TranscriptionProvider)}
            />
          </label>
        </div>

        <label class={fieldClass}>
          <span class={fieldLabelClass}>Agenda</span>
          <Textarea
            value={agendaInput}
            oninput={(event) => onAgendaInput(event.currentTarget.value)}
            class={cn(inputClass, "min-h-52 py-3.5 h-full grow")}
            placeholder={
              "Optional if you provide a meeting title.\nOne line per topic if you already know the shape of the meeting."
            }
          />
          <span class="text-xs leading-5 text-subtle-foreground">Provide either a title or one line per topic. The room opens immediately; AI refinement can happen after entry.</span>
        </label>

        <div class="flex flex-col gap-3">
          <label class="flex items-start gap-3 border border-border bg-panel-muted px-4 py-4">
            <input
              type="checkbox"
              class="mt-1 h-3 w-3 accent-primary"
              checked={endMeetingOnHostExit}
              onchange={(event) => onEndMeetingOnHostExit(event.currentTarget.checked)}
            />
            <div class="flex flex-col gap-1">
              <strong class="text-sm font-mono font-regular uppercase text-foreground">End meeting when host leaves</strong>
              <span class="text-sm leading-6 text-muted-foreground">Disconnect everyone and close the room as soon as the host exits.</span>
            </div>
          </label>
        </div>
      </div>

      <div class="flex min-h-0 flex-col gap-6">
        <div class={sectionHeadClass}>
          <span class="inline-flex min-h-9 items-center border border-border bg-surface-strong px-3 py-2 text-label font-semibold uppercase text-muted-foreground">You before entry</span>
          <p class="max-w-3xl text-body text-muted-foreground">Preview camera, mute devices before joining, and either create a room or join an existing one.</p>
        </div>

        <div class="overflow-hidden border border-border bg-background-deep">
          {#if mediaState === "ready"}
            <video bind:this={localVideo} autoplay muted playsinline class="aspect-video w-full object-cover"></video>
          {:else if mediaState === "requesting"}
            <div class="flex aspect-video w-full items-center justify-center px-6 text-center text-sm text-subtle-foreground">Requesting camera and microphone…</div>
          {:else if mediaState === "blocked"}
            <div class="flex aspect-video w-full items-center justify-center px-6 text-center text-sm text-subtle-foreground">Camera or microphone access was blocked.</div>
          {:else}
            <div class="flex aspect-video w-full items-center justify-center px-6 text-center text-sm text-subtle-foreground">Preview will appear here once device access is granted.</div>
          {/if}
        </div>

        <div class="flex items-center gap-3 gap-4">
          <div class="flex h-full flex-col gap-2">
            <span class="whitespace-nowrap text-sm text-muted-foreground">
              {isAudioMuted ? "Mic off" : "Mic on"} · {isVideoMuted ? "Camera off" : "Camera on"}
            </span>
            <div class="flex items-center gap-2">
              <button class={toggleButtonClass} type="button" onclick={onToggleAudio}>
                <Icon icon={isAudioMuted ? "ph:microphone-slash" : "ph:microphone"} width="18" height="18" />
              </button>
              <button class={toggleButtonClass} type="button" onclick={onToggleVideo}>
                <Icon icon={isVideoMuted ? "ph:video-camera-slash" : "ph:video-camera"} width="18" height="18" />
              </button>
            </div>
          </div>

          <label class={cn(fieldClass, "ml-auto w-full")}>
            <span class={fieldLabelClass}>Your name</span>
            <Input
              value={displayName}
              oninput={(event) => onDisplayName(event.currentTarget.value)}
              class={inputClass}
              placeholder="Ada Lovelace"
            />
          </label>
        </div>

        <div class="grid gap-4">
          <label class={fieldClass}>
            <span class={fieldLabelClass}>Join existing room</span>
            <Input
              value={joinCode}
              oninput={(event) => onJoinCode(event.currentTarget.value)}
              class={cn(inputClass, "font-mono uppercase tracking-[0.16em]")}
              placeholder="lunar-studio-thread"
            />
          </label>
        </div>

        <Button class="min-h-12 w-full bg-primary px-5 py-3 text-foreground hover:bg-primary-strong" disabled={primaryActionDisabled} onclick={primaryAction}>
          {#if submissionMode === "join"}
            <Icon icon="ph:spinner-gap" class="animate-spin" width="18" height="18" />
          {:else if submissionMode === "create"}
            <Icon icon="ph:spinner-gap" class="animate-spin" width="18" height="18" />
          {:else if isJoinMode}
            <Icon icon="ph:sign-in" width="18" height="18" />
          {:else}
            <Icon icon="ph:video-camera" width="18" height="18" />
          {/if}
          <span class="block leading-none">
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
          <p class="rounded-none border border-destructive/30 bg-destructive-soft px-4 py-3.5 text-sm text-destructive-foreground">{errorMessage}</p>
        {/if}
      </div>
    </section>
  </main>
</div>
