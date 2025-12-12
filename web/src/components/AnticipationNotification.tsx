import { useEffect } from 'react'
import type { Anticipation } from '../utils/anticipation'
import './AnticipationNotification.css'

interface AnticipationNotificationProps {
    anticipation: Anticipation
    onAccept: () => void
    onDismiss: () => void
}

export const AnticipationNotification = ({
    anticipation,
    onAccept,
    onDismiss,
}: AnticipationNotificationProps) => {
    // Auto-dismiss after 10 seconds
    useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss()
        }, 10000)

        return () => clearTimeout(timer)
    }, [onDismiss])

    return (
        <div className="anticipation-notification">
            <div className="anticipation-content">
                <div className="anticipation-icon">💡</div>
                <div className="anticipation-message">
                    <div className="anticipation-type">{anticipation.type}</div>
                    <div className="anticipation-text">{anticipation.message}</div>
                </div>
            </div>
            <div className="anticipation-actions">
                <button
                    className="anticipation-btn anticipation-btn-accept"
                    onClick={onAccept}
                    type="button"
                >
                    Yes
                </button>
                <button
                    className="anticipation-btn anticipation-btn-dismiss"
                    onClick={onDismiss}
                    type="button"
                >
                    Dismiss
                </button>
            </div>
        </div>
    )
}
