# Memory

- Product name: `Mote`.
- Platform direction: meeting orchestration platform with SFU infrastructure, live transcription, and near-realtime AI assistance.
- Backend stack target: Bun + Elysia + mediasoup.
- Frontend stack target: Svelte demo app using mediasoup client primitives.
- Additional service: LangGraph-based AI service for tools and agents.
- All persistent project context should be maintained under `./docs`.
- Initial events transport decision: WebSocket-first, with WebRTC data channels deferred until media transport setup exists.
- Meeting bootstrap route: `/`.
- Meeting room route: `/{meet-code}`.
- Room and participant state should persist in SQLite, not in-memory maps.
- Current demo mediasoup shape: one worker, one router, WebSocket signaling, and per-participant send/recv transports.
