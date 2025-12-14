/**
 * Speech Queue - Manages sequential playback of speech chunks
 *
 * Phase 2 (A): Speak-While-Generating
 *
 * Queues text chunks and plays them sequentially, supporting pause/resume/abort.
 */

export interface QueuedChunk {
  text: string
  index: number
  isFinal: boolean
}

export type ChunkPlayCallback = (chunk: QueuedChunk) => Promise<void>

// QueueState as const object instead of enum for TypeScript compatibility
export const QueueState = {
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ABORTED: 'aborted'
} as const

export type QueueState = typeof QueueState[keyof typeof QueueState]

/**
 * Speech Queue class for managing chunk playback
 */
export class SpeechQueue {
  private queue: QueuedChunk[] = []
  private currentChunkIndex: number = -1
  private state: QueueState = QueueState.IDLE
  private playCallback: ChunkPlayCallback
  private onComplete?: () => void
  private onError?: (error: Error) => void
  private currentPlayPromise: Promise<void> | null = null
  private abortController: AbortController | null = null

  constructor(
    playCallback: ChunkPlayCallback,
    onComplete?: () => void,
    onError?: (error: Error) => void
  ) {
    this.playCallback = playCallback
    this.onComplete = onComplete
    this.onError = onError
  }

  /**
   * Add a chunk to the queue and start playing if not already playing
   */
  enqueue(chunk: QueuedChunk) {
    console.log('[SAY-STREAM] Enqueueing chunk:', {
      index: chunk.index,
      length: chunk.text.length,
      isFinal: chunk.isFinal,
      queueSize: this.queue.length
    })

    this.queue.push(chunk)

    // Start playing if idle
    if (this.state === QueueState.IDLE) {
      void this.playNext()
    }
  }

  /**
   * Pause the queue (current chunk continues, but no new chunks are played)
   */
  pause() {
    if (this.state === QueueState.PLAYING) {
      console.log('[SAY-STREAM] Pausing queue at chunk', this.currentChunkIndex)
      this.state = QueueState.PAUSED
    }
  }

  /**
   * Resume the queue
   */
  resume() {
    if (this.state === QueueState.PAUSED) {
      console.log('[SAY-STREAM] Resuming queue from chunk', this.currentChunkIndex)
      this.state = QueueState.PLAYING
      // If a chunk is still in-flight, don't start another one.
      // The existing play loop will continue naturally once the chunk finishes.
      if (!this.currentPlayPromise) {
        void this.playNext()
      }
    }
  }

  /**
   * Abort the queue and clear all pending chunks
   */
  abort() {
    console.log('[SAY-STREAM] Aborting queue')
    this.state = QueueState.ABORTED
    this.queue = []

    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Get the current chunk index
   */
  getCurrentChunkIndex(): number {
    return this.currentChunkIndex
  }

  /**
   * Get the current queue state
   */
  getState(): QueueState {
    return this.state
  }

  /**
   * Get the number of chunks in the queue
   */
  getQueueSize(): number {
    return this.queue.length
  }

  /**
   * Reset the queue to initial state
   */
  reset() {
    this.abort()
    this.currentChunkIndex = -1
    this.state = QueueState.IDLE
  }

  /**
   * Play the next chunk in the queue
   */
  private async playNext() {
    // Don't play if paused or aborted
    if (this.state === QueueState.PAUSED || this.state === QueueState.ABORTED) {
      return
    }

    // Check if there are more chunks to play
    if (this.queue.length === 0) {
      // If we were playing and the queue is empty, we're done
      if (this.state === QueueState.PLAYING) {
        console.log('[SAY-STREAM] Queue empty, playback complete')
        this.state = QueueState.IDLE
        this.currentChunkIndex = -1
        if (this.onComplete) {
          this.onComplete()
        }
      }
      return
    }

    // Set state to playing
    this.state = QueueState.PLAYING

    // Get the next chunk
    const chunk = this.queue.shift()!
    this.currentChunkIndex = chunk.index

    console.log('[SAY-STREAM] Playing chunk:', {
      index: chunk.index,
      length: chunk.text.length,
      isFinal: chunk.isFinal,
      remainingChunks: this.queue.length
    })

    try {
      // Create abort controller for this chunk
      this.abortController = new AbortController()

      // Play the chunk
      this.currentPlayPromise = this.playCallback(chunk)
      await this.currentPlayPromise

      // Clear the promise and abort controller
      this.currentPlayPromise = null
      this.abortController = null

      // Play next chunk if not paused/aborted
      if (this.state === QueueState.PLAYING) {
        void this.playNext()
      }
    } catch (error) {
      // Handle abort gracefully
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[SAY-STREAM] Chunk playback aborted')
        this.currentPlayPromise = null
        this.abortController = null
        return
      }

      // Handle other errors
      console.error('[SAY-STREAM] Error playing chunk:', error)
      this.state = QueueState.IDLE
      this.currentPlayPromise = null
      this.abortController = null

      if (this.onError && error instanceof Error) {
        this.onError(error)
      }
    }
  }
}
