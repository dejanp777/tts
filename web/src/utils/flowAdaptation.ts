/**
 * Flow Adaptation System (ADAPT Principle)
 *
 * Flows organically, not mechanistically through:
 * 1. Following user's lead
 * 2. Adjusting to communication style
 * 3. Handling tangents gracefully
 */

export interface CommunicationStyle {
    verbosity: 'brief' | 'moderate' | 'verbose'
    formality: 'casual' | 'neutral' | 'formal'
    pace: 'fast' | 'moderate' | 'slow'
    emotionality: 'reserved' | 'neutral' | 'expressive'
}

export interface TopicShift {
    fromTopic: string | null
    toTopic: string
    type: 'tangent' | 'pivot' | 'return' | 'new'
    timestamp: number
}

export interface FlowContext {
    currentTopic: string | null
    topicStack: string[]
    userStyle: CommunicationStyle
    recentShifts: TopicShift[]
    interactionCount: number
}

export class FlowAdaptation {
    private context: FlowContext
    private readonly maxTopicStack = 5
    private readonly styleDecayRate = 0.1 // How quickly style influence decays

    constructor() {
        this.context = {
            currentTopic: null,
            topicStack: [],
            userStyle: {
                verbosity: 'moderate',
                formality: 'neutral',
                pace: 'moderate',
                emotionality: 'neutral'
            },
            recentShifts: [],
            interactionCount: 0
        }
    }

    /**
     * Analyzes user message and adapts conversation flow
     *
     * @param userMessage - Current user message
     * @param previousMessages - Recent conversation history
     * @returns Adaptation recommendations
     */
    adapt(userMessage: string, previousMessages: string[] = []): {
        styleAdjustments: Partial<CommunicationStyle>
        topicHandling: 'continue' | 'acknowledge_shift' | 'offer_return' | 'follow_tangent'
        suggestedTone: string
    } {
        this.context.interactionCount++

        // Analyze and update communication style
        const detectedStyle = this.analyzeStyle(userMessage)
        this.updateStyle(detectedStyle)

        // Detect topic shifts
        const topicShift = this.detectTopicShift(userMessage, previousMessages)
        const topicHandling = this.handleTopicShift(topicShift)

        // Generate tone suggestion based on context
        const suggestedTone = this.suggestTone()

        return {
            styleAdjustments: this.getStyleAdjustments(),
            topicHandling,
            suggestedTone
        }
    }

    /**
     * Analyzes message for communication style indicators
     */
    private analyzeStyle(message: string): Partial<CommunicationStyle> {
        const style: Partial<CommunicationStyle> = {}
        const words = message.split(/\s+/)
        const wordCount = words.length

        // Verbosity detection
        if (wordCount < 5) {
            style.verbosity = 'brief'
        } else if (wordCount > 30) {
            style.verbosity = 'verbose'
        } else {
            style.verbosity = 'moderate'
        }

        // Formality detection
        const casualIndicators = /\b(hey|hi|yeah|yep|nope|gonna|wanna|kinda|sorta|lol|haha)\b/i
        const formalIndicators = /\b(please|kindly|would you|could you|I would appreciate|thank you very much)\b/i

        if (casualIndicators.test(message)) {
            style.formality = 'casual'
        } else if (formalIndicators.test(message)) {
            style.formality = 'formal'
        } else {
            style.formality = 'neutral'
        }

        // Pace detection (based on punctuation and structure)
        const quickPatterns = /[!?]{2,}|\.{3,}|^(quick|fast|hurry|asap|urgent)/i
        const slowPatterns = /\b(take your time|whenever|no rush|when you can)\b/i

        if (quickPatterns.test(message)) {
            style.pace = 'fast'
        } else if (slowPatterns.test(message)) {
            style.pace = 'slow'
        } else {
            style.pace = 'moderate'
        }

        // Emotionality detection
        const expressiveIndicators = /[!]{2,}|[A-Z]{3,}|😀|😃|😄|😁|❤️|🎉|💕|\b(love|amazing|awesome|terrible|hate|fantastic)\b/i
        const reservedIndicators = /^[a-z\s.,]+$/ // All lowercase, minimal punctuation

        if (expressiveIndicators.test(message)) {
            style.emotionality = 'expressive'
        } else if (reservedIndicators.test(message) && wordCount < 10) {
            style.emotionality = 'reserved'
        } else {
            style.emotionality = 'neutral'
        }

        return style
    }

