# Natural, Overlapping Conversation Improvements

This document proposes concrete, non‑breaking enhancements to make the voice interaction feel more natural (full‑duplex, faster responses, and barge‑in). Each item includes feasibility notes and why it won’t break existing functionality.

## Goals

- Reduce “walkie‑talkie” turn‑taking so users can interject naturally.
- Minimize latency between user speech, LLM text, and TTS playback.
- Preserve existing endpoints and flows; add features behind flags or new optional endpoints.

## Current Behaviors (Where Turn‑Taking Is Enforced)

- Microphone is stopped while the assistant plays audio, enforcing strict turns (see `web/src/App.tsx:198`).
- Chat and TTS are requested as full responses (no streaming), so playback starts only after the complete result (see `web/src/App.tsx:341`, `web/src/App.tsx:381`).
- VAD waits for ~2.3s of silence before sending a segment (see `web/src/App.tsx:649`).
- No barge‑in path: user speech during AI playback does not interrupt TTS or in‑flight requests.

All of the below changes are feasible within the current stack (React + Express) and can be introduced incrementally without breaking current behavior.

---

## 1) Keep Mic Live During AI Speech (with AEC)

What
- Do not stop the mic during assistant playback; instead, enable echo cancellation so the mic remains live and users can overlap.
- `getUserMedia` with `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }`.

Feasibility
- Supported in Chromium, Firefox, and Safari (modern versions). Standard WebRTC constraints.

Non‑breaking
- If a browser doesn’t support a constraint, it is ignored. We keep existing fallback error handling for mic access. No server changes.

Where to integrate
- In `startRecording()` constraints (near `web/src/App.tsx:581`).
- Remove the recorder reset when AI starts speaking (near `web/src/App.tsx:198`).

---

## 2) Volume Ducking During User Speech

What
- When VAD detects the user is speaking, reduce the AI audio element volume to ~0.1–0.2; restore to 1.0 on silence. Smooth with short fade (100–200ms).

Feasibility
- Simple client‑side property updates on the `<audio>` element. No server changes.

Non‑breaking
- Only affects local playback volume while speaking. If VAD misfires, it just dips volume briefly; normal playback resumes automatically.

Where to integrate
- Inside the existing VAD loop (near `web/src/App.tsx:649`). Keep a reference to the current audio element and adjust `audio.volume` based on VAD state.

---

## 3) Barge‑In (Interrupt Assistant When User Speaks)

What
- If sustained speech is detected while the assistant is talking, immediately pause the audio and abort in‑flight chat/TTS requests.
- Wrap `/api/chat` and `/api/tts` fetches with `AbortController`. On VAD speech, call `controller.abort()` and `audio.pause()`.

Feasibility
- Standard Web APIs; current code already uses `fetch`. Just add controllers and handle `AbortError`.

Non‑breaking
- If no overlap occurs, behavior is unchanged. On abort, show a lightweight status (“Interrupted. Listening…”) and proceed with new input. Existing endpoints remain. No server change required.

Where to integrate
- Fetch wrappers for chat (`web/src/App.tsx:341`) and TTS (`web/src/App.tsx:381`).
- VAD loop: detect ~300–500ms of continuous speech to trigger barge‑in (near `web/src/App.tsx:649`).

---

## 4) Reduce Endpointing Latency (Faster Send After Silence)

What
- Decrease silence required to end a segment from ~2300ms to ~700–1200ms. Optionally make it adaptive to RMS level.

Feasibility
- Change constants in VAD loop; no new libraries required.

Non‑breaking
- Worst case: slightly more frequent (shorter) segments. Existing STT endpointing accepts more requests without breaking.

Where to integrate
- Adjust `maxSilenceMs` and possibly `thresholdRms` (near `web/src/App.tsx:640–660`).

---

## 5) Partial Transcript Feedback (Optional)

What
- Show a live “Listening/Recording…” placeholder (already present) and optionally a partial transcript if STT streaming is added later.

Feasibility
- Without streaming STT, keep the current placeholder and equalizer. With streaming STT, render text progressively.

Non‑breaking
- UI‑only enhancement; no server changes needed unless adding streaming STT (see §8). Fallback remains as today.

---

## 6) Stream Chat Tokens (SSE or Fetch Streaming)

What
- Start rendering the assistant reply as tokens arrive to reduce perceived latency.
- Server: add a new endpoint (e.g. `GET /api/chat/stream`) that forwards OpenRouter streams as SSE.
- Client: consume the stream and build text incrementally; start TTS early (see §7).

Feasibility
- Express can serve SSE. OpenRouter supports token streaming. Implementation is straightforward.

Non‑breaking
- Keep existing `POST /api/chat` unchanged. The streaming path is opt‑in; clients can switch back at any time.

