# Phase 1: Immediate Code Changes
**Timeline:** Week 1-2
**Expected Impact:** 30-40% reduction in interruption complaints

---

## 1. CRITICAL: Increase Silence Threshold (5 minutes)

### Location: `web/src/App.tsx:1146`

**Current:**
```typescript
const maxSilenceMs = import.meta.env.VITE_MAX_SILENCE_MS
  ? parseInt(import.meta.env.VITE_MAX_SILENCE_MS)
  : 800 // Reduced from 2300ms to 800ms for faster turn completion
```

**Change to:**
```typescript
const maxSilenceMs = import.meta.env.VITE_MAX_SILENCE_MS
  ? parseInt(import.meta.env.VITE_MAX_SILENCE_MS)
  : 1500 // Increased to 1500ms for more natural pauses
```

**Environment variable:**
```bash
# Add to .env
VITE_MAX_SILENCE_MS=1500
```

**Rationale:**
- 800ms is in the "danger zone" according to research
- Humans naturally pause 1-2 seconds when thinking
- This single change addresses the #1 complaint: premature interruption

---

## 2. Add User Control Slider (2-3 hours)

### Create new component: `web/src/components/SettingsPanel.tsx`

```typescript
import { useState, useEffect } from 'react'

interface SettingsPanelProps {
  onSilenceThresholdChange: (ms: number) => void
  onBackchannelsEnabledChange: (enabled: boolean) => void
}

export const SettingsPanel = ({
  onSilenceThresholdChange,
  onBackchannelsEnabledChange
}: SettingsPanelProps) => {
  const [silenceThreshold, setSilenceThreshold] = useState(() => {
    const saved = localStorage.getItem('silenceThreshold')
    return saved ? parseInt(saved) : 1500
  })

  const [backchannelsEnabled, setBackchannelsEnabled] = useState(() => {
    const saved = localStorage.getItem('backchannelsEnabled')
    return saved ? saved === 'true' : true
  })

  useEffect(() => {
    localStorage.setItem('silenceThreshold', silenceThreshold.toString())
    onSilenceThresholdChange(silenceThreshold)
  }, [silenceThreshold, onSilenceThresholdChange])

  useEffect(() => {
    localStorage.setItem('backchannelsEnabled', backchannelsEnabled.toString())
    onBackchannelsEnabledChange(backchannelsEnabled)
  }, [backchannelsEnabled, onBackchannelsEnabledChange])

  const getLabel = (ms: number) => {
    if (ms < 800) return 'Faster'
    if (ms < 1200) return 'Quick'
    if (ms < 1800) return 'Normal'
    if (ms < 2400) return 'Patient'
    return 'Slower'
  }

  return (
    <div className="settings-panel">
      <h3>Voice Settings</h3>

      <div className="setting-item">
        <label>
          Response Timing: {getLabel(silenceThreshold)}
          <div className="slider-container">
            <span className="slider-label">Faster</span>
            <input
              type="range"
              min="500"
              max="3000"
              step="100"
              value={silenceThreshold}
              onChange={(e) => setSilenceThreshold(parseInt(e.target.value))}
            />
            <span className="slider-label">Slower</span>
          </div>
          <span className="slider-value">{(silenceThreshold / 1000).toFixed(1)}s</span>
        </label>
      </div>

      <div className="setting-item">
        <label>
          <input
            type="checkbox"
            checked={backchannelsEnabled}
            onChange={(e) => setBackchannelsEnabled(e.target.checked)}
          />
          Enable thinking sounds ("hmm", "okay")
        </label>
      </div>
    </div>
  )
}
```

### Add CSS: `web/src/App.css`

```css
.settings-panel {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.settings-panel h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
}

.setting-item {
  margin-bottom: 12px;
}

.slider-container {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}

.slider-label {
  font-size: 12px;
  color: #666;
  min-width: 50px;
}

.slider-value {
  display: inline-block;
  margin-left: 8px;
  font-weight: 600;
  color: #333;
}

input[type="range"] {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: #ddd;
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #4CAF50;
  cursor: pointer;
}

input[type="range"]::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #4CAF50;
  cursor: pointer;
  border: none;
}

.setting-item label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.setting-item input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}
```

