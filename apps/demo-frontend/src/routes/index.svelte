<script lang="ts">
  import Icon from "@iconify/svelte";
  import {
    APP_TAGLINE,
    Button,
    Input,
    Textarea
  } from "@mote/ui";
  import { EVENTS_CHANNEL_NAME } from "@mote/models";

  interface Props {
    agendaInput: string;
    displayName: string;
    errorMessage: string;
    isSubmitting: boolean;
    submissionMode: "create" | "join" | null;
    joinCode: string;
    onAgendaInput: (value: string) => void;
    onCreateMeeting: () => void;
    onDisplayName: (value: string) => void;
    onJoinCode: (value: string) => void;
    onJoinMeeting: () => void;
    readyToCreate: boolean;
    readyToJoin: boolean;
  }

  let {
    agendaInput,
    displayName,
    errorMessage,
    isSubmitting,
    submissionMode,
    joinCode,
    onAgendaInput,
    onCreateMeeting,
    onDisplayName,
    onJoinCode,
    onJoinMeeting,
    readyToCreate,
    readyToJoin
  }: Props = $props();

</script>

<div class="home-shell">
  <header class="meeting-header">
    <div class="meeting-brand">
      <div class="meeting-meta">
        <span class="meeting-room-label">Mote orchestration demo</span>
        <span class="meeting-subtle">{EVENTS_CHANNEL_NAME}</span>
      </div>
    </div>

    <div class="home-header-chips">
      <span class="home-chip"><Icon icon="ph:database" width="16" height="16" /> SQLite</span>
      <span class="home-chip"><Icon icon="ph:waveform" width="16" height="16" /> Mediasoup</span>
      <span class="home-chip"><Icon icon="ph:brain" width="16" height="16" /> AI layer next</span>
    </div>
  </header>

  <main class="home-main">
    <section class="home-hero panel">
      <div class="home-hero-copy">
        <div class="home-badge-row">
          <span class="home-kicker">Realtime meetings</span>
          <span class="home-kicker home-kicker-muted">Browser-first demo</span>
        </div>
        <h1>Meetings with a media plane, an event plane, and room memory.</h1>
        <p>{APP_TAGLINE}</p>

        <div class="home-feature-grid">
          <div class="home-feature">
            <Icon icon="ph:video-camera" width="18" height="18" />
            <span>Paginated participant grid</span>
          </div>
          <div class="home-feature">
            <Icon icon="ph:textbox" width="18" height="18" />
            <span>Transcript-ready utility rail</span>
          </div>
          <div class="home-feature">
            <Icon icon="ph:calendar-blank" width="18" height="18" />
            <span>Agenda persisted in SQLite</span>
          </div>
          <div class="home-feature">
            <Icon icon="ph:broadcast" width="18" height="18" />
            <span>WebSocket-first control plane</span>
          </div>
        </div>
      </div>

      <div class="home-hero-aside">
        <div class="home-hero-card">
          <span class="home-card-label">Flow</span>
          <strong>Create or join from here, then land in the room workspace immediately.</strong>
          <p>The room opens first. Agenda refinement continues in the background and upgrades the meeting structure asynchronously.</p>
        </div>
        <div class="home-hero-card">
          <span class="home-card-label">Defaults</span>
          <strong>Python file I/O planning prompt as the starting scenario.</strong>
          <p>The entered agenda is treated like a prompt and normalized into locked topics plus subtopics for later AI execution.</p>
        </div>
      </div>
    </section>

    <section class="home-content">
      <div class="home-form panel-ink">
        <div class="home-form-head">
          <h2>Start a room or join by code</h2>
          <p>Use the same aesthetic and control model as the meeting view from the first interaction.</p>
        </div>

        <label class="field">
          <span class="field-label field-label-dark">Your name</span>
          <Input
            value={displayName}
            oninput={(event) => onDisplayName(event.currentTarget.value)}
            class="home-input p-4"
            placeholder="Ada Lovelace"
          />
        </label>

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
          <span class="field-hint text-stone-500">One line per topic. The room opens immediately; the AI agent refines this into locked topics and subtopics after join.</span>
        </label>

        <div class="home-join-row">
          <Input
            value={joinCode}
            oninput={(event) => onJoinCode(event.currentTarget.value)}
            class="home-input home-code-input"
            placeholder="join existing meet code"
          />
          <Button
            class="home-secondary-button"
            variant="secondary"
            disabled={isSubmitting || !readyToJoin}
            onclick={onJoinMeeting}
          >
            {#if submissionMode === "join"}
              <Icon icon="ph:spinner-gap" class="animate-spin" width="18" height="18" />
            {:else}
              <Icon icon="ph:sign-in" width="18" height="18" />
            {/if}
            <span class="button-label">{submissionMode === "join" ? "Joining room" : "Join"}</span>
          </Button>
        </div>

        <Button class="home-primary-button" disabled={isSubmitting || !readyToCreate} onclick={onCreateMeeting}>
          {#if submissionMode === "create"}
            <Icon icon="ph:spinner-gap" class="animate-spin" width="18" height="18" />
          {:else}
            <Icon icon="ph:video-camera" width="18" height="18" />
          {/if}
          <span class="button-label">{submissionMode === "create" ? "Opening room" : "Create meeting"}</span>
        </Button>

        {#if errorMessage}
          <p class="alert alert-dark">{errorMessage}</p>
        {/if}
      </div>

      <div class="home-side-column">
        <div class="panel home-panel">
          <div class="home-panel-head">
            <Icon icon="ph:stack" width="18" height="18" />
            <h3>Current stack</h3>
          </div>
          <div class="home-stack-list">
            <div><strong>Backend</strong><span>Bun + Elysia + mediasoup + SQLite</span></div>
            <div><strong>Frontend</strong><span>Svelte demo with shared UI package</span></div>
            <div><strong>AI path</strong><span>LangGraph agenda normalization first, realtime actions next</span></div>
          </div>
        </div>
      </div>
    </section>
  </main>
</div>
