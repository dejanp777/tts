/**
 * Context-Aware Threshold Adjustment
 *
 * Dynamically adjusts silence threshold based on conversation context,
 * user patterns, and environmental factors.
 *
 * Factors considered:
 * - Question vs statement
 * - Sentence complexity
 * - Speaking rate
 * - Turn number (conversation start vs middle)
 * - Detected accent/language patterns
 * - Background noise level
 */

export interface ConversationContext {
  isQuestion?: boolean
  transcriptLength?: number
  wordsPerSecond?: number
  turnNumber?: number
  accent?: 'native' | 'non-native' | 'unknown'
  noiseLevel?: number  // 0-1
  userHistory?: {
    averageTurnLength?: number
    interruptionRate?: number
  }
}

export class ContextAwareThreshold {
  private baseThreshold: number
  private currentThreshold: number

  constructor(baseThreshold: number = 1500) {
    this.baseThreshold = baseThreshold
    this.currentThreshold = baseThreshold
  }

  /**
   * Calculates optimal threshold based on conversation context
   *
   * @param context - Current conversation context
   * @returns Adjusted threshold in milliseconds
   */
  calculateThreshold(context: ConversationContext): number {
    let threshold = this.baseThreshold
    const adjustmentLog: string[] = []

    // Factor 1: Question vs statement
    if (context.isQuestion !== undefined) {
      if (context.isQuestion) {
        threshold *= 0.8  // Shorter for questions
        adjustmentLog.push('Question detected (-20%)')
      }
    }

    // Factor 2: Sentence complexity (by length)
    if (context.transcriptLength !== undefined) {
      if (context.transcriptLength > 100) {
        threshold *= 1.3  // Longer for complex thoughts
        adjustmentLog.push('Complex sentence (+30%)')
      } else if (context.transcriptLength > 50) {
        threshold *= 1.1  // Slightly longer for medium sentences
        adjustmentLog.push('Medium sentence (+10%)')
      }
    }

    // Factor 3: Speaking rate
    if (context.wordsPerSecond !== undefined) {
      if (context.wordsPerSecond < 2.0) {
        threshold *= 1.5  // Much longer for slow speakers
        adjustmentLog.push('Slow speaker (+50%)')
      } else if (context.wordsPerSecond < 3.0) {
        threshold *= 1.2  // Longer for moderate pace
        adjustmentLog.push('Moderate pace (+20%)')
      } else if (context.wordsPerSecond > 4.5) {
        threshold *= 0.9  // Slightly shorter for fast speakers
        adjustmentLog.push('Fast speaker (-10%)')
      }
    }

    // Factor 4: Turn number (conversation position)
    if (context.turnNumber !== undefined) {
      if (context.turnNumber < 3) {
        threshold *= 1.4  // More patient early in conversation
        adjustmentLog.push('Early conversation (+40%)')
      } else if (context.turnNumber < 5) {
        threshold *= 1.2  // Moderately patient
        adjustmentLog.push('Building rapport (+20%)')
      }
    }

    // Factor 5: Detected accent/language patterns
    if (context.accent === 'non-native') {
      threshold *= 1.6  // Much longer for non-native speakers
      adjustmentLog.push('Non-native accent (+60%)')
    }

    // Factor 6: Background noise level
    if (context.noiseLevel !== undefined) {
      if (context.noiseLevel > 0.5) {
        threshold *= 1.4  // Much longer with high noise
        adjustmentLog.push('High noise (+40%)')
      } else if (context.noiseLevel > 0.3) {
        threshold *= 1.2  // Longer with noise
        adjustmentLog.push('Noisy environment (+20%)')
      }
    }

    // Factor 7: User history patterns
    if (context.userHistory) {
      // If user has been frequently interrupted, increase threshold
      if (context.userHistory.interruptionRate &&
          context.userHistory.interruptionRate > 0.3) {
        threshold *= 1.3  // 30%+ interruption rate = be more patient
        adjustmentLog.push('High interruption history (+30%)')
      }

      // If user tends to make long turns, increase threshold
      if (context.userHistory.averageTurnLength &&
          context.userHistory.averageTurnLength > 20) {
        threshold *= 1.2  // Long average turns = wait longer
        adjustmentLog.push('Long turn history (+20%)')
      }
    }

    // Clamp to reasonable range (0.5x to 3.0x base threshold)
    const minThreshold = this.baseThreshold * 0.5
    const maxThreshold = this.baseThreshold * 3.0
    threshold = Math.max(minThreshold, Math.min(maxThreshold, threshold))

    this.currentThreshold = threshold

    console.log('[Context Threshold]', {
      base: this.baseThreshold,
      calculated: Math.round(threshold),
      adjustments: adjustmentLog
    })

    return Math.round(threshold)
  }

  /**
   * Detects if current transcript is a question
   *
   * @param transcript - Text to analyze
   * @returns Whether it's a question
   */
  isQuestion(transcript: string): boolean {
    // Check for question mark
    if (transcript.includes('?')) return true

    // Check for question words at start
    const questionWords = /^(who|what|when|where|why|how|which|whose|whom)\b/i
    if (questionWords.test(transcript.trim())) return true

    // Check for yes/no question patterns
    const yesNoPattern = /^(do|does|did|is|are|was|were|can|could|will|would|should|may|might)\b/i
    if (yesNoPattern.test(transcript.trim())) return true

    return false
  }

  /**
   * Estimates speaking rate from transcript and duration
   *
   * @param transcript - Text spoken
   * @param durationMs - Duration of speech (ms)
   * @returns Words per second
   */
  estimateSpeakingRate(transcript: string, durationMs: number): number {
    const words = transcript.trim().split(/\s+/).length
    const durationSeconds = durationMs / 1000
    return words / durationSeconds
  }

  /**
   * Estimates noise level from audio RMS values
   *
   * @param rmsValues - Array of RMS energy values
   * @returns Noise level (0-1)
   */
  estimateNoiseLevel(rmsValues: number[]): number {
    if (rmsValues.length === 0) return 0

    // Calculate variance in RMS (high variance = high noise)
    const mean = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length
    const variance = rmsValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / rmsValues.length
    const stdDev = Math.sqrt(variance)

    // Normalize to 0-1 range (heuristic)
    return Math.min(1, stdDev * 20)
  }

  /**
   * Detects potential accent or non-native speech patterns
   * (Simplified heuristic - would need more sophisticated analysis in production)
   *
   * @param _transcript - Text to analyze (reserved for future use)
   * @param audioFeatures - Audio characteristics
   * @returns Accent classification
   */
  detectAccent(
    _transcript: string,
    audioFeatures?: {
      speakingRate: number
      pauseFrequency: number
    }
  ): 'native' | 'non-native' | 'unknown' {
    // Heuristic: slower speech + more pauses might indicate non-native
    if (audioFeatures) {
      if (audioFeatures.speakingRate < 2.5 &&
          audioFeatures.pauseFrequency > 0.3) {
        return 'non-native'
      }
      if (audioFeatures.speakingRate > 3.5) {
        return 'native'
      }
    }

    return 'unknown'
  }

  /**
   * Updates the base threshold
   *
   * @param newBase - New base threshold
   */
  updateBaseThreshold(newBase: number): void {
    this.baseThreshold = newBase
  }

  /**
   * Gets current threshold
   *
   * @returns Current threshold
   */
  getCurrentThreshold(): number {
    return this.currentThreshold
  }
}
