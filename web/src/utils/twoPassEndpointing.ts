/**
 * Two-Pass Endpointing System
 *
 * Validates endpoint decisions before committing to prevent
 * cutting off semantically incomplete utterances.
 *
 * Architecture:
 * 1. First Pass: Fast acoustic check (silence duration)
 * 2. Second Pass: Semantic validator (completeness check)
 * 3. Arbitrator: Combines both signals for final decision
 *
 * Based on Amazon 2024 research on endpoint verification.
 */

export interface FirstPassResult {
  detected: boolean
  confidence: number
  silenceDuration: number
}

export interface SemanticAnalysis {
  incomplete: boolean
  confidence: number
  reason?: string
}

export interface EndpointDecision {
  endpoint: boolean
  confidence: 'high' | 'medium' | 'low'
  extendThreshold?: number  // If incomplete, wait longer
  reason: string
}

export class TwoPassEndpointer {
  private silenceThreshold: number

  constructor(silenceThreshold: number = 1500) {
    this.silenceThreshold = silenceThreshold
  }

  /**
   * First pass: Quick acoustic check
   *
   * @param silenceDuration - Current silence duration (ms)
   * @returns First pass result
   */
  firstPass(silenceDuration: number): FirstPassResult {
    const detected = silenceDuration >= this.silenceThreshold

    // Confidence increases with how far past threshold we are
    const excess = silenceDuration - this.silenceThreshold
    const confidence = detected
      ? Math.min(1.0, 0.5 + (excess / this.silenceThreshold) * 0.5)
      : silenceDuration / this.silenceThreshold

    return {
      detected,
      confidence,
      silenceDuration
    }
  }

  /**
   * Second pass: Semantic validator
   *
   * Checks if the transcript is semantically complete
   *
   * @param transcript - Current transcript text
   * @returns Semantic analysis
   */
  semanticValidator(transcript: string): SemanticAnalysis {
    if (!transcript || transcript.trim().length === 0) {
      return {
        incomplete: true,
        confidence: 1.0,
        reason: 'Empty transcript'
      }
    }

    const text = transcript.trim()

    // Check for incomplete patterns
    const incompletePatterns = [
      {
        pattern: /\.\.\.$/, // Trailing ellipsis
        reason: 'Trailing ellipsis indicates continuation'
      },
      {
        pattern: /\b(to|at|in|from|with|and|or|but|so|because)\s*$/i,
        reason: 'Trailing preposition or conjunction'
      },
      {
        pattern: /^(I|So|And|But|However|Because|If|When)\s+\w+\s*$/i,
        reason: 'Short incomplete clause'
      },
      {
        pattern: /,\s*$/,
        reason: 'Trailing comma suggests more to come'
      },
      {
        pattern: /^(uh|um|like)\s+\w+\s*$/i,
        reason: 'Filler word with minimal content'
      }
    ]

    for (const { pattern, reason } of incompletePatterns) {
      if (pattern.test(text)) {
        return {
          incomplete: true,
          confidence: 0.9,
          reason
        }
      }
    }

    // Check for explicit completeness markers
    const completePatterns = [
      /[.!?]$/,  // Sentence-ending punctuation
      /\b(done|finished|that's all|that's it|okay|alright)\s*$/i
    ]

    for (const pattern of completePatterns) {
      if (pattern.test(text)) {
        return {
          incomplete: false,
          confidence: 0.95,
          reason: 'Clear completion marker'
        }
      }
    }

    // Check word count - very short utterances might be incomplete
    const words = text.split(/\s+/)
    if (words.length <= 2) {
      return {
        incomplete: true,
        confidence: 0.6,
        reason: 'Very short utterance'
      }
    }

    // Default: assume complete if no incompleteness signals found
    return {
      incomplete: false,
      confidence: 0.7,
      reason: 'No clear incompleteness detected'
    }
  }

  /**
   * Arbitrator: Combines first and second pass results
   *
   * @param firstPass - Result from first pass
   * @param semantic - Result from semantic validator
   * @returns Final endpoint decision
   */
  arbitrate(
    firstPass: FirstPassResult,
    semantic: SemanticAnalysis
  ): EndpointDecision {
    // If first pass didn't detect endpoint, don't take turn
    if (!firstPass.detected) {
      return {
        endpoint: false,
        confidence: 'low',
        reason: 'Silence threshold not reached'
      }
    }

    // If semantically incomplete, extend threshold
    if (semantic.incomplete) {
      const extendBy = semantic.confidence > 0.8 ? 1.5 : 1.2
      const extendThreshold = Math.round(this.silenceThreshold * extendBy)

      return {
        endpoint: false,
        confidence: 'low',
        extendThreshold,
        reason: `Semantically incomplete: ${semantic.reason}`
      }
    }

    // Both passes agree - high confidence
    if (firstPass.confidence > 0.7 && semantic.confidence > 0.7) {
      return {
        endpoint: true,
        confidence: 'high',
        reason: 'Both acoustic and semantic signals agree'
      }
    }

    // Both passes agree but with lower confidence
    if (firstPass.confidence > 0.5 && semantic.confidence > 0.5) {
      return {
        endpoint: true,
        confidence: 'medium',
        reason: 'Moderate confidence from both passes'
      }
    }

    // Disagreement - be conservative, wait longer
    return {
      endpoint: false,
      confidence: 'low',
      extendThreshold: Math.round(this.silenceThreshold * 1.3),
      reason: 'Low confidence or disagreement between passes'
    }
  }

  /**
   * Main processing function
   *
   * @param silenceDuration - Current silence duration (ms)
   * @param transcript - Current transcript text
   * @returns Endpoint decision
   */
  process(silenceDuration: number, transcript: string): EndpointDecision {
    // First pass: Quick acoustic check
    const firstPassResult = this.firstPass(silenceDuration)

    if (!firstPassResult.detected) {
      return {
        endpoint: false,
        confidence: 'low',
        reason: 'Silence threshold not reached'
      }
    }

    // Second pass: Semantic validation
    const semanticResult = this.semanticValidator(transcript)

    // Arbitrator: Combine results
    return this.arbitrate(firstPassResult, semanticResult)
  }

  /**
   * Updates the silence threshold
   *
   * @param newThreshold - New threshold in milliseconds
   */
  updateThreshold(newThreshold: number): void {
    this.silenceThreshold = newThreshold
  }
}
