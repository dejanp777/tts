import { useState, useEffect } from 'react'

interface SettingsPanelProps {
  onSilenceThresholdChange: (ms: number) => void
  onBackchannelsEnabledChange: (enabled: boolean) => void
  onAssistantBackchannelsChange?: (enabled: boolean) => void
}

export const SettingsPanel = ({
  onSilenceThresholdChange,
  onBackchannelsEnabledChange,
  onAssistantBackchannelsChange
}: SettingsPanelProps) => {
  const [silenceThreshold, setSilenceThreshold] = useState(() => {
    const saved = localStorage.getItem('silenceThreshold')
    return saved ? parseInt(saved) : 1500
  })

  const [backchannelsEnabled, setBackchannelsEnabled] = useState(() => {
    const saved = localStorage.getItem('backchannelsEnabled')
    return saved ? saved === 'true' : true
  })

  // Phase 3 (B): Assistant backchannels while user speaks
  const [assistantBackchannelsEnabled, setAssistantBackchannelsEnabled] = useState(() => {
    const saved = localStorage.getItem('assistantBackchannelsEnabled')
    return saved ? saved === 'true' : false // Default to false for safety
  })

  useEffect(() => {
    localStorage.setItem('silenceThreshold', silenceThreshold.toString())
    onSilenceThresholdChange(silenceThreshold)
  }, [silenceThreshold, onSilenceThresholdChange])

  useEffect(() => {
    localStorage.setItem('backchannelsEnabled', backchannelsEnabled.toString())
    onBackchannelsEnabledChange(backchannelsEnabled)
  }, [backchannelsEnabled, onBackchannelsEnabledChange])

  useEffect(() => {
    localStorage.setItem('assistantBackchannelsEnabled', assistantBackchannelsEnabled.toString())
    if (onAssistantBackchannelsChange) {
      onAssistantBackchannelsChange(assistantBackchannelsEnabled)
    }
  }, [assistantBackchannelsEnabled, onAssistantBackchannelsChange])

  const getLabel = (ms: number) => {
    if (ms < 800) return 'Faster'
    if (ms < 1200) return 'Quick'
    if (ms < 1800) return 'Normal'
    if (ms < 2400) return 'Patient'
    return 'Slower'
  }

  return (
    <div className="settings-panel">
      <h3>Voice Settings</h3>

      <div className="setting-item">
        <label>
          Response Timing: {getLabel(silenceThreshold)}
          <div className="slider-container">
            <span className="slider-label">Faster</span>
            <input
              type="range"
              min="500"
              max="3000"
              step="100"
              value={silenceThreshold}
              onChange={(e) => setSilenceThreshold(parseInt(e.target.value))}
            />
            <span className="slider-label">Slower</span>
          </div>
          <span className="slider-value">{(silenceThreshold / 1000).toFixed(1)}s</span>
        </label>
      </div>

      <div className="setting-item">
        <label>
          <input
            type="checkbox"
            checked={backchannelsEnabled}
            onChange={(e) => setBackchannelsEnabled(e.target.checked)}
          />
          Enable thinking sounds ("hmm", "okay")
        </label>
      </div>

      <div className="setting-item">
        <label>
          <input
            type="checkbox"
            checked={assistantBackchannelsEnabled}
            onChange={(e) => setAssistantBackchannelsEnabled(e.target.checked)}
          />
          Assistant backchannels while I'm speaking (headphones recommended)
        </label>
        <div className="setting-note" style={{ fontSize: '0.85em', color: '#888', marginTop: '4px' }}>
          The assistant will occasionally say "mm-hmm" or "right" while you speak to show it's listening.
        </div>
      </div>
    </div>
  )
}
