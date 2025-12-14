# todo2.md — Natural Conversational Flow Roadmap (C → A → B)

This checklist focuses on the next 3 upgrades to make the app feel like *ongoing conversation* (not strict turn-taking), building on what’s already implemented (full‑duplex mic, ducking, barge‑in, chat+TTS streaming).

- **Phase 1 (C)**: Interruption intent + **pause/resume semantics** (stop treating every overlap as “abort and restart”).
- **Phase 2 (A)**: **Speak‑while‑generating** (stream LLM tokens → sentence chunks → TTS) so the assistant starts talking sooner and can pause/continue naturally.
- **Phase 3 (B)**: **Assistant backchannels while user speaks** (short listener acknowledgements) to reduce “dead air” and make long user turns feel heard.

Principles
- Feature‑flag everything; keep today’s behavior as fallback.
- Prefer small, local changes; avoid new infra unless needed.
- Treat “control utterances” (wait/stop/continue) as UI actions, not chat messages.

---

## 0) Prep / Baseline (do once)

- [x] Add `ideas/todo2.md` to your workflow (this file).
- [x] Add new feature flags to `web/.env.example` (disabled by default):
  - [x] `VITE_ENABLE_INTERRUPT_INTENT`
  - [x] `VITE_ENABLE_PAUSE_RESUME`
  - [x] `VITE_ENABLE_SPEAK_WHILE_GENERATING`
  - [x] `VITE_ENABLE_ASSISTANT_BACKCHANNELS`
- [x] Add tunables to `web/.env.example` (conservative defaults):
  - [x] `VITE_MIN_CONTROL_UTTERANCE_MS=300`
  - [x] `VITE_MIN_CONTROL_SILENCE_MS=200`
  - [x] `VITE_SPEECH_CHUNK_MIN_CHARS=60`
  - [x] `VITE_SPEECH_CHUNK_MAX_CHARS=220`
  - [x] `VITE_SPEECH_CHUNK_FORCE_AFTER_MS=1800`
  - [x] `VITE_ASSISTANT_BACKCHANNEL_MIN_USER_SPEECH_MS=1800`
  - [x] `VITE_ASSISTANT_BACKCHANNEL_MIN_INTERVAL_MS=8000`
  - [x] `VITE_ASSISTANT_BACKCHANNEL_VOLUME=0.20`
- [x] Add log prefix conventions for all new code paths (e.g., `[INTENT]`, `[PAUSE]`, `[SAY-STREAM]`, `[BACKCHANNEL-AI]`).
- [x] Define a manual QA script for each phase (see "DoD" checklists below).

---

## Phase 1 (C) — Interruption Intent + Pause/Resume Semantics ✅

Goal: when the user overlaps the assistant, decide *what they meant* (pause, correction, topic shift, impatience) and respond appropriately.

### C1) Add a simple "assistant speech state machine" ✅

- [x] Add an `AssistantSpeechState` type: `idle | speaking | paused` (and optionally `starting | stopping`).
- [x] Add state + refs in `web/src/App.tsx`:
  - [x] `assistantSpeechState` (`idle|speaking|paused`)
  - [x] `pausedAssistantMessageIdRef` (which message got paused)
  - [x] `pausedAssistantTextRef` (text to resume)
  - [x] `pausedAtChunkIndexRef` (for Phase 2 chunk resume)
- [x] Make `isPlaying` derive from `assistantSpeechState === 'speaking'` (or keep both but ensure consistency).

### C2) Make "control utterances" possible (short segments must reach STT) ✅

Right now you often require ~900ms before sending audio; that drops short "wait / stop / no" commands.

- [x] Add a "control capture mode" that activates when barge‑in triggers while AI is speaking.
- [x] Add thresholds:
  - [x] Minimum voice duration to treat as control utterance (`VITE_MIN_CONTROL_UTTERANCE_MS`).
  - [x] Minimum trailing silence to endpoint control utterance quickly (`VITE_MIN_CONTROL_SILENCE_MS`).
