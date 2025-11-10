# Natural, Overlapping Conversation Improvements

This document proposes concrete, non‑breaking enhancements to make the voice interaction feel more natural (full‑duplex, faster responses, and barge‑in). Each item includes feasibility notes and why it won’t break existing functionality.

## Implementation Status

**✅ COMPLETED FEATURES:**
- ✅ Phase 1: Streaming TTS Implementation (§7) - Reduces time-to-first-audio from 1-3s to 100-300ms
- ✅ Phase 1: Reduce Endpointing Latency (§4) - Lowered maxSilenceMs from 2300ms to 800ms
- ✅ Phase 2: Keep Mic Live with AEC (§1) - Full-duplex audio with echo cancellation
- ✅ Phase 2: Volume Ducking (§2) - AI volume reduces to 0.15 when user speaks
- ✅ Phase 2: Barge-In Support (§3) - User can interrupt AI with 300ms sustained speech
- ✅ Phase 3: Stream Chat Tokens (§6) - Assistant reply renders as tokens arrive

**🔧 ENVIRONMENT VARIABLES CONFIGURED:**
```
VITE_ENABLE_TTS_STREAM=true
VITE_MAX_SILENCE_MS=800
VITE_ENABLE_FULL_DUPLEX=true
VITE_ENABLE_DUCKING=true
VITE_DUCK_VOLUME=0.15
VITE_ENABLE_BARGE_IN=true
VITE_ENABLE_CHAT_STREAM=true
```

**✅ CODE REVIEW FIXES COMPLETED:**
- ✅ Streaming TTS AbortController - Barge-in now cancels network activity
- ✅ PCMStreamPlayer Gain Control - Ducking now works for streaming TTS
- ✅ Mic Audio Routing Fix - Zero-gain node prevents feedback
- ✅ STT Retry Bug Fix - Fixed undefined audioBase64 variable
- ✅ Dynamic VAD Threshold - Raised threshold during playback to reduce false positives

**📋 REMAINING OPTIONAL TASKS:**
- [ ] Advanced VAD (§8) - Replace RMS-based VAD with ML-based solution
- [ ] Partial Transcripts (§5) - Show live transcription during recording

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

## 1) Keep Mic Live During AI Speech (with AEC) - [x]

What
- Do not stop the mic during assistant playback; instead, enable echo cancellation so the mic remains live and users can overlap.
- `getUserMedia` with `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }`.

Feasibility
- Supported in Chromium, Firefox, and Safari (modern versions). Standard WebRTC constraints.

Non‑breaking
- If a browser doesn’t support a constraint, it is ignored. We keep existing fallback error handling for mic access. No server changes.

Where to integrate
- In `startRecording()` constraints (function `startRecording` in `web/src/App.tsx`).
- Remove the recorder reset when AI starts speaking (the `resetRecorder()` call in the autoplay handler in `web/src/App.tsx`).

Implementation details
- With a selected device: `audio: { deviceId: { exact: id }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }`
- Without a specific device: `audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }`
- Safari/iOS note: unsupported constraints are ignored. Keep ducking (see §2) as a backup to mitigate pickup of assistant audio.

---

## 2) Volume Ducking During User Speech - [x]

What
- When VAD detects the user is speaking, reduce the AI audio element volume to ~0.1–0.2; restore to 1.0 on silence. Smooth with short fade (100–200ms).

Feasibility
- Simple client‑side property updates on the `<audio>` element. No server changes.

Non‑breaking
- Only affects local playback volume while speaking. If VAD misfires, it just dips volume briefly; normal playback resumes automatically.

Where to integrate
- Inside the existing VAD loop (interval handler in `startRecording` in `web/src/App.tsx`). Keep a reference to the current audio element and adjust `audio.volume` based on VAD state.

Implementation details
- Smoothly ramp volume over ~100–200 ms to avoid clicks: when speaking starts, ramp to a `DUCK_VOLUME` (e.g., 0.15); when silence resumes, ramp back to 1.0.
- Reduce false positives by slightly raising the VAD threshold while the assistant is speaking (e.g., multiply your RMS threshold by ~1.5× when `isPlaying` is true).

---

## 3) Barge‑In (Interrupt Assistant When User Speaks) - [x]

