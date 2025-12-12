/**
 * Undo System
 * 
 * Allows users to rollback recent actions and restore
 * previous conversation states.
 * 
 * Features:
 * - Undo last message
 * - Undo last N messages
 * - Restore conversation state
 * - Clear undo history
 */

export interface ConversationState {
    messages: any[]
    timestamp: number
    stateId: string
}

export class UndoManager {
    private history: ConversationState[] = []
    private readonly maxHistory = 10
    private currentStateId = 0

    /**
     * Saves current conversation state
     * 
     * @param messages - Current messages
     */
    saveState(messages: any[]): void {
        const state: ConversationState = {
            messages: JSON.parse(JSON.stringify(messages)), // Deep copy
            timestamp: Date.now(),
            stateId: `state_${this.currentStateId++}`
        }

        this.history.push(state)

        // Keep only last N states
        if (this.history.length > this.maxHistory) {
            this.history.shift()
        }

        console.log('[Undo] State saved:', state.stateId, `(${messages.length} messages)`)
    }

    /**
     * Undoes last action (removes last message pair)
     * 
     * @returns Previous state or null if no history
     */
    undo(): ConversationState | null {
        if (this.history.length < 2) {
            console.log('[Undo] No history to undo')
            return null
        }

        // Remove current state
        this.history.pop()

        // Get previous state
        const previousState = this.history[this.history.length - 1]

        console.log('[Undo] Restored state:', previousState.stateId)
        return previousState
    }

    /**
     * Undoes multiple steps
     * 
     * @param steps - Number of steps to undo
     * @returns Previous state or null
     */
    undoMultiple(steps: number): ConversationState | null {
        if (steps < 1 || steps >= this.history.length) {
            console.log('[Undo] Invalid steps:', steps)
            return null
        }

        // Remove N states
        for (let i = 0; i < steps; i++) {
            this.history.pop()
        }

        const previousState = this.history[this.history.length - 1]
        console.log('[Undo] Restored state:', previousState.stateId, `(${steps} steps back)`)
        return previousState
    }

    /**
     * Checks if undo is available
     * 
     * @returns Whether undo is possible
     */
    canUndo(): boolean {
        return this.history.length >= 2
    }

    /**
     * Gets number of available undo steps
     * 
     * @returns Number of undo steps
     */
    getUndoSteps(): number {
        return Math.max(0, this.history.length - 1)
    }

    /**
     * Clears undo history
     */
    clear(): void {
        this.history = []
        this.currentStateId = 0
        console.log('[Undo] History cleared')
    }

    /**
     * Gets undo statistics
     * 
     * @returns Undo stats
     */
    getStats(): {
        historyLength: number
        canUndo: boolean
        availableSteps: number
        oldestState: number | null
    } {
        return {
            historyLength: this.history.length,
            canUndo: this.canUndo(),
            availableSteps: this.getUndoSteps(),
            oldestState: this.history.length > 0 ? this.history[0].timestamp : null
        }
    }
}
