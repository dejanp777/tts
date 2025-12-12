/**
 * Verbosity Controller
 * 
 * Manages AI response verbosity based on user interruption patterns.
 * Automatically switches between modes to match user preferences.
 * 
 * Modes:
 * - NORMAL: Standard responses (default)
 * - CONCISE: Shorter, more direct responses
 * - MINIMAL: Very brief, essential information only
 */

export type VerbosityMode = 'NORMAL' | 'CONCISE' | 'MINIMAL'

export const VerbosityMode = {
    NORMAL: 'NORMAL' as const,
    CONCISE: 'CONCISE' as const,
    MINIMAL: 'MINIMAL' as const
}

export interface VerbosityConfig {
    mode: VerbosityMode
    systemPromptAdjustment: string
    maxResponseLength: number
}

export class VerbosityController {
    private mode: VerbosityMode = VerbosityMode.NORMAL
    private interruptionHistory: number[] = [] // Timestamps of interruptions
    private readonly interruptionWindow = 60000 // 1 minute window
    private readonly impatientThreshold = 3 // 3 interruptions in window = impatient
    private readonly veryImpatientThreshold = 5 // 5 interruptions = very impatient

    /**
     * Records an interruption and updates verbosity mode if needed
     * 
     * @param timestamp - Timestamp of interruption
     */
    recordInterruption(timestamp: number = Date.now()): void {
        // Add new interruption
        this.interruptionHistory.push(timestamp)

        // Remove old interruptions outside the window
        const cutoff = timestamp - this.interruptionWindow
        this.interruptionHistory = this.interruptionHistory.filter(t => t > cutoff)

        // Update mode based on interruption frequency
        const recentInterruptions = this.interruptionHistory.length

        if (recentInterruptions >= this.veryImpatientThreshold) {
            this.mode = VerbosityMode.MINIMAL
            console.log('[Verbosity] Switched to MINIMAL mode (very impatient user)')
        } else if (recentInterruptions >= this.impatientThreshold) {
            this.mode = VerbosityMode.CONCISE
            console.log('[Verbosity] Switched to CONCISE mode (impatient user)')
        }
    }

    /**
     * Records a successful interaction (no interruption)
     * Gradually returns to normal mode
     */
    recordSuccessfulInteraction(): void {
        // Decay interruption history
        if (this.interruptionHistory.length > 0) {
            this.interruptionHistory.shift() // Remove oldest interruption
        }

        // Return to normal mode if interruptions have decreased
        const recentInterruptions = this.interruptionHistory.length

        if (recentInterruptions < this.impatientThreshold && this.mode !== VerbosityMode.NORMAL) {
            this.mode = VerbosityMode.NORMAL
            console.log('[Verbosity] Returned to NORMAL mode')
        } else if (recentInterruptions < this.veryImpatientThreshold && this.mode === VerbosityMode.MINIMAL) {
            this.mode = VerbosityMode.CONCISE
            console.log('[Verbosity] Returned to CONCISE mode')
        }
    }

    /**
     * Gets current verbosity configuration
     * 
     * @returns Current verbosity config
     */
    getConfig(): VerbosityConfig {
        switch (this.mode) {
            case VerbosityMode.MINIMAL:
                return {
                    mode: VerbosityMode.MINIMAL,
                    systemPromptAdjustment: 'Reply in at most 3 words. Be extremely brief.',
                    maxResponseLength: 15
                }

            case VerbosityMode.CONCISE:
                return {
                    mode: VerbosityMode.CONCISE,
                    systemPromptAdjustment: 'Reply in at most 5 words. Be concise and direct.',
                    maxResponseLength: 30
                }

            case VerbosityMode.NORMAL:
            default:
                return {
                    mode: VerbosityMode.NORMAL,
                    systemPromptAdjustment: 'Reply in at most 7 witty words in casual conversation.',
                    maxResponseLength: 50
                }
        }
    }

    /**
     * Gets current mode
     * 
     * @returns Current verbosity mode
     */
    getMode(): VerbosityMode {
        return this.mode
    }

    /**
     * Manually sets verbosity mode
     * 
     * @param mode - Desired verbosity mode
     */
    setMode(mode: VerbosityMode): void {
        this.mode = mode
        console.log(`[Verbosity] Manually set to ${mode} mode`)
    }

    /**
     * Resets controller to default state
     */
    reset(): void {
        this.mode = VerbosityMode.NORMAL
        this.interruptionHistory = []
        console.log('[Verbosity] Reset to NORMAL mode')
    }

    /**
     * Gets interruption statistics
     * 
     * @returns Interruption stats
     */
    getStats(): {
        mode: VerbosityMode
        recentInterruptions: number
        interruptionRate: number
    } {
        return {
            mode: this.mode,
            recentInterruptions: this.interruptionHistory.length,
            interruptionRate: this.interruptionHistory.length / (this.interruptionWindow / 1000)
        }
    }
}