What
- If sustained speech is detected while the assistant is talking, immediately pause the audio and abort in‑flight chat/TTS requests.
- Wrap `/api/chat` and `/api/tts` fetches with `AbortController`. On VAD speech, call `controller.abort()` and `audio.pause()`.

Feasibility
- Standard Web APIs; current code already uses `fetch`. Just add controllers and handle `AbortError`.

Non‑breaking
- If no overlap occurs, behavior is unchanged. On abort, show a lightweight status (“Interrupted. Listening…”) and proceed with new input. Existing endpoints remain. No server change required.

Where to integrate
- Fetch wrappers for chat (function `requestChatCompletion`) and TTS (`synthesizeSpeech`).
- VAD loop: detect ~300–500 ms of continuous speech to trigger barge‑in in the interval handler.

Abort mechanics (clarified)
- Non‑streaming fetch: wrap with `AbortController`; on barge‑in, call `controller.abort()`.
- Streaming fetch (SSE over fetch, see §6/§7): cancel the `ReadableStreamDefaultReader` and abort the fetch via its controller.
- Playback:
  - `<audio>` element path (non‑streaming): call `audio.pause()` and clear the element/ref.
  - Streaming WebAudio path: stop feeding the PCM buffer and close the Worklet/processor; flush any queued chunks.

Acceptance criteria for barge‑in
- New user speech while assistant is talking pauses playback and cancels in‑flight network requests within <150 ms.
- UI transitions to a lightweight status such as “Interrupted. Listening…”.

---

## 4) Reduce Endpointing Latency (Faster Send After Silence) - [x]

What
- Decrease silence required to end a segment from ~2300ms to ~700–1200ms. Optionally make it adaptive to RMS level.

Feasibility
- Change constants in VAD loop; no new libraries required.

Non‑breaking
- Worst case: slightly more frequent (shorter) segments. Existing STT endpointing accepts more requests without breaking.

Where to integrate
- Adjust `maxSilenceMs` and possibly `thresholdRms` in the VAD loop inside `startRecording`.

Implementation details
- Set `maxSilenceMs` to 800–1000 ms (start at 800).
- Keep `minVoiceMs` ~100–150 ms.
- Optionally apply a short EMA/smoothing on RMS to reduce jitter.

---

## 5) Partial Transcript Feedback (Optional) - [ ]

What
- Show a live “Listening/Recording…” placeholder (already present) and optionally a partial transcript if STT streaming is added later.

Feasibility
- Without streaming STT, keep the current placeholder and equalizer. With streaming STT, render text progressively.

Non‑breaking
- UI‑only enhancement; no server changes needed unless adding streaming STT (see §8). Fallback remains as today.

---

## 6) Stream Chat Tokens (SSE via Fetch Streaming) - [x]

What
- Start rendering the assistant reply as tokens arrive to reduce perceived latency.
- Server: add a new endpoint (e.g., `POST /api/chat/stream`) that forwards OpenRouter streams as SSE.
- Client: consume the SSE using fetch streaming (ReadableStream) and build text incrementally; start TTS early (see §7).

Feasibility
- Express can serve SSE. OpenRouter supports token streaming. Implementation is straightforward.
- Use fetch streaming on the client instead of `EventSource` to allow `AbortController`‑based cancellation (required for reliable barge‑in).

Non‑breaking
- Keep existing `POST /api/chat` unchanged. The streaming path is opt‑in; clients can switch back at any time.

---

## 7) Streaming TTS Playback (SSE/WebSocket) - [x]

What
- **Primary approach**: Use Cartesia's Server-Sent Events (SSE) or WebSocket endpoints to stream raw PCM audio chunks as they're generated, eliminating the wait for complete audio synthesis.
- **Fallback approach**: If streaming isn't enabled, chunk the assistant text by clauses (punctuation) and synthesize per‑chunk, queueing audio for immediate playback.
- **Expected improvement**: Time to first audio reduces from 1-3 seconds to 100-300ms.