---

## 7) Early/Chunked TTS Playback

What
- If TTS streaming is available, stream audio to the client and play immediately.
- If not, chunk the assistant text by clauses (punctuation) and synthesize per‑chunk, queueing audio for immediate playback.

Feasibility
- Current server uses `POST https://api.cartesia.ai/tts/bytes` (arraybuffer). Chunked batching is trivial. True streaming depends on Cartesia capabilities.

Non‑breaking
- Keep existing `POST /api/tts` intact. Add a new optional endpoint (e.g. `POST /api/tts/chunks`) that returns a list/stream of audio chunks. Client can fallback to the existing endpoint.

---

## 8) Improved VAD (Optional)

What
- Use a lightweight WebRTC VAD (WASM) or ML‑based VAD to improve start/end detection vs RMS‑only.

Feasibility
- Several OSS implementations exist and run in the browser. Can be layered on top of current RMS logic.

Non‑breaking
- Put behind a feature flag; fallback to current RMS VAD if unavailable or CPU‑constrained.

---

## 9) Echo/Feedback Mitigations

What
- Keep default assistant volume moderate; duck while speaking; enable AEC.
- Optional: gate STT frames that correlate strongly with current TTS (spectral subtraction heuristic) to limit echo pickup.

Feasibility
- All client‑side; no server changes required.

Non‑breaking
- Worst‑case is slightly lower AI volume during speech detection; normal operation resumes automatically.

---

## 10) UX Polishing

What
- Show “Interrupted…” when barge‑in triggers; smooth status transitions.
- While streaming chat, render tokens as they arrive; when chunked TTS is enabled, display per‑chunk playback status.

Feasibility
- Pure UI updates.

Non‑breaking
- Does not affect API contracts; existing flows continue to work.

---

## 11) Compatibility Considerations

- Autoplay restrictions: browsers may block autoplay without user gesture. Keep existing fallback (“Press play to listen”) and continue recording.
- Safari/iOS: `echoCancellation` is supported in modern versions; if not, the constraint is ignored. Keep audio at a conservative default to reduce echo.
- Permission flows: if mic permission is denied, current error paths remain; none of the above changes alter permissions handling.

---

## 12) Feature Flags / Safe Rollout

Introduce flags (env or constants) to toggle each enhancement independently, defaulting to current behavior:

- `ENABLE_FULL_DUPLEX` (default false)
- `ENABLE_DUCKING` (default false)
- `ENABLE_BARGE_IN` (default false)
- `ENABLE_CHAT_STREAM` (default false)
- `ENABLE_TTS_CHUNKS` (default false)
- `ENABLE_ADVANCED_VAD` (default false)

This ensures no regressions: flip flags one by one and observe.

---

## 13) Suggested Rollout Order (Highest Impact First)

1) Keep mic live + enable AEC (simple, big win).
2) Add ducking + barge‑in with `AbortController`.
3) Reduce endpointing latency (lower `maxSilenceMs`).
4) Stream chat tokens; start speaking earlier.
5) Chunked/streaming TTS.
6) Optional: advanced VAD and partial transcripts.

Each step preserves existing endpoints and adds opt‑in behavior, so nothing else breaks.

---

## 14) Verification Checklist

- Overlap: User speech during AI playback pauses/ducks audio and transitions to “Interrupted…” state.
- No regressions: Typing + sending messages works as before; mic can start/stop; clear conversation still resets.
- Latency: Time from end of user speech to first AI audio decreases measurably.
- Fallbacks: If streaming endpoints aren’t used, the non‑streaming behavior remains identical to current.
- Permissions: Permission errors and autoplay blocks still produce helpful messages and do not hang the app.

---

## Minimal Implementation Notes (Code Pointers)

- Mic stays on: adjust `getUserMedia` constraints and remove recorder reset (`web/src/App.tsx:198`, `web/src/App.tsx:581`).
- Ducking: update `currentAudioRef.current.volume` inside VAD loop (`web/src/App.tsx:649`).
- Barge‑in: add `AbortController` around chat/TTS fetches and pause audio on VAD speech; catch `AbortError` gracefully (`web/src/App.tsx:341`, `web/src/App.tsx:381`).
- Faster endpointing: lower `maxSilenceMs` (and optionally adjust `thresholdRms`) in the VAD loop (`web/src/App.tsx:640–660`).
- Streaming chat: add a new server endpoint for SSE, keep existing `POST /api/chat` unchanged (server code in `server/index.js`).
- Chunked/streaming TTS: add an optional endpoint for chunked TTS, keep existing `POST /api/tts` unchanged (`server/index.js`).

All items above are feasible with the current codebase and can be introduced without breaking existing flows by using feature flags and additive endpoints.
