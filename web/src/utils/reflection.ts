/**
 * Reflection System (REFLECT)
 * 
 * Detects critical information and asks for confirmation
 * before proceeding with important actions.
 * 
 * Examples:
 * - Financial transactions → "Just to confirm, you want to send $500?"
 * - Deletions → "You want to delete this permanently?"
 * - Irreversible actions → "This can't be undone. Proceed?"
 */

export interface CriticalInfo {
    type: 'financial' | 'deletion' | 'personal' | 'commitment' | 'irreversible'
    detected: string
    confirmationMessage: string
    confidence: number
}

export class ReflectionEngine {
    /**
     * Detects if message contains critical information
     * 
     * @param message - User message
     * @returns Critical info if detected
     */
    detectCriticalInfo(message: string): CriticalInfo | null {
        const text = message.toLowerCase()

        // Financial transactions
        const financialMatch = text.match(/(?:send|transfer|pay|charge)\s+(?:\$|€|£)?(\d+(?:,\d{3})*(?:\.\d{2})?)/i)
        if (financialMatch) {
            return {
                type: 'financial',
                detected: financialMatch[0],
                confirmationMessage: `Just to confirm, you want to ${financialMatch[0]}?`,
                confidence: 0.95
            }
        }

        // Deletion actions
        const deletionPatterns = [
            /delete\s+(?:my|the|all)\s+([a-z\s]+)/i,
            /remove\s+(?:my|the|all)\s+([a-z\s]+)/i,
            /cancel\s+(?:my|the)\s+([a-z\s]+)/i
        ]

        for (const pattern of deletionPatterns) {
            const match = text.match(pattern)
            if (match) {
                return {
                    type: 'deletion',
                    detected: match[0],
                    confirmationMessage: `You want to ${match[0]}? This can't be undone.`,
                    confidence: 0.9
                }
            }
        }

        // Personal information sharing
        const personalPatterns = [
            /(?:my|the)\s+(?:address|phone|email|ssn|credit card)/i,
            /share\s+(?:my|the)\s+([a-z\s]+)/i
        ]

        for (const pattern of personalPatterns) {
            const match = text.match(pattern)
            if (match) {
                return {
                    type: 'personal',
                    detected: match[0],
                    confirmationMessage: `You want to share ${match[0]}? Are you sure?`,
                    confidence: 0.85
                }
            }
        }

        // Commitments
        const commitmentPatterns = [
            /(?:book|reserve|schedule)\s+([a-z\s]+)/i,
            /(?:sign up|register)\s+for\s+([a-z\s]+)/i
        ]

        for (const pattern of commitmentPatterns) {
            const match = text.match(pattern)
            if (match) {
                return {
                    type: 'commitment',
                    detected: match[0],
                    confirmationMessage: `Confirming: you want to ${match[0]}?`,
                    confidence: 0.8
                }
            }
        }

        return null
    }

    /**
     * Formats confirmation message for AI response
     * 
     * @param criticalInfo - Detected critical info
     * @returns Formatted confirmation message
     */
    formatConfirmation(criticalInfo: CriticalInfo): string {
        return `⚠️ ${criticalInfo.confirmationMessage}`
    }

    /**
     * Checks if user confirmed the action
     * 
     * @param response - User's response
     * @returns Whether user confirmed
     */
    isConfirmed(response: string): boolean {
        const text = response.toLowerCase().trim()

        const confirmPatterns = [
            /^yes$/,
            /^yeah$/,
            /^yep$/,
            /^sure$/,
            /^ok$/,
            /^okay$/,
            /^confirm$/,
            /^correct$/,
            /^right$/,
            /^proceed$/
        ]

        return confirmPatterns.some(pattern => pattern.test(text))
    }

    /**
     * Checks if user denied the action
     * 
     * @param response - User's response
     * @returns Whether user denied
     */
    isDenied(response: string): boolean {
        const text = response.toLowerCase().trim()

        const denyPatterns = [
            /^no$/,
            /^nope$/,
            /^nah$/,
            /^cancel$/,
            /^stop$/,
            /^wait$/,
            /^nevermind$/,
            /^never mind$/
        ]

        return denyPatterns.some(pattern => pattern.test(text))
    }
}
