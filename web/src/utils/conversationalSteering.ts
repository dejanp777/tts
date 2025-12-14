/**
 * Conversational Steering System (PULL Principle)
 *
 * Uses cues to steer conversation intentionally through:
 * 1. Offering choices to guide user decisions
 * 2. Setting expectations about timing and process
 * 3. Guiding next steps in the conversation flow
 */

export interface ConversationalCue {
    type: 'choice' | 'expectation' | 'guidance' | 'clarification'
    message: string
    options?: string[]
    priority: 'high' | 'medium' | 'low'
    context: string
}

export interface ConversationState {
    topic: string | null
    lastUserIntent: string | null
    pendingActions: string[]
    openQuestions: string[]
    turnCount: number
}

export class ConversationalSteering {
    private state: ConversationState
    private readonly maxPendingActions = 3
    private lastCueTime: number = 0
    private readonly minCueInterval = 5000 // 5 seconds between cues

    constructor() {
        this.state = {
            topic: null,
            lastUserIntent: null,
            pendingActions: [],
            openQuestions: [],
            turnCount: 0
        }
    }

    /**
     * Analyzes assistant response and generates steering cues
     *
     * @param assistantResponse - The AI's response text
     * @param userMessage - The user's original message
     * @returns Steering cue if appropriate
     */
    generateCue(assistantResponse: string, userMessage: string): ConversationalCue | null {
        // Rate limit cues
        const now = Date.now()
        if (now - this.lastCueTime < this.minCueInterval) {
            return null
        }

        this.state.turnCount++
        const lowerUser = userMessage.toLowerCase()
        const lowerResponse = assistantResponse.toLowerCase()

        // Detect ambiguity requiring clarification
        const clarificationCue = this.detectAmbiguity(lowerUser)
        if (clarificationCue) {
            this.lastCueTime = now
            return clarificationCue
        }

        // Detect multi-step processes requiring expectations
        const expectationCue = this.detectMultiStep(lowerResponse)
        if (expectationCue) {
            this.lastCueTime = now
            return expectationCue
        }

        // Detect decision points requiring choices
        const choiceCue = this.detectDecisionPoint(lowerUser, lowerResponse)
        if (choiceCue) {
            this.lastCueTime = now
            return choiceCue
        }

        // Generate guidance for next steps
        const guidanceCue = this.generateGuidance(lowerUser, lowerResponse)
        if (guidanceCue && this.state.turnCount % 3 === 0) {
            this.lastCueTime = now
            return guidanceCue
        }

        return null
    }

    /**
     * Detects ambiguous user input requiring clarification
     */
    private detectAmbiguity(userMessage: string): ConversationalCue | null {
        // Vague pronouns without clear referent
        const vaguePronouns = /\b(it|this|that|those|these|they)\b/i
        const specificContext = /\b(the |my |your |our |their )\w+/i

        if (vaguePronouns.test(userMessage) && !specificContext.test(userMessage)) {
            // Check if message is very short (likely ambiguous)
            if (userMessage.split(' ').length < 4) {
                return {
                    type: 'clarification',
                    message: "Could you be more specific about what you're referring to?",
                    priority: 'medium',
                    context: 'vague_reference'
                }
            }
        }

        // Multiple possible interpretations
        if (userMessage.includes(' or ') && !userMessage.includes('?')) {
            return {
                type: 'choice',
                message: "Which would you prefer?",
                options: this.extractOrOptions(userMessage),
                priority: 'high',
                context: 'implicit_choice'
            }
        }

        return null
    }

    /**
     * Detects multi-step processes and sets expectations
     */
    private detectMultiStep(response: string): ConversationalCue | null {
        const multiStepIndicators = [
            'first', 'then', 'next', 'after that', 'finally',
            'step 1', 'step 2', 'steps', 'process'
        ]

        const hasMultiStep = multiStepIndicators.some(indicator =>
            response.includes(indicator)
        )

        if (hasMultiStep) {
            // Count steps in response
            const stepCount = (response.match(/\b(first|second|third|then|next|finally|step \d)/gi) || []).length

            if (stepCount >= 2) {
                return {
                    type: 'expectation',
                    message: `This involves ${stepCount} steps. Ready to proceed?`,
                    priority: 'medium',
                    context: 'multi_step_process'
                }
            }
        }

        // Detect time-consuming operations
        const timeIndicators = ['minutes', 'moment', 'while', 'processing', 'loading']
        if (timeIndicators.some(t => response.includes(t))) {
            return {
                type: 'expectation',
                message: "This might take a moment. I'll let you know when it's done.",
                priority: 'low',
                context: 'time_expectation'
            }
        }

        return null
    }

