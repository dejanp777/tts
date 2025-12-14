# Implementation Verification Guide

This document provides step-by-step verification procedures for all implemented natural conversation features.

## Prerequisites

- Server running on port 4000: `cd /root/cartesia-tts/server && npm start`
- Web client running on port 5175: `cd /root/cartesia-tts/web && npm run dev`
- Microphone access granted in browser
- All environment variables configured in `/root/cartesia-tts/web/.env`

## Feature Verification

### ✅ Phase 1: Streaming TTS Implementation

**What to verify:**
- Time-to-first-audio should be 100-300ms instead of 1-3s
- Audio should start playing before the full response is generated

**How to test:**
1. Open the web app at http://localhost:5175
2. Grant microphone access
3. Send a message (voice or text): "Tell me a long story"
4. Observe that audio playback starts almost immediately
5. Check browser console for `[TTS] Using streaming mode` log

**Expected behavior:**
- Audio begins playing within 100-300ms
- Streaming chunks are logged in console
- No noticeable delay between text generation and audio playback

**Environment variable:**
```
VITE_ENABLE_TTS_STREAM=true
```

---

### ✅ Phase 1: Reduce Endpointing Latency

**What to verify:**
- VAD should detect end of speech faster (800ms vs 2300ms)
- Faster turn completion

**How to test:**
1. Start recording by speaking into the microphone
2. Say a short phrase: "Hello, how are you?"
3. Stop speaking and observe how quickly the recording ends
4. Time should be approximately 800ms after you stop speaking

**Expected behavior:**
- Recording stops ~800ms after silence
- Status changes from "Recording..." to "Transcribing audio..." quickly
- Faster overall conversation flow

**Environment variable:**
```
VITE_MAX_SILENCE_MS=800
```

---

### ✅ Phase 2: Keep Mic Live with AEC (Full-Duplex)

**What to verify:**
- Microphone stays active while AI is speaking
- No echo or feedback from AI audio
- Can speak while AI is talking

**How to test:**
1. Send a message that triggers a long AI response
2. While AI is speaking, observe the audio level bars
3. Speak into the microphone while AI is talking
4. Audio bars should show your voice activity

**Expected behavior:**
- Audio level bars remain active during AI playback
- No echo cancellation issues
- Microphone is not paused/stopped during playback
- Browser console shows echo cancellation enabled

**Environment variable:**
```
VITE_ENABLE_FULL_DUPLEX=true
```

---

### ✅ Phase 2: Volume Ducking

**What to verify:**
- AI audio volume reduces when you speak
- Volume restores when you stop speaking

**How to test:**
1. Send a message that triggers a long AI response
2. While AI is speaking, start speaking into the microphone
3. Listen for AI volume to decrease to ~15% (0.15)
4. Stop speaking and listen for volume to restore to 100%

**Expected behavior:**
- AI volume smoothly decreases when you speak
- AI volume smoothly increases when you stop speaking
- Volume transitions are gradual (not abrupt)
- Ducking only occurs when full-duplex is enabled

**Environment variables:**
```
VITE_ENABLE_DUCKING=true
VITE_DUCK_VOLUME=0.15
```

---

### ✅ Phase 2: Barge-In Support

**What to verify:**
- Can interrupt AI by speaking over it
- AI stops speaking and requests are aborted
- Conversation continues naturally after interruption

**How to test:**
1. Send a message that triggers a long AI response
2. While AI is speaking, start speaking for at least 300ms
3. Observe that AI audio stops immediately
4. Check status message changes to "Interrupted. Listening..."
5. Continue speaking to send a new message

**Expected behavior:**
- AI audio stops after 300ms of sustained user speech
- In-flight chat/TTS requests are aborted
- Browser console shows `[Barge-in] User interrupted AI`
- Status shows "Interrupted. Listening..."
- Pending messages are removed from chat history
- No error messages displayed to user

**Environment variable:**
```
VITE_ENABLE_BARGE_IN=true
```

---

### ✅ Phase 3: Stream Chat Tokens

**What to verify:**
- Assistant messages appear token-by-token as they're generated
- Text rendering starts before full response is complete
- Reduced perceived latency

**How to test:**
1. Send a message: "Write me a poem about coding"
2. Observe the assistant message area
3. Text should appear word-by-word or phrase-by-phrase
4. Check browser console for `[Chat] Using streaming mode`

**Expected behavior:**
- Assistant message text appears incrementally
- Each token/word appears as it's generated
- No waiting for full response before display
- Smooth text rendering without flickering

**Environment variable:**
```
VITE_ENABLE_CHAT_STREAM=true
```

