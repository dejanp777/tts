export interface ProsodyProfile {
  emotion: string
  speed?: number
  energy?: number
  pitch?: number
}

export const EMOTION_PROFILES: Record<string, ProsodyProfile> = {
  greeting: {
    emotion: 'friendly',
    energy: 0.9,
    speed: 1.0
  },
  error: {
    emotion: 'apologetic',
    energy: 0.6,
    speed: 0.95
  },
  excited: {
    emotion: 'enthusiastic',
    energy: 0.95,
    speed: 1.1
  },
  thoughtful: {
    emotion: 'calm',
    energy: 0.6,
    speed: 0.9
  },
  curious: {
    emotion: 'curious',
    energy: 0.8,
    speed: 1.0
  },
  frustrated: {
    emotion: 'frustrated',
    energy: 0.7,
    speed: 1.0
  },
  empathetic: {
    emotion: 'empathetic',
    energy: 0.65,
    speed: 0.95
  },
  default: {
    emotion: 'frustrated', // Match current persona
    energy: 0.7,
    speed: 1.0
  }
}

export type MessageType =
  | 'greeting'
  | 'error'
  | 'question'
  | 'exclamation'
  | 'apology'
  | 'default'

export const detectMessageType = (content: string): MessageType => {
  const lower = content.toLowerCase()

  // Greetings
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)/.test(lower)) {
    return 'greeting'
  }

  // Errors/apologies
  if (/sorry|apolog|my bad|oops|my mistake/.test(lower)) {
    return 'apology'
  }

  // Questions
  if (content.includes('?')) {
    return 'question'
  }

  // Exclamations
  if (content.includes('!')) {
    return 'exclamation'
  }

  return 'default'
}

export const selectProsody = (
  messageType: MessageType,
  content: string
): ProsodyProfile => {
  switch (messageType) {
    case 'greeting':
      return EMOTION_PROFILES.greeting

    case 'error':
    case 'apology':
      return EMOTION_PROFILES.error

    case 'question':
      return EMOTION_PROFILES.curious

    case 'exclamation':
      return EMOTION_PROFILES.excited

    default:
      // Context-aware defaults
      if (content.length > 100) {
        return EMOTION_PROFILES.thoughtful
      }
      return EMOTION_PROFILES.default
  }
}
