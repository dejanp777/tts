# Cartesia Voice Chat — System Overview

This document explains how the current application works end‑to‑end: the architecture, technologies, configuration, data flows, APIs, performance characteristics, and testing approach. It is intended for technical review and improvement suggestions.

## 1) Repository Structure

- `server/` — Node.js/Express proxy that wraps Cartesia STT/TTS and OpenRouter chat APIs, adds SSE forwarding, audio transcoding, and error handling.
- `web/` — Vite + React (TypeScript) SPA for recording audio, text chat, streaming playback, and UI state.
- `tests/` — Node scripts that exercise the STT → Chat → TTS pipeline (including SSE streams) without a browser.
- `docs/` — Implementation notes, change logs, and this overview.

## 2) Technology Stack

- Backend
  - Runtime: Node.js 20+
  - Framework: Express 5 with `cors`, `multer` (multipart), `dotenv`
  - HTTP client: `axios`
  - Media: `ffmpeg-static` for server‑side transcoding to WAV PCM
  - Streaming: Server‑Sent Events (SSE) proxy/forwarding for chat and TTS
  - Formats: WAV (PCM 16/32), raw PCM float32 (44100Hz)
  - External APIs:
    - Cartesia STT: `POST https://api.cartesia.ai/stt`
    - Cartesia TTS (bytes): `POST https://api.cartesia.ai/tts/bytes`
    - Cartesia TTS (SSE): `POST https://api.cartesia.ai/tts/sse`
    - OpenRouter Chat: `POST https://openrouter.ai/api/v1/chat/completions` (with `stream: true` for SSE)

- Frontend
  - Build: Vite 7 + React 19 + TypeScript 5
  - Browser APIs: `MediaRecorder`, `getUserMedia`, Web Audio API (`AudioContext`, `AnalyserNode`, `ScriptProcessorNode`)
  - Custom audio: on‑device VAD-ish loop, PCM streaming player for raw float32 chunks
  - Feature flags via `web/.env`

## 3) Configuration

Copy examples and supply real keys locally:

- `server/.env` (see also `server/.env.example`)
  - `PORT` — Express port (default `4000`)
  - `OPENROUTER_API_KEY` — OpenRouter key
  - `OPENROUTER_MODEL` — Default: `deepseek/deepseek-chat-v3-0324`
  - `OPENROUTER_SITE_URL`, `OPENROUTER_SITE_NAME` — Optional OpenRouter headers
  - `CARTESIA_API_KEY` — Cartesia key
  - `CARTESIA_TTS_MODEL` — Default: `sonic-3`
  - `CARTESIA_VOICE_ID` — Default voice (UUID)
  - `CARTESIA_VERSION` — API version header (e.g., `2024-06-10`)
  - `CARTESIA_STT_MODEL` — Default: `ink-whisper` (aliases like `glossa-1` are remapped)
  - `CARTESIA_STT_ENDPOINT` — Default: `https://api.cartesia.ai/stt`
  - `CARTESIA_STT_LANGUAGE` — Default: `auto`
  - `SYSTEM_PROMPT` — System persona prompt injected on every chat request (customizable; see “Safety notes”)

- `web/.env` (see also `web/.env.example`)
  - `VITE_API_BASE_URL` — Backend base URL (or empty to use relative paths + Vite proxy)
  - `VITE_ENABLE_TTS_STREAM` — `true` to stream audio from TTS
  - `VITE_MAX_SILENCE_MS` — Endpointing silence threshold (default ~800ms as tuned)
  - `VITE_ENABLE_FULL_DUPLEX` — Keep mic live during playback (AEC/NS/AGC)
  - `VITE_ENABLE_DUCKING`, `VITE_DUCK_VOLUME` — Duck assistant audio when user speaks
  - `VITE_ENABLE_BARGE_IN` — Abort chat/TTS if the user interrupts
  - `VITE_ENABLE_CHAT_STREAM` — Stream LLM tokens for faster perceived latency

Security note: Never commit real API keys. Keep real values in local `.env` only.

## 4) Runtime Data Flow

There are two entry modes: typed input and recorded speech. Both converge into the same chat → TTS pipeline.

