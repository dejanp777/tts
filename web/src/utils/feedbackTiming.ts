/**
 * Feedback Timing Logic
 * 
 * Determines when to ask for user feedback to avoid being annoying.
 * 
 * Rules:
 * - Don't ask after every response
 * - Ask more frequently early in conversation
 * - Max once per 5 turns
 * - Track feedback history in localStorage
 */

export interface FeedbackHistory {
    lastAskedTurn: number
    totalFeedbackGiven: number
    feedbackTurns: number[]
}

export class FeedbackTiming {
    private storageKey = 'voice-ai-feedback-history'
    private minTurnsBetweenFeedback = 5
    private earlyConversationThreshold = 10 // First 10 turns

    /**
     * Determines if we should ask for feedback
     * 
     * @param currentTurn - Current turn number (1-based)
     * @returns Whether to show feedback button
     */
    shouldAskFeedback(currentTurn: number): boolean {
        const history = this.getHistory()

        // Don't ask on first turn
        if (currentTurn <= 1) {
            return false
        }

        // Early conversation: ask more frequently (every 3 turns)
        if (currentTurn <= this.earlyConversationThreshold) {
            const turnsSinceLastAsk = currentTurn - history.lastAskedTurn
            if (turnsSinceLastAsk >= 3) {
                return true
            }
        }

        // Later conversation: ask less frequently (every 5 turns)
        const turnsSinceLastAsk = currentTurn - history.lastAskedTurn
        if (turnsSinceLastAsk >= this.minTurnsBetweenFeedback) {
            return true
        }

        return false
    }

    /**
     * Records that feedback was asked
     * 
     * @param turnNumber - Turn number when feedback was asked
     */
    recordFeedbackAsked(turnNumber: number): void {
        const history = this.getHistory()
        history.lastAskedTurn = turnNumber
        this.saveHistory(history)
    }

    /**
     * Records that feedback was given
     * 
     * @param turnNumber - Turn number when feedback was given
     */
    recordFeedbackGiven(turnNumber: number): void {
        const history = this.getHistory()
        history.totalFeedbackGiven++
        history.feedbackTurns.push(turnNumber)
        this.saveHistory(history)
        console.log('[Feedback Timing] Feedback given, total:', history.totalFeedbackGiven)
    }

    /**
     * Gets feedback history
     * 
     * @returns Feedback history
     */
    getHistory(): FeedbackHistory {
        try {
            const stored = localStorage.getItem(this.storageKey)
            if (stored) {
                return JSON.parse(stored)
            }
        } catch (error) {
            console.error('[Feedback Timing] Error loading history:', error)
        }

        return {
            lastAskedTurn: 0,
            totalFeedbackGiven: 0,
            feedbackTurns: []
        }
    }

    /**
     * Resets feedback history
     */
    reset(): void {
        localStorage.removeItem(this.storageKey)
        console.log('[Feedback Timing] History reset')
    }

    private saveHistory(history: FeedbackHistory): void {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(history))
        } catch (error) {
            console.error('[Feedback Timing] Error saving history:', error)
        }
    }
}
