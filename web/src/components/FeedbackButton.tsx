import { useState } from 'react'
import './FeedbackButton.css'

interface FeedbackButtonProps {
    messageId: string
    onFeedback: (messageId: string, isPositive: boolean) => void
}

export const FeedbackButton = ({ messageId, onFeedback }: FeedbackButtonProps) => {
    const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleFeedback = async (isPositive: boolean) => {
        if (feedback !== null || isSubmitting) return

        setIsSubmitting(true)
        setFeedback(isPositive ? 'positive' : 'negative')

        try {
            await onFeedback(messageId, isPositive)
            console.log('[Feedback] Submitted:', isPositive ? 'thumbs up' : 'thumbs down')
        } catch (error) {
            console.error('[Feedback] Error submitting:', error)
            setFeedback(null)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="feedback-buttons">
            <button
                className={`feedback-btn ${feedback === 'positive' ? 'active' : ''}`}
                onClick={() => handleFeedback(true)}
                disabled={feedback !== null || isSubmitting}
                title="Good response"
                aria-label="Thumbs up"
            >
                👍
            </button>
            <button
                className={`feedback-btn ${feedback === 'negative' ? 'active' : ''}`}
                onClick={() => handleFeedback(false)}
                disabled={feedback !== null || isSubmitting}
                title="Bad response"
                aria-label="Thumbs down"
            >
                👎
            </button>
            {feedback && (
                <span className="feedback-thanks">Thanks!</span>
            )}
        </div>
    )
}