Feasibility
- **Cartesia supports streaming**: Both `POST https://api.cartesia.ai/tts/sse` (SSE) and `wss://api.cartesia.ai/tts/websocket` (WebSocket) endpoints stream raw PCM audio (`pcm_f32le` or `pcm_s16le` at 44100 Hz).
- **SSE recommended first**: Simpler to implement than WebSocket; uses standard HTTP with `text/event-stream` content type.
- **WebAudio playback**: Use `AudioContext` with `AudioWorkletNode` (preferred) or `ScriptProcessorNode` (fallback) to play PCM chunks as they arrive.
- **Current server uses bytes endpoint**: `POST https://api.cartesia.ai/tts/bytes` returns complete arraybuffer. Streaming requires new endpoint.

Non‑breaking
- Keep existing `POST /api/tts` intact as fallback.
- Add new optional endpoint `GET /api/tts/stream` (SSE) or `POST /api/tts/stream` (if POST required for longer text).
- Client can toggle between streaming and non-streaming via feature flag `ENABLE_TTS_STREAM`.
- If streaming fails or is disabled, automatically fall back to existing bytes endpoint.

Implementation Details

**Server-side (SSE Proxy):**
- Add new route in `server/index.js` before `app.listen(...)` (line ~301).
- Proxy Cartesia's SSE endpoint to keep API key server-side:
  ```javascript
  app.get('/api/tts/stream', async (req, res) => {
    const { text, voiceId, emotion } = req.query;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const response = await axios.post(
        'https://api.cartesia.ai/tts/sse',
        {
          model_id: CARTESIA_TTS_MODEL,
          transcript: text,
          voice: { mode: 'id', id: voiceId },
          output_format: {
            container: 'raw',
            encoding: 'pcm_f32le',  // Float32 PCM for WebAudio
            sample_rate: 44100
          },
          generation_config: { emotion }
        },
        {
          headers: {
            'X-API-Key': CARTESIA_API_KEY,
            'Cartesia-Version': CARTESIA_VERSION
          },
          responseType: 'stream'
        }
      );

      // Parse and forward SSE events
      response.data.on('data', (chunk) => {
        res.write(chunk);
      });

      response.data.on('end', () => {
        res.end();
      });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  ```

**Client-side (Streaming Player):**
- Add streaming variant in `web/src/App.tsx` near existing `synthesizeSpeech` function.
- Prefer `fetch` with `ReadableStream` (even for GET) to enable `AbortController` and clean barge‑in. `EventSource` is acceptable for quick prototypes but cannot be aborted directly.
  ```typescript
  const synthesizeSpeechStream = async (
    text: string,
    onChunk: (pcmData: Float32Array) => void,
    signal?: AbortSignal
  ) => {
    const res = await fetch('/api/tts/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.body) throw new Error('No stream body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // parse SSE lines from buf; for each `data: <base64>` emit chunk
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const m = frame.match(/^data:\s*(.*)$/m);
        if (m) {
          const pcm = base64ToFloat32Array(m[1]);
          onChunk(pcm);
        }
      }
    }
  };
  ```

- Create PCM player using WebAudio (new utility):
  ```typescript
  class PCMStreamPlayer {
    private audioContext: AudioContext;
    private bufferQueue: Float32Array[] = [];
    private isPlaying = false;

    constructor(sampleRate = 44100) {
      this.audioContext = new AudioContext({ sampleRate });
    }

    addChunk(pcmData: Float32Array) {
      this.bufferQueue.push(pcmData);
      if (!this.isPlaying) {
        this.playNext();
      }
    }

    private playNext() {
      if (this.bufferQueue.length === 0) {
        this.isPlaying = false;
        return;
      }

      this.isPlaying = true;
      const chunk = this.bufferQueue.shift()!;
      const audioBuffer = this.audioContext.createBuffer(
        1, // mono
        chunk.length,
        this.audioContext.sampleRate
      );

      audioBuffer.copyToChannel(chunk, 0);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      source.onended = () => this.playNext();
      source.start();
    }

    stop() {
      this.bufferQueue = [];
      this.isPlaying = false;
    }
  }
  ```

**Integration Points:**
- In `sendMessageFlow`, check `ENABLE_TTS_STREAM` flag.
- If enabled, use `synthesizeSpeechStream` instead of `synthesizeSpeech`.
- Start playback immediately when first chunk arrives.
- Update message status to show streaming progress.

