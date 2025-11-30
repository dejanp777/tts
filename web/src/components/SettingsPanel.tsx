import { useState, useEffect } from 'react'

interface SettingsPanelProps {
  onSilenceThresholdChange: (ms: number) => void
  onBackchannelsEnabledChange: (enabled: boolean) => void
}

export const SettingsPanel = ({
  onSilenceThresholdChange,
  onBackchannelsEnabledChange
}: SettingsPanelProps) => {
  const [silenceThreshold, setSilenceThreshold] = useState(() => {
    const saved = localStorage.getItem('silenceThreshold')
    return saved ? parseInt(saved) : 1500
  })

  const [backchannelsEnabled, setBackchannelsEnabled] = useState(() => {
    const saved = localStorage.getItem('backchannelsEnabled')
    return saved ? saved === 'true' : true
  })

  useEffect(() => {
    localStorage.setItem('silenceThreshold', silenceThreshold.toString())
    onSilenceThresholdChange(silenceThreshold)
  }, [silenceThreshold, onSilenceThresholdChange])

  useEffect(() => {
    localStorage.setItem('backchannelsEnabled', backchannelsEnabled.toString())
    onBackchannelsEnabledChange(backchannelsEnabled)
  }, [backchannelsEnabled, onBackchannelsEnabledChange])

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
    </div>
  )
}