### Integrate into `web/src/App.tsx`

```typescript
// Add import at top
import { SettingsPanel } from './components/SettingsPanel'

// Add state for user preferences
const [userSilenceThreshold, setUserSilenceThreshold] = useState(1500)
const [backchannelsEnabled, setBackchannelsEnabled] = useState(true)

// Modify the maxSilenceMs calculation (around line 1146)
const maxSilenceMs = userSilenceThreshold // Use user preference instead of env var

// Add SettingsPanel to render (after header, before messages section)
<header className="chat-header">
  {/* existing header content */}
</header>

<SettingsPanel
  onSilenceThresholdChange={setUserSilenceThreshold}
  onBackchannelsEnabledChange={setBackchannelsEnabled}
/>

<section className="messages">
  {/* existing messages */}
</section>
```

---

## 3. Graduated Audio Ducking (1-2 hours)

### Location: `web/src/App.tsx:1179-1214`

**Current:**
```typescript
// Volume ducking: reduce AI audio volume when user is speaking
const enableDucking = import.meta.env.VITE_ENABLE_DUCKING === 'true' || false
const duckVolume = import.meta.env.VITE_DUCK_VOLUME
  ? parseFloat(import.meta.env.VITE_DUCK_VOLUME)
  : 0.15

if (enableDucking && isPlaying) {
  // Duck volume for either HTMLAudio or PCMStreamPlayer
  if (pcmStreamPlayerRef.current) {
    // Streaming TTS path - use gain node
    if (speaking) {
      const currentVolume = pcmStreamPlayerRef.current.getVolume()
      if (currentVolume > duckVolume) {
        pcmStreamPlayerRef.current.setVolume(Math.max(duckVolume, currentVolume - 0.05))
      }
    } else {
      const currentVolume = pcmStreamPlayerRef.current.getVolume()
      if (currentVolume < 1.0) {
        pcmStreamPlayerRef.current.setVolume(Math.min(1.0, currentVolume + 0.05))
      }
    }
  }
  // ... similar for currentAudioRef
}
```

**Change to:**
```typescript
// Enhanced graduated audio ducking
const enableDucking = import.meta.env.VITE_ENABLE_DUCKING === 'true' || false

// Classify user audio to determine ducking level
const classifyUserAudio = (
  duration: number,
  intensity: number,
  speaking: boolean
): 'NONE' | 'BACKCHANNEL' | 'TENTATIVE' | 'CLEAR' => {
  if (!speaking) return 'NONE'

  // Short, quiet sounds = backchannel ("mm-hmm")
  if (duration < 800 && intensity < 0.03) {
    return 'BACKCHANNEL'
  }

  // Low intensity but longer = tentative speech
  if (intensity < 0.04) {
    return 'TENTATIVE'
  }

  // Strong, sustained speech = clear interruption
  return 'CLEAR'
}

const getDuckVolume = (classification: string): number => {
  switch (classification) {
    case 'BACKCHANNEL': return 0.80  // Minimal ducking
    case 'TENTATIVE': return 0.50    // Moderate ducking
    case 'CLEAR': return 0.20        // Strong ducking
    default: return 1.0              // No ducking
  }
}

if (enableDucking && isPlaying) {
  // Calculate RMS intensity from audio data
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  const intensity = Math.sqrt(sum / data.length)

  // Classify the current user audio
  const classification = classifyUserAudio(
    voiceMsRef.current,
    intensity,
    speaking
  )

  const targetVolume = getDuckVolume(classification)

  // Smooth transition to target volume (300ms fade)
  if (pcmStreamPlayerRef.current) {
    const currentVolume = pcmStreamPlayerRef.current.getVolume()
    const step = 0.05

    if (Math.abs(currentVolume - targetVolume) > 0.01) {
      const newVolume = currentVolume < targetVolume
        ? Math.min(targetVolume, currentVolume + step)
        : Math.max(targetVolume, currentVolume - step)

      pcmStreamPlayerRef.current.setVolume(newVolume)
    }
  } else if (currentAudioRef.current) {
    const currentVolume = currentAudioRef.current.volume
    const step = 0.05

    if (Math.abs(currentVolume - targetVolume) > 0.01) {
      const newVolume = currentVolume < targetVolume
        ? Math.min(targetVolume, currentVolume + step)
        : Math.max(targetVolume, currentVolume - step)

      currentAudioRef.current.volume = newVolume
    }
  }
}
```