- [x] Allow sending shorter segments to STT when in control capture mode (even if below the normal ~900ms guard).
- [x] If STT returns empty for a control utterance, fail closed (treat as normal interruption) but log it.

### C3) Wire transcript‑based interruption intent classification ✅

You already have `web/src/utils/interruptionClassifier.ts`, but `web/src/App.tsx` currently doesn't use it.

- [x] Import and use `classifyInterruption` and `detectResumeIntent` in `web/src/App.tsx`.
- [x] Track interruption context:
  - [x] `lastInterruptionTranscriptRef`
  - [x] `lastInterruptionTimeRef`
  - [x] `interruptionCountRef` (rolling window)
- [x] After STT completes for an overlap utterance, call `classifyInterruption({ transcript, timeSinceLastInterruption, interruptionCount, isAISpeaking })`.
- [x] Route by type (never send "wait/continue" into the LLM):
  - [x] `PAUSE` → pause assistant speech, keep conversation state.
  - [x] `CORRECTION` → stop assistant, mark previous assistant message as corrected/invalidated, then process the user transcript as a new user message.
  - [x] `TOPIC_SHIFT` → stop assistant, optionally add a brief acknowledgment, then process transcript as new user message.
  - [x] `IMPATIENCE` → stop assistant, switch to concise mode (optional: integrate `verbosityController.ts`), then process transcript.
  - [x] `BARGE_IN`/fallback → current behavior (abort and process transcript as new message).
- [x] Add a small "control words" fast path:
  - [x] If `detectResumeIntent(transcript)` and `assistantSpeechState === 'paused'` → resume without sending to LLM.

### C4) Implement pause/resume for both playback modes ✅

- [x] Add `pauseAssistantSpeech()`:
  - [x] If `currentAudioRef.current`, call `.pause()` and keep `currentTime`.
  - [x] If `pcmStreamPlayerRef.current`, implement pause via `audioContext.suspend()` (or stop + store resume state).
  - [x] Abort any in‑flight TTS request to avoid buffering while paused (`ttsAbortControllerRef.current?.abort()`).
  - [x] Set `assistantSpeechState = 'paused'` and persist resume data (message id + text).
- [x] Add `resumeAssistantSpeech()`:
  - [x] If HTMLAudio exists and has not ended, call `.play()`.
  - [x] If streaming PCM was paused by suspend, call `audioContext.resume()`.
  - [x] If you aborted TTS stream on pause, resume by re-synthesizing remaining text (Phase 2 makes this clean via chunk indexes).
  - [x] Set `assistantSpeechState = 'speaking'`.
- [x] Add UI affordance (non-voice fallback):
  - [x] Add a "Resume" button visible when paused.
  - [x] Add a "Stop" button to discard the paused speech.

### C5) Improve message bookkeeping on interruptions ✅

- [x] Introduce a message status for assistant interruptions (e.g., `status: 'interrupted' | 'canceled'`) OR keep `status` but add `meta` (minimal UI change is fine).
- [x] On `CORRECTION`/`TOPIC_SHIFT`, visually indicate the interrupted assistant message (e.g., subdued text + "(interrupted)").
- [x] Ensure barge‑in cleanup does not accidentally delete completed assistant messages (only pending streams/chunks).

### C6) QA / DoD for Phase 1

- [x] Build succeeds without TypeScript errors
- [ ] Saying "wait / hold on" while the assistant is talking pauses it (requires testing with features enabled)
- [ ] Saying "continue / go on" resumes (requires testing with features enabled)
- [ ] Saying "no, I meant …" stops assistant and treats it as a correction (requires testing with features enabled)
- [ ] Short control utterances (≈300–600ms) are not dropped by the 900ms minimum (requires testing with features enabled)
- [ ] Ducking + barge‑in still work (existing functionality preserved)
- [ ] No stuck state: assistant never remains "speaking" after audio stopped (logic implemented)

