/**
 * Chunked Response Delivery System
 *
 * Breaks long responses into natural, conversational chunks to:
 * - Improve perceived responsiveness
 * - Allow for natural pauses and breathing room
 * - Enable interruption at natural breakpoints
 * - Reduce cognitive load on the user
 *
 * Features:
 * - Sentence-based chunking with intelligent splitting
 * - Natural pause calculation based on chunk content
 * - Progressive delivery with TTS streaming
 */

export interface ResponseChunk {
  text: string
  pauseAfterMs: number
  index: number
  isLast: boolean
}

export interface ChunkingOptions {
  maxChunkLength?: number // Maximum characters per chunk
  minChunkLength?: number // Minimum characters per chunk (avoid tiny chunks)
  basePauseMs?: number // Base pause between chunks
  enableChunking?: boolean // Master toggle
}

export class ChunkedDelivery {
  private readonly maxChunkLength: number
  private readonly basePauseMs: number
  private readonly enableChunking: boolean

  constructor(options: ChunkingOptions = {}) {
    this.maxChunkLength = options.maxChunkLength || 150
    // Note: minChunkLength option available but not currently used
    this.basePauseMs = options.basePauseMs || 500
    this.enableChunking = options.enableChunking !== false
  }

  /**
   * Splits a response into natural chunks
   *
   * @param response - Full response text
   * @returns Array of chunks with pause durations
   */
  chunkResponse(response: string): ResponseChunk[] {
    if (!this.enableChunking || response.length <= this.maxChunkLength) {
      // Don't chunk short responses
      return [
        {
          text: response,
          pauseAfterMs: 0,
          index: 0,
          isLast: true
        }
      ]
    }

    // Split into sentences first
    const sentences = this.splitIntoSentences(response)
    const chunks: ResponseChunk[] = []
    let currentChunk = ''

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]

      // If adding this sentence would exceed max length and we already have content
      if (currentChunk.length > 0 && (currentChunk + sentence).length > this.maxChunkLength) {
        // Emit current chunk
        chunks.push({
          text: currentChunk.trim(),
          pauseAfterMs: this.calculatePause(currentChunk),
          index: chunks.length,
          isLast: false
        })
        currentChunk = sentence
      } else {
        // Add to current chunk
        currentChunk += (currentChunk ? ' ' : '') + sentence
      }
    }

    // Add final chunk
    if (currentChunk) {
      chunks.push({
        text: currentChunk.trim(),
        pauseAfterMs: 0, // No pause after last chunk
        index: chunks.length,
        isLast: true
      })
    }

    // Mark last chunk
    if (chunks.length > 0) {
      chunks[chunks.length - 1].isLast = true
    }

    console.log('[Chunked Delivery] Split response into', chunks.length, 'chunks')
    return chunks
  }

  /**
   * Determines if response should be chunked
   *
   * @param response - Response text
   * @returns Whether chunking should be applied
   */
  shouldChunk(response: string): boolean {
    if (!this.enableChunking) {
      return false
    }

    // Chunk if response is long enough
    return response.length > this.maxChunkLength
  }

  /**
   * Gets estimated total delivery time including pauses
   *
   * @param chunks - Array of chunks
   * @returns Total estimated time in milliseconds
   */
  getEstimatedDeliveryTime(chunks: ResponseChunk[]): number {
    let totalTime = 0

    for (const chunk of chunks) {
      // Estimate TTS time (roughly 100ms per 10 characters, conservative estimate)
      const ttsTime = (chunk.text.length / 10) * 100
      totalTime += ttsTime + chunk.pauseAfterMs
    }

    return totalTime
  }

  // Private helper methods

  /**
   * Splits text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by space and capital letter
    // Also split on line breaks
    const sentenceRegex = /([.!?]+\s+(?=[A-Z])|[\n\r]+)/

    const parts = text.split(sentenceRegex)
    const sentences: string[] = []
    let current = ''

    for (const part of parts) {
      if (sentenceRegex.test(part)) {
        // This is a delimiter, add to current and push
        if (current) {
          sentences.push((current + part).trim())
          current = ''
        }
      } else {
        // This is content
        current += part
      }
    }

    // Add remaining content
    if (current) {
      sentences.push(current.trim())
    }

    return sentences.filter(s => s.length > 0)
  }

  /**
   * Calculates appropriate pause duration based on chunk content
   */
  private calculatePause(chunk: string): number {
    // Longer pauses for chunks ending with certain punctuation
    if (chunk.endsWith('?')) {
      return this.basePauseMs + 200 // Questions get longer pause
    }

    if (chunk.endsWith('!')) {
      return this.basePauseMs + 100 // Exclamations get slightly longer pause
    }

    if (chunk.endsWith('.')) {
      return this.basePauseMs // Normal pause
    }

    if (chunk.endsWith(',') || chunk.endsWith(';')) {
      return this.basePauseMs - 200 // Shorter pause for mid-thought
    }

    // Default pause
    return this.basePauseMs
  }

  // Note: Topic shift detection patterns available for future enhancements:
  // - /^(however|but|although|meanwhile|additionally|furthermore|moreover)/i
  // - /^(by the way|incidentally|speaking of)/i
  // - /^(on the other hand|on another note)/i
}