---

## 4. Backchannel Detection (3-4 hours)

### Create utility: `web/src/utils/backchannels.ts`

```typescript
export interface AudioFeatures {
  duration: number      // milliseconds
  intensity: number     // RMS energy (0-1)
  frequency: number     // dominant frequency (Hz)
}

export type AudioClassification =
  | 'BACKCHANNEL'      // "mm-hmm", "uh-huh" during AI speech
  | 'INTERRUPTION'     // Real turn-taking attempt
  | 'SILENCE'          // No speech

export interface ClassificationResult {
  type: AudioClassification
  confidence: number   // 0-1
}

const BACKCHANNEL_PHONEMES = [
  'mm', 'mhm', 'mmhmm',
  'uh', 'huh', 'uhhuh',
  'yeah', 'yep', 'yup',
  'okay', 'ok'
]

export const classifyUserAudio = (
  features: AudioFeatures,
  aiIsSpeaking: boolean
): ClassificationResult => {
  // Only classify as backchannel if AI is speaking
  if (!aiIsSpeaking) {
    return {
      type: features.intensity > 0.025 ? 'INTERRUPTION' : 'SILENCE',
      confidence: 0.8
    }
  }

  // Backchannel criteria:
  // 1. Very short duration (<1 second, typically 0.3-0.6s)
  const shortDuration = features.duration < 1000

  // 2. Low intensity (quieter than normal speech)
  const lowIntensity = features.intensity < 0.04

  // 3. Specific frequency range (nasal sounds ~100-300Hz)
  const nasalFrequency = features.frequency > 80 && features.frequency < 350

  // Calculate confidence
  let confidence = 0
  if (shortDuration) confidence += 0.4
  if (lowIntensity) confidence += 0.4
  if (nasalFrequency) confidence += 0.2

  // High confidence backchannel detection
  if (confidence >= 0.7) {
    return {
      type: 'BACKCHANNEL',
      confidence
    }
  }

  // Longer duration or higher intensity = real interruption
  if (features.duration > 1000 || features.intensity > 0.06) {
    return {
      type: 'INTERRUPTION',
      confidence: 0.9
    }
  }

  // Ambiguous case - default to interruption to be safe
  return {
    type: 'INTERRUPTION',
    confidence: 0.5
  }
}

export const extractAudioFeatures = (
  audioData: Float32Array,
  sampleRate: number,
  durationMs: number
): AudioFeatures => {
  // Calculate RMS intensity
  let sum = 0
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i]
  }
  const intensity = Math.sqrt(sum / audioData.length)

  // Simple frequency estimation (dominant frequency)
  // In production, use FFT for accurate frequency analysis
  const frequency = estimateDominantFrequency(audioData, sampleRate)

  return {
    duration: durationMs,
    intensity,
    frequency
  }
}

// Simple zero-crossing rate method for frequency estimation
const estimateDominantFrequency = (
  data: Float32Array,
  sampleRate: number
): number => {
  let zeroCrossings = 0

  for (let i = 1; i < data.length; i++) {
    if ((data[i] >= 0 && data[i - 1] < 0) || (data[i] < 0 && data[i - 1] >= 0)) {
      zeroCrossings++
    }
  }

  // Frequency = (zero crossings / 2) / duration
  const duration = data.length / sampleRate
  return (zeroCrossings / 2) / duration
}
```

### Integrate into `web/src/App.tsx`