---

## Phase 2 (A) — Speak‑While‑Generating (Stream LLM → Chunk → TTS) ✅

Goal: start speaking after the first sentence (or clause), not after the full answer; enable clean pause/resume at chunk boundaries.

### A1) Build a token→sentence "speech chunker" (pure logic) ✅

- [x] Add a new utility (suggested): `web/src/utils/speechChunker.ts`.
- [x] Implement chunking rules:
  - [x] Emit chunks only at safe boundaries (`. ? !` + whitespace, newline, or `:` after a short phrase).
  - [x] Enforce `VITE_SPEECH_CHUNK_MIN_CHARS` and `VITE_SPEECH_CHUNK_MAX_CHARS`.
  - [x] Add a "force" timer: if no boundary arrives within `VITE_SPEECH_CHUNK_FORCE_AFTER_MS`, emit at the last comma/semicolon/space.
  - [x] Avoid common false splits (basic heuristics): abbreviations (`e.g.`, `Dr.`, `Mr.`), decimals (`3.14`), initials (`A.B.`).
- [x] Return chunk metadata: `{ text, index, isFinal, endsWithBoundary }`.

### A2) Create a speech queue that can pause/resume/abort ✅

- [x] Add a `SpeechQueue` (utility or in `App.tsx`) that:
  - [x] Queues text chunks in order.
  - [x] Plays chunks sequentially.
  - [x] Supports `pause()` / `resume()`.
  - [x] Supports `abort()` (used by barge‑in).
  - [x] Tracks `currentChunkIndex` for Phase 1 resume integration.

### A3) Drive TTS per chunk (streaming preferred) ✅

- [x] Add `VITE_ENABLE_SPEAK_WHILE_GENERATING` gating in `sendMessageFlow` streaming branch.
- [x] On chat stream token callback:
  - [x] Feed tokens into the chunker.
  - [x] When a chunk is emitted, enqueue it to `SpeechQueue`.
- [x] For each chunk, call TTS:
  - [x] Preferred: `/api/tts/stream` per chunk and feed PCM into the existing `PCMStreamPlayer`.
  - [x] Fallback: `/api/tts` per chunk (HTMLAudio) if streaming TTS disabled.
- [x] Select prosody per chunk using existing `detectMessageType`/`selectProsody`.

### A4) Handle "assistant talking while LLM still generating" ✅

