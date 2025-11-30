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

// Note: Phoneme detection would require additional ASR integration
// const BACKCHANNEL_PHONEMES = ['mm', 'mhm', 'uh', 'huh', 'yeah', 'yep', 'okay']

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