```typescript
// Add import
import { classifyUserAudio, extractAudioFeatures } from './utils/backchannels'

// In VAD timer callback (around line 1150-1300), replace barge-in logic:

// Calculate audio features
const audioFeatures = extractAudioFeatures(
  data,
  audioContextRef.current?.sampleRate || 44100,
  voiceMsRef.current
)

// Classify the audio
const classification = classifyUserAudio(audioFeatures, isPlaying)

console.log('[Audio Classification]', {
  type: classification.type,
  confidence: classification.confidence,
  features: audioFeatures,
  aiSpeaking: isPlaying
})

// Barge-in: interrupt AI when user speaks over it
const enableBargeIn = import.meta.env.VITE_ENABLE_BARGE_IN === 'true' || false
const bargeInThresholdMs = 300 // Require 300ms of sustained speech to trigger barge-in

if (enableBargeIn && isPlaying && speaking) {
  // Only trigger barge-in for real interruptions, not backchannels
  if (classification.type === 'INTERRUPTION' &&
      classification.confidence > 0.7 &&
      voiceMsRef.current >= bargeInThresholdMs) {

    console.log('[Barge-in] User interrupted AI (not a backchannel)')

    // Abort in-flight requests
    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort()
      chatAbortControllerRef.current = null
    }
    if (ttsAbortControllerRef.current) {
      ttsAbortControllerRef.current.abort()
      ttsAbortControllerRef.current = null
    }

    // Stop audio playback
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
    }

    // Stop streaming audio if using streaming TTS
    if (pcmStreamPlayerRef.current) {
      pcmStreamPlayerRef.current.stop()
    }

    setIsPlaying(false)
    setPlayingMessageId(null)
    setStatus('Interrupted. Listening...')
  } else if (classification.type === 'BACKCHANNEL') {
    console.log('[Backchannel] Detected, not interrupting AI')
    // Don't interrupt, just acknowledge in logs
  }
}
```

---

## 5. AI Thinking Fillers (4-5 hours)

### Create utility: `web/src/utils/thinkingFillers.ts`

```typescript
export interface FillerOptions {
  enabled: boolean
  thresholdMs: number  // How long to wait before playing
  minInterval: number  // Minimum time between fillers
}

export type FillerType = 'thinking' | 'acknowledgment' | 'transition'

const FILLER_AUDIO_URLS: Record<FillerType, string[]> = {
  thinking: [
    '/audio/fillers/hmm.mp3',
    '/audio/fillers/let-me-see.mp3',
    '/audio/fillers/let-me-think.mp3'
  ],
  acknowledgment: [
    '/audio/fillers/okay.mp3',
    '/audio/fillers/i-see.mp3',
    '/audio/fillers/right.mp3'
  ],
  transition: [
    '/audio/fillers/so.mp3',
    '/audio/fillers/well.mp3'
  ]
}

export class ThinkingFillerManager {
  private lastFillerTime = 0
  private options: FillerOptions

  constructor(options: FillerOptions) {
    this.options = options
  }

  shouldPlayFiller(): boolean {
    if (!this.options.enabled) return false

    const now = Date.now()
    const timeSinceLastFiller = now - this.lastFillerTime

    return timeSinceLastFiller >= this.options.minInterval
  }

  selectFiller(userInput: string): string | null {
    if (!this.shouldPlayFiller()) return null

    // Choose contextual filler based on input
    let type: FillerType

    if (userInput.includes('?')) {
      type = 'thinking' // For questions
    } else if (userInput.length > 100) {
      type = 'acknowledgment' // For long inputs
    } else {
      type = 'thinking' // Default
    }

    const fillers = FILLER_AUDIO_URLS[type]
    const randomFiller = fillers[Math.floor(Math.random() * fillers.length)]

    this.lastFillerTime = Date.now()
    return randomFiller
  }

  async playFiller(audioUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl)
      audio.volume = 0.8 // Slightly quieter than main speech

      audio.onended = () => resolve()
      audio.onerror = (err) => reject(err)

      audio.play().catch(reject)
    })
  }
}
```

### Generate filler audio files

