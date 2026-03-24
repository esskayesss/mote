# System Architecture

## Target Services

- `apps/backend`: Elysia service responsible for room lifecycle, SQLite-backed room persistence, SFU orchestration, event fan-out, and transcription ingestion coordination.
- `apps/demo-frontend`: Svelte client with `/` as the meeting bootstrap route and `/{meet-code}` as the meeting surface for local media, remote presence, transcription, and AI assistance surfaces.
- `apps/ai-service`: LangGraph-oriented service for meeting intelligence, participant-specific interventions, and tool execution.

## Shared Packages

- `packages/models`: shared contracts, event types, and common meeting constants.
- `packages/ui`: shared UI tokens and frontend primitives.
- `packages/whisper-client`: thin wrapper around local Whisper realtime transcription integration.

## Planned Channels

- Media channels: audio and video delivery through mediasoup transports.
- Events channel: structured meeting events, agenda progress, AI suggestions, moderation signals, and participant-private notifications.
- Initial event transport choice: WebSocket-first. This keeps meeting control state independent from peer media setup, is easy to fan out from the backend, and maps cleanly to participant-private AI messages before WebRTC data channels are justified.
- Transcription channel: low-latency text segments and metadata, likely bridged into the event plane for downstream AI consumers.

## Current Demo Signaling

- WebSocket signaling path: `apps/backend` exposes `ws/:code/:participantId` for mediasoup transport, produce, and consume requests.
- Mediasoup topology: one worker and one router for the current demo, with per-participant send/recv WebRTC transports.
- Persistence boundary: SQLite stores rooms and participants; mediasoup transports, producers, and consumers remain in-memory runtime state.
- ICE strategy: mediasoup exposes host candidates for the SFU, browsers receive STUN plus optional TURN credentials from the backend room bootstrap response, and TURN is expected to be served by a separate coturn deployment.
- Default dev path: `STUN_URLS` defaults to `stun:stun.l.google.com:19302`, while repo-local TURN can be started from `infra/turn/docker-compose.yml` once `TURN_STATIC_AUTH_SECRET` and `TURN_EXTERNAL_IP` are configured.

## Open Technical Questions

- Whether Bun should directly host the mediasoup runtime in production or whether a compatibility boundary is needed.
- How to model participant-private AI events so they remain low-latency and secure.
- How to coordinate transcription timing with speaker diarization and room state.