1) Voice input (speech → text)
- User clicks “Record”. The app requests a mic stream with optional echo cancellation/noise suppression/AGC when full‑duplex is enabled.
- A lightweight VAD loop runs in the browser using `AnalyserNode` RMS energy to detect voice vs. silence. While voice is active, the app buffers `MediaRecorder` chunks for the current segment.
- When a segment closes (silence > `VITE_MAX_SILENCE_MS`), the app forms a Blob (WAV/OGG/WEBM depending on browser) and posts it to `POST /api/stt` as `multipart/form-data`.
- Backend receives the blob, optionally transcodes to 16kHz mono WAV PCM using ffmpeg if the input isn’t already WAV, then posts to Cartesia STT. Various result shapes are normalized to a single `transcript` string.

2) Chat (text → assistant text)
- The existing `messages` history is combined with a `system` message from `SYSTEM_PROMPT` and sent to OpenRouter.
- Non‑streaming path: `POST /api/chat` returns a single assistant message.
- Streaming path: `POST /api/chat/stream` sets up SSE, forwards chunks verbatim, and the client renders tokens as they arrive (reducing perceived latency).

3) TTS (assistant text → audio)
- Non‑streaming path: `POST /api/tts` requests a WAV (`pcm_f32le`, 44.1kHz) from Cartesia, returns a `data:audio/wav;base64,...` URL, and the browser plays it via `<audio>`.
- Streaming path: `POST /api/tts/stream` sets up SSE to Cartesia, forwarding `type: "chunk"` events. The client decodes base64 float32 PCM into `Float32Array`s and plays them via a custom `PCMStreamPlayer` that schedules chunks on an `AudioContext`.

4) Overlap and control
- Full‑duplex: If enabled, the mic stays live while the assistant speaks. Otherwise, the app pauses/tears down the recorder during playback and resumes after.
- Ducking: While the user speaks (VAD active), the assistant’s audio volume is temporarily reduced to `VITE_DUCK_VOLUME` and smoothly restored after silence.
- Barge‑in: If the user speaks continuously for ~300ms during assistant speech, the client aborts in‑flight chat/TTS requests and stops playback; the new user segment is then transcribed.

## 5) Backend API

All endpoints live in `server/index.js`.

- `GET /health`
  - Check liveness: `{ status: "ok" }`.

- `POST /api/stt` (multipart form)
  - Request: `audio` (file), optional `modelId`, optional `language` (default `auto`).
  - Server logic:
    - Optional transcoding to WAV PCM 16kHz mono via ffmpeg.
    - Posts to Cartesia STT (with alias → model mapping and a retry fallback when language conflicts occur).
  - Response: `{ transcript: string, raw: any }`.

- `POST /api/chat`
  - Request: `{ messages: Array<{role, content}>, temperature?, top_p? }`.
  - Server logic: Adds `system` message (`SYSTEM_PROMPT`), posts to OpenRouter, returns first choice.
  - Response: `{ message, raw }`.

- `POST /api/chat/stream` (SSE)
  - Request: same as `/api/chat` but streamed.
  - Server logic: Sets SSE headers, forwards streaming chunks from OpenRouter to the client, and logs time to first chunk and total time.
  - Response: SSE frames from upstream.

- `POST /api/tts`
  - Request: `{ text: string, voiceId?, speed?, emotion? }`.
  - Server logic: Requests WAV `pcm_f32le` 44.1kHz bytes from Cartesia TTS, base64‑encodes, returns data URL.
  - Response: `{ audio: string (data URL), format }`.

- `POST /api/tts/stream` (SSE)
  - Request: `{ text: string, voiceId?, emotion? }`.
  - Server logic: Proxies to Cartesia TTS SSE, forwards `chunk`/`done` events, logs time to first chunk and total time.
  - Response: SSE frames with base64 float32 PCM chunks.

Cross‑cutting:
- CORS enabled; JSON body limit is 10MB.
- Cache headers set to disable caching (`no-store`).
- Errors log upstream status/data. Some sensitive logs should be reduced for production.

## 6) Frontend Architecture

- Single page (`web/src/App.tsx`) built with React hooks and minimal dependencies.
- Key state
  - `messages`: Chat history (`user`/`assistant`, `text`, `status`, `audioUrl`).
  - `isRecording`, `isProcessing`, `isPlaying`, `status`, `error`.
  - Abort controllers for chat and TTS for barge‑in.

- Audio capture
  - `MediaRecorder` collects small chunks (e.g., 250ms) from a `getUserMedia` stream.
  - Web Audio `AnalyserNode` measures energy for a simple VAD loop; `ScriptProcessorNode` captures raw PCM for level meters.
  - VAD thresholds, debouncing and `VITE_MAX_SILENCE_MS` determine segmenting.