```typescript
// Add to server/index.js - new endpoint to generate fillers

app.post('/api/tts/generate-fillers', async (req, res) => {
  try {
    if (!CARTESIA_API_KEY) {
      return res.status(500).json({ error: 'Cartesia API key not configured' });
    }

    const TESSA_VOICE_ID = '6ccbfb76-1fc6-48f7-b71d-91ac6298247b';

    const fillers = [
      { text: 'hmm', emotion: 'thoughtful', filename: 'hmm.mp3' },
      { text: 'let me see', emotion: 'thoughtful', filename: 'let-me-see.mp3' },
      { text: 'let me think about that', emotion: 'thoughtful', filename: 'let-me-think.mp3' },
      { text: 'okay', emotion: 'neutral', filename: 'okay.mp3' },
      { text: 'I see', emotion: 'understanding', filename: 'i-see.mp3' },
      { text: 'right', emotion: 'neutral', filename: 'right.mp3' },
      { text: 'so', emotion: 'neutral', filename: 'so.mp3' },
      { text: 'well', emotion: 'thoughtful', filename: 'well.mp3' }
    ];

    const generatedFillers = [];

    for (const filler of fillers) {
      const response = await axios.post('https://api.cartesia.ai/tts/bytes', {
        model_id: CARTESIA_TTS_MODEL,
        transcript: filler.text,
        voice: { mode: 'id', id: TESSA_VOICE_ID },
        output_format: {
          container: 'mp3',
          encoding: 'mp3',
          sample_rate: 22050
        },
        generation_config: {
          speed: 0.95, // Slightly slower
          emotion: filler.emotion
        }
      }, {
        headers: {
          'X-API-Key': CARTESIA_API_KEY,
          'Cartesia-Version': CARTESIA_VERSION,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 60000,
      });

      const audioBase64 = Buffer.from(response.data).toString('base64');

      generatedFillers.push({
        filename: filler.filename,
        audio: `data:audio/mp3;base64,${audioBase64}`
      });
    }

    res.json({ fillers: generatedFillers });
  } catch (error) {
    console.error('[generate-fillers] error', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to generate fillers',
      details: error.response?.data || error.message,
    });
  }
});
```

### Integrate into `web/src/App.tsx`

```typescript
// Add import
import { ThinkingFillerManager } from './utils/thinkingFillers'

// Initialize filler manager
const fillerManagerRef = useRef<ThinkingFillerManager>(
  new ThinkingFillerManager({
    enabled: backchannelsEnabled,
    thresholdMs: 1500,
    minInterval: 5000 // Max 1 filler per 5 seconds
  })
)

// Update when user preference changes
useEffect(() => {
  fillerManagerRef.current = new ThinkingFillerManager({
    enabled: backchannelsEnabled,
    thresholdMs: 1500,
    minInterval: 5000
  })
}, [backchannelsEnabled])

// In sendMessageFlow, add filler logic before LLM call:

const sendMessageFlow = useCallback(
  async (userText: string) => {
    // ... existing code ...

    setStatus('Thinking...')

    // START: Filler logic
    let fillerTimeout: number | null = null
    let fillerPlayed = false

    const fillerUrl = fillerManagerRef.current.selectFiller(userText)

    if (fillerUrl) {
      fillerTimeout = window.setTimeout(async () => {
        try {
          console.log('[Filler] Playing thinking filler:', fillerUrl)
          await fillerManagerRef.current.playFiller(fillerUrl)
          fillerPlayed = true
        } catch (err) {
          console.error('[Filler] Failed to play:', err)
        }
      }, fillerManagerRef.current.options.thresholdMs)
    }
    // END: Filler logic

    try {
      const enableChatStream = import.meta.env.VITE_ENABLE_CHAT_STREAM === 'true' || false
      let assistantText = ''
      const assistantId = createId()

      // ... existing chat logic ...

      // Clear filler timeout once we have response
      if (fillerTimeout) {
        window.clearTimeout(fillerTimeout)
      }

      // ... rest of existing code ...
    } catch (err) {
      // Clear filler timeout on error
      if (fillerTimeout) {
        window.clearTimeout(fillerTimeout)
      }
      // ... existing error handling ...
    }
  },
  [/* existing deps */, backchannelsEnabled]
)
```

---

## 6. Expand Emotional Prosody (3-4 hours)

### Create utility: `web/src/utils/prosody.ts`

