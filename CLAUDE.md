# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Cartesia Voice Chat** is an advanced voice-enabled chat application featuring real-time conversational AI with sophisticated turn-taking, interruption detection, and prosody control. Users can speak or type to an OpenRouter-powered LLM assistant, with responses synthesized via Cartesia TTS.

**Character:** Roleplays as a 24-year-old secretary in New York with a sassy, confident personality. System prompt enforces 7-word replies and character consistency.

## Architecture

### Two-Part System

1. **Backend (`server/`)** - Express.js proxy (JavaScript)
   - Securely wraps external API keys (Cartesia, OpenRouter)
   - Handles audio transcoding with optional ffmpeg
   - Implements turn-taking prediction system

2. **Frontend (`web/`)** - React + TypeScript with Vite
   - Real-time voice chat interface
   - Advanced Voice Activity Detection (VAD)
   - PCM audio streaming and playback

### Backend API Endpoints

- `POST /api/stt` - Multipart audio upload → Cartesia STT → transcript
- `POST /api/chat` - OpenAI-format messages → OpenRouter LLM → response
- `POST /api/chat/stream` - SSE streaming chat completions
- `POST /api/tts` - Text + prosody → Cartesia TTS → base64 audio
- `POST /api/tts/stream` - SSE streaming TTS (PCM chunks)
- `POST /api/turn-prediction` - Turn-taking decision via TurnGPT+VAP fusion
- `POST /api/tts/generate-fillers` - Generate thinking filler audio files
- `GET /health` - Health check

### Turn-Taking System (`server/turn-taking/`)

The conversation flow uses a **fusion approach** combining:
- **TurnGPT (turngpt.js)** - Text-based analysis for Transition Relevance Places (TRPs)
- **VAP (vap.js)** - Audio-based prosodic analysis for voice activity projection
- **Fusion (fusion.js)** - Weighted combination (default: 60% text, 40% audio)

**Current:** Heuristic-based implementation (production-ready)
**Upgrade Path:** Full ML models available (see `server/turn-taking/README.md`)

### Frontend Features

**Phase 1: Conversation Modes**
- User-adjustable silence thresholds (localStorage persisted)
- Backchannel detection distinguishes "mm-hmm" from real interruptions
- Graduated audio ducking (4 levels: none → 80% → 50% → 20% volume)
- Barge-in allows interrupting AI mid-response (aborts chat/TTS requests)
- Thinking fillers ("hmm", "let me see") play during LLM latency
- Dynamic prosody selection adjusts emotion/speed based on message type

**Phase 2: Predictive Turn-Taking**
- Two-pass endpointing: checks prediction at min silence, falls back to max
- Fusion combines text+audio signals for early turn completion
- Configurable thresholds and fusion weights

**Audio Pipeline:**
- Voice Activity Detection (VAD) using AnalyserNode RMS energy
- ScriptProcessorNode captures raw PCM for prediction features
- MediaRecorder collects segments (250ms chunks)
- Downsample to 16kHz WAV for STT
- Stream PCM playback for low-latency TTS

**Utility Modules (`web/src/utils/`):**
- `prosody.ts` - Message classification and emotion profiles
- `backchannels.ts` - Audio feature extraction and classification
- `thinkingFillers.ts` - Filler management and playback
- `twoPassEndpointing.ts` - Min/max silence logic
- `contextAwareThreshold.ts` - Dynamic threshold adjustment
- `adaptiveLearning.ts` - Online weight learning

## Development Commands

### Setup

```bash
# Install backend dependencies
cd server && npm install

# Install frontend dependencies
cd ../web && npm install
```

### Environment Configuration

Copy example files and add API keys:

```bash
cp server/.env.example server/.env
cp web/.env.example web/.env
```