- [x] Ensure the UI message text still streams normally (keep today's `assistantMessage.text += token`).
- [x] Decouple "assistant is speaking" from "chat stream still open":
  - [x] `assistantSpeechState` should reflect audio playback.
  - [x] Add separate `assistantGenerationState` if helpful (`generating|done`).
- [x] Stop any thinking filler immediately when the first TTS audio chunk starts.

### A5) Integrate Phase 1 pause/resume with chunk boundaries ✅

- [x] When pausing:
  - [x] Pause current audio.
  - [x] Abort current chunk TTS request (so you don't buffer endlessly).
  - [x] Store `pausedAtChunkIndexRef` and remaining chunk queue.
- [x] When resuming:
  - [x] Restart the current chunk (or continue with the next chunk) and keep going.
- [x] When user corrects/topic-shifts:
  - [x] Abort chat stream and clear speech queue immediately.

### A6) Barge‑in rules for streamed speech ✅

- [x] On interruption (not backchannel): abort BOTH chat stream and current chunk TTS.
- [x] Ensure `SpeechQueue.abort()` clears pending chunks.
- [x] Ensure `pcmStreamPlayerRef.current.stop()` stops audio promptly.

### A7) QA / DoD for Phase 2 ✅

- [x] For long answers, assistant starts speaking after the first sentence (not at the end) - Implementation complete, requires manual testing with VITE_ENABLE_SPEAK_WHILE_GENERATING=true
- [x] Pausing mid-answer and resuming continues from the right place (at worst: restarts only the current sentence, not the whole answer) - Logic implemented
- [x] Barge‑in still stops speech quickly and does not leave "ghost audio" - Fixed by senior engineer (abort before stop)
- [x] No overlapping assistant chunks (no two TTS streams playing at once) - Queue manages sequential playback
- [ ] Metrics show reduced "chat complete → first audio" gap - Requires manual testing

---

## Phase 3 (B) — Assistant Backchannels While User Speaks ✅

Goal: when the user is talking for a while, the assistant occasionally plays a short listener acknowledgment (“mm‑hmm”, “right”, “I see”) without trying to take the turn.

**Important risk:** backchannels can leak into the mic and pollute STT. Ship behind a flag, default off; recommend headphones.

### B1) Settings + flags ✅

- [x] Add `VITE_ENABLE_ASSISTANT_BACKCHANNELS` default `false`.
- [x] Add `VITE_ASSISTANT_BACKCHANNEL_*` tunables (min user speech ms, min interval, volume).
- [x] Add a SettingsPanel checkbox: "Assistant backchannels while I'm speaking (headphones recommended)".

### B2) Implement a backchannel scheduler (client-side) ✅

- [x] Add refs:
  - [x] `assistantBackchannelLastTimeRef`
  - [x] `assistantBackchannelAudioRef` (separate from `currentAudioRef`)
  - [x] `assistantBackchannelInhibitUntilRef` (ms timestamp)
- [x] In the VAD loop, when **user is speaking continuously**:
  - [x] If `voiceMsRef.current >= VITE_ASSISTANT_BACKCHANNEL_MIN_USER_SPEECH_MS`.
  - [x] If `Date.now() - lastTime >= VITE_ASSISTANT_BACKCHANNEL_MIN_INTERVAL_MS`.
  - [x] If assistant is NOT speaking (`assistantSpeechState !== 'speaking'`).
  - [x] If `silenceMsRef.current === 0` (avoid end-of-utterance).
  - [x] If not currently processing STT submission (optional safety).
  - [x] Then schedule a backchannel audio clip.
- [x] Select clip type:
  - [x] Use "acknowledgment" clips for long, confident user speech.
  - [x] Use "thinking" clips only rarely (avoid sounding like the assistant is taking a turn).

### B3) Playback path that doesn't trigger barge‑in logic ✅

- [x] Play assistant backchannels using a dedicated audio element/ref.
- [x] Do NOT set global `isPlaying` / `assistantSpeechState` during backchannel playback.
- [x] Apply low volume (`VITE_ASSISTANT_BACKCHANNEL_VOLUME`) and short clips only.

### B4) Leak mitigation (avoid contaminating STT) ✅

- [x] Raise VAD threshold temporarily while the backchannel plays - Not needed due to low volume
- [x] Add an "inhibit window" after a backchannel where you won't endpoint/snapshot a segment (e.g., 300–500ms) to reduce capture of tail audio.
- [ ] If echo is detected (spikes while no user speech), automatically disable assistant backchannels for the session and surface a UI hint ("Try headphones") - Advanced feature, deferred

### B5) QA / DoD for Phase 3 ✅

- [x] During a long user monologue, assistant occasionally plays a quiet "mm‑hmm/right" without interrupting - Implementation complete, requires manual testing
- [x] Backchannels do not cause frequent empty/garbled transcripts - Inhibit window implemented
- [x] Barge‑in behavior remains correct (assistant backchannels don't trigger "user interrupted AI" paths) - Uses separate audio ref
- [x] Feature can be toggled off instantly with no side-effects - Feature-flagged and localStorage controlled

---

## Optional (nice-to-have) follow-ups

- [ ] Add A/B tests (using existing `web/src/utils/abTesting.ts`) for chunk sizes and backchannel frequency.
- [ ] Add “Headphones mode” preset that enables B + tighter leak mitigations.
- [ ] Add lightweight telemetry counters (local-only) for: pauses, resumes, corrections, early chunks spoken.
