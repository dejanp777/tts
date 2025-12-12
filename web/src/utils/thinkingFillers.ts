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
  private currentAudio: HTMLAudioElement | null = null
  private playbackResolve: (() => void) | null = null
  private playbackStartTime: number = 0

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

      // Track playback state for coordination with TTS
      this.currentAudio = audio
      this.playbackStartTime = Date.now()
      this.playbackResolve = resolve

      audio.onended = () => {
        this.cleanup()
        resolve()
      }

      audio.onerror = (err) => {
        this.cleanup()
        reject(err)
      }

      audio.play().catch((err) => {
        this.cleanup()
        reject(err)
      })
    })
  }

  /** Stop currently playing filler audio */
  stopFiller(): void {
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.currentTime = 0
    }
    if (this.playbackResolve) {
      this.playbackResolve()
    }
    this.cleanup()
  }

  /** Check if filler is currently playing */
  isPlaying(): boolean {
    return this.currentAudio !== null
  }

  /** Get how long the current filler has been playing (ms) */
  getPlaybackDuration(): number {
    return this.playbackStartTime ? Date.now() - this.playbackStartTime : 0
  }

  private cleanup(): void {
    this.currentAudio = null
    this.playbackResolve = null
    this.playbackStartTime = 0
  }
}
