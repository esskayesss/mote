# Current State

## Repository

- The repository is initialized as a Bun workspace with Turborepo orchestration.
- Applications are scaffolded for backend, demo frontend, and AI service.
- Shared packages are scaffolded for UI constants, shared models, and a thin Whisper wrapper.
- The demo frontend now uses a two-stage flow: `/` for create/join and `/{meet-code}` for the meeting itself.
- Room metadata and participant presence are now expected to be stored in SQLite rather than process memory.
- Shared shadcn-style UI primitives now live in `packages/ui`.
- The backend has been split out of a single entry file into `src/config.ts`, `src/http/create-app.ts`, `src/media/runtime.ts`, and `src/store/room-store.ts`.
- Mediasoup worker/router wiring and WebSocket signaling now exist for browser send/recv transport setup.
- A dedicated meeting events WebSocket channel now exists alongside mediasoup signaling, and the meeting UI no longer depends on client polling.
- Room bootstrap responses now carry ICE server configuration, including timed TURN credentials when a coturn-compatible shared secret is configured.
- The frontend now uses a shared dark visual system across both `/` and `/{meet-code}`, with Geist Sans and Geist Mono applied application-wide.
- Shared controls now use a tighter system for padding, border contrast, and alignment, so buttons, inputs, tabs, and panels read as one product instead of route-specific one-offs.
- Homepage and pre-join controls now also declare explicit route-level padding/flex rules instead of relying only on shared primitive defaults.
- The meeting route now uses a dark workspace layout with a paginated participant grid, a right-side utility rail, and a 300x300 local preview dock.
- Local microphone and camera toggles now work directly against the active media tracks from the meeting surface.
- Participant tiles, live chat, agenda changes, moderation actions, and transcript history are now driven by the meeting event channel rather than mediasoup-side signaling state.
- Participant leave handling is now persisted: explicit leaves and WebSocket disconnects remove the participant row from SQLite.
- The transcription layer is now wired as a participant-scoped realtime path: browser mic audio streams to `apps/ai-service`, the AI service manages the deployment session, and the backend publishes transcript events into the room event channel.
- Transcript entries are now attributed to participant identity in the meeting UI, including live partial segments and persisted finalized lines.
- The AI service now also owns a LangGraph-backed agenda refinement path that can turn rough agenda text into a structured `agenda.v1` artifact.
- The AI service now has a clearer internal split between `agents`, `tools`, and `workflows`, with agenda normalization as the first structured AI workflow.
- Room creation now opens immediately and offloads agenda refinement to an asynchronous backend task, which later publishes an `agenda.updated` event when the locked artifact is ready.
- Agenda artifacts are now explicitly immutable meeting source-of-truth objects: they preserve the entered agenda as `sourcePrompt`, generate structured points plus subtopics, and are marked `locked`.

## Product Stage

- The current milestone is infrastructure scaffolding and architectural alignment.
- No agenda-management agent or fact-checking pipeline exists yet.
- A first artifact pipeline exists for agenda refinement, but no downstream AI action engine is consuming that artifact yet.
- The meeting UI now reads structured agenda points and subtopics from `room.agendaArtifact` when present, but execution state is not yet overlaid on top of that artifact.
- Homepage room creation now uses a lightweight spinner state and no longer blocks the user on agenda normalization before entering the meeting.
- The frontend now consumes remote mediasoup producers, so external participants can appear as real remote video/audio tiles in the meeting route.

## Immediate Constraints

- Mediasoup requires a native worker binary build, so the backend `dev` flow now runs `scripts/ensure-mediasoup-worker.mjs` before starting.
- Realtime transcription now depends on an external WhisperLive deployment; the app-side transport and attribution path are implemented, but the model server must be running for transcript events to appear.
- The event transport direction is WebSocket-first for the initial demo, and the app now uses a second WebSocket channel for meeting events separate from mediasoup signaling.
- The backend now defaults public-facing media and service addresses to `joi.thrush-dab.ts.net` rather than loopback assumptions.
- TURN is not bundled into the backend process; it is expected to run as a separate coturn service, with repo scaffolding in `infra/turn/docker-compose.yml`.
- WhisperLive is not bundled into the AI service; it is expected to run as a separate deployment and can be overridden with `TRANSCRIPTION_PROVIDER_URL`, with the demo default pointing at `xerxes.thrush-dab.ts.net:9090`.
- Agenda refinement uses an OpenAI-compatible chat completions endpoint via `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`, but it falls back to deterministic local structuring when the model path is unavailable.
- The default agenda seed is now a mock Python file-I/O planning scenario rather than the original generic meeting template.
- Client-driven `agenda.update` mutations are now rejected at the event runtime so the meeting agenda source of truth stays locked after room creation.
- Remote participant pagination is currently fixed at four tiles per page rather than dynamically adapting to viewport capacity.
- The frontend is still a plain Svelte + Vite app with route-organized components rather than true SvelteKit filesystem routing.
