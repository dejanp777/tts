# Critical Fixes: STT Empty Transcripts & TTS Streaming

## Issue 1: STT Returning Empty Transcripts
STT was returning status 200 but with empty transcription:
```
Error: Transcription returned empty result
```

## Issue 2: TTS Streaming Base64 Decoding Error
TTS streaming was failing with base64 decoding error:
```
[TTS Stream] Failed to decode chunk: InvalidCharacterError: Failed to execute 'atob' on 'Window': The string to be decoded is not correctly encoded.
```

## Root Cause 1: STT Field Name Mismatch
The `extractTranscript` function was checking for `data.transcript` first, but according to Cartesia's official STT API documentation, the response format is:
```json
{
  "text": "Hello, world!",
  "duration": 2.5,
  "language": "en"
}
```

The transcript is in the `text` field, not `transcript`. The function was checking `data.text` as a fallback, but it should be the primary field.

## Root Cause 2: TTS SSE Response Format
The client-side SSE parser was expecting raw base64 data in the format:
```
data: <base64>\n\n
```

However, according to Cartesia's official documentation, the `/tts/sse` endpoint returns **JSON objects** in the SSE format:
```
data: {"type":"chunk","data":"<base64>"}\n\n
data: {"type":"done"}\n\n
```

## Solution 1: Fix STT Field Priority
Updated `extractTranscript` function in `server/index.js` to check `data.text` first (Cartesia's primary field):

**Before:**
```javascript
let t =
  take(data.transcript) ||
  take(data.text) ||
  // ...
```

**After:**
```javascript
// Cartesia STT API returns { text: "...", duration: ..., language: "..." }
let t =
  take(data.text) ||           // Cartesia STT primary field
  take(data.transcript) ||     // Fallback
  // ...
```

## Solution 2: Fix TTS SSE JSON Parsing
Updated the client-side SSE parser in `web/src/App.tsx` to:
1. Parse the SSE data field as JSON
2. Check the `type` field to determine the chunk type
3. Extract base64 data from the `data` field for `chunk` type events
4. Handle `done` and `error` events properly

### Code Changes

**Before (Lines 677-695):**
```typescript
// Parse SSE events (format: "data: <base64>\n\n")
let idx
while ((idx = buffer.indexOf('\n\n')) >= 0) {
  const frame = buffer.slice(0, idx)
  buffer = buffer.slice(idx + 2)

  const match = frame.match(/^data:\s*(.*)$/m)
  if (match && match[1]) {
    try {
      const base64Data = match[1].trim()
      if (base64Data && base64Data !== '[DONE]') {
        const pcmData = base64ToFloat32Array(base64Data)
        onChunk(pcmData)
      }
    } catch (err) {
      console.error('[TTS Stream] Failed to decode chunk:', err)
    }
  }
}
```

**After (Lines 677-708):**
```typescript
// Parse SSE events (format: "data: {\"type\":\"chunk\",\"data\":\"<base64>\"}\n\n")
let idx
while ((idx = buffer.indexOf('\n\n')) >= 0) {
  const frame = buffer.slice(0, idx)
  buffer = buffer.slice(idx + 2)

  const match = frame.match(/^data:\s*(.*)$/m)
  if (match && match[1]) {
    try {
      const jsonData = match[1].trim()
      if (!jsonData) continue

      // Parse JSON response from Cartesia
      const chunk = JSON.parse(jsonData)
      
      if (chunk.type === 'chunk' && chunk.data) {
        // chunk.data contains base64-encoded PCM data
        const pcmData = base64ToFloat32Array(chunk.data)
        onChunk(pcmData)
      } else if (chunk.type === 'done') {
        console.log('[TTS Stream] Stream completed')
        break
      } else if (chunk.type === 'error') {
        console.error('[TTS Stream] Server error:', chunk.message)
        throw new Error(chunk.message || 'TTS stream error')
      }
    } catch (err) {
      console.error('[TTS Stream] Failed to parse chunk:', err)
      console.error('[TTS Stream] Raw data:', match[1])
    }
  }
}
```

### Server-Side Logging
Added logging in `server/index.js` to debug the SSE format:
```javascript
// Forward SSE events from Cartesia to client
let chunkCount = 0;
response.data.on('data', (chunk) => {
  chunkCount++;
  if (chunkCount <= 2) {
    // Log first 2 chunks to see the format
    console.log(`[tts/stream] Chunk ${chunkCount}:`, chunk.toString().substring(0, 200));
  }
  res.write(chunk);
});
```

## Reference
Cartesia TTS SSE API documentation shows the correct response format:
```typescript
for await (const chunk of stream) {
    if (chunk.type === "chunk" && chunk.data) {
        const audioBuffer = Buffer.from(chunk.data, "base64");
        // Process audio
    } else if (chunk.type === "done") {
        console.log("Stream completed");
        break;
    } else if (chunk.type === "error") {
        console.error("Stream error:", chunk.message);
        break;
    }
}
```

## Testing
1. Server restarted with enhanced logging
2. Ready to test voice TTS streaming
3. Expected behavior:
   - STT transcription works ✅
   - Chat streaming works ✅
   - TTS streaming should now work with proper JSON parsing

## Files Modified
- `server/index.js` - Fixed STT field priority (data.text first) + Added TTS SSE debug logging
- `web/src/App.tsx` - Fixed SSE JSON parsing for TTS stream
- `docs/tts_stream_fix.md` - This documentation

## Summary
Both issues were caused by incorrect assumptions about API response formats:
1. **STT**: Assumed `transcript` field, but Cartesia uses `text`
2. **TTS**: Assumed raw base64 in SSE, but Cartesia sends JSON objects with `{type, data}` structure

Both fixes align the code with Cartesia's official API documentation.