```typescript
export interface ProsodyProfile {
  emotion: string
  speed?: number
  energy?: number
  pitch?: number
}

export const EMOTION_PROFILES: Record<string, ProsodyProfile> = {
  greeting: {
    emotion: 'friendly',
    energy: 0.9,
    speed: 1.0
  },
  error: {
    emotion: 'apologetic',
    energy: 0.6,
    speed: 0.95
  },
  excited: {
    emotion: 'enthusiastic',
    energy: 0.95,
    speed: 1.1
  },
  thoughtful: {
    emotion: 'calm',
    energy: 0.6,
    speed: 0.9
  },
  curious: {
    emotion: 'curious',
    energy: 0.8,
    speed: 1.0
  },
  frustrated: {
    emotion: 'frustrated',
    energy: 0.7,
    speed: 1.0
  },
  empathetic: {
    emotion: 'empathetic',
    energy: 0.65,
    speed: 0.95
  },
  default: {
    emotion: 'frustrated', // Match current persona
    energy: 0.7,
    speed: 1.0
  }
}

export type MessageType =
  | 'greeting'
  | 'error'
  | 'question'
  | 'exclamation'
  | 'apology'
  | 'default'

export const detectMessageType = (content: string): MessageType => {
  const lower = content.toLowerCase()

  // Greetings
  if (/^(hi|hello|hey|good morning|good afternoon)/.test(lower)) {
    return 'greeting'
  }

  // Errors/apologies
  if (/sorry|apolog|my bad|oops/.test(lower)) {
    return 'apology'
  }

  // Questions
  if (content.includes('?')) {
    return 'question'
  }

  // Exclamations
  if (content.includes('!')) {
    return 'exclamation'
  }

  return 'default'
}

export const selectProsody = (
  messageType: MessageType,
  content: string
): ProsodyProfile => {
  switch (messageType) {
    case 'greeting':
      return EMOTION_PROFILES.greeting

    case 'error':
    case 'apology':
      return EMOTION_PROFILES.error

    case 'question':
      return EMOTION_PROFILES.curious

    case 'exclamation':
      return EMOTION_PROFILES.excited

    default:
      // Context-aware defaults
      if (content.length > 100) {
        return EMOTION_PROFILES.thoughtful
      }
      return EMOTION_PROFILES.default
  }
}
```

### Modify `web/src/App.tsx` - TTS calls

```typescript
// Import prosody utilities
import { detectMessageType, selectProsody } from './utils/prosody'

// In sendMessageFlow, when calling TTS:

// Detect message type and select appropriate prosody
const messageType = detectMessageType(assistantText)
const prosody = selectProsody(messageType, assistantText)

console.log('[Prosody] Selected:', { messageType, prosody })

if (ENABLE_TTS_STREAM) {
  // Streaming TTS - prosody will be applied server-side
  // We'll need to pass prosody parameters in the request

  // Note: This requires server-side changes to accept prosody params
} else {
  // Non-streaming TTS
  const audioUrl = await synthesizeSpeech(assistantText, prosody)
  // ... rest of code
}
```

### Modify `web/src/App.tsx` - synthesizeSpeech function

```typescript
const synthesizeSpeech = useCallback(async (
  text: string,
  prosody?: ProsodyProfile
) => {
  const url = `${API_BASE}/api/tts`
  console.log('[API] Requesting TTS:', url, 'prosody:', prosody)

  const controller = new AbortController()
  ttsAbortControllerRef.current = controller

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      emotion: prosody?.emotion || 'frustrated',
      speed: prosody?.speed || 1.0
    }),
    signal: controller.signal,
  })

  // ... rest of existing code
}, [])
```

### Modify `server/index.js` - TTS endpoint

```typescript
app.post('/api/tts', async (req, res) => {
  try {
    if (!CARTESIA_API_KEY) {
      return res.status(500).json({ error: 'Cartesia API key not configured' });
    }

    const TESSA_VOICE_ID = '6ccbfb76-1fc6-48f7-b71d-91ac6298247b';

    const {
      text,
      voiceId = TESSA_VOICE_ID,
      speed = 1.0,
      emotion = 'frustrated' // Accept dynamic emotion
    } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }

    console.log('[TTS] Generating with emotion:', emotion, 'speed:', speed);

    const payload = {
      model_id: CARTESIA_TTS_MODEL,
      transcript: text,
      voice: {
        mode: 'id',
        id: voiceId,
      },
      output_format: {
        container: 'wav',
        encoding: 'pcm_f32le',
        sample_rate: 44100,
      },
      generation_config: {
        speed: speed,
        volume: 1,
        emotion: emotion,
      },
    };

    // ... rest of existing code
  } catch (error) {
    // ... existing error handling
  }
});
```

