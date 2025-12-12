import type { CriticalInfo } from '../utils/reflection'
import './ConfirmationDialog.css'

interface ConfirmationDialogProps {
    criticalInfo: CriticalInfo
    onConfirm: () => void
    onCancel: () => void
}

export const ConfirmationDialog = ({
    criticalInfo,
    onConfirm,
    onCancel,
}: ConfirmationDialogProps) => {
    return (
        <div className="confirmation-overlay">
            <div className="confirmation-dialog">
                <div className="confirmation-icon">⚠️</div>
                <div className="confirmation-content">
                    <h3 className="confirmation-title">Confirmation Required</h3>
                    <p className="confirmation-message">{criticalInfo.confirmationMessage}</p>
                    <div className="confirmation-details">
                        <span className="confirmation-type">{criticalInfo.type}</span>
                        <span className="confirmation-detected">"{criticalInfo.detected}"</span>
                    </div>
                </div>
                <div className="confirmation-actions">
                    <button
                        className="confirmation-btn confirmation-btn-cancel"
                        onClick={onCancel}
                        type="button"
                    >
                        Cancel
                    </button>
                    <button
                        className="confirmation-btn confirmation-btn-confirm"
                        onClick={onConfirm}
                        type="button"
                        autoFocus
                    >
                        Confirm
                    </button>
                </div>
                <div className="confirmation-hint">
                    Say "yes" to confirm or "no" to cancel
                </div>
            </div>
        </div>
    )
}