**Required environment variables:**
- `OPENROUTER_API_KEY` - OpenRouter API key (sk-or-...)
- `CARTESIA_API_KEY` - Cartesia API key (sk_car_...)
- `CARTESIA_VOICE_ID` - Voice ID (default: Tessa)
- `PORT` - Backend port (default: 4000)
- `VITE_API_BASE_URL` - Backend URL for frontend (http://localhost:4000)

**Feature flags (in `web/.env`):**
- `VITE_ENABLE_TTS_STREAM` - Use streaming TTS (true/false)
- `VITE_ENABLE_CHAT_STREAM` - Use streaming chat (true/false)
- `VITE_ENABLE_FULL_DUPLEX` - Allow talking while AI speaks (true/false)
- `VITE_ENABLE_DUCKING` - Graduated audio ducking (true/false)
- `VITE_ENABLE_BARGE_IN` - Allow interrupting AI (true/false)
- `VITE_ENABLE_TURN_PREDICTION` - Predictive turn-taking (true/false)
- `VITE_MIN_SILENCE_MS` - Min silence before prediction check (500)
- `VITE_FUSION_THRESHOLD` - Prediction confidence threshold (0.7)

### Running Development Servers

```bash
# Start backend (port 4000)
cd server
npm run dev

# Start frontend (port 5174) - separate terminal
cd web
npm run dev
```

Then open http://localhost:5174

### Building for Production

```bash
cd web
npm run build
# Output: web/dist/
```

### Testing

**Manual test flow:**
1. Ensure both servers running
2. Load http://localhost:5174
3. Grant microphone permission
4. Record audio → verify transcript appears
5. Verify assistant reply text + audio playback
6. Test typed message via input box
7. Test Clear button

### Linting

```bash
cd web
npm run lint
```

## Key Implementation Details

### Audio Transcoding
Backend attempts to transcode audio to 16kHz mono WAV PCM using ffmpeg-static (optional dependency). Falls back to original format if ffmpeg unavailable. This ensures maximum Cartesia STT compatibility.

### VAD (Voice Activity Detection)
Frontend uses AnalyserNode to compute RMS energy every 50ms. When energy exceeds threshold for 150ms, starts collecting audio chunks. After user-configurable silence (default 1500ms), sends segment to STT. Separate raw PCM capture enables feature extraction for turn prediction.

### Barge-In Implementation
When user speaks during AI playback and audio is classified as interruption (not backchannel), frontend:
1. Aborts in-flight chat and TTS requests via AbortController
2. Stops audio playback (both Audio element and PCM stream)
3. Continues listening for new user input
4. Removes pending assistant messages from state

### Streaming TTS Playback
PCMStreamPlayer class manages queue of Float32Array chunks from SSE stream. Uses AudioContext to create buffers and chain playback via source.onended callbacks. Enables low-latency audio start (first chunk plays immediately) while remaining chunks stream in.

### Full-Duplex Mode
When enabled, recording continues during AI playback using:
- Echo cancellation constraint on MediaStream
- Noise suppression and auto gain control
- Raised VAD threshold during playback (1.5x base)
- Audio ducking to reduce AI volume when user speaks

### Prosody Selection
`detectMessageType()` classifies assistant messages into categories (greeting, question, error, excited, thoughtful, empathetic, default). `selectProsody()` maps types to emotion profiles with speed/energy parameters. Backend applies these to Cartesia TTS generation_config.

### State Management
App.tsx manages complex state including:
- Message history with status tracking (pending/complete/error)
- Audio playback state (isPlaying, playingMessageId)
- Recording state (isRecording, VAD timers, segment buffers)
- Processing state (isProcessing, abort controllers)
- User preferences (silence threshold, backchannels enabled)

Uses refs to avoid dependency issues: messagesRef.current always has latest messages, isProcessingRef.current prevents recorder reset during processing.

### Backchannel Classification
`extractAudioFeatures()` computes duration, intensity, frequency from audio samples. `classifyUserAudio()` uses thresholds:
- **Backchannel:** Short (<800ms) + quiet (<0.03 intensity)
- **Tentative:** Low intensity (<0.04) but longer
- **Clear interruption:** Strong sustained speech

Classification drives ducking levels and barge-in decisions.

### Turn Prediction Flow
1. After min silence (500ms default), extract audio features
2. POST to /api/turn-prediction with features + silence duration
3. Backend fusion combines TurnGPT (text patterns) + VAP (prosody)
4. If confidence ≥ threshold (0.7 default), process audio early
5. Otherwise wait for max silence (1500ms) as fallback

## Common Patterns

### Adding New Endpoints
1. Add route handler in `server/index.js`
2. Validate request body and API keys
3. Proxy to external API with proper headers
4. Handle errors and return normalized JSON
5. Add corresponding fetch call in `web/src/App.tsx`

### Modifying Voice Character
Edit `SYSTEM_PROMPT` constant in `server/index.js`. System prompt is prepended to all chat requests. Change reply length limit, personality traits, or conversation style here.

### Adjusting VAD Sensitivity
In `startRecording()` callback (App.tsx):
- `baseThresholdRms` (default 0.025) - Lower = more sensitive
- `minVoiceMs` (default 150) - Min speech duration to start segment
- `maxSilenceMs` - Read from user preference state (default 1500)

### Adding New Prosody Profiles
1. Add profile to `EMOTION_PROFILES` in `web/src/utils/prosody.ts`
2. Update `detectMessageType()` to return new type
3. Map type in `selectProsody()`
4. Cartesia supports: frustrated, happy, sad, neutral, curious, empathetic, etc.

### Debugging Audio Issues
- Check browser console for `[API]`, `[TTS]`, `[STT]`, `[VAD]` prefixed logs
- Backend logs include timing metrics: `⏱️ [TIMING]` prefix
- Audio classification logs: `[Audio Classification]`, `[Backchannel]`
- Turn prediction logs: `[Turn Prediction]` prefix

## File Organization

```
server/
  index.js              # Express server, all API endpoints
  turn-taking/
    fusion.js           # TurnGPT+VAP fusion logic
    turngpt.js          # Text-based TRP prediction (heuristic)
    vap.js              # Audio-based VAP prediction (heuristic)
    README.md           # Upgrade path to full ML models

web/
  src/
    App.tsx             # Main component, voice chat logic
    main.tsx            # React entry point
    components/
      SettingsPanel.tsx # User preferences UI
    utils/
      prosody.ts        # Emotion and speed profiles
      backchannels.ts   # Audio classification
      thinkingFillers.ts # Filler audio management
      twoPassEndpointing.ts
      contextAwareThreshold.ts
      adaptiveLearning.ts

docs/
  tasks1.md            # Original implementation task breakdown
```

## External Dependencies

**APIs:**
- **Cartesia** (api.cartesia.ai) - STT (ink-whisper model) and TTS (sonic-3 model)
- **OpenRouter** (openrouter.ai) - LLM completions (default: deepseek/deepseek-chat-v3-0324)

**Backend Packages:**
- express - Web server
- axios - HTTP client for external APIs
- multer - Multipart form handling for audio uploads
- ffmpeg-static - Audio transcoding (optional)
- cors - Cross-origin requests
- dotenv - Environment variables

**Frontend Packages:**
- react 19 - UI framework
- vite - Build tool and dev server
- typescript - Type safety

## Notes

- ffmpeg-static is optional; server logs warning if unavailable but continues functioning
- Browser autoplay may be blocked; UI shows manual play button when needed
- Full-duplex requires browser support for echo cancellation (most modern browsers)
- Turn prediction requires sufficient audio features (min 900ms segment)
- Cartesia STT model aliases: "glossa-*" auto-maps to "ink-whisper"
- WebM/Ogg containers used when supported, falls back to WAV
- Cache-Control headers disable all caching for real-time behavior
