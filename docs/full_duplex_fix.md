# Full-Duplex Audio Fix

## Issue
User reported that the microphone gets disabled when AI voice is speaking, even though `VITE_ENABLE_FULL_DUPLEX=true` is set in the environment.

## Root Cause (UPDATED)
There were **TWO separate issues**:

1. **Streaming TTS path** was missing the full-duplex check (FIXED in first iteration)
2. **React useEffect dependency issue** - The `startRecording` function had `isProcessing` in its dependency array, causing the recorder to be reset whenever processing started (CRITICAL BUG)

### Code Analysis

**Non-Streaming TTS (Lines 299-310)** - ✅ Had full-duplex check:
```typescript
// Only pause recording if full duplex is disabled
const enableFullDuplex = import.meta.env.VITE_ENABLE_FULL_DUPLEX === 'true'
const wasRecording = isRecording
if (wasRecording && !enableFullDuplex) {
  resetRecorder()  // Only reset if full duplex is disabled
}
```

**Streaming TTS (Lines 840-846)** - ❌ Missing full-duplex check:
```typescript
// Set up playback state tracking
setIsPlaying(true)
setPlayingMessageId(assistantId)
// No check for full duplex - recorder would be stopped elsewhere
```

## The Critical Bug: React Dependency Hell

### What Was Happening
```typescript
// startRecording callback dependencies (line 1253)
}, [handleRecordedAudio, isProcessing, mimeType, resetRecorder, selectedMicId, refreshDevices])

// useEffect that manages recording (line 1258-1265)
useEffect(() => {
  void (async () => {
    await startRecording()
  })()
  return () => {
    resetRecorder()  // ← This was being called!
  }
}, [startRecording])
```

**The Problem:**
1. User speaks → VAD detects silence → `handleRecordedAudio` is called
2. `handleRecordedAudio` sets `isProcessing = true`
3. Because `isProcessing` is in `startRecording`'s dependency array, the `startRecording` function reference changes
4. The `useEffect` at line 1258 detects the change and re-runs
5. **The cleanup function runs FIRST**, calling `resetRecorder()` and stopping the mic
6. Then `startRecording()` is called, but it returns early because `isProcessing = true`
7. **Result**: Mic is stopped and never restarted!

This is why the console showed:
```
[TTS Stream] Full duplex enabled: true Was recording: false
```

The full-duplex was enabled, but the recorder had already been stopped by the React cleanup!

## Solution
Two fixes were needed:

### Fix 1: Remove `isProcessing` Check from `startRecording`
The check was preventing the recorder from starting during processing, but we actually WANT the recorder to stay alive during processing for full-duplex mode.

**Before:**
```typescript
const startRecording = useCallback(async () => {
  if (isProcessing) {
    setError('Please wait for the current response to finish.')
    return
  }
  // ...
}, [handleRecordedAudio, isProcessing, mimeType, resetRecorder, selectedMicId, refreshDevices])
```

**After:**
```typescript
const startRecording = useCallback(async () => {
  // Don't check isProcessing here - we want to keep recording even during processing
  // for full-duplex mode. The VAD will queue segments if needed.
  // ...
}, [handleRecordedAudio, mimeType, resetRecorder, selectedMicId, refreshDevices])
```

### Fix 2: Add Full-Duplex Check to Streaming TTS
Added the same full-duplex check to the streaming TTS path to ensure the microphone stays live during AI speech when full-duplex is enabled.

### Changes Made

**File: `web/src/App.tsx`**

**1. Streaming TTS Path (Lines 840-855):**
```typescript
// Reset volume to full before starting new playback
// (in case previous playback ended while ducked)
player.setVolume(1.0)

// Only pause recording if full duplex is disabled
const enableFullDuplex = import.meta.env.VITE_ENABLE_FULL_DUPLEX === 'true'
const wasRecording = isRecording
console.log('[TTS Stream] Full duplex enabled:', enableFullDuplex, 'Was recording:', wasRecording)
if (wasRecording && !enableFullDuplex) {
  console.log('[TTS Stream] Stopping recorder (full duplex disabled)')
  resetRecorder()
}

// Set up playback state tracking
setIsPlaying(true)
setPlayingMessageId(assistantId)
```

**2. Non-Streaming TTS Path (Lines 299-310):**
Added debug logging to verify behavior:
```typescript
// Only pause recording if full duplex is disabled
const enableFullDuplex = import.meta.env.VITE_ENABLE_FULL_DUPLEX === 'true'
const wasRecording = isRecording
console.log('[TTS Non-Stream] Full duplex enabled:', enableFullDuplex, 'Was recording:', wasRecording)
if (wasRecording && !enableFullDuplex) {
  console.log('[TTS Non-Stream] Stopping recorder (full duplex disabled)')
  resetRecorder()
}
```

## Expected Behavior After Fix

With `VITE_ENABLE_FULL_DUPLEX=true`:
- ✅ Microphone stays live during AI speech
- ✅ User can speak while AI is talking (full-duplex)
- ✅ Volume ducking activates when user speaks
- ✅ Barge-in can interrupt AI mid-sentence

With `VITE_ENABLE_FULL_DUPLEX=false`:
- ✅ Microphone stops when AI starts speaking (walkie-talkie mode)
- ✅ User must wait for AI to finish before speaking

## Debug Logging
Added console logs to verify:
1. Whether full-duplex is enabled
2. Whether recording was active when playback started
3. Whether recorder was stopped or kept alive

Check browser console for:
```
[TTS Stream] Full duplex enabled: true Was recording: true
```
or
```
[TTS Non-Stream] Full duplex enabled: true Was recording: true
```

If you see `Full duplex enabled: false`, check that:
1. `web/.env` has `VITE_ENABLE_FULL_DUPLEX=true`
2. The dev server was restarted after changing `.env`
3. The browser was hard-refreshed (Ctrl+Shift+R)

## Related Features
This fix enables the full suite of natural conversation features:
- Full-duplex audio (mic stays on)
- Volume ducking (AI volume drops when you speak)
- Barge-in (interrupt AI mid-sentence)
- Echo cancellation (prevents feedback)

All controlled by environment variables in `web/.env`:
```
VITE_ENABLE_FULL_DUPLEX=true
VITE_ENABLE_DUCKING=true
VITE_DUCK_VOLUME=0.15
VITE_ENABLE_BARGE_IN=true
```

## Testing
1. Start recording (microphone should be active)
2. Send a message and wait for AI to start speaking
3. **Check console logs** - should show `Full duplex enabled: true`
4. **Verify microphone stays active** - waveform should still be visible
5. Try speaking while AI is talking - volume should duck and you can interrupt

## Files Modified
- `web/src/App.tsx` - Fixed React dependency issue + Added full-duplex check to streaming TTS path + debug logging
  - Line 993-1000: Removed `isProcessing` check from `startRecording`
  - Line 1253: Removed `isProcessing` from dependency array
  - Line 840-855: Added full-duplex check to streaming TTS
  - Line 299-310: Added debug logging to non-streaming TTS
- `docs/full_duplex_fix.md` - This documentation

