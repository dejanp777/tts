/**
 * Conversation Memory System (RECALL)
 * 
 * Extracts and stores important information from conversations
 * for later recall and personalization.
 * 
 * Stores:
 * - User's name
 * - Personal preferences
 * - Important facts mentioned
 * - Context from previous conversations
 */

export interface MemoryItem {
    type: 'name' | 'preference' | 'fact' | 'context'
    content: string
    timestamp: number
    confidence: number
    source: string // Which message it came from
}

export interface ConversationMemory {
    userName?: string
    preferences: MemoryItem[]
    facts: MemoryItem[]
    contexts: MemoryItem[]
    lastUpdated: number
}

export class MemoryManager {
    private storageKey = 'voice-ai-conversation-memory'
    private memory: ConversationMemory

    constructor() {
        this.memory = this.loadMemory()
    }

    /**
     * Extracts important information from a message
     * 
     * @param message - User message
     * @param messageId - Message ID for tracking
     */
    extractMemories(message: string, messageId: string): MemoryItem[] {
        const extracted: MemoryItem[] = []
        const text = message.toLowerCase()

        // Extract name
        const nameMatch = text.match(/(?:my name is|i'm|i am|call me)\s+([a-z]+)/i)
        if (nameMatch) {
            this.memory.userName = nameMatch[1]
            extracted.push({
                type: 'name',
                content: nameMatch[1],
                timestamp: Date.now(),
                confidence: 0.9,
                source: messageId
            })
        }

        // Extract preferences
        const preferencePatterns = [
            /i (?:like|love|prefer|enjoy)\s+([^.!?]+)/i,
            /i (?:don't like|hate|dislike)\s+([^.!?]+)/i
        ]

        for (const pattern of preferencePatterns) {
            const match = text.match(pattern)
            if (match) {
                extracted.push({
                    type: 'preference',
                    content: match[0],
                    timestamp: Date.now(),
                    confidence: 0.8,
                    source: messageId
                })
            }
        }

        // Extract facts
        const factPatterns = [
            /i (?:work|live|study)\s+(?:at|in)\s+([^.!?]+)/i,
            /i have\s+(?:a|an)?\s*([^.!?]+)/i,
            /my\s+([a-z]+)\s+is\s+([^.!?]+)/i
        ]

        for (const pattern of factPatterns) {
            const match = text.match(pattern)
            if (match) {
                extracted.push({
                    type: 'fact',
                    content: match[0],
                    timestamp: Date.now(),
                    confidence: 0.7,
                    source: messageId
                })
            }
        }

        // Store extracted memories
        for (const item of extracted) {
            this.addMemory(item)
        }

        if (extracted.length > 0) {
            console.log('[Memory] Extracted:', extracted.length, 'items')
        }

        return extracted
    }

    /**
     * Recalls relevant memories for context
     * 
     * @param query - Current query or context
     * @returns Relevant memories
     */
    recall(query?: string): MemoryItem[] {
        const allMemories = [
            ...this.memory.preferences,
            ...this.memory.facts,
            ...this.memory.contexts
        ]

        if (!query) {
            // Return recent memories
            return allMemories
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 5)
        }

        // Simple relevance matching
        const queryLower = query.toLowerCase()
        return allMemories
            .filter(m => m.content.toLowerCase().includes(queryLower))
            .sort((a, b) => b.confidence - a.confidence)
    }

    /**
     * Gets user's name if known
     * 
     * @returns User's name or null
     */
    getUserName(): string | null {
        return this.memory.userName || null
    }

    /**
     * Formats memory for system prompt injection
     * 
     * @returns Memory context string
     */
    formatForPrompt(): string {
        const parts: string[] = []

        if (this.memory.userName) {
            parts.push(`User's name: ${this.memory.userName}`)
        }

        if (this.memory.preferences.length > 0) {
            const recentPrefs = this.memory.preferences
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 3)
                .map(p => p.content)
            parts.push(`Preferences: ${recentPrefs.join('; ')}`)
        }

        if (this.memory.facts.length > 0) {
            const recentFacts = this.memory.facts
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 3)
                .map(f => f.content)
            parts.push(`Facts: ${recentFacts.join('; ')}`)
        }

        return parts.length > 0 ? `\n\nRemembered context: ${parts.join('. ')}` : ''
    }

    /**
     * Clears all memories
     */
    clear(): void {
        this.memory = {
            preferences: [],
            facts: [],
            contexts: [],
            lastUpdated: Date.now()
        }
        this.saveMemory()
        console.log('[Memory] Cleared all memories')
    }

    /**
     * Gets memory statistics
     * 
     * @returns Memory stats
     */
    getStats(): {
        userName: string | null
        totalMemories: number
        preferences: number
        facts: number
        contexts: number
    } {
        return {
            userName: this.memory.userName || null,
            totalMemories: this.memory.preferences.length + this.memory.facts.length + this.memory.contexts.length,
            preferences: this.memory.preferences.length,
            facts: this.memory.facts.length,
            contexts: this.memory.contexts.length
        }
    }

    // Private methods

    private addMemory(item: MemoryItem): void {
        switch (item.type) {
            case 'preference':
                this.memory.preferences.push(item)
                break
            case 'fact':
                this.memory.facts.push(item)
                break
            case 'context':
                this.memory.contexts.push(item)
                break
        }

        this.memory.lastUpdated = Date.now()
        this.saveMemory()
    }

    private loadMemory(): ConversationMemory {
        try {
            const stored = localStorage.getItem(this.storageKey)
            if (stored) {
                return JSON.parse(stored)
            }
        } catch (error) {
            console.error('[Memory] Error loading:', error)
        }

        return {
            preferences: [],
            facts: [],
            contexts: [],
            lastUpdated: Date.now()
        }
    }

    private saveMemory(): void {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.memory))
        } catch (error) {
            console.error('[Memory] Error saving:', error)
        }
    }
}
