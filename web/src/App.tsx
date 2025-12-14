import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import './App.css'
import { SettingsPanel } from './components/SettingsPanel'
import { FeedbackButton } from './components/FeedbackButton'
import { AnticipationNotification } from './components/AnticipationNotification'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import { UndoButton } from './components/UndoButton'
import { classifyUserAudio as classifyBackchannel, extractAudioFeatures } from './utils/backchannels'
import { ThinkingFillerManager } from './utils/thinkingFillers'
import { detectMessageType, selectProsody, type ProsodyProfile } from './utils/prosody'
import { TwoPassEndpointer } from './utils/twoPassEndpointing'
import { ContextAwareThreshold } from './utils/contextAwareThreshold'
import { AdaptiveLearningSystem } from './utils/adaptiveLearning'
// Phase 1 (C3): Interruption Intent Classification
import { classifyInterruption, detectResumeIntent, type InterruptionContext } from './utils/interruptionClassifier'
// Reserved for future verbosity adaptation:
// import { VerbosityController } from './utils/verbosityController'
import { MemoryManager } from './utils/conversationMemory'
import { AnticipationEngine, type Anticipation } from './utils/anticipation'
import { ReflectionEngine, type CriticalInfo } from './utils/reflection'
import { UndoManager } from './utils/undo'
import { ErrorRecovery, type ErrorContext } from './utils/errorRecovery'
import { FeedbackTiming } from './utils/feedbackTiming'
import { SpeculativeGenerator, type ConversationContext } from './utils/speculativeGeneration'
import { ChunkedDelivery } from './utils/chunkedDelivery'
import { ConversationalSteering, type ConversationalCue } from './utils/conversationalSteering'
import { FlowAdaptation } from './utils/flowAdaptation'
import { SteeringCue } from './components/SteeringCue'
import { ABTestingFramework, EXPERIMENTS } from './utils/abTesting'
// Phase 2 (A): Speak-While-Generating
import { SpeechChunker } from './utils/speechChunker'
import { SpeechQueue, QueueState, type QueuedChunk } from './utils/speechQueue'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  status?: 'pending' | 'complete' | 'error' | 'interrupted' | 'canceled'
  audioUrl?: string
}

// Phase 1 (C): Assistant Speech State Machine
type AssistantSpeechState = 'idle' | 'speaking' | 'paused'

// Use relative URL for API calls so it works on both desktop and mobile
// The Cloudflare tunnel proxies both frontend and backend on the same domain
const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || ''

// Feature flags
const ENABLE_TTS_STREAM = import.meta.env.VITE_ENABLE_TTS_STREAM === 'true' || false
const ENABLE_SPECULATIVE_GEN = import.meta.env.VITE_ENABLE_SPECULATIVE_GEN === 'true' || false
const ENABLE_CHUNKED_DELIVERY = import.meta.env.VITE_ENABLE_CHUNKED_DELIVERY === 'true' || false

const MEDIA_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/wav',
]

const AUTOPLAY_STATUS = 'Playing voice...'

const createId = () =>
(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2, 11))

// Helper function to decode base64 to Float32Array
function base64ToFloat32Array(base64: string): Float32Array {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return new Float32Array(bytes.buffer)
}

// PCM Stream Player class for streaming audio playback
class PCMStreamPlayer {
  private audioContext: AudioContext
  private gainNode: GainNode
  private bufferQueue: Float32Array[] = []
  private isPlaying = false
  private currentSource: AudioBufferSourceNode | null = null
  private onEndedCallback: (() => void) | null = null

  constructor(sampleRate = 44100) {
    this.audioContext = new AudioContext({ sampleRate })
    this.gainNode = this.audioContext.createGain()
    this.gainNode.connect(this.audioContext.destination)
  }

  addChunk(pcmData: Float32Array) {
    this.bufferQueue.push(pcmData)
    if (!this.isPlaying) {
      this.playNext()
    }
  }

  private playNext() {
    if (this.bufferQueue.length === 0) {
      this.isPlaying = false
      if (this.onEndedCallback) {
        this.onEndedCallback()
      }
      return
    }

    this.isPlaying = true
    const chunk = this.bufferQueue.shift()!
    const audioBuffer = this.audioContext.createBuffer(
      1, // mono
      chunk.length,
      this.audioContext.sampleRate
    )

    // Get the channel data and copy manually to avoid TypeScript issues
    const channelData = audioBuffer.getChannelData(0)
    for (let i = 0; i < chunk.length; i++) {
      channelData[i] = chunk[i]
    }

    const source = this.audioContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.gainNode)
    source.onended = () => this.playNext()
    this.currentSource = source
    source.start()
  }

  stop() {
    if (this.currentSource) {
      try {
        this.currentSource.stop()
      } catch {
        // Ignore if already stopped
        void 0
      }
      this.currentSource = null
    }
    this.bufferQueue = []
    this.isPlaying = false
  }

  onEnded(callback: () => void) {
    this.onEndedCallback = callback
  }

  setVolume(volume: number) {
    this.gainNode.gain.value = Math.max(0, Math.min(1, volume))
  }

  getVolume(): number {
    return this.gainNode.gain.value
  }

  getAudioContext() {
    return this.audioContext
  }
}

