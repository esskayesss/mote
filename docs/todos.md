# Todos

## Next

- Validate mediasoup compatibility and worker build flow in a Bun-first workspace on a non-sandboxed local runtime.
- Define the event channel schema for public versus participant-private signals.
- Stand up and validate the dedicated WhisperLive deployment behind `TRANSCRIPTION_PROVIDER_URL`.
- Add reconnect/resume semantics for participant-scoped transcription sessions so brief socket drops do not lose transcript continuity.
- Add `transcript.partial` compaction or throttling if the current provider produces too many interim updates.
- Add AI-generated agenda nudges, private coaching, and fact-check events on top of the existing meeting event channel.
- Thread persisted `agendaArtifact` into the meeting UI so the agenda rail can render objectives, dependencies, and success signals instead of only a flat string list.
- Add artifact-triggered AI actions in `apps/ai-service` that consume `agenda.v1` and publish agenda nudges, owner reminders, and discussion transitions.
- Establish package boundaries for shared types versus transport-specific contracts.
- Add robust reconnect/resume behavior so reloads can reclaim the same participant identity and media session without stale rows.
- Move from a single demo router to room-aware worker/router allocation once scaling requirements are defined.
- Add HTTPS/TLS termination and TURN-over-TLS on `443` so restrictive enterprise networks can still join meetings reliably.

## Questions To Resolve

- Maximum participant target for the initial demo.
- Whether the events channel should run over WebSocket, data channel, or both.
- How AI interventions are surfaced in the UI without becoming distracting.