- Streaming playback
  - `PCMStreamPlayer` wraps an `AudioContext`, buffers incoming float32 PCM, schedules chunks as `AudioBufferSourceNode`s, and supports `onEnded` callbacks and volume control.
  - Non‑streaming playback uses a normal `Audio` element with a base64 data‑URL.

- UI/UX
  - Visual equalizer bars from analyser energy.
  - Mic device selection and live status indicators.
  - Autoplay fallback: if the browser blocks autoplay, the UI shows a “Play Audio” button.

## 7) Performance & Instrumentation

Timing logs are added in both client and server to identify bottlenecks:
- STT time, time to first chat token, chat completion time, time to first TTS chunk, TTS completion time, and end‑to‑end total.
- See `docs/performance_timing_logs.md` for target budgets and interpretation.

Latency improvements already implemented:
- Streaming TTS (time‑to‑first‑audio on the order of 100–300ms).
- Streaming chat tokens to reduce perceived wait.
- Aggressive endpointing (silence ~800ms) to finish turns quicker.
- Full‑duplex + ducking + barge‑in for natural overlap.

## 8) Testing

The `tests/` folder includes Node scripts that exercise the pipeline using generated audio and SSE parsing:

- `tests/quick-test.js` — One STT → Chat (stream) → TTS (stream) exchange with timing summary.
- `tests/conversation-test.js` — Multi‑exchange run with stats; options for verbosity, JSON output, and server URL.
- Helpers: `tests/utils/audio-generator.js` (creates short WAV buffers), `tests/utils/sse-parser.js` (consumes SSE streams).

To run (with the server running):
```
node tests/quick-test.js
node tests/conversation-test.js --exchanges 5 --verbose
```

## 9) Safety Notes & Assumptions

- The backend prepends a `system` message from `SYSTEM_PROMPT` to every chat request. The default in `.env.example` configures a roleplay persona and short responses. For academic use, consider replacing it with a neutral, safe‑for‑work system prompt. Keep in mind platform policies and institutional guidelines.
- Do not log or expose API keys. Review logs for PII before deployment.
- Autoplay policies vary by browser; the UI falls back to manual play if needed.
- STT alias mapping: legacy model names like `glossa-*` are remapped to `ink-whisper`. Language `auto` is the default; there is a fallback path that retries without explicit language if the upstream returns an alias/language compatibility error.

## 10) Known Limitations

- LLM latency can dominate time‑to‑first‑token depending on model/load; model choice via `OPENROUTER_MODEL` has a big impact.
- VAD is heuristic and can mis‑segment in noisy conditions; this can be improved with a dedicated VAD model or WebRTC VAD.
- PCM streaming uses a simple buffer scheduler; very slow clients could underrun/overrun without further jitter buffering.
- No persistence: chat history is held in memory on the client only; a refresh clears state.
- No authentication/authorization layer is implemented around the backend.

## 11) Extension Points

- Swap LLM: change `OPENROUTER_MODEL` or add a new `/api/chat/*` route.
- Change voices: update `CARTESIA_VOICE_ID` and/or expose a UI selector.
- Add auth: protect `/api/*` with API keys or session auth.
- Persist history: add a server database (e.g., SQLite/Postgres) with session IDs.
- Improve VAD: integrate a better VAD, endpointing, and echo control pipeline.
- Metrics: export timing logs to a dashboard and add tracing IDs per request.

## 12) Local Development & Build

Prereqs: Node 20+, Cartesia and OpenRouter API keys.

Install:
```
cd server && npm install
cd ../web && npm install
```

Run (two terminals):
```
cd server && npm run dev
cd web && npm run dev
```

Open: `http://localhost:5174` (Vite dev server with API proxy).

Build front‑end:
```
cd web && npm run build
```

## 13) Files of Interest (quick map)

- Backend: `server/index.js` — all routes, SSE forwarding, STT transcoding, and timing logs.
- Frontend: `web/src/App.tsx` — VAD + recorder, chat/TTS fetchers, PCM streaming player, UI logic.
- Config: `server/.env.example`, `web/.env.example` — feature flags and API keys.
- Docs: `docs/implementation_summary.md`, `docs/performance_timing_logs.md` — background on recent improvements.

---

If you’re reviewing for improvements, the most impactful areas are LLM latency (model selection and prompt budget), audio endpointing/VAD robustness, streaming jitter buffers and backpressure, and adding authentication/rate limiting for production use.

