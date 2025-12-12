/**
 * Error Recovery System
 * 
 * Handles various error scenarios in voice interactions with
 * progressive reprompting and escalation strategies.
 * 
 * Error Types:
 * - NO_MATCH: Empty or unintelligible transcription
 * - CONTEXT_FAILURE: AI couldn't understand context
 * - ACCENT_ERROR: Non-native speech patterns
 * - NOISE_ERROR: High ambient noise detected
 * - FALSE_START: User started speaking but stopped quickly
 */

export type ErrorType = 'NO_MATCH' | 'CONTEXT_FAILURE' | 'ACCENT_ERROR' | 'NOISE_ERROR' | 'FALSE_START' | 'NONE'

export const ErrorType = {
    NO_MATCH: 'NO_MATCH' as const,
    CONTEXT_FAILURE: 'CONTEXT_FAILURE' as const,
    ACCENT_ERROR: 'ACCENT_ERROR' as const,
    NOISE_ERROR: 'NOISE_ERROR' as const,
    FALSE_START: 'FALSE_START' as const,
    NONE: 'NONE' as const
}

export interface ErrorContext {
    transcript?: string
    noiseLevel?: number
    duration?: number
    consecutiveErrors?: number
    errorHistory?: ErrorType[]
}

export interface ErrorRecoveryAction {
    errorType: ErrorType
    message: string
    shouldReprompt: boolean
    offerTyping: boolean
    adjustSettings?: {
        increaseThreshold?: boolean
        suggestQuietLocation?: boolean
    }
}

export class ErrorRecovery {
    private errorHistory: Array<{ type: ErrorType; timestamp: number }> = []
    private consecutiveErrors = 0
    private readonly maxRetries = 3
    private readonly errorWindow = 30000 // 30 seconds

    /**
     * Classifies error type based on context
     * 
     * @param context - Error context
     * @returns Classified error type
     */
    classifyError(context: ErrorContext): ErrorType {
        const { transcript, noiseLevel, duration, consecutiveErrors } = context

        // NO_MATCH: Empty or very short transcript
        if (!transcript || transcript.trim().length === 0) {
            return ErrorType.NO_MATCH
        }

        // FALSE_START: Very short duration (< 500ms)
        if (duration !== undefined && duration < 500) {
            return ErrorType.FALSE_START
        }

        // NOISE_ERROR: High noise level
        if (noiseLevel !== undefined && noiseLevel > 0.6) {
            return ErrorType.NOISE_ERROR
        }

        // ACCENT_ERROR: Repeated errors with valid audio
        if (consecutiveErrors !== undefined && consecutiveErrors >= 2 && transcript.length > 0) {
            // Check if transcript has unusual patterns (heuristic)
            const hasUnusualPatterns = this.detectUnusualPatterns(transcript)
            if (hasUnusualPatterns) {
                return ErrorType.ACCENT_ERROR
            }
        }

        return ErrorType.NONE
    }

    /**
     * Gets recovery action for error
     * 
     * @param errorType - Type of error
     * @param attemptNumber - Current attempt number (1-based)
     * @returns Recovery action
     */
    getRecoveryAction(errorType: ErrorType, attemptNumber: number = 1): ErrorRecoveryAction {
        // Track error
        this.errorHistory.push({ type: errorType, timestamp: Date.now() })
        this.consecutiveErrors++

        // Clean old errors from history
        this.cleanErrorHistory()

        // Offer typing after max retries
        if (this.consecutiveErrors >= this.maxRetries) {
            return {
                errorType,
                message: "I'm having trouble understanding. Would you like to type instead?",
                shouldReprompt: false,
                offerTyping: true
            }
        }

        // Progressive reprompting based on error type
        switch (errorType) {
            case ErrorType.NO_MATCH:
                return this.getNoMatchAction(attemptNumber)

            case ErrorType.NOISE_ERROR:
                return this.getNoiseErrorAction(attemptNumber)

            case ErrorType.ACCENT_ERROR:
                return this.getAccentErrorAction(attemptNumber)

            case ErrorType.FALSE_START:
                return this.getFalseStartAction(attemptNumber)

            case ErrorType.CONTEXT_FAILURE:
                return this.getContextFailureAction(attemptNumber)

            default:
                return {
                    errorType: ErrorType.NONE,
                    message: '',
                    shouldReprompt: false,
                    offerTyping: false
                }
        }
    }