    /**
     * Updates running style profile with decay
     */
    private updateStyle(detected: Partial<CommunicationStyle>): void {
        const current = this.context.userStyle

        // Apply detected style with weighted update
        if (detected.verbosity) {
            current.verbosity = this.blendStyle(
                current.verbosity,
                detected.verbosity,
                ['brief', 'moderate', 'verbose']
            ) as 'brief' | 'moderate' | 'verbose'
        }

        if (detected.formality) {
            current.formality = this.blendStyle(
                current.formality,
                detected.formality,
                ['casual', 'neutral', 'formal']
            ) as 'casual' | 'neutral' | 'formal'
        }

        if (detected.pace) {
            current.pace = this.blendStyle(
                current.pace,
                detected.pace,
                ['fast', 'moderate', 'slow']
            ) as 'fast' | 'moderate' | 'slow'
        }

        if (detected.emotionality) {
            current.emotionality = this.blendStyle(
                current.emotionality,
                detected.emotionality,
                ['reserved', 'neutral', 'expressive']
            ) as 'reserved' | 'neutral' | 'expressive'
        }
    }

    /**
     * Blends old and new style values with weighted update
     */
    private blendStyle<T extends string>(
        current: T,
        detected: T,
        spectrum: T[]
    ): T {
        const currentIdx = spectrum.indexOf(current)
        const detectedIdx = spectrum.indexOf(detected)

        // Weighted average toward detected, with decay toward neutral
        const neutralIdx = Math.floor(spectrum.length / 2)
        const weight = 0.3 // How much new detection influences

        let newIdx = currentIdx + (detectedIdx - currentIdx) * weight

        // Slight decay toward neutral
        newIdx += (neutralIdx - newIdx) * this.styleDecayRate

        return spectrum[Math.round(Math.max(0, Math.min(spectrum.length - 1, newIdx)))]
    }

