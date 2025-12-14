/**
 * Speech Chunker - Breaks streaming LLM text into speakable chunks
 *
 * Phase 2 (A): Speak-While-Generating
 *
 * Takes streaming tokens and outputs chunks at natural sentence boundaries,
 * enabling TTS to start speaking before the full response is generated.
 */

export interface SpeechChunk {
  text: string
  index: number
  isFinal: boolean
  endsWithBoundary: boolean
}

export interface SpeechChunkerOptions {
  minChars?: number
  maxChars?: number
  forceAfterMs?: number
}

const DEFAULT_OPTIONS: Required<SpeechChunkerOptions> = {
  minChars: 60,
  maxChars: 220,
  forceAfterMs: 1800
}

/**
 * Common abbreviations that shouldn't trigger chunk boundaries
 */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr',
  'etc', 'e.g', 'i.e', 'vs', 'inc', 'ltd', 'co',
  'st', 'ave', 'rd', 'blvd', 'dept', 'approx'
])

/**
 * Speech Chunker class for real-time text chunking
 */
export class SpeechChunker {
  private buffer: string = ''
  private chunkIndex: number = 0
  private lastChunkTime: number = Date.now()
  private options: Required<SpeechChunkerOptions>

  constructor(options: SpeechChunkerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Add a token to the buffer and check if we should emit a chunk
   */
  addToken(token: string): SpeechChunk | null {
    this.buffer += token

    // Check if we should force a chunk due to timeout
    const timeSinceLastChunk = Date.now() - this.lastChunkTime
    const shouldForce = timeSinceLastChunk >= this.options.forceAfterMs

    // Try to find a natural boundary
    const chunk = this.tryEmitChunk(shouldForce)
    if (chunk) {
      this.lastChunkTime = Date.now()
      return chunk
    }

    return null
  }

  /**
   * Flush any remaining text as the final chunk
   */
  flush(): SpeechChunk | null {
    if (this.buffer.trim().length === 0) {
      return null
    }

    const chunk: SpeechChunk = {
      text: this.buffer.trim(),
      index: this.chunkIndex++,
      isFinal: true,
      endsWithBoundary: false
    }

    this.buffer = ''
    return chunk
  }

  /**
   * Reset the chunker state
   */
  reset() {
    this.buffer = ''
    this.chunkIndex = 0
    this.lastChunkTime = Date.now()
  }

  /**
   * Try to emit a chunk at a natural boundary
   */
  private tryEmitChunk(force: boolean): SpeechChunk | null {
    const bufferLength = this.buffer.length

    // Don't emit if buffer is below minimum (unless forcing)
    if (!force && bufferLength < this.options.minChars) {
      return null
    }

    // Try to find strong boundaries first (. ! ?)
    let boundaryIndex = this.findStrongBoundary()

    // If no strong boundary and we're forcing, try weaker boundaries
    if (boundaryIndex === -1 && force) {
      boundaryIndex = this.findWeakBoundary()
    }

    // If no strong boundary and buffer exceeds max, force at last space
    if (boundaryIndex === -1 && bufferLength >= this.options.maxChars) {
      boundaryIndex = this.findLastSpace()
    }

    // If we found a boundary, emit the chunk
    if (boundaryIndex !== -1) {
      const chunkText = this.buffer.substring(0, boundaryIndex + 1).trim()
      const chunk: SpeechChunk = {
        text: chunkText,
        index: this.chunkIndex++,
        isFinal: false,
        endsWithBoundary: true
      }

      this.buffer = this.buffer.substring(boundaryIndex + 1)
      return chunk
    }

    return null
  }

  /**
   * Find a strong sentence boundary (. ! ?)
   */
  private findStrongBoundary(): number {
    const boundaries = ['.', '!', '?']
    let lastValidBoundary = -1

    for (let i = this.options.minChars; i < this.buffer.length; i++) {
      const char = this.buffer[i]

      if (boundaries.includes(char)) {
        // Check if this is a false positive (abbreviation, decimal, etc.)
        if (this.isFalseBoundary(i)) {
          continue
        }

        // Check if followed by whitespace or newline (or is at end)
        const nextChar = this.buffer[i + 1]
        if (!nextChar || nextChar === ' ' || nextChar === '\n' || nextChar === '\r') {
          lastValidBoundary = i
        }
      }
    }

    return lastValidBoundary
  }

  /**
   * Find a weak boundary (: , ;) - used when forcing
   */
  private findWeakBoundary(): number {
    const boundaries = [':', ',', ';']
    let lastValidBoundary = -1

    for (let i = Math.floor(this.options.minChars / 2); i < this.buffer.length; i++) {
      const char = this.buffer[i]

      if (boundaries.includes(char)) {
        const nextChar = this.buffer[i + 1]
        if (!nextChar || nextChar === ' ' || nextChar === '\n' || nextChar === '\r') {
          lastValidBoundary = i
        }
      }
    }

    return lastValidBoundary
  }

  /**
   * Find the last space in the buffer
   */
  private findLastSpace(): number {
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i] === ' ') {
        return i
      }
    }
    return -1
  }

  /**
   * Check if a boundary character is a false positive
   */
  private isFalseBoundary(index: number): boolean {
    const char = this.buffer[index]

    // Check for abbreviations (word before period in ABBREVIATIONS set)
    if (char === '.') {
      // Look back to find the word before the period
      let wordStart = index - 1
      while (wordStart >= 0 && /[a-zA-Z]/.test(this.buffer[wordStart])) {
        wordStart--
      }
      wordStart++

      if (wordStart < index) {
        const word = this.buffer.substring(wordStart, index).toLowerCase()
        if (ABBREVIATIONS.has(word)) {
          return true
        }
      }

      // Check for decimals (digit before and after period)
      const prevChar = this.buffer[index - 1]
      const nextChar = this.buffer[index + 1]
      if (prevChar && /\d/.test(prevChar) && nextChar && /\d/.test(nextChar)) {
        return true
      }

      // Check for initials (single letter + period + space + capital letter)
      if (prevChar && /[A-Z]/.test(prevChar)) {
        const beforePrev = this.buffer[index - 2]
        if (!beforePrev || beforePrev === ' ' || beforePrev === '\n') {
          // This looks like an initial
          if (nextChar === '.' || (nextChar === ' ' && this.buffer[index + 2] && /[A-Z]/.test(this.buffer[index + 2]))) {
            return true
          }
        }
      }
    }

    return false
  }
}