const App = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const isProcessingStateRef = useRef<boolean>(false)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false) // Track if AI is speaking
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null) // Track which message is playing
  const [audioLevels, setAudioLevels] = useState<number[]>([0, 0, 0, 0, 0]) // Audio equalizer bars
  const [autoplayBlockedMessageId, setAutoplayBlockedMessageId] = useState<string | null>(null) // Track message that needs manual play

  // Phase 1 (C): Assistant Speech State Machine
  const [assistantSpeechState, setAssistantSpeechState] = useState<AssistantSpeechState>('idle')
  const assistantSpeechStateRef = useRef<AssistantSpeechState>('idle')
  const playingMessageIdRef = useRef<string | null>(null)
  const pausedAssistantMessageIdRef = useRef<string | null>(null)
  const pausedAssistantTextRef = useRef<string>('')
  const pausedAtChunkIndexRef = useRef<number>(0) // For Phase 2 chunk resume
  const pausedAudioPositionRef = useRef<number>(0) // For HTMLAudio pause/resume

  // User preference state for Phase 1.2
  const [userSilenceThreshold, setUserSilenceThreshold] = useState(() => {
    const saved = localStorage.getItem('silenceThreshold')
    return saved ? parseInt(saved) : 1500
  })
  const userSilenceThresholdRef = useRef<number>(userSilenceThreshold)
  const [backchannelsEnabled, setBackchannelsEnabled] = useState(() => {
    const saved = localStorage.getItem('backchannelsEnabled')
    return saved ? saved === 'true' : true
  })

  // Phase 3 (B): Assistant backchannels while user speaks
  const [assistantBackchannelsEnabled, setAssistantBackchannelsEnabled] = useState(() => {
    const saved = localStorage.getItem('assistantBackchannelsEnabled')
    return saved ? saved === 'true' : false
  })
  const assistantBackchannelsEnabledRef = useRef<boolean>(assistantBackchannelsEnabled)

  // Sync isPlaying with assistantSpeechState
  useEffect(() => {
    assistantSpeechStateRef.current = assistantSpeechState
    setIsPlaying(assistantSpeechState === 'speaking')
  }, [assistantSpeechState])

  useEffect(() => {
    playingMessageIdRef.current = playingMessageId
  }, [playingMessageId])

  useEffect(() => {
    isProcessingStateRef.current = isProcessing
  }, [isProcessing])

  useEffect(() => {
    userSilenceThresholdRef.current = userSilenceThreshold
  }, [userSilenceThreshold])

  useEffect(() => {
    assistantBackchannelsEnabledRef.current = assistantBackchannelsEnabled
  }, [assistantBackchannelsEnabled])

  // Log API configuration on mount
  useEffect(() => {
    console.log('[CONFIG] API_BASE:', API_BASE || '(relative URLs)')
    console.log('[CONFIG] Current origin:', window.location.origin)
    console.log('[CONFIG] Backchannels enabled:', backchannelsEnabled)
  }, [backchannelsEnabled])

  const messagesRef = useRef<ChatMessage[]>([])
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const lastPlayedMessageId = useRef<string | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null) // Track current audio
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vadTimerRef = useRef<number | null>(null)
  const collectingRef = useRef<boolean>(false)
  const voiceMsRef = useRef<number>(0)
  const silenceMsRef = useRef<number>(0)
  const segmentChunksRef = useRef<Blob[]>([])
  const pendingSegmentRef = useRef<{ blob: Blob; mime: string } | null>(null)
  const turnPredictionCheckedRef = useRef<boolean>(false) // Track if we've checked prediction for current segment
  const headerChunkRef = useRef<Blob | null>(null)
  const pcmChunksRef = useRef<Float32Array[]>([])
  const sampleRateRef = useRef<number>(44100)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const chatAbortControllerRef = useRef<AbortController | null>(null)
  const ttsAbortControllerRef = useRef<AbortController | null>(null)
  const isProcessingRef = useRef<boolean>(false) // Ref to avoid dependency issues
  const fillerPlaybackRef = useRef<Promise<void> | null>(null) // Track filler playback for TTS coordination

  function mergeFloat32(chunks: Float32Array[]) {
    const total = chunks.reduce((sum, c) => sum + c.length, 0)
    const out = new Float32Array(total)
    let offset = 0
    for (const c of chunks) {
      out.set(c, offset)
      offset += c.length
    }
    return out
  }

  function downsample(buffer: Float32Array, inRate: number, outRate: number) {
    if (outRate >= inRate) return buffer
    const ratio = inRate / outRate
    const newLen = Math.round(buffer.length / ratio)
    const out = new Float32Array(newLen)
    let i = 0
    let idx = 0
    while (i < newLen) {
      out[i++] = buffer[Math.round(idx)]
      idx += ratio
    }
    return out
  }

  function encodeWavPCM16(samples: Float32Array, sampleRate: number) {
    const bytesPerSample = 2
    const blockAlign = bytesPerSample * 1
    const byteRate = sampleRate * blockAlign
    const dataSize = samples.length * bytesPerSample
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)

    function writeString(view: DataView, offset: number, str: string) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
    }

    let offset = 0
    writeString(view, offset, 'RIFF'); offset += 4
    view.setUint32(offset, 36 + dataSize, true); offset += 4
    writeString(view, offset, 'WAVE'); offset += 4
    writeString(view, offset, 'fmt '); offset += 4
    view.setUint32(offset, 16, true); offset += 4 // PCM chunk size
    view.setUint16(offset, 1, true); offset += 2 // PCM format
    view.setUint16(offset, 1, true); offset += 2 // channels
    view.setUint32(offset, sampleRate, true); offset += 4
    view.setUint32(offset, byteRate, true); offset += 4
    view.setUint16(offset, blockAlign, true); offset += 2
    view.setUint16(offset, 8 * bytesPerSample, true); offset += 2
    writeString(view, offset, 'data'); offset += 4
    view.setUint32(offset, dataSize, true); offset += 4

    // PCM 16
    let pos = 44
    for (let i = 0; i < samples.length; i++, pos += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    }

    return new Blob([buffer], { type: 'audio/wav' })
  }
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string | null>(null)

  const mimeType = useMemo(() => {
    for (const candidate of MEDIA_MIME_TYPES) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
        return candidate
      }
    }

    return 'audio/webm'
  }, [])

  const resetRecorder = useCallback(() => {
    if (mediaRecorderRef.current) {
      const stream = mediaRecorderRef.current.stream
      stream.getTracks().forEach((track) => track.stop())
      mediaRecorderRef.current = null
    }

    chunksRef.current = []
    setIsRecording(false)
    setAudioLevels([0, 0, 0, 0, 0]) // Reset equalizer
    if (vadTimerRef.current) {
      window.clearInterval(vadTimerRef.current)
      vadTimerRef.current = null
    }
    try {
      analyserRef.current?.disconnect()
      audioContextRef.current?.close()
    } catch (err) {
      console.warn('[Recorder] Cleanup failed:', err)
    }
    analyserRef.current = null
    audioContextRef.current = null
    collectingRef.current = false
    voiceMsRef.current = 0
    silenceMsRef.current = 0
    segmentChunksRef.current = []
    // Clear VAD buffers to ensure fresh segments
    headerChunkRef.current = null
    pcmChunksRef.current = []
  }, [])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => {
    const latestSpokenMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.audioUrl)

    if (!latestSpokenMessage || latestSpokenMessage.id === lastPlayedMessageId.current) {
      return
    }

    lastPlayedMessageId.current = latestSpokenMessage.id
    setStatus((prev) => prev ?? AUTOPLAY_STATUS)

    // Stop any previous audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
    }

    const audio = new Audio(latestSpokenMessage.audioUrl)
    currentAudioRef.current = audio

    // Reset volume to full before starting new playback
    // (in case previous playback ended while ducked)
    audio.volume = 1.0

    // Only pause recording if full duplex is disabled
    const enableFullDuplex = import.meta.env.VITE_ENABLE_FULL_DUPLEX === 'true'
    const wasRecording = isRecording
    console.log('[TTS Non-Stream] Full duplex enabled:', enableFullDuplex, 'Was recording:', wasRecording)
    if (wasRecording && !enableFullDuplex) {
      console.log('[TTS Non-Stream] Stopping recorder (full duplex disabled)')
      resetRecorder()
    }

    setAssistantSpeechState('speaking')
    setPlayingMessageId(latestSpokenMessage.id)
    setAutoplayBlockedMessageId(null) // Clear any previous autoplay block

    audio.onended = () => {
      setAssistantSpeechState('idle')
      setPlayingMessageId(null)
      currentAudioRef.current = null
      // Resume recording after AI finishes speaking (only if full duplex is disabled)
      if (wasRecording && !enableFullDuplex) {
        setTimeout(async () => {
          // Get fresh microphone access
          try {
            const constraints: MediaStreamConstraints = selectedMicId
              ? { audio: { deviceId: { exact: selectedMicId } } }
              : { audio: true }
            const stream = await navigator.mediaDevices.getUserMedia(constraints)
            const recorder = new MediaRecorder(stream, { mimeType })
            mediaRecorderRef.current = recorder
            chunksRef.current = []
            segmentChunksRef.current = []
            headerChunkRef.current = null
            pcmChunksRef.current = []

            recorder.ondataavailable = (event) => {
              if (event.data && event.data.size > 0) {
                if (!headerChunkRef.current) {
                  headerChunkRef.current = event.data
                }
                if (collectingRef.current) {
                  segmentChunksRef.current.push(event.data)
                }
              }
            }

            recorder.onstop = () => { }
            recorder.start(250)
            setIsRecording(true)
            setStatus('Listening...')
          } catch (err) {
            console.error('Failed to resume recording:', err)
          }
        }, 500) // Small delay to avoid picking up tail end of audio
      }
    }

    audio
      .play()
      .catch((err) => {
        console.error('Autoplay failed', err)
        setError((prev) => prev ?? 'Autoplay was blocked. Click the play button to listen.')
        setAssistantSpeechState('idle')
        setPlayingMessageId(null)
        setAutoplayBlockedMessageId(latestSpokenMessage.id)
        currentAudioRef.current = null
        // Resume recording even if playback failed (only if full duplex is disabled)
        if (wasRecording && !enableFullDuplex) {
          setTimeout(async () => {
            try {
              const constraints: MediaStreamConstraints = selectedMicId
                ? { audio: { deviceId: { exact: selectedMicId } } }
                : { audio: true }
              const stream = await navigator.mediaDevices.getUserMedia(constraints)
              const recorder = new MediaRecorder(stream, { mimeType })
              mediaRecorderRef.current = recorder
              chunksRef.current = []
              segmentChunksRef.current = []
              headerChunkRef.current = null
              pcmChunksRef.current = []

              recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                  if (!headerChunkRef.current) {
                    headerChunkRef.current = event.data
                  }
                  if (collectingRef.current) {
                    segmentChunksRef.current.push(event.data)
                  }
                }
              }

              recorder.onstop = () => { }
              recorder.start(250)
              setIsRecording(true)
              setStatus('Listening...')
            } catch (err) {
              console.error('Failed to resume recording:', err)
            }
          }, 500)
        }
      })
      .finally(() => {
        setStatus((prev) => (prev === AUTOPLAY_STATUS ? null : prev))
      })
  }, [messages, isRecording, resetRecorder, selectedMicId, mimeType])

  useEffect(() => {
    return () => {
      resetRecorder()
    }
  }, [resetRecorder])

  // Manual play handler for autoplay-blocked messages
  const handleManualPlay = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (!message?.audioUrl) return

    const audio = new Audio(message.audioUrl)
    currentAudioRef.current = audio
    audio.volume = 1.0

    setAssistantSpeechState('speaking')
    setPlayingMessageId(messageId)
    setAutoplayBlockedMessageId(null)
    setError(null)

    audio.onended = () => {
      setAssistantSpeechState('idle')
      setPlayingMessageId(null)
      currentAudioRef.current = null
    }

    audio.play().catch((err) => {
      console.error('Manual play failed', err)
      setError('Failed to play audio')
      setAssistantSpeechState('idle')
      setPlayingMessageId(null)
      currentAudioRef.current = null
    })
  }, [messages])

  // Phase 1 (C4): Pause/Resume Assistant Speech
  const pauseAssistantSpeech = useCallback(() => {
    const enablePauseResume = import.meta.env.VITE_ENABLE_PAUSE_RESUME === 'true'
    if (!enablePauseResume) return

    console.log('[PAUSE] Pausing assistant speech')

    const activeMessageId = playingMessageIdRef.current

    // Phase 2 (A5): Pause speech queue if using chunked delivery
    if (speechQueueRef.current) {
      speechQueueRef.current.pause()
      pausedAtChunkIndexRef.current = speechQueueRef.current.getCurrentChunkIndex()
      console.log('[PAUSE] Paused at chunk index:', pausedAtChunkIndexRef.current)
    }

    // Pause HTMLAudio if playing
    if (currentAudioRef.current && !currentAudioRef.current.paused) {
      pausedAudioPositionRef.current = currentAudioRef.current.currentTime
      currentAudioRef.current.pause()
    }

    // Pause PCM streaming audio
    if (pcmStreamPlayerRef.current) {
      const audioContext = pcmStreamPlayerRef.current.getAudioContext()
      if (audioContext.state === 'running') {
        audioContext.suspend().catch((err) => {
          console.error('[PAUSE] Failed to suspend audio context:', err)
        })
      }
    }

    // Note: We do not abort in-flight streaming TTS on pause so resume can
    // continue playback without restarting/losing audio.

    // Store pause state
    pausedAssistantMessageIdRef.current = activeMessageId
    const message = messagesRef.current.find(m => m.id === activeMessageId)
    if (message) {
      pausedAssistantTextRef.current = message.text
    }

    assistantSpeechStateRef.current = 'paused'
    setAssistantSpeechState('paused')
    setStatus('Paused. Say "continue" to resume.')
  }, [])

  const resumeAssistantSpeech = useCallback(() => {
    const enablePauseResume = import.meta.env.VITE_ENABLE_PAUSE_RESUME === 'true'
    if (!enablePauseResume) return

    console.log('[PAUSE] Resuming assistant speech')

    // Phase 2 (A5): Resume speech queue if using chunked delivery
    if (speechQueueRef.current && speechQueueRef.current.getState() === QueueState.PAUSED) {
      console.log('[PAUSE] Resuming speech queue from chunk index:', pausedAtChunkIndexRef.current)
      // Resume WebAudio playback first (the queue only controls chunk sequencing).
      if (pcmStreamPlayerRef.current) {
        const audioContext = pcmStreamPlayerRef.current.getAudioContext()
        if (audioContext.state === 'suspended') {
          audioContext.resume().catch((err) => {
            console.error('[PAUSE] Failed to resume audio context for queue:', err)
            setError('Failed to resume audio playback')
          })
        }
      }
      speechQueueRef.current.resume()
      assistantSpeechStateRef.current = 'speaking'
      setAssistantSpeechState('speaking')
      setPlayingMessageId(pausedAssistantMessageIdRef.current)
      setStatus(null)
      return
    }

    // Resume HTMLAudio if available
    if (currentAudioRef.current && currentAudioRef.current.paused && !currentAudioRef.current.ended) {
      currentAudioRef.current.currentTime = pausedAudioPositionRef.current
      currentAudioRef.current.play().catch((err) => {
        console.error('[PAUSE] Failed to resume audio:', err)
        setError('Failed to resume audio playback')
        assistantSpeechStateRef.current = 'idle'
        setAssistantSpeechState('idle')
      })
      assistantSpeechStateRef.current = 'speaking'
      setAssistantSpeechState('speaking')
      setPlayingMessageId(pausedAssistantMessageIdRef.current)
      setStatus(null)
      return
    }

    // Resume PCM streaming audio
    if (pcmStreamPlayerRef.current) {
      const audioContext = pcmStreamPlayerRef.current.getAudioContext()
      if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
          assistantSpeechStateRef.current = 'speaking'
          setAssistantSpeechState('speaking')
          setPlayingMessageId(pausedAssistantMessageIdRef.current)
          setStatus(null)
        }).catch((err) => {
          console.error('[PAUSE] Failed to resume audio context:', err)
          setError('Failed to resume audio playback')
          assistantSpeechStateRef.current = 'idle'
          setAssistantSpeechState('idle')
        })
        return
      }
    }

    // If there's no resumable audio stream/element, re-synthesize from stored text.
    if (pausedAssistantTextRef.current && pausedAssistantMessageIdRef.current) {
      console.log('[PAUSE] Re-synthesizing paused text')
      setStatus('Generating voice...')

      const messageType = detectMessageType(pausedAssistantTextRef.current)
      const prosody = selectProsody(messageType, pausedAssistantTextRef.current)

      // Use streaming TTS if available
      if (import.meta.env.VITE_ENABLE_TTS_STREAM === 'true' && pcmStreamPlayerRef.current) {
        const player = pcmStreamPlayerRef.current
        player.setVolume(1.0)

        assistantSpeechStateRef.current = 'speaking'
        setAssistantSpeechState('speaking')
        setPlayingMessageId(pausedAssistantMessageIdRef.current)

        const ttsController = new AbortController()
        ttsAbortControllerRef.current = ttsController

        synthesizeSpeechStream(
          pausedAssistantTextRef.current,
          (pcmData) => player.addChunk(pcmData),
          ttsController.signal,
          prosody
        ).then(() => {
          setStatus(null)
        }).catch((err) => {
          if (err.name !== 'AbortError') {
            console.error('[PAUSE] Failed to resume TTS stream:', err)
            setError('Failed to resume speech')
            assistantSpeechStateRef.current = 'idle'
            setAssistantSpeechState('idle')
          }
        })
      } else {
        // Non-streaming TTS
        synthesizeSpeech(pausedAssistantTextRef.current, prosody).then((audioUrl) => {
          const audio = new Audio(audioUrl)
          currentAudioRef.current = audio
          audio.volume = 1.0

          assistantSpeechStateRef.current = 'speaking'
          setAssistantSpeechState('speaking')
          setPlayingMessageId(pausedAssistantMessageIdRef.current)

          audio.onended = () => {
            assistantSpeechStateRef.current = 'idle'
            setAssistantSpeechState('idle')
            setPlayingMessageId(null)
            currentAudioRef.current = null
          }

          audio.play().catch((err) => {
            console.error('[PAUSE] Failed to play resumed audio:', err)
            setError('Failed to resume audio playback')
            assistantSpeechStateRef.current = 'idle'
            setAssistantSpeechState('idle')
          })

          setStatus(null)
        }).catch((err) => {
          console.error('[PAUSE] Failed to synthesize resumed speech:', err)
          setError('Failed to resume speech')
          assistantSpeechStateRef.current = 'idle'
          setAssistantSpeechState('idle')
        })
      }
    } else {
      console.warn('[PAUSE] No paused speech to resume')
      assistantSpeechStateRef.current = 'idle'
      setAssistantSpeechState('idle')
      setStatus(null)
    }
  }, [])

  // When we finish processing, auto-handle any pending recorded segment
  useEffect(() => {
    if (!isProcessing && pendingSegmentRef.current) {
      const seg = pendingSegmentRef.current
      pendingSegmentRef.current = null
      void handleRecordedAudio(seg.blob, seg.mime)
    }
  }, [isProcessing])

  // Refresh available microphones
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const mics = list.filter((d) => d.kind === 'audioinput')
      setMicDevices(mics)
      if (!selectedMicId && mics.length > 0) {
        setSelectedMicId(mics[0].deviceId || null)
      }
    } catch (err) {
      console.warn('enumerateDevices failed', err)
    }
  }, [selectedMicId])

  useEffect(() => {
    void refreshDevices()
    const handler = () => void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', handler)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler)
  }, [refreshDevices])

  const requestChatCompletion = useCallback(async (history: ChatMessage[], memoryContext?: string) => {
    const payload = history.map((entry) => ({
      role: entry.role,
      content: entry.text,
    }))

    const url = `${API_BASE}/api/chat`
    console.log('[API] Requesting chat completion:', url)

    // Create abort controller for this request
    const controller = new AbortController()
    chatAbortControllerRef.current = controller

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: payload,
        memoryContext: memoryContext || undefined
      }),
      signal: controller.signal,
    })

    console.log('[API] Chat response status:', response.status)

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      console.error('[API] Chat error:', body)
      throw new Error(body?.error || 'Chat completion failed')
    }

    const body = await response.json()
    const assistantMessage = body?.message

    if (!assistantMessage) {
      throw new Error('Chat completion returned no message')
    }

    const content = Array.isArray(assistantMessage.content)
      ? assistantMessage.content
        .map((segment: { text?: string } | string) =>
          typeof segment === 'string' ? segment : segment?.text ?? ''
        )
        .join('')
      : assistantMessage.content ?? ''

    if (!content.trim()) {
      throw new Error('Assistant response was empty')
    }

    return content.trim()
  }, [])

  const requestChatCompletionStream = useCallback(
    async (history: ChatMessage[], onToken: (token: string) => void) => {
      const payload = history.map((entry) => ({
        role: entry.role,
        content: entry.text,
      }))

      const url = `${API_BASE}/api/chat/stream`
      console.log('[API] Requesting streaming chat completion:', url)

      // Create abort controller for this request
      const controller = new AbortController()
      chatAbortControllerRef.current = controller

      // Add timeout for the entire stream (30 seconds)
      const timeoutId = setTimeout(() => {
        console.warn('[Chat Stream] Timeout after 30s, aborting')
        controller.abort()
      }, 30000)

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: payload }),
          signal: controller.signal,
        })

        console.log('[API] Chat stream response status:', response.status)

        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          console.error('[API] Chat stream error:', body)
          throw new Error(body?.error || 'Streaming chat completion failed')
        }

        if (!response.body) {
          throw new Error('No response body for streaming chat')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let fullContent = ''
        let buffer = '' // Persistent buffer for chunk-safe parsing

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              console.log('[Chat Stream] Stream done, exiting read loop')
              break
            }

            buffer += decoder.decode(value, { stream: true })

            // Parse SSE events (format: "data: <json>\n\n")
            let idx
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, idx)
              buffer = buffer.slice(idx + 2)

              const match = frame.match(/^data:\s*(.*)$/m)
              if (match && match[1]) {
                const data = match[1].trim()
                if (data === '[DONE]') {
                  console.log('[Chat Stream] Received [DONE] marker')
                  continue
                }

                try {
                  const parsed = JSON.parse(data)
                  const delta = parsed.choices?.[0]?.delta?.content
                  if (delta) {
                    fullContent += delta
                    onToken(delta)
                  }
                } catch (e) {
                  console.error('[Chat Stream] Failed to parse JSON:', e)
                }
              }
            }
          }
        } finally {
          console.log('[Chat Stream] Releasing reader lock, fullContent length:', fullContent.length)
          reader.releaseLock()
        }

        if (!fullContent.trim()) {
          throw new Error('Assistant response was empty')
        }

        return fullContent.trim()
      } finally {
        clearTimeout(timeoutId)
      }
    },
    []
  )

  const synthesizeSpeech = useCallback(async (text: string, prosody?: ProsodyProfile) => {
    const url = `${API_BASE}/api/tts`
    console.log('[API] Requesting TTS:', url, 'prosody:', prosody)

    // Create abort controller for this request
    const controller = new AbortController()
    ttsAbortControllerRef.current = controller

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        emotion: prosody?.emotion || 'frustrated',
        speed: prosody?.speed || 1.0
      }),
      signal: controller.signal,
    })

    console.log('[API] TTS response status:', response.status)

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      console.error('[API] TTS error:', body)
      throw new Error(body?.error || 'Text-to-speech synthesis failed')
    }

    const body = await response.json()

    if (!body?.audio) {
      throw new Error('No audio returned from TTS endpoint')
    }

    return body.audio as string
  }, [])

  // PCM Stream Player for streaming TTS
  const pcmStreamPlayerRef = useRef<PCMStreamPlayer | null>(null)

  // Phase 2 (A): Speech chunker and queue refs
  const speechChunkerRef = useRef<SpeechChunker | null>(null)
  const speechQueueRef = useRef<SpeechQueue | null>(null)
  // Phase 2 (A4): Track whether assistant is still generating (separate from speaking)
  // This will be used in future UI updates to show generation status
  const [, setAssistantGenerationState] = useState<'idle' | 'generating' | 'done'>('idle')

  // Phase 1.5: Thinking Filler Manager
  const fillerManagerRef = useRef<ThinkingFillerManager>(
    new ThinkingFillerManager({
      enabled: backchannelsEnabled,
      thresholdMs: 1500,
      minInterval: 5000 // Max 1 filler per 5 seconds
    })
  )

  // Phase 3: Advanced Endpointing and Adaptive Learning
  const twoPassEndpointerRef = useRef<TwoPassEndpointer>(
    new TwoPassEndpointer(userSilenceThreshold)
  )
  const contextAwareThresholdRef = useRef<ContextAwareThreshold>(
    new ContextAwareThreshold(userSilenceThreshold)
  )
  const adaptiveLearningRef = useRef<AdaptiveLearningSystem>(
    new AdaptiveLearningSystem('default', userSilenceThreshold)
  )

  // Track conversation context for adaptive systems
  // Reserved for future use in adaptive systems:
  // const conversationStartTimeRef = useRef<number>(Date.now())
  const lastTranscriptRef = useRef<string>('')
  const lastTranscriptTimeRef = useRef<number>(0)

  // Phase 1 (C3): Interruption context tracking
  const lastInterruptionTranscriptRef = useRef<string>('')
  const lastInterruptionTimeRef = useRef<number>(0)
  const interruptionCountRef = useRef<number>(0)
  const pauseOnBargeInRef = useRef<boolean>(false)

  // Phase 3 (B2): Assistant backchannel tracking
  const assistantBackchannelLastTimeRef = useRef<number>(0)
  const assistantBackchannelAudioRef = useRef<HTMLAudioElement | null>(null)
  const assistantBackchannelInhibitUntilRef = useRef<number>(0)

  // Interruption Classification and Verbosity Control
  // Reserved for future use in verbosity adaptation:
  // const verbosityControllerRef = useRef<VerbosityController>(new VerbosityController())
  // const [isPaused, setIsPaused] = useState(false) // Track if AI is paused
  // const pausedStateRef = useRef<{
  //   messageId: string | null
  //   position: number
  // }>({ messageId: null, position: 0 })

  // Phase 1: UX Principles - RECALL, ANTICIPATE, REFLECT, Undo
  const memoryManagerRef = useRef<MemoryManager>(new MemoryManager())
  const anticipationEngineRef = useRef<AnticipationEngine>(new AnticipationEngine())
  const reflectionEngineRef = useRef<ReflectionEngine>(new ReflectionEngine())
  const undoManagerRef = useRef<UndoManager<ChatMessage>>(new UndoManager<ChatMessage>())

  const [currentAnticipation, setCurrentAnticipation] = useState<Anticipation | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState<CriticalInfo | null>(null)
  const [showUndoButton, setShowUndoButton] = useState(false)
  const undoTimerRef = useRef<number | null>(null)

  // Error Recovery and Feedback Systems
  const errorRecoveryRef = useRef<ErrorRecovery>(new ErrorRecovery())
  const feedbackTimingRef = useRef<FeedbackTiming>(new FeedbackTiming())
  const [feedbackMessageIds, setFeedbackMessageIds] = useState<Set<string>>(new Set())

  // Speculative Generation System
  const speculativeGeneratorRef = useRef<SpeculativeGenerator>(new SpeculativeGenerator())

  // Chunked Delivery System
  const chunkedDeliveryRef = useRef<ChunkedDelivery>(
    new ChunkedDelivery({
      maxChunkLength: 150,
      minChunkLength: 30,
      basePauseMs: 500,
      enableChunking: ENABLE_CHUNKED_DELIVERY
    })
  )

  // PULL: Conversational Steering System
  const conversationalSteeringRef = useRef<ConversationalSteering>(new ConversationalSteering())
  const [currentSteeringCue, setCurrentSteeringCue] = useState<ConversationalCue | null>(null)

  // ADAPT: Flow Adaptation System
  const flowAdaptationRef = useRef<FlowAdaptation>(new FlowAdaptation())

  // A/B Testing Framework
  const abTestingRef = useRef<ABTestingFramework | null>(null)

  // Initialize A/B testing on mount
  useEffect(() => {
    if (!abTestingRef.current) {
      const framework = new ABTestingFramework()
      // Register pre-defined experiments
      framework.registerExperiment(EXPERIMENTS.SILENCE_THRESHOLD)
      framework.registerExperiment(EXPERIMENTS.TTS_STREAMING)
      framework.registerExperiment(EXPERIMENTS.THINKING_FILLERS)
      abTestingRef.current = framework
      console.log('[A/B Testing] Active experiments:', framework.getActiveExperiments().map(e => e.name))
    }
  }, [])

  // Update filler manager when user preference changes
  useEffect(() => {
    fillerManagerRef.current = new ThinkingFillerManager({
      enabled: backchannelsEnabled,
      thresholdMs: 1500,
      minInterval: 5000
    })
  }, [backchannelsEnabled])

  const synthesizeSpeechStream = useCallback(async (
    text: string,
    onChunk: (pcmData: Float32Array) => void,
    signal?: AbortSignal,
    prosody?: ProsodyProfile
  ) => {
    const url = `${API_BASE}/api/tts/stream`
    console.log('[API] Requesting streaming TTS:', url, 'text length:', text.length, 'prosody:', prosody)

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        emotion: prosody?.emotion || 'frustrated',
        speed: prosody?.speed || 1.0
      }),
      signal,
    })

    console.log('[API] Streaming TTS response status:', response.status)

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      console.error('[API] Streaming TTS error:', body)
      throw new Error(body?.error || 'Streaming TTS failed')
    }

    if (!response.body) {
      throw new Error('No stream body in response')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    let chunkCount = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          console.log('[TTS Stream] Stream done, received', chunkCount, 'chunks')
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events (format: "data: {\"type\":\"chunk\",\"data\":\"<base64>\"}\n\n")
        let idx
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)

          const match = frame.match(/^data:\s*(.*)$/m)
          if (match && match[1]) {
            try {
              const jsonData = match[1].trim()
              if (!jsonData) continue

              // Parse JSON response from Cartesia
              const chunk = JSON.parse(jsonData)

              if (chunk.type === 'chunk' && chunk.data) {
                // chunk.data contains base64-encoded PCM data
                const pcmData = base64ToFloat32Array(chunk.data)
                chunkCount++
                if (chunkCount === 1) {
                  console.log('[TTS Stream] First chunk received, base64 length:', chunk.data.length)
                }
                onChunk(pcmData)
              } else if (chunk.type === 'done') {
                console.log('[TTS Stream] Stream completed, total chunks:', chunkCount)
                break
              } else if (chunk.type === 'error') {
                console.error('[TTS Stream] Server error:', chunk.message)
                throw new Error(chunk.message || 'TTS stream error')
              } else {
                console.warn('[TTS Stream] Unknown chunk type:', chunk.type, chunk)
              }
            } catch (err) {
              console.error('[TTS Stream] Failed to parse chunk:', err)
              console.error('[TTS Stream] Raw data (first 200 chars):', match[1].substring(0, 200))
            }
          }
        }
      }
    } finally {
      console.log('[TTS Stream] Releasing reader, total chunks received:', chunkCount)
      reader.releaseLock()
    }
  }, [])

  const transcribeAudio = useCallback(async (blob: Blob, encoding: string) => {
    const form = new FormData()
    form.append('audio', blob, `recording.${encoding}`)
    form.append('encoding', encoding)
    form.append('language', 'auto')

    const url = `${API_BASE}/api/stt`
    console.log('[API] Requesting STT:', url, 'blob size:', blob.size, 'encoding:', encoding)

    const response = await fetch(url, {
      method: 'POST',
      body: form,
    })

    console.log('[API] STT response status:', response.status)

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      console.error('[API] STT error:', payload)
      let msg = payload?.error || 'Failed to transcribe audio'
      if (payload?.details) {
        const details = typeof payload.details === 'string' ? payload.details : JSON.stringify(payload.details)
        msg += `: ${details.substring(0, 500)}`
      }
      throw new Error(msg)
    }

    const payload = await response.json()
    const transcript: string | undefined = payload?.transcript

    if (!transcript || !transcript.trim()) {
      throw new Error('Transcription returned empty result')
    }

    return transcript.trim()
  }, [])

  const sendMessageFlow = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim()
      if (!trimmed) {
        return
      }

      setIsProcessing(true)
      setError(null)

      const userMessage: ChatMessage = {
        id: createId(),
        role: 'user',
        text: trimmed,
        status: 'complete' as const,
      }

      // Phase 1: RECALL - Extract memories from user message
      memoryManagerRef.current.extractMemories(trimmed, userMessage.id)

      // Phase 1: ANTICIPATE - Check for anticipation opportunities
      const previousMessages = messagesRef.current
        .filter(m => m.role === 'user')
        .map(m => m.text)
      const anticipation = anticipationEngineRef.current.anticipate(trimmed, previousMessages)
      if (anticipation && anticipation.confidence > 0.7) {
        console.log('[Anticipation] Detected:', anticipation)
        setCurrentAnticipation(anticipation)
      }

      // Phase 1: REFLECT - Check for critical information
      const criticalInfo = reflectionEngineRef.current.detectCriticalInfo(trimmed)
      if (criticalInfo && criticalInfo.confidence > 0.8) {
        console.log('[Reflection] Critical info detected:', criticalInfo)
        setPendingConfirmation(criticalInfo)
        // Don't proceed with message flow - wait for confirmation
        setIsProcessing(false)
        return
      }

      const conversationWithUser: ChatMessage[] = [...messagesRef.current, userMessage]
      messagesRef.current = conversationWithUser
      setMessages(conversationWithUser)

      setStatus('Thinking...')

      // Phase 1.5: Set up thinking filler
      let fillerTimeout: number | null = null

      const fillerUrl = fillerManagerRef.current.selectFiller(trimmed)

      if (fillerUrl) {
        fillerTimeout = window.setTimeout(async () => {
          try {
            console.log('[Filler] Playing thinking filler:', fillerUrl)
            // Store the playback promise so TTS can wait for or stop it
            const playbackPromise = fillerManagerRef.current.playFiller(fillerUrl)
            fillerPlaybackRef.current = playbackPromise
            await playbackPromise
          } catch (err) {
            console.error('[Filler] Failed to play:', err)
          } finally {
            fillerPlaybackRef.current = null
          }
        }, fillerManagerRef.current['options'].thresholdMs)
      }

      try {
        const enableChatStream = import.meta.env.VITE_ENABLE_CHAT_STREAM === 'true' || false
        let assistantText = ''
        const assistantId = createId()
        let usedSpeakWhileGenerating = false

        if (enableChatStream) {
          // Use streaming chat - show tokens as they arrive
          console.log('[Chat] Using streaming mode')
          const chatStartTime = performance.now()

          const assistantMessage: ChatMessage = {
            id: assistantId,
            role: 'assistant',
            text: '',
            status: 'pending' as const,
          }

          const conversationWithAssistant: ChatMessage[] = [
            ...conversationWithUser,
            assistantMessage,
          ]
          messagesRef.current = conversationWithAssistant
          setMessages(conversationWithAssistant)

          // Phase 2 (A): Initialize speech chunker and queue if speak-while-generating enabled
          const enableSpeakWhileGenerating = import.meta.env.VITE_ENABLE_SPEAK_WHILE_GENERATING === 'true'

          if (enableSpeakWhileGenerating && ENABLE_TTS_STREAM) {
            console.log('[SAY-STREAM] Initializing speak-while-generating mode')
            usedSpeakWhileGenerating = true
            setAssistantGenerationState('generating')

            // Initialize PCM player if not already created
            if (!pcmStreamPlayerRef.current) {
              pcmStreamPlayerRef.current = new PCMStreamPlayer(44100)
            }

            // Initialize speech chunker with env config
            speechChunkerRef.current = new SpeechChunker({
              minChars: parseInt(import.meta.env.VITE_SPEECH_CHUNK_MIN_CHARS || '60'),
              maxChars: parseInt(import.meta.env.VITE_SPEECH_CHUNK_MAX_CHARS || '220'),
              forceAfterMs: parseInt(import.meta.env.VITE_SPEECH_CHUNK_FORCE_AFTER_MS || '1800')
            })

            // Initialize speech queue
            const player = pcmStreamPlayerRef.current
            player.setVolume(1.0)

            // Set up playback state when first chunk starts
            let isFirstChunk = true

            speechQueueRef.current = new SpeechQueue(
              async (chunk: QueuedChunk) => {
                console.log('[SAY-STREAM] Playing queued chunk:', chunk.index)

                // Set playing state on first chunk
                if (isFirstChunk) {
                  isFirstChunk = false
                  setAssistantSpeechState('speaking')
                  setPlayingMessageId(assistantId)

                  // Stop thinking filler if playing
                  if (fillerManagerRef.current.isPlaying()) {
                    fillerManagerRef.current.stopFiller()
                  }
                }

                // Detect message type and select prosody
                const messageType = detectMessageType(chunk.text)
                const prosody = selectProsody(messageType, chunk.text)

                // Synthesize this chunk
                const ttsController = new AbortController()
                ttsAbortControllerRef.current = ttsController

                await synthesizeSpeechStream(
                  chunk.text,
                  (pcmData) => player.addChunk(pcmData),
                  ttsController.signal,
                  prosody
                )
              },
              () => {
                // On complete
                console.log('[SAY-STREAM] All chunks played')
                setAssistantSpeechState('idle')
                setPlayingMessageId(null)
                setAssistantGenerationState('done')
              },
              (error) => {
                // On error
                console.error('[SAY-STREAM] Queue error:', error)
                setAssistantSpeechState('idle')
                setPlayingMessageId(null)
                setAssistantGenerationState('done')
              }
            )
          }

          let firstTokenTime: number | null = null
          // Stream tokens and update message in real-time
          assistantText = await requestChatCompletionStream(conversationWithUser, (token) => {
            if (firstTokenTime === null) {
              firstTokenTime = performance.now()
              console.log(`⏱️ [TIMING] Chat first token took ${(firstTokenTime - chatStartTime).toFixed(0)}ms`)
            }
            assistantMessage.text += token
            messagesRef.current = [...conversationWithUser, assistantMessage]
            setMessages([...conversationWithUser, assistantMessage])

            // Phase 2 (A): Feed token to speech chunker if enabled
            if (enableSpeakWhileGenerating && speechChunkerRef.current && speechQueueRef.current) {
              const chunk = speechChunkerRef.current.addToken(token)
              if (chunk) {
                console.log('[SAY-STREAM] Chunk emitted from token stream:', { index: chunk.index, length: chunk.text.length })
                speechQueueRef.current.enqueue({
                  text: chunk.text,
                  index: chunk.index,
                  isFinal: chunk.isFinal
                })
              }
            }
          })

          const chatEndTime = performance.now()
          console.log(`⏱️ [TIMING] Chat complete took ${(chatEndTime - chatStartTime).toFixed(0)}ms`)

          // Phase 2 (A): Flush final chunk if speak-while-generating enabled
          if (enableSpeakWhileGenerating && speechChunkerRef.current && speechQueueRef.current) {
            const finalChunk = speechChunkerRef.current.flush()
            if (finalChunk) {
              console.log('[SAY-STREAM] Flushing final chunk:', { index: finalChunk.index, length: finalChunk.text.length })
              speechQueueRef.current.enqueue({
                text: finalChunk.text,
                index: finalChunk.index,
                isFinal: true
              })
            }
            setAssistantGenerationState('done')
          }

          // Update with final text
          assistantMessage.text = assistantText
          assistantMessage.status = 'complete'
          messagesRef.current = [...conversationWithUser, assistantMessage]
          setMessages([...conversationWithUser, assistantMessage])
        } else {
          // Use non-streaming chat
          // Phase 1: RECALL - Get memory context for injection
          const memoryContext = memoryManagerRef.current.formatForPrompt()
          if (memoryContext) {
            console.log('[Memory] Injecting context:', memoryContext)
          }

          assistantText = await requestChatCompletion(conversationWithUser, memoryContext)
          const assistantMessage: ChatMessage = {
            id: assistantId,
            role: 'assistant',
            text: assistantText,
            status: 'pending' as const,
          }

          const conversationWithAssistant: ChatMessage[] = [
            ...conversationWithUser,
            assistantMessage,
          ]
          messagesRef.current = conversationWithAssistant
          setMessages(conversationWithAssistant)

          // Phase 1: Undo - Save state after message pair
          undoManagerRef.current.saveState(conversationWithAssistant)
        }

        // Clear filler timeout once we have response
        if (fillerTimeout) {
          window.clearTimeout(fillerTimeout)
        }

        // Coordinate with any playing filler before starting TTS
        if (fillerPlaybackRef.current) {
          const playbackDuration = fillerManagerRef.current.getPlaybackDuration()
          const MAX_WAIT_DURATION = 800 // Don't wait more than 800ms for filler

          if (playbackDuration > MAX_WAIT_DURATION) {
            // Filler has been playing too long, stop it to minimize TTS delay
            console.log('[Filler] Stopping long-playing filler after', playbackDuration, 'ms')
            fillerManagerRef.current.stopFiller()
          } else if (fillerManagerRef.current.isPlaying()) {
            // Short filler - wait for natural completion
            console.log('[Filler] Waiting for short filler to finish, elapsed:', playbackDuration, 'ms')
            try {
              await fillerPlaybackRef.current
            } catch (err) {
              console.log('[Filler] Filler ended with error:', err)
            }
          }
          fillerPlaybackRef.current = null
        }

        // Phase 2 (A): If speak-while-generating is active, chunks are already queued for playback.
        // Avoid synthesizing the full assistantText again (would double-speak).
        if (usedSpeakWhileGenerating) {
          console.log('[SAY-STREAM] Skipping full-answer TTS (chunk queue active)')
          setStatus(null)
        } else if (ENABLE_TTS_STREAM) {
          setStatus('Generating voice...')
          // Use streaming TTS
          console.log('[TTS] Using streaming mode')
          const ttsStartTime = performance.now()

          // Initialize PCM player if not already created
          if (!pcmStreamPlayerRef.current) {
            pcmStreamPlayerRef.current = new PCMStreamPlayer(44100)
          }

          const player = pcmStreamPlayerRef.current

          // Reset volume to full before starting new playback
          // (in case previous playback ended while ducked)
          player.setVolume(1.0)

          // Only pause recording if full duplex is disabled
          const enableFullDuplex = import.meta.env.VITE_ENABLE_FULL_DUPLEX === 'true'
          const wasRecording = isRecording
          console.log('[TTS Stream] Full duplex enabled:', enableFullDuplex, 'Was recording:', wasRecording)
          if (wasRecording && !enableFullDuplex) {
            console.log('[TTS Stream] Stopping recorder (full duplex disabled)')
            resetRecorder()
          }

          // Set up playback state tracking
          setAssistantSpeechState('speaking')
          setPlayingMessageId(assistantId)

          player.onEnded(() => {
            setAssistantSpeechState('idle')
            setPlayingMessageId(null)
          })

          // Create abort controller for streaming TTS
          const ttsController = new AbortController()
          ttsAbortControllerRef.current = ttsController

          // Phase 1.6: Detect message type and select appropriate prosody
          const messageType = detectMessageType(assistantText)
          const prosody = selectProsody(messageType, assistantText)
          console.log('[Prosody] Selected:', { messageType, prosody })

          let firstChunkTime: number | null = null
          // Stream and play audio chunks
          await synthesizeSpeechStream(
            assistantText,
            (pcmData) => {
              if (firstChunkTime === null) {
                firstChunkTime = performance.now()
                console.log(`⏱️ [TIMING] TTS first chunk took ${(firstChunkTime - ttsStartTime).toFixed(0)}ms`)
              }
              player.addChunk(pcmData)
            },
            ttsController.signal,
            prosody
          )

          const ttsEndTime = performance.now()
          console.log(`⏱️ [TIMING] TTS complete took ${(ttsEndTime - ttsStartTime).toFixed(0)}ms`)

          // Mark as complete
          const finalizedMessages = messagesRef.current.map((entry) =>
            entry.id === assistantId ? { ...entry, status: 'complete' as const } : entry
          )

          messagesRef.current = finalizedMessages
          setMessages(finalizedMessages)
          setStatus(null)
        } else {
          setStatus('Generating voice...')
          // Use non-streaming TTS (original behavior)
          // Phase 1.6: Detect message type and select appropriate prosody
          const messageType = detectMessageType(assistantText)
          const prosody = selectProsody(messageType, assistantText)
          console.log('[Prosody] Selected:', { messageType, prosody })

          // Check if response should be chunked
          if (ENABLE_CHUNKED_DELIVERY && chunkedDeliveryRef.current.shouldChunk(assistantText)) {
            console.log('[Chunked Delivery] Chunking response')
            const chunks = chunkedDeliveryRef.current.chunkResponse(assistantText)

            // Generate TTS for all chunks in advance
            const chunkAudioUrls: string[] = []
            for (const chunk of chunks) {
              const chunkProsody = selectProsody(detectMessageType(chunk.text), chunk.text)
              const audioUrl = await synthesizeSpeech(chunk.text, chunkProsody)
              chunkAudioUrls.push(audioUrl)
            }

            // Play chunks sequentially with pauses
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i]
              const audioUrl = chunkAudioUrls[i]

              console.log(`[Chunked Delivery] Playing chunk ${i + 1}/${chunks.length}`)

              // Play this chunk
              const audio = new Audio(audioUrl)
              audio.volume = 1.0
              currentAudioRef.current = audio

              setAssistantSpeechState('speaking')
              setPlayingMessageId(assistantId)

              // Wait for chunk to finish playing
              await new Promise<void>((resolve, reject) => {
                audio.onended = () => {
                  setAssistantSpeechState('idle')
                  setPlayingMessageId(null)
                  currentAudioRef.current = null
                  resolve()
                }
                audio.onerror = () => {
                  reject(new Error('Audio playback failed'))
                }
                audio.play().catch(reject)
              })

              // Add pause after chunk (unless it's the last one)
              if (!chunk.isLast && chunk.pauseAfterMs > 0) {
                console.log(`[Chunked Delivery] Pausing for ${chunk.pauseAfterMs}ms`)
                await new Promise(resolve => setTimeout(resolve, chunk.pauseAfterMs))
              }
            }

            // Mark as complete
            const finalizedMessages = messagesRef.current.map((entry) =>
              entry.id === assistantId ? { ...entry, status: 'complete' as const } : entry
            )

            messagesRef.current = finalizedMessages
            setMessages(finalizedMessages)
          } else {
            // Regular non-chunked TTS
            const audioUrl = await synthesizeSpeech(assistantText, prosody)

            const finalizedMessages = messagesRef.current.map((entry) =>
              entry.id === assistantId ? { ...entry, audioUrl, status: 'complete' as const } : entry
            )

            messagesRef.current = finalizedMessages
            setMessages(finalizedMessages)
          }

          setStatus(null)

          // Phase 1: Undo - Show undo button for 30 seconds
          setShowUndoButton(true)
          if (undoTimerRef.current) {
            window.clearTimeout(undoTimerRef.current)
          }
          undoTimerRef.current = window.setTimeout(() => {
            setShowUndoButton(false)
          }, 30000) // 30 seconds
        }

        // Start speculative generation if enabled
        if (ENABLE_SPECULATIVE_GEN) {
          const context: ConversationContext = {
            recentMessages: messagesRef.current.map(m => ({ role: m.role, text: m.text })),
            currentTopic: undefined // Could be enhanced with topic tracking
          }

          const prediction = speculativeGeneratorRef.current.predictUserInput(context)
          if (prediction) {
            console.log('[Speculative] Starting speculation based on prediction:', prediction)
            void speculativeGeneratorRef.current.startSpeculation(
              prediction.text,
              prediction.confidence,
              async (text, signal) => {
                if (signal.aborted) {
                  throw new DOMException('Aborted', 'AbortError')
                }
                // Use the existing request function with the speculative text
                const speculativeHistory = [
                  ...messagesRef.current,
                  { id: createId(), role: 'user' as const, text, status: 'complete' as const }
                ]
                return await requestChatCompletion(speculativeHistory)
              }
            )
          }
        }

        // ADAPT: Flow adaptation based on user style
        const previousUserMessages = messagesRef.current
          .filter(m => m.role === 'user')
          .map(m => m.text)
        const flowAdaptation = flowAdaptationRef.current.adapt(trimmed, previousUserMessages)
        console.log('[ADAPT] Flow adaptation:', {
          style: flowAdaptation.styleAdjustments,
          topicHandling: flowAdaptation.topicHandling,
          suggestedTone: flowAdaptation.suggestedTone
        })

        // PULL: Generate conversational steering cues
        const steeringCue = conversationalSteeringRef.current.generateCue(assistantText, trimmed)
        if (steeringCue) {
          console.log('[PULL] Steering cue generated:', steeringCue)
          setCurrentSteeringCue(steeringCue)
        }
      } catch (err) {
        console.error(err)

        // Clear filler timeout on error
        if (fillerTimeout) {
          window.clearTimeout(fillerTimeout)
        }

        // Stop any playing filler
        if (fillerManagerRef.current.isPlaying()) {
          fillerManagerRef.current.stopFiller()
        }
        fillerPlaybackRef.current = null

        // Handle AbortError gracefully (from barge-in)
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('[Barge-in] Request aborted by user')
          const pausedByBargeIn = pauseOnBargeInRef.current
          pauseOnBargeInRef.current = false

          if (pausedByBargeIn) {
            setStatus('Paused. Say "continue" to resume.')
          } else {
            setStatus('Interrupted. Listening...')
          }
          setError(null)

          // If we paused due to barge-in, preserve the partial assistant message for resume.
          // Otherwise, keep the existing behavior (drop pending messages).
          const recoveredMessages: ChatMessage[] = pausedByBargeIn
            ? messagesRef.current.map((entry) =>
                entry.status === 'pending' ? { ...entry, status: 'interrupted' as const } : entry
              )
            : messagesRef.current.filter((entry) => entry.status !== 'pending')
          messagesRef.current = recoveredMessages
          setMessages(recoveredMessages)
        } else {
          const message = err instanceof Error ? err.message : 'Unknown error'
          setError(message)
          setStatus(null)

          const recoveredMessages: ChatMessage[] = messagesRef.current.map((entry) =>
            entry.status === 'pending' ? { ...entry, status: 'error' as const } : entry
          )

          messagesRef.current = recoveredMessages
          setMessages(recoveredMessages)
        }
      } finally {
        setIsProcessing(false)
      }
    },
    [requestChatCompletion, requestChatCompletionStream, synthesizeSpeech, synthesizeSpeechStream]
  )

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isProcessing) {
      setError('Please wait for the current response to finish.')
      return
    }

    const trimmed = inputValue.trim()
    if (!trimmed) {
      return
    }

    setInputValue('')
    void sendMessageFlow(trimmed)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (!isProcessing) {
        const trimmed = inputValue.trim()
        if (trimmed) {
          setInputValue('')
          void sendMessageFlow(trimmed)
        }
      }
    }
  }

  const handleRecordedAudio = useCallback(
    async (blob: Blob, mime: string) => {
      console.log('[handleRecordedAudio] Called. isProcessingRef:', isProcessingRef.current)

      if (isProcessingRef.current) {
        pendingSegmentRef.current = { blob, mime }
        setStatus('Queued next segment...')
        return
      }

      const encoding = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'webm'

      isProcessingRef.current = true
      setIsProcessing(true)
      setStatus('Transcribing audio...')
      setError(null)

      console.log('[handleRecordedAudio] Set isProcessing=true')

      try {
        const t0 = performance.now()
        const transcript = await transcribeAudio(blob, encoding)
        const t1 = performance.now()
        console.log(`⏱️ [TIMING] STT took ${(t1 - t0).toFixed(0)}ms`)

        // Phase 1 (C3): Check for resume intent if assistant is paused
        const enableInterruptIntent = import.meta.env.VITE_ENABLE_INTERRUPT_INTENT === 'true'
        const enablePauseResume = import.meta.env.VITE_ENABLE_PAUSE_RESUME === 'true'

        const assistantSpeechStateNow = assistantSpeechStateRef.current

        if (enablePauseResume && assistantSpeechStateNow === 'paused') {
          if (detectResumeIntent(transcript)) {
            console.log('[INTENT] Resume intent detected')
            resumeAssistantSpeech()
            setIsProcessing(false)
            isProcessingRef.current = false
            return
          }
        }

        // Phase 1 (C3): Classify interruption if AI is speaking or paused
        if (enableInterruptIntent && assistantSpeechStateNow !== 'idle') {
          const currentTime = Date.now()
          const timeSinceLastInterruption = lastInterruptionTimeRef.current
            ? currentTime - lastInterruptionTimeRef.current
            : Infinity

          const context: InterruptionContext = {
            transcript,
            previousTranscript: lastInterruptionTranscriptRef.current,
            timeSinceLastInterruption,
            interruptionCount: interruptionCountRef.current,
            isAISpeaking: true
          }

          const interruptionResult = classifyInterruption(context)
          console.log('[INTENT] Interruption classified:', {
            type: interruptionResult.type,
            confidence: interruptionResult.confidence,
            reason: interruptionResult.reason
          })

          // Update interruption tracking
          lastInterruptionTranscriptRef.current = transcript
          lastInterruptionTimeRef.current = currentTime
          if (timeSinceLastInterruption < 10000) {
            interruptionCountRef.current++
          } else {
            interruptionCountRef.current = 1
          }

          // Route by interruption type
          if (interruptionResult.type === 'PAUSE') {
            console.log('[INTENT] Pause requested')
            pauseAssistantSpeech()
            setIsProcessing(false)
            isProcessingRef.current = false
            return
          }

          const stopAssistantPlayback = (reason: string) => {
            console.log('[INTENT] Stopping assistant:', reason)
            const activeMessageId = playingMessageIdRef.current ?? pausedAssistantMessageIdRef.current

            // Abort speech queue and in-flight requests
            if (speechQueueRef.current) {
              console.log('[SAY-STREAM] Aborting speech queue:', reason)
              speechQueueRef.current.abort()
            }
            if (chatAbortControllerRef.current) {
              console.log('[SAY-STREAM] Aborting chat stream:', reason)
              chatAbortControllerRef.current.abort()
              chatAbortControllerRef.current = null
            }
            if (ttsAbortControllerRef.current) {
              console.log('[SAY-STREAM] Aborting TTS:', reason)
              ttsAbortControllerRef.current.abort()
              ttsAbortControllerRef.current = null
            }

            // Stop assistant playback
            if (currentAudioRef.current) {
              currentAudioRef.current.pause()
              currentAudioRef.current = null
            }
	            if (pcmStreamPlayerRef.current) {
	              pcmStreamPlayerRef.current.stop()
	              const audioContext = pcmStreamPlayerRef.current.getAudioContext()
	              if (audioContext.state === 'suspended') {
	                audioContext.resume().catch((err) => {
	                  console.error('[INTENT] Failed to resume audio context after stop:', err)
	                })
	              }
	            }

            // Clear paused state if any
            pausedAssistantMessageIdRef.current = null
            pausedAssistantTextRef.current = ''
            pausedAtChunkIndexRef.current = 0
            pausedAudioPositionRef.current = 0

            assistantSpeechStateRef.current = 'idle'
            setAssistantSpeechState('idle')
            setPlayingMessageId(null)
            setAssistantGenerationState('idle')

            // Mark the interrupted assistant message (if present)
            if (activeMessageId) {
              const updatedMessages = messagesRef.current.map(m => {
                if (m.id === activeMessageId && m.role === 'assistant') {
                  return { ...m, status: 'interrupted' as const }
                }
                return m
              })
              setMessages(updatedMessages)
              messagesRef.current = updatedMessages
            }
          }

          if (interruptionResult.type === 'CORRECTION' || interruptionResult.type === 'TOPIC_SHIFT') {
            stopAssistantPlayback('correction/topic shift')
          } else if (interruptionResult.type === 'IMPATIENCE') {
            stopAssistantPlayback('impatience')
            // TODO: Integrate with verbosityController to reduce response length
          } else if (interruptionResult.type === 'BARGE_IN') {
            stopAssistantPlayback('barge-in')
          }
          // For other types, continue with normal flow
        }

        // Phase 3: Adaptive Learning - Provide feedback based on user interaction
        if (transcript && transcript.trim()) {
          const currentTime = Date.now()
          const timeSinceLastTranscript = lastTranscriptTimeRef.current
            ? currentTime - lastTranscriptTimeRef.current
            : 0

          // Detect interruption pattern (user re-prompted quickly)
          if (lastTranscriptRef.current && timeSinceLastTranscript < 2000) {
            const isInterruption = adaptiveLearningRef.current.detectInterruption(
              lastTranscriptRef.current,
              transcript,
              timeSinceLastTranscript
            )

            if (isInterruption) {
                  adaptiveLearningRef.current.updateFromFeedback({
                    type: 'interruption',
                    timestamp: currentTime,
                    context: {
                      threshold: userSilenceThresholdRef.current,
                      silenceDuration: timeSinceLastTranscript,
                      transcriptLength: transcript.length
                    }
                  })
                }
          }

          // Update last transcript for next comparison
          lastTranscriptRef.current = transcript
          lastTranscriptTimeRef.current = currentTime
        }

        // Try to use speculative response if enabled
        let usedSpeculativeResponse = false
        if (ENABLE_SPECULATIVE_GEN) {
          const speculativeResponse = await speculativeGeneratorRef.current.tryUseSpeculation(transcript)
          if (speculativeResponse) {
            console.log('[Speculative] Using speculative response! Latency saved.')
            usedSpeculativeResponse = true

            // Use the speculative response directly
            const userMessage: ChatMessage = {
              id: createId(),
              role: 'user',
              text: transcript,
              status: 'complete' as const,
            }
            const assistantMessage: ChatMessage = {
              id: createId(),
              role: 'assistant',
              text: speculativeResponse,
              status: 'complete' as const,
            }
            const updatedMessages = [...messagesRef.current, userMessage, assistantMessage]
            messagesRef.current = updatedMessages
            setMessages(updatedMessages)

            // Still need to generate TTS
            setStatus('Generating voice...')
            const messageType = detectMessageType(speculativeResponse)
            const prosody = selectProsody(messageType, speculativeResponse)
            const audioUrl = await synthesizeSpeech(speculativeResponse, prosody)

            const finalMessages = messagesRef.current.map((entry) =>
              entry.id === assistantMessage.id ? { ...entry, audioUrl } : entry
            )
            messagesRef.current = finalMessages
            setMessages(finalMessages)
            setStatus(null)
          }
        }

        // If no speculative response was used, do normal flow
        if (!usedSpeculativeResponse) {
          await sendMessageFlow(transcript)
        }

        const t2 = performance.now()
        console.log(`⏱️ [TIMING] Total flow (STT + Chat + TTS) took ${(t2 - t0).toFixed(0)}ms`)

        // Reset error recovery on successful interaction
        errorRecoveryRef.current.resetErrors()

        // Track A/B test conversions for successful turn
        if (abTestingRef.current) {
          abTestingRef.current.trackConversion('silence_threshold_v1')
          abTestingRef.current.trackCustomMetric('silence_threshold_v1', 'successful_turns', 1)
        }

        // Check if we should show feedback button
        const turnNumber = messagesRef.current.filter(m => m.role === 'user').length
        if (feedbackTimingRef.current.shouldAskFeedback(turnNumber)) {
          // Get the last assistant message
          const lastAssistantMessage = messagesRef.current
            .filter(m => m.role === 'assistant')
            .pop()
          if (lastAssistantMessage) {
            setFeedbackMessageIds(prev => new Set(prev).add(lastAssistantMessage.id))
            feedbackTimingRef.current.recordFeedbackAsked(turnNumber)
          }
        }

        // Reset processing flag after successful completion
        isProcessingRef.current = false
        setIsProcessing(false)
      } catch (err) {
        console.error(err)
        const message =
          err instanceof Error ? err.message : 'Failed to transcribe audio. Please try again.'

        // Integrate error recovery
        const errorContext: ErrorContext = {
          transcript: '',
          duration: voiceMsRef.current,
          consecutiveErrors: errorRecoveryRef.current.getStats().consecutiveErrors
        }

        if (typeof message === 'string' && message.toLowerCase().includes('empty result')) {
          // Phase 1 (C2): Log if this was a control utterance attempt
          const wasControlMode =
            (import.meta.env.VITE_ENABLE_INTERRUPT_INTENT === 'true') &&
            (assistantSpeechStateRef.current === 'speaking' || assistantSpeechStateRef.current === 'paused')
          if (wasControlMode) {
            console.log('[CONTROL] Empty STT result in control mode - treating as normal interruption')
          }

          // Classify as NO_MATCH error
          const errorType = errorRecoveryRef.current.classifyError(errorContext)
          const recoveryAction = errorRecoveryRef.current.getRecoveryAction(errorType)

          console.log('[Error Recovery]', {
            errorType: recoveryAction.errorType,
            message: recoveryAction.message,
            offerTyping: recoveryAction.offerTyping
          })

          // Show recovery message
          setStatus(recoveryAction.message)

          // If offering typing, keep the error displayed
          if (recoveryAction.offerTyping) {
            setError("Having trouble with voice? Try typing your message instead.")
          }
        } else {
          // Other errors
          setError(message)
          setStatus(null)
        }

        // Track A/B test errors
        if (abTestingRef.current) {
          abTestingRef.current.trackError('silence_threshold_v1')
        }

        isProcessingRef.current = false
        setIsProcessing(false)
      }
    },
    [sendMessageFlow, transcribeAudio, pauseAssistantSpeech, resumeAssistantSpeech]
    // Note: isProcessing removed from deps to prevent recorder reset during processing
  )

  const startRecording = useCallback(async () => {
    // Don't check isProcessing here - we want to keep recording even during processing
    // for full-duplex mode. The VAD will queue segments if needed.

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Microphone access is not supported in this browser.')
      return
    }

    try {
      // Enable echo cancellation, noise suppression, and auto gain control
      const enableFullDuplex = import.meta.env.VITE_ENABLE_FULL_DUPLEX === 'true' || false

      const constraints: MediaStreamConstraints = selectedMicId
        ? {
          audio: {
            deviceId: { exact: selectedMicId },
            echoCancellation: enableFullDuplex,
            noiseSuppression: enableFullDuplex,
            autoGainControl: enableFullDuplex
          }
        }
        : {
          audio: {
            echoCancellation: enableFullDuplex,
            noiseSuppression: enableFullDuplex,
            autoGainControl: enableFullDuplex
          }
        }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      segmentChunksRef.current = []
      headerChunkRef.current = null
      pcmChunksRef.current = []

      // Collect chunks only while a VAD segment is active
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          if (!headerChunkRef.current) {
            headerChunkRef.current = event.data
          }
          if (collectingRef.current) {
            segmentChunksRef.current.push(event.data)
          }
        }
      }

      recorder.onerror = (event) => {
        console.error('MediaRecorder error', event)
        setError('Recording failed. Please try again.')
        setStatus(null)
        resetRecorder()
      }

      recorder.onstop = () => { }

      recorder.start(250) // emit small chunks
      setIsRecording(true)
      setStatus('Listening...')

      // Setup a simple VAD using AnalyserNode RMS energy + capture raw PCM via ScriptProcessor
      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

      if (!AudioContextCtor) {
        throw new Error('AudioContext is not supported in this browser.')
      }

      const audioCtx = new AudioContextCtor()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0)
        if (collectingRef.current) {
          pcmChunksRef.current.push(new Float32Array(input))
        }
      }
      source.connect(processor)
      // Use zero-gain node to keep processor alive without routing mic to speakers
      const silentGain = audioCtx.createGain()
      silentGain.gain.value = 0
      processor.connect(silentGain)
      silentGain.connect(audioCtx.destination)
      audioContextRef.current = audioCtx
      analyserRef.current = analyser
      processorRef.current = processor
      sampleRateRef.current = audioCtx.sampleRate || 44100

      const data = new Float32Array(analyser.fftSize)
      const baseThresholdRms = 0.025
      const minVoiceMs = 150
      // Use user preference for silence threshold (Phase 1.2)
      const maxSilenceMs = userSilenceThreshold
      const interval = 50

      // Phase 1 (C2): Control utterance capture thresholds
      const enableControlCapture = import.meta.env.VITE_ENABLE_INTERRUPT_INTENT === 'true'
      const enablePauseResume = import.meta.env.VITE_ENABLE_PAUSE_RESUME === 'true'
      const minControlUtteranceMs = parseInt(import.meta.env.VITE_MIN_CONTROL_UTTERANCE_MS || '300')
      const minControlSilenceMs = parseInt(import.meta.env.VITE_MIN_CONTROL_SILENCE_MS || '200')

      vadTimerRef.current = window.setInterval(() => {
        if (!analyserRef.current) return
        analyserRef.current.getFloatTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
        const rms = Math.sqrt(sum / data.length)
        const isAssistantSpeaking = assistantSpeechStateRef.current === 'speaking'
        // Use dynamic threshold: raise it during AI playback to reduce false positives
        const thresholdRms = isAssistantSpeaking ? baseThresholdRms * 1.5 : baseThresholdRms
        const speaking = rms > thresholdRms

        // Phase 1 (C2): Determine if in control capture mode (used throughout VAD loop)
        const isControlCaptureMode =
          enableControlCapture &&
          (assistantSpeechStateRef.current === 'speaking' || assistantSpeechStateRef.current === 'paused')

        // Phase 3 (B2): Assistant backchannel scheduler
        const enableAssistantBackchannels =
          import.meta.env.VITE_ENABLE_ASSISTANT_BACKCHANNELS === 'true' &&
          assistantBackchannelsEnabledRef.current
        const minUserSpeechMs = parseInt(import.meta.env.VITE_ASSISTANT_BACKCHANNEL_MIN_USER_SPEECH_MS || '1800')
        const minIntervalMs = parseInt(import.meta.env.VITE_ASSISTANT_BACKCHANNEL_MIN_INTERVAL_MS || '8000')
        const backchannelVolume = parseFloat(import.meta.env.VITE_ASSISTANT_BACKCHANNEL_VOLUME || '0.20')

	        if (enableAssistantBackchannels &&
	            speaking &&
	            voiceMsRef.current >= minUserSpeechMs &&
	            silenceMsRef.current === 0 &&
	            assistantSpeechStateRef.current === 'idle' &&
	            !isProcessingRef.current &&
	            Date.now() - assistantBackchannelLastTimeRef.current >= minIntervalMs &&
	            Date.now() >= assistantBackchannelInhibitUntilRef.current) {

          console.log('[BACKCHANNEL-AI] Triggering assistant backchannel')

          // Play a simple acknowledgment backchannel
          const backchannelPhrases = ['mm-hmm', 'yeah', 'okay', 'right', 'I see']
          const randomPhrase = backchannelPhrases[Math.floor(Math.random() * backchannelPhrases.length)]

          // Use existing TTS synthesis for the backchannel
          const backchannelProsody: ProsodyProfile = {
            emotion: 'neutral',
            speed: 1.1,
            energy: 0.5
          }
          synthesizeSpeech(randomPhrase, backchannelProsody)
            .then((audioUrl) => {
              if (assistantBackchannelAudioRef.current) {
                assistantBackchannelAudioRef.current.pause()
              }

              const audio = new Audio(audioUrl)
              audio.volume = backchannelVolume
              assistantBackchannelAudioRef.current = audio

              audio.play().catch((err) => {
                console.error('[BACKCHANNEL-AI] Failed to play backchannel:', err)
              })

              audio.onended = () => {
                assistantBackchannelAudioRef.current = null
                // Set inhibit window after backchannel
                assistantBackchannelInhibitUntilRef.current = Date.now() + 500
              }

              assistantBackchannelLastTimeRef.current = Date.now()
            })
            .catch((err) => {
              console.error('[BACKCHANNEL-AI] Failed to synthesize backchannel:', err)
            })
        }

        // Update equalizer visualization
        const numBars = 5
        const barValues: number[] = []
        const chunkSize = Math.floor(data.length / numBars)
        for (let i = 0; i < numBars; i++) {
          let barSum = 0
          const start = i * chunkSize
          const end = start + chunkSize
          for (let j = start; j < end && j < data.length; j++) {
            barSum += data[j] * data[j]
          }
          const barRms = Math.sqrt(barSum / chunkSize)
          // Normalize to 0-1 range and amplify for better visualization
          const normalized = Math.min(1, (barRms / thresholdRms) * 2)
          barValues.push(normalized)
        }
        setAudioLevels(barValues)

        // Phase 1.3: Graduated audio ducking with 4 levels
        const enableDucking = import.meta.env.VITE_ENABLE_DUCKING === 'true' || false

        // Classify user audio to determine ducking level
        const classifyUserAudio = (
          duration: number,
          intensity: number,
          speaking: boolean
        ): 'NONE' | 'BACKCHANNEL' | 'TENTATIVE' | 'CLEAR' => {
          if (!speaking) return 'NONE'

          // Short, quiet sounds = backchannel ("mm-hmm")
          if (duration < 800 && intensity < 0.03) {
            return 'BACKCHANNEL'
          }

          // Low intensity but longer = tentative speech
          if (intensity < 0.04) {
            return 'TENTATIVE'
          }

          // Strong, sustained speech = clear interruption
          return 'CLEAR'
        }

        const getDuckVolume = (classification: string): number => {
          switch (classification) {
            case 'BACKCHANNEL': return 0.80  // Minimal ducking
            case 'TENTATIVE': return 0.50    // Moderate ducking
            case 'CLEAR': return 0.20        // Strong ducking
            default: return 1.0              // No ducking
          }
        }

        if (enableDucking && isAssistantSpeaking) {
          // Classify the current user audio
          const classification = classifyUserAudio(
            voiceMsRef.current,
            rms,
            speaking
          )

          const targetVolume = getDuckVolume(classification)

          // Smooth transition to target volume (300ms fade)
          const step = 0.05

          if (pcmStreamPlayerRef.current) {
            const currentVolume = pcmStreamPlayerRef.current.getVolume()
            if (Math.abs(currentVolume - targetVolume) > 0.01) {
              const newVolume = currentVolume < targetVolume
                ? Math.min(targetVolume, currentVolume + step)
                : Math.max(targetVolume, currentVolume - step)
              pcmStreamPlayerRef.current.setVolume(newVolume)
            }
          } else if (currentAudioRef.current) {
            const currentVolume = currentAudioRef.current.volume
            if (Math.abs(currentVolume - targetVolume) > 0.01) {
              const newVolume = currentVolume < targetVolume
                ? Math.min(targetVolume, currentVolume + step)
                : Math.max(targetVolume, currentVolume - step)
              currentAudioRef.current.volume = newVolume
            }
          }
        }

        // Phase 1.4: Barge-in with backchannel detection
        const enableBargeIn = import.meta.env.VITE_ENABLE_BARGE_IN === 'true' || false
        const bargeInThresholdMs = 300 // Require 300ms of sustained speech to trigger barge-in

        if (enableBargeIn && isAssistantSpeaking && speaking) {
          // Extract audio features for classification
          const audioFeatures = extractAudioFeatures(
            data,
            audioContextRef.current?.sampleRate || 44100,
            voiceMsRef.current
          )

          // Classify the audio (backchannel vs. interruption)
          const backchannelClassification = classifyBackchannel(audioFeatures, isAssistantSpeaking)

          console.log('[Audio Classification]', {
            type: backchannelClassification.type,
            confidence: backchannelClassification.confidence,
            features: audioFeatures,
            aiSpeaking: isAssistantSpeaking
          })

          // Only trigger barge-in for real interruptions, not backchannels
          if (backchannelClassification.type === 'INTERRUPTION' &&
            backchannelClassification.confidence > 0.7 &&
            voiceMsRef.current >= bargeInThresholdMs) {

            console.log('[Barge-in] User interrupted AI (not a backchannel)')

            const shouldPauseInsteadOfStop = enableControlCapture && enablePauseResume

            if (shouldPauseInsteadOfStop) {
              // Pause immediately to allow control utterances; intent routing happens after STT.
              // Do not abort chat/TTS here so resume can continue naturally.
              pauseAssistantSpeech()
            } else {
              // Abort in-flight requests
              if (speechQueueRef.current) {
                speechQueueRef.current.abort()
              }
              if (chatAbortControllerRef.current) {
                chatAbortControllerRef.current.abort()
                chatAbortControllerRef.current = null
              }
              if (ttsAbortControllerRef.current) {
                ttsAbortControllerRef.current.abort()
                ttsAbortControllerRef.current = null
              }

              // Stop audio playback
              if (currentAudioRef.current) {
                currentAudioRef.current.pause()
                currentAudioRef.current = null
              }

              // Stop streaming audio if using streaming TTS
              if (pcmStreamPlayerRef.current) {
                pcmStreamPlayerRef.current.stop()
              }

              assistantSpeechStateRef.current = 'idle'
              setAssistantSpeechState('idle')
              setPlayingMessageId(null)
              setStatus('Interrupted. Listening...')
            }
          } else if (backchannelClassification.type === 'BACKCHANNEL') {
            console.log('[Backchannel] Detected, not interrupting AI')
            // Don't interrupt, just acknowledge in logs
          }
        }

        if (speaking) {
          voiceMsRef.current += interval
          silenceMsRef.current = 0
        } else {
          silenceMsRef.current += interval
        }

        if (!collectingRef.current && voiceMsRef.current >= minVoiceMs) {
          collectingRef.current = true
          segmentChunksRef.current = []
          turnPredictionCheckedRef.current = false // Reset prediction check for new segment
          setStatus('Recording...')
        }

        // Phase 2: Turn-Taking Prediction
        // Check turn prediction after minimum silence but before maximum
        const enableTurnPrediction = import.meta.env.VITE_ENABLE_TURN_PREDICTION === 'true' || false
        const minSilenceMs = parseInt(import.meta.env.VITE_MIN_SILENCE_MS || '500')

        if (enableTurnPrediction &&
          collectingRef.current &&
          !turnPredictionCheckedRef.current &&
          silenceMsRef.current >= minSilenceMs &&
          silenceMsRef.current < maxSilenceMs &&
          pcmChunksRef.current.length > 0) {

          // Mark that we've checked prediction for this segment
          turnPredictionCheckedRef.current = true

          // Extract audio features from collected audio
          const merged = mergeFloat32([...pcmChunksRef.current])
          const audioFeatures = extractAudioFeatures(
            merged,
            sampleRateRef.current,
            voiceMsRef.current
          )

          // Call turn-prediction API
          void (async () => {
            try {
              const response = await fetch(`${API_BASE}/api/turn-prediction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  transcript: '', // No partial transcript available
                  audioFeatures: {
                    duration: audioFeatures.duration,
                    intensity: audioFeatures.intensity,
                    frequency: audioFeatures.frequency
                  },
                  silenceDuration: silenceMsRef.current,
                  fallbackThreshold: maxSilenceMs
                })
              })

              if (response.ok) {
                const decision = await response.json()

                console.log('[Turn Prediction]', {
                  takeTurn: decision.takeTurn,
                  confidence: decision.confidence,
                  silenceDuration: silenceMsRef.current,
                  threshold: decision.threshold
                })

                // If prediction says take turn with high confidence, process audio early
                const fusionThreshold = parseFloat(import.meta.env.VITE_FUSION_THRESHOLD || '0.7')
                if (decision.takeTurn && decision.confidence >= fusionThreshold && collectingRef.current) {
                  console.log('[Turn Prediction] Taking turn early based on prediction')

                  // Process the audio immediately
                  const segChunks = [...segmentChunksRef.current]
                  const pcmChunks = [...pcmChunksRef.current]
                  segmentChunksRef.current = []
                  pcmChunksRef.current = []
                  collectingRef.current = false
                  voiceMsRef.current = 0
                  silenceMsRef.current = 0

                  let approxMs = 0
                  if (pcmChunks.length > 0) {
                    const totalSamples = pcmChunks.reduce((s, c) => s + c.length, 0)
                    approxMs = (totalSamples / sampleRateRef.current) * 1000
                  } else {
                    approxMs = segChunks.length * 250
                  }

                  // Phase 1 (C2): Allow shorter segments for control utterances during AI speech
                  const minSegmentMs = isControlCaptureMode ? minControlUtteranceMs : 900

                  if (approxMs >= minSegmentMs) {
                    console.log('[VAD] Processing segment:', {
                      duration: approxMs,
                      isControlMode: isControlCaptureMode,
                      minRequired: minSegmentMs
                    })

                    let blob: Blob
                    if (pcmChunks.length > 0) {
                      const merged = mergeFloat32(pcmChunks)
                      const down = downsample(merged, sampleRateRef.current, 16000)
                      blob = encodeWavPCM16(down, 16000)
                    } else {
                      const parts = headerChunkRef.current ? [headerChunkRef.current, ...segChunks] : segChunks
                      blob = new Blob(parts, { type: mimeType })
                    }
                    if (isProcessingStateRef.current) {
                      pendingSegmentRef.current = { blob, mime: mimeType }
                      setStatus('Queued next segment...')
                    } else {
                      void handleRecordedAudio(blob, mimeType)
                    }
                  }
                }
              }
            } catch (err) {
              // Silently fail - will fall back to regular silence detection
              console.warn('[Turn Prediction] API call failed, falling back to silence detection:', err)
            }
          })()
        }

        // Phase 3: Intelligent Endpointing with Two-Pass Validation
        // Phase 1 (C2): Use shorter silence threshold for control mode
        const effectiveMinSilence = isControlCaptureMode ? Math.min(minSilenceMs, minControlSilenceMs) : minSilenceMs

        if (collectingRef.current && silenceMsRef.current >= effectiveMinSilence) {
          // Get current partial transcript if available (we don't have it in this implementation)
          // For now, we'll use empty string and rely on acoustic features
          const partialTranscript = ''

          // Calculate context-aware threshold (skip for control mode to allow quick endpointing)
          let effectiveThreshold: number
          let contextThreshold: number = 0
          let adaptiveThreshold: number = 0

          if (isControlCaptureMode) {
            effectiveThreshold = minControlSilenceMs
            console.log('[CONTROL] Using fast control mode threshold:', effectiveThreshold)
          } else {
            const turnNumber = messagesRef.current.filter(m => m.role === 'user').length + 1
            contextThreshold = contextAwareThresholdRef.current.calculateThreshold({
              turnNumber,
              transcriptLength: partialTranscript.length,
              userHistory: {
                interruptionRate: adaptiveLearningRef.current.getProfile().stats.interruptionRate,
                averageTurnLength: adaptiveLearningRef.current.getProfile().stats.averageTurnLength
              }
            })

            // Use adaptive learning threshold if available, otherwise use context-aware threshold
            adaptiveThreshold = adaptiveLearningRef.current.getOptimalThreshold()
            effectiveThreshold = Math.max(contextThreshold, adaptiveThreshold)
          }

          // Update two-pass endpointer with current threshold
          twoPassEndpointerRef.current.updateThreshold(effectiveThreshold)

          // Check if we've reached the effective threshold
          if (silenceMsRef.current >= effectiveThreshold) {
            // Perform two-pass endpointing validation
            const endpointDecision = twoPassEndpointerRef.current.process(
              silenceMsRef.current,
              partialTranscript
            )

            console.log('[Phase 3 Endpointing]', {
              silenceDuration: silenceMsRef.current,
              contextThreshold,
              adaptiveThreshold,
              effectiveThreshold,
              endpoint: endpointDecision.endpoint,
              confidence: endpointDecision.confidence,
              reason: endpointDecision.reason
            })

            // If endpoint decision says to extend threshold, wait longer
            if (!endpointDecision.endpoint && endpointDecision.extendThreshold) {
              // Don't process yet, wait for extended threshold
              const extendedThreshold = endpointDecision.extendThreshold
              if (silenceMsRef.current < extendedThreshold) {
                // Continue waiting
                return
              }
            }

            // Process the audio segment
            const segChunks = [...segmentChunksRef.current]
            const pcmChunks = [...pcmChunksRef.current]
            segmentChunksRef.current = []
            pcmChunksRef.current = []
            collectingRef.current = false
            voiceMsRef.current = 0
            // Note: silenceMsRef.current contains final silence duration if needed for future metrics
            silenceMsRef.current = 0

            let approxMs = 0
            if (pcmChunks.length > 0) {
              const totalSamples = pcmChunks.reduce((s, c) => s + c.length, 0)
              approxMs = (totalSamples / sampleRateRef.current) * 1000
            } else {
              approxMs = segChunks.length * 250
            }

            // Phase 1 (C2): Allow shorter segments for control utterances during AI speech
            const minSegmentMs = isControlCaptureMode ? minControlUtteranceMs : 900

            if (approxMs >= minSegmentMs) {
              console.log('[VAD] Processing segment:', {
                duration: approxMs,
                isControlMode: isControlCaptureMode,
                minRequired: minSegmentMs
              })

              // Prefer WAV PCM encoded from raw samples if available, else fallback to container chunks
              let blob: Blob
              if (pcmChunks.length > 0) {
                const merged = mergeFloat32(pcmChunks)
                const down = downsample(merged, sampleRateRef.current, 16000)
                blob = encodeWavPCM16(down, 16000)
              } else {
                const parts = headerChunkRef.current ? [headerChunkRef.current, ...segChunks] : segChunks
                blob = new Blob(parts, { type: mimeType })
              }

              // Track for adaptive learning (we'll update after we get the transcript)
              lastTranscriptTimeRef.current = Date.now()

              if (isProcessingStateRef.current) {
                pendingSegmentRef.current = { blob, mime: mimeType }
                setStatus('Queued next segment...')
              } else {
                void handleRecordedAudio(blob, mimeType)
              }
            } else {
              setStatus('Listening...')
            }
          }
        }

        if (!speaking && voiceMsRef.current > 0 && silenceMsRef.current > maxSilenceMs) {
          voiceMsRef.current = 0
        }
      }, interval)
      setError(null)
    } catch (err: unknown) {
      console.error(err)
      const errorName = err instanceof Error ? err.name : undefined
      if (errorName && (errorName === 'NotFoundError' || errorName === 'OverconstrainedError')) {
        setError('No matching microphone found. Select a different device and try again.')
        void refreshDevices()
      } else if (errorName && (errorName === 'NotAllowedError' || errorName === 'SecurityError')) {
        setError('Microphone permission denied. Allow access in the browser and OS settings.')
      } else {
        setError('Failed to access microphone. Please grant permission and try again.')
      }
      setStatus(null)
      resetRecorder()
    }
  }, [handleRecordedAudio, mimeType, resetRecorder, selectedMicId, refreshDevices, userSilenceThreshold, pauseAssistantSpeech, synthesizeSpeech])

  // Auto start/refresh when selection changes
  useEffect(() => {
    void (async () => {
      await startRecording()
    })()
    return () => {
      resetRecorder()
    }
  }, [startRecording])

  const clearConversation = () => {
    resetRecorder()
    messagesRef.current = []
    setMessages([])
    setError(null)
    setStatus(null)
    setInputValue('')
    setIsProcessing(false)
    textAreaRef.current?.focus()
    // Reset error recovery and feedback
    errorRecoveryRef.current.resetErrors()
    feedbackTimingRef.current.reset()
    setFeedbackMessageIds(new Set())
    // Reset PULL and ADAPT systems
    conversationalSteeringRef.current.reset()
    flowAdaptationRef.current.reset()
    setCurrentSteeringCue(null)
  }

  // Handler for feedback button
  const handleFeedback = useCallback(async (messageId: string, isPositive: boolean) => {
    try {
      const response = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          feedback: isPositive ? 'positive' : 'negative',
          timestamp: Date.now()
        })
      })

      if (!response.ok) {
        console.error('[Feedback] Failed to submit feedback')
      }

      // Record feedback given
        const turnNumber = messagesRef.current.filter(m => m.role === 'user').length
      feedbackTimingRef.current.recordFeedbackGiven(turnNumber)
    } catch (error) {
      console.error('[Feedback] Error submitting feedback:', error)
      throw error
    }
  }, [messages])

  // Handler for anticipation notification
  const handleAnticipationAccept = useCallback(() => {
    if (currentAnticipation) {
      console.log('[Anticipation] User accepted suggestion:', currentAnticipation.message)
      // Send the anticipated message
      void sendMessageFlow(currentAnticipation.message)
      setCurrentAnticipation(null)
    }
  }, [currentAnticipation, sendMessageFlow])

  const handleAnticipationDismiss = useCallback(() => {
    console.log('[Anticipation] User dismissed suggestion')
    setCurrentAnticipation(null)
  }, [])

  // Handler for confirmation dialog
  const handleConfirmationConfirm = useCallback(() => {
    if (pendingConfirmation) {
      console.log('[Confirmation] User confirmed critical action')
      setPendingConfirmation(null)
      // Continue with the original message flow that triggered confirmation
      // Get the last user message and process it
      const lastUserMessage = messagesRef.current.filter(m => m.role === 'user').pop()
      if (lastUserMessage) {
        void sendMessageFlow(lastUserMessage.text)
      }
    }
  }, [pendingConfirmation, sendMessageFlow])

  const handleConfirmationCancel = useCallback(() => {
    console.log('[Confirmation] User cancelled critical action')
    setPendingConfirmation(null)
    setIsProcessing(false)
    setStatus(null)
  }, [])

  // Handler for undo button
  const handleUndo = useCallback(() => {
    console.log('[Undo] User requested undo')
    const previousState = undoManagerRef.current.undo()
    if (previousState) {
      messagesRef.current = previousState.messages
      setMessages(previousState.messages)
      setShowUndoButton(false)
      if (undoTimerRef.current) {
        window.clearTimeout(undoTimerRef.current)
      }
    } else {
      console.log('[Undo] No previous state available')
    }
  }, [])

  // Handler for steering cue option selection
  const handleSteeringOptionSelect = useCallback((option: string) => {
    console.log('[PULL] User selected option:', option)
    // Use the selected option as user input
    void sendMessageFlow(option)
    setCurrentSteeringCue(null)
  }, [sendMessageFlow])

  // Handler for steering cue dismissal
  const handleSteeringDismiss = useCallback(() => {
    console.log('[PULL] User dismissed steering cue')
    setCurrentSteeringCue(null)
  }, [])

  return (
    <div className="app-container">
      <div className="chat-card">
        <header className="chat-header">
          <div>
            <h1>Girlfriend</h1>
            <p>
              Speak or type your message. Audio is transcribed with Cartesia STT, answered by
              OpenRouter, then voiced through Cartesia TTS.
            </p>
          </div>
          <button className="clear-button" onClick={clearConversation} disabled={!messages.length} style={{ display: 'none' }}>
            Clear
          </button>
        </header>

        <SettingsPanel
          onSilenceThresholdChange={setUserSilenceThreshold}
          onBackchannelsEnabledChange={setBackchannelsEnabled}
          onAssistantBackchannelsChange={setAssistantBackchannelsEnabled}
        />

        <section className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p>Record or type a message to begin the conversation.</p>
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={`message message-${message.role} ${playingMessageId === message.id ? 'message-playing' : ''
                  }`}
              >
                <div className="message-label">
                  {message.role === 'user' ? 'You' : 'Assistant'}
                  {playingMessageId === message.id && (
                    <span className="playing-indicator"> 🔊 Playing...</span>
                  )}
                </div>
                <p>{message.text}</p>
                {message.status === 'pending' && (
                  <div className="message-status">Generating speech...</div>
                )}
                {message.status === 'error' && (
                  <div className="message-status error">
                    Voice response failed. Try sending another message.
                  </div>
                )}
                {autoplayBlockedMessageId === message.id && message.audioUrl && (
                  <button
                    className="play-button"
                    onClick={() => handleManualPlay(message.id)}
                    style={{
                      marginTop: '8px',
                      padding: '8px 16px',
                      backgroundColor: '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    ▶️ Play Audio
                  </button>
                )}
                {/* Phase 1 (C4): Pause/Resume UI buttons */}
                {import.meta.env.VITE_ENABLE_PAUSE_RESUME === 'true' &&
                 playingMessageId === message.id &&
                 assistantSpeechState === 'speaking' && (
                  <button
                    className="pause-button"
                    onClick={pauseAssistantSpeech}
                    style={{
                      marginTop: '8px',
                      marginLeft: '8px',
                      padding: '8px 16px',
                      backgroundColor: '#FF9800',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    ⏸️ Pause
                  </button>
                )}
                {/* Render feedback button for assistant messages */}
                {message.role === 'assistant' &&
                 message.status === 'complete' &&
                 feedbackMessageIds.has(message.id) && (
                  <FeedbackButton
                    messageId={message.id}
                    onFeedback={handleFeedback}
                  />
                )}
              </article>
            ))
          )}
          <div ref={scrollAnchorRef} />
        </section>

        {/* Render AnticipationNotification */}
        {currentAnticipation && (
          <AnticipationNotification
            anticipation={currentAnticipation}
            onAccept={handleAnticipationAccept}
            onDismiss={handleAnticipationDismiss}
          />
        )}

        {/* Render ConfirmationDialog */}
        {pendingConfirmation && (
          <ConfirmationDialog
            criticalInfo={pendingConfirmation}
            onConfirm={handleConfirmationConfirm}
            onCancel={handleConfirmationCancel}
          />
        )}

        {/* Render UndoButton */}
        <UndoButton visible={showUndoButton} onUndo={handleUndo} />

        {/* Phase 1 (C4): Resume/Stop buttons when paused */}
        {import.meta.env.VITE_ENABLE_PAUSE_RESUME === 'true' && assistantSpeechState === 'paused' && (
          <div style={{
            position: 'fixed',
            bottom: '120px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            color: 'white',
            padding: '16px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            zIndex: 1000,
            display: 'flex',
            gap: '12px',
            alignItems: 'center'
          }}>
            <span>⏸️ Paused</span>
            <button
              onClick={resumeAssistantSpeech}
              style={{
                padding: '8px 16px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              ▶️ Resume
            </button>
	            <button
	              onClick={() => {
	                console.log('[PAUSE] Discarding paused speech')
	                // Abort speech queue and in-flight requests
	                if (speechQueueRef.current) {
	                  speechQueueRef.current.abort()
	                }
	                if (chatAbortControllerRef.current) {
	                  chatAbortControllerRef.current.abort()
	                  chatAbortControllerRef.current = null
	                }
	                if (ttsAbortControllerRef.current) {
	                  ttsAbortControllerRef.current.abort()
	                  ttsAbortControllerRef.current = null
	                }

	                // Stop any playing audio (assistant + backchannels)
	                if (assistantBackchannelAudioRef.current) {
	                  assistantBackchannelAudioRef.current.pause()
	                  assistantBackchannelAudioRef.current = null
	                }
	                if (currentAudioRef.current) {
	                  currentAudioRef.current.pause()
	                  currentAudioRef.current = null
	                }
	                if (pcmStreamPlayerRef.current) {
	                  pcmStreamPlayerRef.current.stop()
	                  const audioContext = pcmStreamPlayerRef.current.getAudioContext()
	                  if (audioContext.state === 'suspended') {
	                    audioContext.resume().catch((err) => {
	                      console.error('[PAUSE] Failed to resume audio context after discard:', err)
	                    })
	                  }
	                }

	                // Clear paused state
	                pausedAssistantMessageIdRef.current = null
	                pausedAssistantTextRef.current = ''
	                pausedAtChunkIndexRef.current = 0
	                pausedAudioPositionRef.current = 0

	                assistantSpeechStateRef.current = 'idle'
	                setAssistantSpeechState('idle')
	                setAssistantGenerationState('idle')
	                setPlayingMessageId(null)
	                setStatus(null)
	              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              ⏹️ Stop
            </button>
          </div>
        )}

        {/* Render Steering Cue (PULL principle) */}
        {currentSteeringCue && (
          <SteeringCue
            cue={currentSteeringCue}
            onOptionSelect={handleSteeringOptionSelect}
            onDismiss={handleSteeringDismiss}
            autoDismissMs={15000}
          />
        )}

        <footer className="composer">
          <form className="composer-form" onSubmit={handleFormSubmit}>
            {/* Listening controls at the top */}
            <div className="listener-controls">
              <div className={`listener-indicator ${isRecording ? 'on' : isPlaying ? 'playing' : 'off'}`}>
                <span className="indicator" />
                {isPlaying ? 'AI Speaking...' : isRecording ? 'Listening' : 'Mic off'}
              </div>

              {/* Audio Equalizer */}
              {isRecording && (
                <div className="audio-equalizer">
                  {audioLevels.map((level, index) => (
                    <div key={index} className="equalizer-bar">
                      <div
                        className="equalizer-bar-fill"
                        style={{ height: `${level * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <select
                className="mic-select"
                value={selectedMicId ?? ''}
                onChange={(e) => setSelectedMicId(e.target.value || null)}
              >
                {micDevices.length === 0 ? (
                  <option value="">No microphone found</option>
                ) : (
                  micDevices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Microphone ${i + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Input box and send button below */}
            <div className="input-row">
              <textarea
                ref={textAreaRef}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write your message here..."
                rows={3}
                disabled={isProcessing}
              />

              <button
                type="submit"
                className="send-button"
                disabled={isProcessing || !inputValue.trim()}
              >
                {isProcessing ? 'Working...' : 'Send'}
              </button>
            </div>
          </form>

          <div className="status">
            {status && <span>{status}</span>}
            {error && <span className="error">{error}</span>}
          </div>
        </footer>
      </div>
    </div>
  )
}

export default App
