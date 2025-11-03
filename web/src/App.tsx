import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import './App.css'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  status?: 'pending' | 'complete' | 'error'
  audioUrl?: string
}

// Use relative URL for API calls so it works on both desktop and mobile
// The Cloudflare tunnel proxies both frontend and backend on the same domain
const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || ''

// Feature flags
const ENABLE_TTS_STREAM = import.meta.env.VITE_ENABLE_TTS_STREAM === 'true' || false

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
      } catch (e) {
        // Ignore if already stopped
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
  // Log API configuration on mount
  useEffect(() => {
    console.log('[CONFIG] API_BASE:', API_BASE || '(relative URLs)')
    console.log('[CONFIG] Current origin:', window.location.origin)
  }, [])

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false) // Track if AI is speaking
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null) // Track which message is playing
  const [audioLevels, setAudioLevels] = useState<number[]>([0, 0, 0, 0, 0]) // Audio equalizer bars
  const [autoplayBlockedMessageId, setAutoplayBlockedMessageId] = useState<string | null>(null) // Track message that needs manual play

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
  const headerChunkRef = useRef<Blob | null>(null)
  const pcmChunksRef = useRef<Float32Array[]>([])
  const sampleRateRef = useRef<number>(44100)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const chatAbortControllerRef = useRef<AbortController | null>(null)
  const ttsAbortControllerRef = useRef<AbortController | null>(null)
  const isProcessingRef = useRef<boolean>(false) // Ref to avoid dependency issues

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
      let s = Math.max(-1, Math.min(1, samples[i]))
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
    } catch {}
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

    setIsPlaying(true)
    setPlayingMessageId(latestSpokenMessage.id)
    setAutoplayBlockedMessageId(null) // Clear any previous autoplay block

    audio.onended = () => {
      setIsPlaying(false)
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

            recorder.onstop = () => {}
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
        setIsPlaying(false)
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

              recorder.onstop = () => {}
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

    setIsPlaying(true)
    setPlayingMessageId(messageId)
    setAutoplayBlockedMessageId(null)
    setError(null)

    audio.onended = () => {
      setIsPlaying(false)
      setPlayingMessageId(null)
      currentAudioRef.current = null
    }

    audio.play().catch((err) => {
      console.error('Manual play failed', err)
      setError('Failed to play audio')
      setIsPlaying(false)
      setPlayingMessageId(null)
      currentAudioRef.current = null
    })
  }, [messages])

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

  const requestChatCompletion = useCallback(async (history: ChatMessage[]) => {
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
      body: JSON.stringify({ messages: payload }),
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

  const synthesizeSpeech = useCallback(async (text: string) => {
    const url = `${API_BASE}/api/tts`
    console.log('[API] Requesting TTS:', url)

    // Create abort controller for this request
    const controller = new AbortController()
    ttsAbortControllerRef.current = controller

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
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

  const synthesizeSpeechStream = useCallback(async (
    text: string,
    onChunk: (pcmData: Float32Array) => void,
    signal?: AbortSignal
  ) => {
    const url = `${API_BASE}/api/tts/stream`
    console.log('[API] Requesting streaming TTS:', url, 'text length:', text.length)

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
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

      const conversationWithUser: ChatMessage[] = [...messagesRef.current, userMessage]
      messagesRef.current = conversationWithUser
      setMessages(conversationWithUser)

      setStatus('Thinking...')

      try {
        const enableChatStream = import.meta.env.VITE_ENABLE_CHAT_STREAM === 'true' || false
        let assistantText = ''
        const assistantId = createId()

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
          })

          const chatEndTime = performance.now()
          console.log(`⏱️ [TIMING] Chat complete took ${(chatEndTime - chatStartTime).toFixed(0)}ms`)

          // Update with final text
          assistantMessage.text = assistantText
          messagesRef.current = [...conversationWithUser, assistantMessage]
          setMessages([...conversationWithUser, assistantMessage])
        } else {
          // Use non-streaming chat
          assistantText = await requestChatCompletion(conversationWithUser)
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
        }

        setStatus('Generating voice...')

        if (ENABLE_TTS_STREAM) {
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
          setIsPlaying(true)
          setPlayingMessageId(assistantId)

          player.onEnded(() => {
            setIsPlaying(false)
            setPlayingMessageId(null)
          })

          // Create abort controller for streaming TTS
          const ttsController = new AbortController()
          ttsAbortControllerRef.current = ttsController

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
            ttsController.signal
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
          // Use non-streaming TTS (original behavior)
          const audioUrl = await synthesizeSpeech(assistantText)

          const finalizedMessages = messagesRef.current.map((entry) =>
            entry.id === assistantId ? { ...entry, audioUrl, status: 'complete' as const } : entry
          )

          messagesRef.current = finalizedMessages
          setMessages(finalizedMessages)
          setStatus(null)
        }
      } catch (err) {
        console.error(err)

        // Handle AbortError gracefully (from barge-in)
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('[Barge-in] Request aborted by user')
          setStatus('Interrupted. Listening...')
          setError(null)

          // Remove pending messages
          const recoveredMessages: ChatMessage[] = messagesRef.current.filter((entry) =>
            entry.status !== 'pending'
          )
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
      console.log('[handleRecordedAudio] Called. isProcessing:', isProcessingRef.current, 'isRecording:', isRecording)

      if (isProcessingRef.current) {
        setError('Wait for the current response to finish before recording again.')
        return
      }

      const encoding = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'webm'

      isProcessingRef.current = true
      setIsProcessing(true)
      setStatus('Transcribing audio...')
      setError(null)

      console.log('[handleRecordedAudio] Set isProcessing=true, isRecording is still:', isRecording)

      try {
        const t0 = performance.now()
        const transcript = await transcribeAudio(blob, encoding)
        const t1 = performance.now()
        console.log(`⏱️ [TIMING] STT took ${(t1 - t0).toFixed(0)}ms`)

        await sendMessageFlow(transcript)
        const t2 = performance.now()
        console.log(`⏱️ [TIMING] Total flow (STT + Chat + TTS) took ${(t2 - t0).toFixed(0)}ms`)

        // Reset processing flag after successful completion
        isProcessingRef.current = false
        setIsProcessing(false)
      } catch (err) {
        console.error(err)
        const message =
          err instanceof Error ? err.message : 'Failed to transcribe audio. Please try again.'
        if (typeof message === 'string' && message.toLowerCase().includes('empty result')) {
          // Skip showing an error for silent/empty segments
          setStatus('No speech detected; waiting...')
        } else {
          setError(message)
          setStatus(null)
        }
        isProcessingRef.current = false
        setIsProcessing(false)
      }
    },
    [sendMessageFlow, transcribeAudio]
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

      recorder.onstop = () => {}

      recorder.start(250) // emit small chunks
      setIsRecording(true)
      setStatus('Listening...')

      // Setup a simple VAD using AnalyserNode RMS energy + capture raw PCM via ScriptProcessor
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
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
      const maxSilenceMs = import.meta.env.VITE_MAX_SILENCE_MS
        ? parseInt(import.meta.env.VITE_MAX_SILENCE_MS)
        : 800 // Reduced from 2300ms to 800ms for faster turn completion
      const interval = 50

      vadTimerRef.current = window.setInterval(() => {
        if (!analyserRef.current) return
        analyserRef.current.getFloatTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
        const rms = Math.sqrt(sum / data.length)
        // Use dynamic threshold: raise it during AI playback to reduce false positives
        const thresholdRms = isPlaying ? baseThresholdRms * 1.5 : baseThresholdRms
        const speaking = rms > thresholdRms

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

        // Volume ducking: reduce AI audio volume when user is speaking
        const enableDucking = import.meta.env.VITE_ENABLE_DUCKING === 'true' || false
        const duckVolume = import.meta.env.VITE_DUCK_VOLUME
          ? parseFloat(import.meta.env.VITE_DUCK_VOLUME)
          : 0.15

        if (enableDucking && isPlaying) {
          // Duck volume for either HTMLAudio or PCMStreamPlayer
          if (pcmStreamPlayerRef.current) {
            // Streaming TTS path - use gain node
            if (speaking) {
              const currentVolume = pcmStreamPlayerRef.current.getVolume()
              if (currentVolume > duckVolume) {
                pcmStreamPlayerRef.current.setVolume(Math.max(duckVolume, currentVolume - 0.05))
              }
            } else {
              const currentVolume = pcmStreamPlayerRef.current.getVolume()
              if (currentVolume < 1.0) {
                pcmStreamPlayerRef.current.setVolume(Math.min(1.0, currentVolume + 0.05))
              }
            }
          } else if (currentAudioRef.current) {
            // Non-streaming TTS path - use HTMLAudio volume
            if (speaking) {
              const currentVolume = currentAudioRef.current.volume
              if (currentVolume > duckVolume) {
                currentAudioRef.current.volume = Math.max(duckVolume, currentVolume - 0.05)
              }
            } else {
              const currentVolume = currentAudioRef.current.volume
              if (currentVolume < 1.0) {
                currentAudioRef.current.volume = Math.min(1.0, currentVolume + 0.05)
              }
            }
          }
        }

        // Barge-in: interrupt AI when user speaks over it
        const enableBargeIn = import.meta.env.VITE_ENABLE_BARGE_IN === 'true' || false
        const bargeInThresholdMs = 300 // Require 300ms of sustained speech to trigger barge-in

        if (enableBargeIn && isPlaying && speaking && voiceMsRef.current >= bargeInThresholdMs) {
          console.log('[Barge-in] User interrupted AI')

          // Abort in-flight requests
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

          setIsPlaying(false)
          setPlayingMessageId(null)
          setStatus('Interrupted. Listening...')
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
          setStatus('Recording...')
        }

        if (collectingRef.current && silenceMsRef.current >= maxSilenceMs) {
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
          if (approxMs >= 900) {
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
            if (isProcessing) {
              pendingSegmentRef.current = { blob, mime: mimeType }
              setStatus('Queued next segment...')
            } else {
              void handleRecordedAudio(blob, mimeType)
            }
          } else {
            setStatus('Listening...')
          }
        }

        if (!speaking && voiceMsRef.current > 0 && silenceMsRef.current > maxSilenceMs) {
          voiceMsRef.current = 0
        }
      }, interval)
      setError(null)
    } catch (err: any) {
      console.error(err)
      if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) {
        setError('No matching microphone found. Select a different device and try again.')
        void refreshDevices()
      } else if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setError('Microphone permission denied. Allow access in the browser and OS settings.')
      } else {
        setError('Failed to access microphone. Please grant permission and try again.')
      }
      setStatus(null)
      resetRecorder()
    }
  }, [handleRecordedAudio, mimeType, resetRecorder, selectedMicId, refreshDevices])

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
  }

  return (
    <div className="app-container">
      <div className="chat-card">
        <header className="chat-header">
          <div>
            <h1>Angry Secretary</h1>
            <p>
              Speak or type your message. Audio is transcribed with Cartesia STT, answered by
              OpenRouter, then voiced through Cartesia TTS.
            </p>
          </div>
          <button className="clear-button" onClick={clearConversation} disabled={!messages.length}>
            Clear
          </button>
        </header>

        <section className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p>Record or type a message to begin the conversation.</p>
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={`message message-${message.role} ${
                  playingMessageId === message.id ? 'message-playing' : ''
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
              </article>
            ))
          )}
          <div ref={scrollAnchorRef} />
        </section>

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