---

## Combined Feature Test

**Test all features together:**

1. Start a conversation with a long question
2. While AI is responding:
   - Verify audio starts quickly (streaming TTS)
   - Verify text appears incrementally (streaming chat)
   - Verify mic stays live (full-duplex)
   - Speak to test volume ducking
   - Continue speaking to test barge-in
3. After interruption:
   - Verify conversation continues naturally
   - Verify fast turn completion (reduced latency)

**Expected behavior:**
- Natural, overlapping conversation
- No walkie-talkie turn-taking
- Fast response times
- Smooth interruptions
- No audio feedback or echo

---

## TODO2: Natural Conversational Flow (C → A → B)

These features are behind flags and are **off by default** in `web/.env.example`.

### ✅ Phase 1 (C): Interruption intent + Pause/Resume

**Enable:**
```
VITE_ENABLE_INTERRUPT_INTENT=true
VITE_ENABLE_PAUSE_RESUME=true
```

**What to verify:**
- Speaking over the assistant triggers a **pause** quickly (barge‑in → pause).
- Saying “continue / go on / go ahead” resumes the paused audio.
- Saying “no, I meant …” stops the current response and treats it as a correction.

**How to test:**
1. Ask for a long response (so the assistant speaks for a few seconds).
2. While the assistant is speaking, say: “wait” or “hold on”.
3. Confirm the assistant pauses and the UI shows the paused state.
4. Say: “continue” and confirm playback resumes.
5. While speaking, say: “no, I meant …” and confirm the assistant stops and your correction is processed as new input.

Console hints: look for `[INTENT]`, `[PAUSE]`, and `[CONTROL]` logs.

---

### ✅ Phase 2 (A): Speak‑While‑Generating (LLM tokens → chunks → TTS)

**Enable:**
```
VITE_ENABLE_SPEAK_WHILE_GENERATING=true
```

**Prerequisites (must already be enabled):**
```
VITE_ENABLE_CHAT_STREAM=true
VITE_ENABLE_TTS_STREAM=true
```

**What to verify:**
- On long answers, audio starts after the first chunk (≈ first sentence), not after the full response.
- No “double speaking” (full answer is not spoken again after chunk playback).

Console hints: look for `[SAY-STREAM]` logs (chunk enqueue / playback).

---

### ✅ Phase 3 (B): Assistant backchannels while the user speaks

**Enable:**
```
VITE_ENABLE_ASSISTANT_BACKCHANNELS=true
```

**Also enable in UI:**
- Settings → “Assistant backchannels while I'm speaking (headphones recommended)”

**What to verify:**
- During a long user monologue (≈2–3s), the assistant occasionally plays a quiet “mm‑hmm / right / okay”.
- Backchannels do not trigger the “user interrupted AI” path.

Console hints: look for `[BACKCHANNEL-AI]` logs.

**Tip:** Use headphones to reduce echo/STT contamination.

## Troubleshooting

### Audio feedback/echo issues
- Ensure `VITE_ENABLE_FULL_DUPLEX=true`
- Check browser supports echo cancellation
- Try using headphones
- Verify microphone permissions

### Barge-in not working
- Ensure `VITE_ENABLE_BARGE_IN=true`
- Ensure `VITE_ENABLE_FULL_DUPLEX=true`
- Speak for at least 300ms to trigger
- Check browser console for barge-in logs

### Streaming not working
- Verify environment variables are set
- Check server logs for SSE endpoint calls
- Verify browser supports fetch streaming
- Check network tab for streaming responses

### Volume ducking not working
- Ensure `VITE_ENABLE_DUCKING=true`
- Ensure `VITE_ENABLE_FULL_DUPLEX=true`
- Verify audio is playing when you speak
- Check `VITE_DUCK_VOLUME` value (0.0-1.0)

---

## Performance Metrics

**Before implementation:**
- Time-to-first-audio: 1-3 seconds
- Turn completion delay: 2.3 seconds
- No overlap support
- No interruption support

**After implementation:**
- Time-to-first-audio: 100-300ms (10x faster)
- Turn completion delay: 800ms (3x faster)
- Full-duplex audio with AEC
- Barge-in with 300ms threshold
- Streaming chat and TTS

---

## Next Steps (Optional)

The following features are optional enhancements:

1. **Advanced VAD (§8)**: Replace RMS-based VAD with ML-based solution (e.g., Silero VAD)
2. **Partial Transcripts (§5)**: Show live transcription during recording (requires streaming STT)

These features are not critical for natural conversation but can further improve the user experience.