**Alternative: Chunked TTS (Simpler Fallback)**
- If full streaming is too complex initially, split assistant text by sentences/clauses.
- Call existing `/api/tts` endpoint per chunk.
- Queue and play chunks sequentially.
- Still reduces time-to-first-audio without requiring AudioWorklet.
- Example:
  ```typescript
  const chunks = text.split(/(?<=[.!?])\s+/); // Split by sentence
  for (const chunk of chunks) {
    await synthesizeSpeech(chunk, messageId);
  }
  ```

**Feature Flag:**
- Add to environment or constants: `ENABLE_TTS_STREAM` (default: false)
- Allows instant rollback to bytes endpoint if issues arise.

**Security:**
- API key remains server-side (never exposed to browser).
- SSE proxy validates and sanitizes input parameters.

**Browser Compatibility:**
- `EventSource`: Supported in all modern browsers but cannot be aborted directly.
- `fetch` streaming + `AbortController`: Supported in modern browsers; recommended for barge‑in.
- `AudioContext`: Supported in all modern browsers.
- `AudioWorkletNode`: Chrome 66+, Firefox 76+, Safari 14.1+.
- `ScriptProcessorNode`: Deprecated but works as fallback for older browsers.

---

## 8) Improved VAD (Optional) - [ ]

What
- Use a lightweight WebRTC VAD (WASM) or ML‑based VAD to improve start/end detection vs RMS‑only.

Feasibility
- Several OSS implementations exist and run in the browser. Can be layered on top of current RMS logic.

Non‑breaking
- Put behind a feature flag; fallback to current RMS VAD if unavailable or CPU‑constrained.

---

## 9) Echo/Feedback Mitigations - [ ]

What
- Keep default assistant volume moderate; duck while speaking; enable AEC.
- Optional: gate STT frames that correlate strongly with current TTS (spectral subtraction heuristic) to limit echo pickup.

Feasibility
- All client‑side; no server changes required.

Non‑breaking
- Worst‑case is slightly lower AI volume during speech detection; normal operation resumes automatically.

---

## 10) UX Polishing - [ ]

What
- Show “Interrupted…” when barge‑in triggers; smooth status transitions.
- While streaming chat, render tokens as they arrive; when chunked TTS is enabled, display per‑chunk playback status.

Feasibility
- Pure UI updates.

Non‑breaking
- Does not affect API contracts; existing flows continue to work.

---

## 11) Compatibility Considerations

- Autoplay restrictions: browsers may block autoplay without user gesture. Keep existing fallback (“Press play to listen”) and continue recording. Create the `AudioContext` in response to an initial user action (e.g., mic permission) to improve autoplay success.
- Safari/iOS: `echoCancellation` may be ignored in some versions. Keep assistant volume conservative and rely on ducking. `AudioWorklet` support varies; maintain a `ScriptProcessorNode` fallback.
- Permission flows: if mic permission is denied, current error paths remain; none of the above changes alter permissions handling.

---

## 12) Feature Flags / Safe Rollout

Introduce flags (env or constants) to toggle each enhancement independently, defaulting to current behavior. Suggested names:

- Client (Vite):
  - `VITE_ENABLE_TTS_STREAM` (default false)
  - `VITE_ENABLE_FULL_DUPLEX` (default false)
  - `VITE_ENABLE_DUCKING` (default false)
  - `VITE_ENABLE_BARGE_IN` (default false)
  - `VITE_ENABLE_CHAT_STREAM` (default false)
  - `VITE_ENABLE_TTS_CHUNKS` (default false)
  - `VITE_MAX_SILENCE_MS` (default 800–1000)
  - `VITE_DUCK_VOLUME` (default 0.15)
- Server:
  - `ENABLE_TTS_STREAM` (default false)
  - `ENABLE_CHAT_STREAM` (default false)

This ensures no regressions: flip flags one by one and observe. Start with `VITE_ENABLE_TTS_STREAM`/`ENABLE_TTS_STREAM` for immediate latency improvement.

---

## 13) Suggested Rollout Order (Highest Impact First)

**Phase 1: Immediate Latency Wins (Low Risk, High Impact)**
- [x] 1) **Streaming TTS (§7)** - Reduces time-to-first-audio from 1-3s to 100-300ms. Start with SSE endpoint, keep bytes endpoint as fallback. **COMPLETED**
- [x] 2) Reduce endpointing latency (§4) - Lower `maxSilenceMs` from 2300ms to 700-1200ms for faster turn completion. **COMPLETED**

