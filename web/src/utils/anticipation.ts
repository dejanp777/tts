/**
 * Anticipation System
 * 
 * Predicts user needs and provides proactive suggestions
 * based on conversation patterns and context.
 * 
 * Examples:
 * - User asks about weather → Suggest checking forecast
 * - User mentions travel → Suggest packing list
 * - Repeated questions → Suggest creating reminder
 */

export interface Anticipation {
    type: 'suggestion' | 'reminder' | 'clarification'
    message: string
    confidence: number
    trigger: string
}

export class AnticipationEngine {
    private conversationHistory: string[] = []
    private readonly maxHistory = 10

    /**
     * Analyzes conversation and generates anticipations
     * 
     * @param currentMessage - Current user message
     * @param previousMessages - Previous messages in conversation
     * @returns Anticipations if any
     */
    anticipate(currentMessage: string, previousMessages: string[] = []): Anticipation | null {
        // Seed history from prior context (helps after refresh/reload)
        if (this.conversationHistory.length === 0 && previousMessages.length > 0) {
            this.conversationHistory = previousMessages
                .slice(-this.maxHistory)
                .map((m) => m.toLowerCase())
        }

        // Update history
        this.conversationHistory.push(currentMessage.toLowerCase())
        if (this.conversationHistory.length > this.maxHistory) {
            this.conversationHistory.shift()
        }

        const text = currentMessage.toLowerCase()

        // Check for repeated questions
        const repeatedQuestion = this.detectRepeatedQuestion()
        if (repeatedQuestion) {
            return {
                type: 'reminder',
                message: "You've asked about this before. Would you like me to remember this for you?",
                confidence: 0.8,
                trigger: 'repeated_question'
            }
        }

        // Check for incomplete thoughts
        if (this.detectIncompleteThought(text)) {
            return {
                type: 'clarification',
                message: "Did you want to add something else?",
                confidence: 0.6,
                trigger: 'incomplete_thought'
            }
        }

        // Context-based suggestions
        const contextSuggestion = this.getContextSuggestion(text)
        if (contextSuggestion) {
            return contextSuggestion
        }

        return null
    }

    /**
     * Detects if user is asking repeated questions
     * 
     * @returns Whether repeated question detected
     */
    private detectRepeatedQuestion(): boolean {
        if (this.conversationHistory.length < 3) return false

        const recent = this.conversationHistory.slice(-3)
        const questions = recent.filter(msg =>
            msg.includes('?') ||
            msg.startsWith('what') ||
            msg.startsWith('how') ||
            msg.startsWith('when') ||
            msg.startsWith('where') ||
            msg.startsWith('why')
        )

        // If 2+ similar questions in last 3 messages
        return questions.length >= 2
    }

    /**
     * Detects incomplete thoughts (trailing "and", "but", etc.)
     * 
     * @param text - Message text
     * @returns Whether incomplete thought detected
     */
    private detectIncompleteThought(text: string): boolean {
        const incompletePatterns = [
            /\s+and\s*$/,
            /\s+but\s*$/,
            /\s+or\s*$/,
            /\s+so\s*$/
        ]

        return incompletePatterns.some(pattern => pattern.test(text))
    }

    /**
     * Gets context-based suggestions
     * 
     * @param text - Message text
     * @returns Anticipation if relevant
     */
    private getContextSuggestion(text: string): Anticipation | null {
        // Travel context
        if (text.includes('travel') || text.includes('trip') || text.includes('vacation')) {
            return {
                type: 'suggestion',
                message: "Planning a trip? I can help with packing lists or itineraries.",
                confidence: 0.7,
                trigger: 'travel_context'
            }
        }

        // Weather context
        if (text.includes('weather') || text.includes('forecast')) {
            return {
                type: 'suggestion',
                message: "Want me to check the extended forecast?",
                confidence: 0.75,
                trigger: 'weather_context'
            }
        }

        // Time-sensitive context
        if (text.includes('tomorrow') || text.includes('later') || text.includes('remind')) {
            return {
                type: 'reminder',
                message: "Should I set a reminder for this?",
                confidence: 0.8,
                trigger: 'time_sensitive'
            }
        }

        // Learning context
        if (text.includes('how to') || text.includes('learn') || text.includes('teach')) {
            return {
                type: 'suggestion',
                message: "Want me to break this down into steps?",
                confidence: 0.7,
                trigger: 'learning_context'
            }
        }

        return null
    }

    /**
     * Resets conversation history
     */
    reset(): void {
        this.conversationHistory = []
        console.log('[Anticipation] History reset')
    }

    /**
     * Gets anticipation statistics
     * 
     * @returns Stats
     */
    getStats(): {
        historyLength: number
        recentPatterns: string[]
    } {
        return {
            historyLength: this.conversationHistory.length,
            recentPatterns: this.conversationHistory.slice(-3)
        }
    }
}