    /**
     * Detects topic shifts in conversation
     */
    private detectTopicShift(
        currentMessage: string,
        _previousMessages: string[]
    ): TopicShift | null {
        const newTopic = this.extractTopic(currentMessage)

        if (!newTopic) return null

        const previousTopic = this.context.currentTopic

        // Check if returning to a stacked topic
        if (this.context.topicStack.includes(newTopic)) {
            return {
                fromTopic: previousTopic,
                toTopic: newTopic,
                type: 'return',
                timestamp: Date.now()
            }
        }

        // Check for tangent indicators
        const tangentIndicators = /\b(by the way|btw|speaking of|oh|actually|random question|side note)\b/i
        const isTangent = tangentIndicators.test(currentMessage)

        // Check for pivot indicators
        const pivotIndicators = /\b(anyway|back to|let's focus on|moving on|forget that)\b/i
        const isPivot = pivotIndicators.test(currentMessage)

        if (previousTopic && newTopic !== previousTopic) {
            let shiftType: TopicShift['type'] = 'new'

            if (isTangent) {
                shiftType = 'tangent'
                // Push current topic to stack for potential return
                if (!this.context.topicStack.includes(previousTopic)) {
                    this.context.topicStack.push(previousTopic)
                    if (this.context.topicStack.length > this.maxTopicStack) {
                        this.context.topicStack.shift()
                    }
                }
            } else if (isPivot) {
                shiftType = 'pivot'
            }

            return {
                fromTopic: previousTopic,
                toTopic: newTopic,
                type: shiftType,
                timestamp: Date.now()
            }
        }

        return null
    }

    /**
     * Extracts main topic from message
     */
    private extractTopic(message: string): string | null {
        // Simple topic extraction based on nouns and key phrases
        const topicPatterns = [
            /\b(about|regarding|concerning|for)\s+(\w+(?:\s+\w+)?)/i,
            /\b(help with|question about|need)\s+(\w+(?:\s+\w+)?)/i,
            /\bwhat is\s+(\w+(?:\s+\w+)?)/i,
            /\bhow to\s+(\w+(?:\s+\w+)?)/i
        ]

        for (const pattern of topicPatterns) {
            const match = message.match(pattern)
            if (match) {
                return match[match.length - 1].toLowerCase()
            }
        }

        // Fallback: use first noun-like word
        const words = message.toLowerCase().split(/\s+/)
        const skipWords = new Set([
            'i', 'you', 'we', 'they', 'it', 'the', 'a', 'an', 'is', 'are', 'was', 'were',
            'can', 'could', 'would', 'should', 'will', 'do', 'does', 'did', 'have', 'has'
        ])

        for (const word of words) {
            const cleanWord = word.replace(/[^a-z]/g, '')
            if (cleanWord.length > 3 && !skipWords.has(cleanWord)) {
                return cleanWord
            }
        }

        return null
    }

    /**
     * Handles detected topic shift
     */
    private handleTopicShift(shift: TopicShift | null): 'continue' | 'acknowledge_shift' | 'offer_return' | 'follow_tangent' {
        if (!shift) {
            return 'continue'
        }

        // Update current topic
        this.context.currentTopic = shift.toTopic

        // Track the shift
        this.context.recentShifts.push(shift)
        if (this.context.recentShifts.length > 5) {
            this.context.recentShifts.shift()
        }

        switch (shift.type) {
            case 'tangent':
                return 'follow_tangent'

            case 'return':
                // Clear the returned-to topic from stack
                this.context.topicStack = this.context.topicStack.filter(t => t !== shift.toTopic)
                return 'acknowledge_shift'

            case 'pivot':
                // Clear topic stack on explicit pivot
                this.context.topicStack = []
                return 'acknowledge_shift'

            case 'new':
                // Check if we should offer to return to previous topic
                if (this.context.topicStack.length > 0) {
                    return 'offer_return'
                }
                return 'continue'

            default:
                return 'continue'
        }
    }

    /**
     * Gets style adjustments to match user
     */
    private getStyleAdjustments(): Partial<CommunicationStyle> {
        return { ...this.context.userStyle }
    }

    /**
     * Suggests appropriate tone based on context
     */
    private suggestTone(): string {
        const style = this.context.userStyle

        // Build tone description
        const tones: string[] = []

        if (style.formality === 'casual') {
            tones.push('friendly')
        } else if (style.formality === 'formal') {
            tones.push('professional')
        }

        if (style.emotionality === 'expressive') {
            tones.push('enthusiastic')
        } else if (style.emotionality === 'reserved') {
            tones.push('calm')
        }

        if (style.pace === 'fast') {
            tones.push('concise')
        } else if (style.pace === 'slow') {
            tones.push('patient')
        }

        if (style.verbosity === 'brief') {
            tones.push('direct')
        } else if (style.verbosity === 'verbose') {
            tones.push('detailed')
        }

        return tones.length > 0 ? tones.join(', ') : 'balanced'
    }

    /**
     * Generates a topic return offer message
     */
    generateReturnOffer(): string | null {
        if (this.context.topicStack.length === 0) {
            return null
        }

        const previousTopic = this.context.topicStack[this.context.topicStack.length - 1]
        return `Would you like to go back to discussing ${previousTopic}?`
    }

    /**
     * Gets current flow context
     */
    getContext(): FlowContext {
        return {
            ...this.context,
            topicStack: [...this.context.topicStack],
            recentShifts: [...this.context.recentShifts]
        }
    }

    /**
     * Resets flow adaptation state
     */
    reset(): void {
        this.context = {
            currentTopic: null,
            topicStack: [],
            userStyle: {
                verbosity: 'moderate',
                formality: 'neutral',
                pace: 'moderate',
                emotionality: 'neutral'
            },
            recentShifts: [],
            interactionCount: 0
        }
        console.log('[FlowAdaptation] Reset')
    }
}