Similar changes needed for `/api/tts/stream` endpoint.

---

## Testing Checklist

### After implementing each change:

1. **Silence Threshold:**
   - [ ] Test with natural pauses (count "one Mississippi, two Mississippi")
   - [ ] Verify no premature interruptions
   - [ ] Check response feels appropriately delayed

2. **User Slider:**
   - [ ] Verify slider moves smoothly (500-3000ms)
   - [ ] Check value persists after page reload
   - [ ] Test at extreme ends (very fast/very slow)
   - [ ] Verify label updates correctly

3. **Graduated Ducking:**
   - [ ] Test with quiet "mm-hmm" sounds (should stay at 80%)
   - [ ] Test with normal speech (should drop to 20%)
   - [ ] Verify smooth transitions (no jarring volume jumps)
   - [ ] Check both streaming and non-streaming TTS paths

4. **Backchannel Detection:**
   - [ ] Say "mm-hmm" during AI speech (should NOT interrupt)
   - [ ] Say full sentence during AI speech (SHOULD interrupt)
   - [ ] Check console logs for classification accuracy
   - [ ] Test with different microphone sensitivity levels

5. **Thinking Fillers:**
   - [ ] Ask complex question, verify "hmm" plays after 1.5s
   - [ ] Verify not too frequent (max 1 per 5 seconds)
   - [ ] Test opt-out (checkbox should disable)
   - [ ] Check different filler types for different contexts

6. **Emotional Prosody:**
   - [ ] Greet AI, verify friendly tone
   - [ ] Trigger error, verify apologetic tone
   - [ ] Ask question, verify curious tone
   - [ ] Use exclamation, verify enthusiastic tone
   - [ ] Read responses aloud - do they sound natural?

---

## Deployment Steps

1. **Install dependencies** (if any new packages added)
   ```bash
   cd web && npm install
   cd ../server && npm install
   ```

2. **Generate filler audio files**
   ```bash
   # Call the new endpoint to generate MP3 files
   curl -X POST http://localhost:4000/api/tts/generate-fillers > fillers.json

   # Extract and save to web/public/audio/fillers/
   mkdir -p web/public/audio/fillers
   # (Use script to decode base64 and save files)
   ```

3. **Update environment variables**
   ```bash
   # .env or .env.local
   VITE_MAX_SILENCE_MS=1500
   VITE_ENABLE_DUCKING=true
   VITE_ENABLE_BARGE_IN=true
   ```

4. **Test locally**
   ```bash
   # Terminal 1
   cd server && npm start

   # Terminal 2
   cd web && npm run dev
   ```

5. **Monitor console logs**
   - Watch for `[Audio Classification]` logs
   - Watch for `[Prosody] Selected:` logs
   - Watch for `[Filler]` logs
   - Check for any errors

6. **Gradual rollout**
   - Test with 1-2 users first
   - Gather feedback
   - Adjust thresholds if needed
   - Roll out to all users

---

## Expected Results

### Before (Current State):
- Users complain: "Interrupts me mid-thought"
- 800ms threshold feels rushed
- "mm-hmm" stops AI speech
- Silent delays feel awkward
- Robotic, single-emotion voice

### After (Phase 1 Complete):
- Users say: "Feels more patient"
- 1500ms default + user control = flexibility
- Backchannels ignored = smoother flow
- Thinking fillers = less awkward silences
- Dynamic emotions = warmer personality

---

## Next Steps After Phase 1

Once Phase 1 is complete and tested:
1. Gather user feedback (survey + usage metrics)
2. Measure interruption rate reduction
3. Decide: Proceed to Phase 2 (TurnGPT/VAP)?
4. Or: Iterate on Phase 1 improvements?

**Recommendation:** Don't rush to Phase 2. Let Phase 1 run for 1-2 weeks, gather data, then decide.

---

## Questions?

If you need help implementing any of these changes, let me know which section you want to tackle first!
