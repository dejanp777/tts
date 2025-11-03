# Performance Timing Logs

## Overview
Added comprehensive timing logs to both client and server to identify bottlenecks in the voice chat pipeline.

## What Was Added

### Client-Side Timing (Browser Console)
All timing logs use `performance.now()` for high-precision measurements and are prefixed with `⏱️ [TIMING]`.

**1. STT Timing:**
```
⏱️ [TIMING] STT took XXXms
```
- Measures time from sending audio to receiving transcript
- Includes network round-trip + Cartesia STT processing

**2. Chat Streaming Timing:**
```
⏱️ [TIMING] Chat first token took XXXms
⏱️ [TIMING] Chat complete took XXXms
```
- **First token**: Time from request to first word from LLM (critical for perceived latency)
- **Complete**: Total time for entire chat response

**3. TTS Streaming Timing:**
```
⏱️ [TIMING] TTS first chunk took XXXms
⏱️ [TIMING] TTS complete took XXXms
```
- **First chunk**: Time from request to first audio chunk (time to first sound)
- **Complete**: Total time for entire TTS generation

**4. Total Flow Timing:**
```
⏱️ [TIMING] Total flow (STT + Chat + TTS) took XXXms
```
- End-to-end time from speech to voice playback

### Server-Side Timing (Terminal/Server Logs)
All timing logs use `Date.now()` and are prefixed with `⏱️ [TIMING]`.

**1. STT Endpoint:**
```
⏱️ [TIMING] STT request started (file size: XXX bytes)
⏱️ [TIMING] STT complete took XXXms
```
- Measures server-side processing time for speech-to-text
- Includes ffmpeg transcoding + Cartesia API call

**2. Chat Streaming Endpoint:**
```
⏱️ [TIMING] Chat stream request started
⏱️ [TIMING] Chat first chunk from OpenRouter took XXXms
⏱️ [TIMING] Chat stream complete took XXXms
```
- **First chunk**: Time until OpenRouter starts streaming (LLM latency)
- **Complete**: Total time for entire chat stream

**3. TTS Streaming Endpoint:**
```
⏱️ [TIMING] TTS stream request started (text length: XXX chars)
⏱️ [TIMING] TTS first chunk from Cartesia took XXXms
⏱️ [TIMING] TTS stream complete took XXXms (XXX chunks)
```
- **First chunk**: Time until Cartesia starts streaming audio
- **Complete**: Total time + chunk count

## How to Read the Logs

### Example Console Output:
```
⏱️ [TIMING] STT took 815ms
⏱️ [TIMING] Chat first token took 5250ms  ← BOTTLENECK!
⏱️ [TIMING] Chat complete took 6100ms
⏱️ [TIMING] TTS first chunk took 792ms
⏱️ [TIMING] TTS complete took 1200ms
⏱️ [TIMING] Total flow (STT + Chat + TTS) took 8115ms
```

### Example Server Output:
```
⏱️ [TIMING] STT request started (file size: 248534 bytes)
⏱️ [TIMING] STT complete took 780ms
⏱️ [TIMING] Chat stream request started
⏱️ [TIMING] Chat first chunk from OpenRouter took 5100ms  ← BOTTLENECK!
⏱️ [TIMING] Chat stream complete took 6050ms
⏱️ [TIMING] TTS stream request started (text length: 145 chars)
⏱️ [TIMING] TTS first chunk from Cartesia took 650ms
⏱️ [TIMING] TTS stream complete took 1150ms (23 chunks)
```

## Identifying Bottlenecks

### 1. STT Bottleneck
**Symptoms:**
- `STT took` > 1500ms
- Server shows high `STT complete` time

**Possible Causes:**
- Large audio file (check file size in server log)
- Slow ffmpeg transcoding
- Cartesia STT API slow/overloaded
- Network latency to Cartesia

**Solutions:**
- Use WAV format client-side to skip transcoding
- Reduce audio quality/sample rate
- Check network connection

### 2. Chat/LLM Bottleneck (MOST COMMON)
**Symptoms:**
- `Chat first token took` > 3000ms
- Large gap between "Chat stream request started" and "first chunk"

**Possible Causes:**
- Slow LLM model (DeepSeek can be slow)
- Long conversation history (large prompt)
- OpenRouter routing to distant server
- Model under heavy load

**Solutions:**
- Switch to faster model (e.g., GPT-3.5-turbo, Claude Instant)
- Reduce conversation history (send fewer messages)
- Try different time of day (less load)
- Check OpenRouter status page

### 3. TTS Bottleneck
**Symptoms:**
- `TTS first chunk took` > 1500ms
- Server shows high `TTS first chunk from Cartesia` time

**Possible Causes:**
- Long text to synthesize (check text length in server log)
- Cartesia API slow/overloaded
- Network latency to Cartesia

**Solutions:**
- Split long responses into sentences
- Check network connection
- Try different voice/emotion settings

### 4. Network Bottleneck
**Symptoms:**
- Large difference between server timing and client timing
- Example: Server shows `STT complete took 500ms` but client shows `STT took 1500ms`

**Possible Causes:**
- Slow network between client and server
- High latency connection
- Bandwidth limitations

**Solutions:**
- Check network speed
- Move server closer to client
- Use CDN/edge deployment

## Target Performance Goals

### Excellent Performance:
- **STT**: < 800ms
- **Chat first token**: < 1500ms ⚡ (critical for perceived speed)
- **TTS first chunk**: < 500ms
- **Total flow**: < 3000ms

### Good Performance:
- **STT**: < 1200ms
- **Chat first token**: < 3000ms
- **TTS first chunk**: < 1000ms
- **Total flow**: < 5000ms

### Needs Improvement:
- **STT**: > 1500ms
- **Chat first token**: > 5000ms ❌ (user will notice lag)
- **TTS first chunk**: > 1500ms
- **Total flow**: > 7000ms

## What to Look For

When testing, pay special attention to:

1. **Chat first token time** - This is usually the biggest bottleneck
2. **Difference between server and client times** - Indicates network issues
3. **TTS chunk count** - More chunks = longer audio = more time
4. **File size** - Larger audio files take longer to process

## Files Modified
- `web/src/App.tsx` - Added client-side timing logs
  - Line 970-987: STT + total flow timing
  - Line 783-815: Chat streaming timing
  - Line 841-894: TTS streaming timing
- `server/index.js` - Added server-side timing logs
  - Line 138-152: STT request timing
  - Line 254-266: STT complete timing
  - Line 337-346: Chat stream request timing
  - Line 373-388: Chat stream chunk timing
  - Line 425-435: TTS stream request timing
  - Line 459-480: TTS stream chunk timing
- `docs/performance_timing_logs.md` - This documentation

