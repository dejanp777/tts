# todo3.md — Low-Latency, Non‑Turn Conversation Roadmap (Keystone: Streaming STT)

This checklist builds on `ideas/todo2.md` (Phases 1–3) and focuses on the remaining gap: the app still *feels* sequential because the pipeline is gated by endpointing + “send audio → wait for STT → then LLM → then TTS”.

The single biggest unlock is **streaming STT (partial transcripts via WebSocket)**. Once partial text exists, you can run turn prediction on real text, start the LLM early, and stream TTS sooner — making the interaction feel continuous rather than turn-based.

Principles
- Feature‑flag everything; keep today’s behavior as fallback.
- Optimize for **time‑to‑first‑sound** and **barge‑in responsiveness**, not just total time.
- Prefer local/pre‑generated audio for micro‑utterances (backchannels/fillers).
- Measure each phase with the existing `⏱️ [TIMING]` logs; add missing metrics.

---

## Phase 0 — Fix Current No‑Ops / Latency Regressions (must‑do)

These are practical issues that currently prevent the “advanced” features from working as intended.

- [ ] Fix turn prediction no‑op: stop sending `transcript: ''` and/or update backend fusion to use **VAP** when transcript is missing so it can return `takeTurn=true` *before* `VITE_MAX_SILENCE_MS`.
- [ ] Fix two‑pass endpointing over‑waiting: when no partial transcript is available, bypass semantic validation (do not treat empty transcript as “incomplete”) so endpointing doesn’t extend the silence threshold by default.
- [ ] Fix barge‑in→pause semantics: set/clear `pauseOnBargeInRef` correctly so AbortError handling preserves a paused assistant state (instead of treating it as a full interruption).
- [ ] Make `SpeechQueue.abort()` actually cancel in‑flight TTS: pass an `AbortSignal` into the chunk play callback and into `synthesizeSpeechStream` so barge‑in/pause stops network + audio immediately.
- [ ] Prevent “assistant idle while audio still playing”: tie `assistantSpeechState` to **actual playback drain** (not just queue completion); avoid flicker during chunk gaps.
- [ ] Reduce main‑thread churn during chat streaming: throttle/batch `setMessages` updates while tokens stream so VAD/ducking stays responsive.
- [ ] Clean up env separation: remove non‑`VITE_` vars from `web/.env.example` (they won’t reach the browser) and keep TurnGPT/VAP config in `server/.env.example`.

**DoD**
- [ ] Turn prediction can trigger before max silence (verified in console/server logs).
- [ ] Endpointing does not “extend” solely because transcript is empty.
- [ ] Barge‑in pause doesn’t drop/incorrectly mark assistant messages.
- [ ] Abort stops speech quickly and cancels upstream streams (no “ghost audio”).

---

## Phase 1 — Quick, Measurable Tuning (safe experiments)

Ship these behind flags/A‑B tests so you can revert quickly if naturalness drops.

- [ ] A/B test smaller speech chunks (earlier first audio) in `web/.env`:
  - [ ] Try `VITE_SPEECH_CHUNK_MIN_CHARS=40` (was 60)
  - [ ] Try `VITE_SPEECH_CHUNK_MAX_CHARS=150` (was 220)
  - [ ] Re-tune `VITE_SPEECH_CHUNK_FORCE_AFTER_MS` if speech gets choppy
- [ ] After Phase 0 turn prediction fixes, test more aggressive turn‑taking:
  - [ ] Try `VITE_MIN_SILENCE_MS=350` (was 500) to check prediction earlier
  - [ ] Try `VITE_FUSION_THRESHOLD=0.6` (was 0.7) for earlier take‑turn decisions
- [ ] Reduce “first audio” payload size (if supported by Cartesia TTS):
  - [ ] Evaluate `pcm_s16le` vs `pcm_f32le` for streaming
  - [ ] Evaluate lower sample rates for backchannels/fillers (keep main voice higher quality)
- [ ] Fastest real‑world win: pick a lower‑latency OpenRouter model/provider (opt‑in preset) and verify with `Chat first token` timing.

**DoD**
- [ ] `⏱️ [TIMING] Chat first token` and `TTS first chunk` are measurably lower with no major quality regression.

---

## Phase 2 — Streaming STT via WebSocket (keystone / highest impact)

This enables partial transcripts, real-time “listening” feedback, text-based turn prediction, and early LLM start.

Backend
- [ ] Confirm Cartesia real‑time STT protocol (audio format, message schema, partial/final event types).
- [ ] Add a WS endpoint `ws://<server>/stt/stream` behind `ENABLE_STT_STREAMING=true`.
- [ ] Implement `server/stt-streaming.js` session lifecycle: connect → audio frames → partials → final → close; handle keepalive, reconnect, and backpressure.
- [ ] Add timing metrics: time‑to‑first‑partial, time‑to‑final, and disconnect reasons.

Frontend
- [ ] Open STT WS when recording starts; stream audio frames continuously (recommend PCM16 @ 16k).
- [ ] Render partial transcript live (confidence UX: “I’m hearing you…”).
- [ ] Commit a turn when end‑of‑turn is predicted; request/receive final transcript; fall back to current `/api/stt` if WS fails.

Integration
- [ ] Feed partial transcript into turn prediction (TurnGPT) + endpointing (replace empty transcript).
- [ ] Start “Thinking…” earlier when end‑of‑turn confidence is high (don’t wait for long silence).

**DoD**
- [ ] Partial transcript appears within ~200–500ms of speech start on a good connection.
- [ ] “User stops → assistant first audio” improves materially versus baseline logs.

---

## Phase 3 — Parallelize the Pipeline (LLM starts before user fully ends)

Once partial transcripts exist, perceived latency drops by doing work while the user is still finishing.

- [ ] Start chat streaming early when partial transcript is stable + end‑of‑turn confidence is high; abort/restart if final transcript diverges.
- [ ] Make speak‑while‑generating the default once stable: tokens → chunker → per‑chunk TTS stream (first sentence/clause speaks ASAP).
- [ ] Improve correction handling: if the user corrects mid‑answer, abort instantly and treat transcript as new user message without “dead air”.

**DoD**
- [ ] “End of user turn → first assistant audio” is consistently <800ms on a good connection.

---

## Phase 4 — Audio Pipeline Off Main Thread (smoother full‑duplex)

This reduces jank and improves barge‑in/ducking responsiveness under load.

- [ ] Replace `ScriptProcessorNode` VAD/PCM capture with `AudioWorklet` (and add the required Vite build wiring).
- [ ] Downsample/resample on the client (or in a Worker/Worklet) for streaming STT to minimize bandwidth and server ffmpeg work.
- [ ] Add guardrails: cap buffered PCM while paused; apply backpressure to WS to prevent memory growth.

**DoD**
- [ ] No noticeable UI stutter during long chat streams; ducking + barge‑in remain responsive.

---

## Phase 5 — Practical UX/Perf Polish (cheap wins)

- [ ] Use local/pre‑generated audio for assistant backchannels (avoid per‑backchannel TTS requests; reduces latency + cost).
- [ ] Add “Headphones mode” preset: enables assistant backchannels + stronger leak mitigations + warning UI.
- [ ] Add local‑only telemetry counters: pauses, resumes, corrections, early‑turn triggers, abort‑to‑silence time, partial‑to‑final transcript deltas.