    /**
     * Detects decision points where user needs to make a choice
     */
    private detectDecisionPoint(userMessage: string, response: string): ConversationalCue | null {
        // User expressing uncertainty
        const uncertaintyPatterns = [
            /not sure (about|what|which|if)/i,
            /don't know (what|which|if|how)/i,
            /maybe|perhaps|possibly/i,
            /should i|could i|would you/i
        ]

        const isUncertain = uncertaintyPatterns.some(pattern => pattern.test(userMessage))

        if (isUncertain) {
            // Generate helpful choices based on context
            const choices = this.generateContextualChoices(userMessage)
            if (choices.length > 0) {
                return {
                    type: 'choice',
                    message: "Let me offer some options:",
                    options: choices,
                    priority: 'high',
                    context: 'user_uncertainty'
                }
            }
        }

        // Response contains multiple options
        if (response.includes(' or ') && response.includes('?')) {
            return {
                type: 'choice',
                message: "Which option would you prefer?",
                priority: 'medium',
                context: 'response_options'
            }
        }

        return null
    }

    /**
     * Generates guidance for next steps
     */
    private generateGuidance(userMessage: string, response: string): ConversationalCue | null {
        // Detect completed actions that need follow-up
        const completionIndicators = ['done', 'complete', 'finished', 'set', 'ready']
        const hasCompletion = completionIndicators.some(i => response.includes(i))

        if (hasCompletion) {
            return {
                type: 'guidance',
                message: "Is there anything else you'd like me to help with?",
                priority: 'low',
                context: 'task_completion'
            }
        }

        // Detect questions that might need elaboration
        if (userMessage.includes('how') || userMessage.includes('why')) {
            return {
                type: 'guidance',
                message: "Would you like me to go into more detail?",
                priority: 'low',
                context: 'explanation_offered'
            }
        }

        // Detect errors or problems mentioned
        const problemIndicators = ['error', 'problem', 'issue', 'wrong', 'broken', 'failed']
        if (problemIndicators.some(p => userMessage.includes(p))) {
            return {
                type: 'guidance',
                message: "Want me to help troubleshoot this?",
                priority: 'medium',
                context: 'problem_detected'
            }
        }

        return null
    }

    /**
     * Extracts options from "X or Y" patterns
     */
    private extractOrOptions(text: string): string[] {
        const orMatch = text.match(/(.+?)\s+or\s+(.+)/i)
        if (orMatch) {
            return [orMatch[1].trim(), orMatch[2].trim()]
        }
        return []
    }

    /**
     * Generates contextual choices based on user message
     */
    private generateContextualChoices(message: string): string[] {
        const choices: string[] = []

        // Time-related uncertainty
        if (message.includes('when') || message.includes('time')) {
            choices.push('Now', 'Later', 'Set a reminder')
        }

        // Method uncertainty
        if (message.includes('how')) {
            choices.push('Step-by-step guide', 'Quick summary', 'Show me an example')
        }

        // Selection uncertainty
        if (message.includes('which') || message.includes('what')) {
            choices.push('See options', 'Get recommendation', 'Compare choices')
        }

        return choices
    }

    /**
     * Updates conversation state with new topic
     */
    updateTopic(topic: string): void {
        this.state.topic = topic
        console.log('[Steering] Topic updated:', topic)
    }

    /**
     * Adds a pending action to track
     */
    addPendingAction(action: string): void {
        if (this.state.pendingActions.length < this.maxPendingActions) {
            this.state.pendingActions.push(action)
        }
    }

    /**
     * Completes a pending action
     */
    completePendingAction(action: string): void {
        this.state.pendingActions = this.state.pendingActions.filter(a => a !== action)
    }

    /**
     * Formats a cue for display/speech
     */
    formatCueForSpeech(cue: ConversationalCue): string {
        let formatted = cue.message

        if (cue.options && cue.options.length > 0) {
            const optionList = cue.options.slice(0, 3).join(', or ')
            formatted += ` ${optionList}?`
        }

        return formatted
    }

    /**
     * Gets the current conversation state
     */
    getState(): ConversationState {
        return { ...this.state }
    }

    /**
     * Resets the steering system
     */
    reset(): void {
        this.state = {
            topic: null,
            lastUserIntent: null,
            pendingActions: [],
            openQuestions: [],
            turnCount: 0
        }
        this.lastCueTime = 0
        console.log('[Steering] Reset')
    }
}
