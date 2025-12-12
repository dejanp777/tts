import { useEffect, useState } from 'react'
import './UndoButton.css'

interface UndoButtonProps {
    onUndo: () => void
    visible: boolean
}

export const UndoButton = ({ onUndo, visible }: UndoButtonProps) => {
    const [secondsLeft, setSecondsLeft] = useState(30)

    useEffect(() => {
        if (!visible) {
            setSecondsLeft(30)
            return
        }

        const interval = setInterval(() => {
            setSecondsLeft((prev) => {
                if (prev <= 1) {
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => clearInterval(interval)
    }, [visible])

    if (!visible) {
        return null
    }

    return (
        <button
            className={`undo-button ${secondsLeft <= 5 ? 'undo-button-fading' : ''}`}
            onClick={onUndo}
            type="button"
        >
            <span className="undo-icon">↶</span>
            <span className="undo-text">Undo</span>
            <span className="undo-timer">{secondsLeft}s</span>
        </button>
    )
}
