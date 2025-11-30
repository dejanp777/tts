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
