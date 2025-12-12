/**
 * Interruption Classification System
 * 
 * Classifies user interruptions into different types to enable
 * appropriate AI responses.
 * 
 * Types:
 * - PAUSE: User wants AI to pause ("wait", "hold on")
 * - TOPIC_SHIFT: User changes subject ("actually", "what about")
 * - CORRECTION: User corrects AI ("no", "I said", "I meant")
 * - IMPATIENCE: Repeated interruptions indicating frustration
 * - BARGE_IN: User speaks during AI playback (basic interruption)
 */

export type InterruptionType = 'PAUSE' | 'TOPIC_SHIFT' | 'CORRECTION' | 'IMPATIENCE' | 'BARGE_IN' | 'NONE'

export const InterruptionType = {
    PAUSE: 'PAUSE' as const,
    TOPIC_SHIFT: 'TOPIC_SHIFT' as const,
    CORRECTION: 'CORRECTION' as const,
    IMPATIENCE: 'IMPATIENCE' as const,
    BARGE_IN: 'BARGE_IN' as const,
    NONE: 'NONE' as const
}

export interface InterruptionContext {
    transcript: string
    previousTranscript?: string
    timeSinceLastInterruption?: number
    interruptionCount?: number
    isAISpeaking?: boolean
}

export interface InterruptionResult {
    type: InterruptionType
    confidence: number
    reason: string
    suggestedAction?: string
}

/**
 * Classifies user interruptions based on transcript and context
 * 
 * @param context - Interruption context
 * @returns Classification result
 */
export function classifyInterruption(context: InterruptionContext): InterruptionResult {
    const { transcript, timeSinceLastInterruption, interruptionCount, isAISpeaking } = context
    // previousTranscript available for future use in more sophisticated classification

    const text = transcript.toLowerCase().trim()

    // Check for PAUSE indicators
    const pausePatterns = [
        /^(wait|hold on|hold up|stop|pause|hang on)/i,
        /^(one second|one moment|just a sec|just a moment)/i
    ]

    for (const pattern of pausePatterns) {
        if (pattern.test(text)) {
            return {
                type: InterruptionType.PAUSE,
                confidence: 0.95,
                reason: 'User requested pause',
                suggestedAction: 'Pause TTS, maintain conversation state, wait for "continue" or similar'
            }
        }
    }

    // Check for TOPIC_SHIFT indicators
    const topicShiftPatterns = [
        /^(actually|wait|hold on),?\s+(what about|how about|instead|let's talk about)/i,
        /^(never mind|forget that|change of plans)/i,
        /^(by the way|also|oh|speaking of)/i
    ]

    for (const pattern of topicShiftPatterns) {
        if (pattern.test(text)) {
            return {
                type: InterruptionType.TOPIC_SHIFT,
                confidence: 0.9,
                reason: 'User shifted conversation topic',
                suggestedAction: 'Acknowledge shift, address new topic'
            }
        }
    }

    // Check for CORRECTION indicators
    const correctionPatterns = [
        /^(no|nope|not|incorrect|wrong)/i,
        /^(i said|i meant|i mean|what i meant was)/i,
        /^(listen|hear me|let me clarify)/i,
        /^(that's not|that isn't|you misunderstood)/i
    ]

    for (const pattern of correctionPatterns) {
        if (pattern.test(text)) {
            return {
                type: InterruptionType.CORRECTION,
                confidence: 0.92,
                reason: 'User is correcting previous statement',
                suggestedAction: 'Stop TTS, apologize, confirm correction'
            }
        }
    }

    // Check for IMPATIENCE (repeated interruptions)
    if (interruptionCount !== undefined && interruptionCount >= 3) {
        if (timeSinceLastInterruption !== undefined && timeSinceLastInterruption < 10000) {
            return {
                type: InterruptionType.IMPATIENCE,
                confidence: 0.85,
                reason: `${interruptionCount} interruptions in short time`,
                suggestedAction: 'Switch to concise mode, reduce verbosity'
            }
        }
    }

    // Check for basic BARGE_IN (user speaking during AI playback)
    if (isAISpeaking) {
        return {
            type: InterruptionType.BARGE_IN,
            confidence: 0.7,
            reason: 'User spoke during AI playback',
            suggestedAction: 'Stop TTS, process user input'
        }
    }

    // No clear interruption pattern detected
    return {
        type: InterruptionType.NONE,
        confidence: 1.0,
        reason: 'No interruption detected',
        suggestedAction: 'Process normally'
    }
}

/**
 * Detects if user wants to resume after a pause
 * 
 * @param transcript - User transcript
 * @returns Whether user wants to resume
 */
export function detectResumeIntent(transcript: string): boolean {
    const text = transcript.toLowerCase().trim()

    const resumePatterns = [
        /^(continue|go on|go ahead|keep going|proceed)/i,
        /^(okay|ok|alright|sure),?\s+(continue|go on|go ahead)/i,
        /^(i'm ready|ready now)/i
    ]

    for (const pattern of resumePatterns) {
        if (pattern.test(text)) {
            return true
        }
    }

    return false
}