**Phase 2: Natural Overlap (Medium Risk, High Impact)**
- [x] 3) Keep mic live + enable AEC (§1) - Simple constraint change, enables overlap detection. **COMPLETED**
- [x] 4) Add ducking (§2) - Volume reduction during user speech for better audio clarity. **COMPLETED**
- [x] 5) Add barge‑in with `AbortController` (§3) - Interrupt AI when user speaks over it. **COMPLETED**

**Phase 3: Advanced Features (Higher Complexity)**
- [x] 6) Stream chat tokens (§6) - Start rendering assistant reply as tokens arrive. **COMPLETED**
- [ ] 7) Optional: advanced VAD (§8) and partial transcripts (§5).

Each step preserves existing endpoints and adds opt‑in behavior via feature flags, so nothing else breaks.

---

## 14) Verification Checklist

- [ ] Overlap: User speech during AI playback causes ducking within <150 ms and, if barge‑in is enabled, pauses audio and cancels in‑flight chat/TTS.
- [ ] No regressions: Typing + sending messages works as before; mic can start/stop; clear conversation still resets.
- [ ] Latency: Time from end of user speech to first AI audio decreases measurably; with streaming TTS, first audio begins while longer text is still being generated.
- [ ] Fallbacks: If streaming endpoints aren’t used, the non‑streaming behavior remains identical to current.
- [ ] Permissions: Permission errors and autoplay blocks still produce helpful messages and do not hang the app.

---

## 15) Testing Plan (Concise)

- [ ] Chrome + Safari (desktop + iOS): overlap speech, verify ducking/interrupt, check autoplay fallback.
- [ ] Flags on/off: compare behaviors quickly by toggling env vars and reloading.
- [ ] Long texts: ensure SSE route handles large payloads via POST body; no truncation.
- [ ] Errors mid‑stream: server closes upstream; client shows “Voice interrupted” and recovers recording state.

---

## 16) Pitfalls and Mitigations

- Avoid `EventSource` on the client if you need abort; prefer fetch streaming with `AbortController` for clean barge‑in.
- Sample‑rate mismatches: send 44100 Hz PCM; resample to `audioCtx.sampleRate` if needed.
- `AudioWorklet` availability: use Worklet when available, fallback to `ScriptProcessorNode` otherwise.

---

## Minimal Implementation Notes (Code Pointers)

**Priority 1: Streaming TTS (§7)**
- [ ] Server: Add `GET /api/tts/stream` SSE proxy endpoint in `server/index.js` (before line ~301).
- [ ] Server: Proxy Cartesia's `POST https://api.cartesia.ai/tts/sse` with `pcm_f32le` output format.
- [ ] Client: Add `synthesizeSpeechStream()` function in `web/src/App.tsx` near line ~380.
- [ ] Client: Create `PCMStreamPlayer` class using `AudioContext` and buffer queue.
- [ ] Client: In `sendMessageFlow` (line ~420-459), check `ENABLE_TTS_STREAM` flag and use streaming path.
- [ ] Fallback: Keep existing `POST /api/tts` bytes endpoint unchanged for instant rollback.

**Other Features:**
- [ ] Mic stays on: adjust `getUserMedia` constraints and remove recorder reset (`web/src/App.tsx:198`, `web/src/App.tsx:581`).
- [ ] Ducking: update `currentAudioRef.current.volume` inside VAD loop (`web/src/App.tsx:649`).
- [ ] Barge‑in: add `AbortController` around chat/TTS fetches and pause audio on VAD speech; catch `AbortError` gracefully (`web/src/App.tsx:341`, `web/src/App.tsx:381`).
- [ ] Faster endpointing: lower `maxSilenceMs` (and optionally adjust `thresholdRms`) in the VAD loop (`web/src/App.tsx:640–660`).
- [ ] Streaming chat: add a new server endpoint for SSE, keep existing `POST /api/chat` unchanged (server code in `server/index.js`).
- [ ] Chunked TTS (simpler alternative): split text by sentences and call existing `/api/tts` per chunk.

All items above are feasible with the current codebase and can be introduced without breaking existing flows by using feature flags and additive endpoints.