    /**
     * Resets error state after successful interaction
     */
    resetErrors(): void {
        this.consecutiveErrors = 0
        console.log('[Error Recovery] Reset - successful interaction')
    }

    /**
     * Gets error statistics
     * 
     * @returns Error stats
     */
    getStats(): {
        consecutiveErrors: number
        recentErrors: number
        errorRate: number
    } {
        const recentErrors = this.errorHistory.length
        const timeWindow = Date.now() - this.errorWindow
        const errorsInWindow = this.errorHistory.filter(e => e.timestamp > timeWindow).length
        const errorRate = errorsInWindow / (this.errorWindow / 1000) // errors per second

        return {
            consecutiveErrors: this.consecutiveErrors,
            recentErrors,
            errorRate
        }
    }

    // Private helper methods

    private getNoMatchAction(attemptNumber: number): ErrorRecoveryAction {
        const messages = [
            "I didn't catch that. Could you try again?",
            "Sorry, I missed that. Please repeat?",
            "One more time?"
        ]

        return {
            errorType: ErrorType.NO_MATCH,
            message: messages[Math.min(attemptNumber - 1, messages.length - 1)],
            shouldReprompt: true,
            offerTyping: false
        }
    }

    private getNoiseErrorAction(attemptNumber: number): ErrorRecoveryAction {
        const messages = [
            "It's a bit noisy. Could you move somewhere quieter?",
            "Still having trouble hearing you. Try a quieter spot?",
            "The background noise is too high."
        ]

        return {
            errorType: ErrorType.NOISE_ERROR,
            message: messages[Math.min(attemptNumber - 1, messages.length - 1)],
            shouldReprompt: true,
            offerTyping: false,
            adjustSettings: {
                suggestQuietLocation: true
            }
        }
    }

    private getAccentErrorAction(attemptNumber: number): ErrorRecoveryAction {
        const messages = [
            "I'm having trouble understanding. Could you speak a bit slower?",
            "Please speak clearly and slowly.",
            "Try speaking more slowly?"
        ]

        return {
            errorType: ErrorType.ACCENT_ERROR,
            message: messages[Math.min(attemptNumber - 1, messages.length - 1)],
            shouldReprompt: true,
            offerTyping: false,
            adjustSettings: {
                increaseThreshold: true
            }
        }
    }

    private getFalseStartAction(_attemptNumber: number): ErrorRecoveryAction {
        return {
            errorType: ErrorType.FALSE_START,
            message: "Take your time. I'm listening.",
            shouldReprompt: false,
            offerTyping: false
        }
    }

    private getContextFailureAction(attemptNumber: number): ErrorRecoveryAction {
        const messages = [
            "I didn't quite understand. Could you rephrase?",
            "Can you say that differently?",
            "I'm confused. Try rephrasing?"
        ]

        return {
            errorType: ErrorType.CONTEXT_FAILURE,
            message: messages[Math.min(attemptNumber - 1, messages.length - 1)],
            shouldReprompt: true,
            offerTyping: false
        }
    }

    private detectUnusualPatterns(transcript: string): boolean {
        // Heuristic: Check for very short words or fragmented speech
        const words = transcript.split(/\s+/)
        const shortWords = words.filter(w => w.length <= 2).length
        const shortWordRatio = shortWords / words.length

        // If more than 50% of words are very short, might indicate accent/recognition issues
        return shortWordRatio > 0.5
    }

    private cleanErrorHistory(): void {
        const cutoff = Date.now() - this.errorWindow
        this.errorHistory = this.errorHistory.filter(e => e.timestamp > cutoff)
    }
}
