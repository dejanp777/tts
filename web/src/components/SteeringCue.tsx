import { useCallback, useEffect, useState } from 'react'
import type { ConversationalCue } from '../utils/conversationalSteering'
import './SteeringCue.css'

interface SteeringCueProps {
    cue: ConversationalCue
    onOptionSelect?: (option: string) => void
    onDismiss?: () => void
    autoDismissMs?: number
}

export const SteeringCue = ({
    cue,
    onOptionSelect,
    onDismiss,
    autoDismissMs = 10000
}: SteeringCueProps) => {
    const [isVisible, setIsVisible] = useState(true)
    const [selectedOption, setSelectedOption] = useState<string | null>(null)

    useEffect(() => {
        if (autoDismissMs > 0) {
            const timer = setTimeout(() => {
                setIsVisible(false)
                onDismiss?.()
            }, autoDismissMs)
            return () => clearTimeout(timer)
        }
    }, [autoDismissMs, onDismiss])

    const handleOptionClick = useCallback((option: string) => {
        setSelectedOption(option)
        onOptionSelect?.(option)
        setTimeout(() => {
            setIsVisible(false)
            onDismiss?.()
        }, 500)
    }, [onOptionSelect, onDismiss])

    const handleDismiss = useCallback(() => {
        setIsVisible(false)
        onDismiss?.()
    }, [onDismiss])

    if (!isVisible) return null

    const getIcon = () => {
        switch (cue.type) {
            case 'choice': return '🔀'
            case 'expectation': return '⏱️'
            case 'guidance': return '💡'
            case 'clarification': return '❓'
            default: return '💬'
        }
    }

    const getPriorityClass = () => {
        switch (cue.priority) {
            case 'high': return 'steering-cue-high'
            case 'low': return 'steering-cue-low'
            default: return ''
        }
    }

    return (
        <div className={`steering-cue ${getPriorityClass()}`}>
            <div className="steering-cue-header">
                <span className="steering-cue-icon">{getIcon()}</span>
                <span className="steering-cue-type">
                    {cue.type === 'choice' && 'Choose an option'}
                    {cue.type === 'expectation' && 'Heads up'}
                    {cue.type === 'guidance' && 'Suggestion'}
                    {cue.type === 'clarification' && 'Quick question'}
                </span>
                <button
                    className="steering-cue-dismiss"
                    onClick={handleDismiss}
                    aria-label="Dismiss"
                >
                    ×
                </button>
            </div>
            <p className="steering-cue-message">{cue.message}</p>
            {cue.options && cue.options.length > 0 && (
                <div className="steering-cue-options">
                    {cue.options.map((option, index) => (
                        <button
                            key={index}
                            className={`steering-cue-option ${selectedOption === option ? 'selected' : ''}`}
                            onClick={() => handleOptionClick(option)}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
