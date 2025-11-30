/**
 * Adaptive Learning System
 *
 * Learns optimal per-user settings through implicit and explicit feedback.
 * Stores user profiles in localStorage for privacy-friendly personalization.
 *
 * Based on contextual multi-armed bandit approach (Amazon research).
 */

export interface UserProfile {
  userId: string
  optimalThreshold: number
  learningRate: number
  observations: number
  stats: {
    averageTurnLength: number
    interruptionCount: number
    totalTurns: number
    interruptionRate: number
    averageSilenceDuration: number
    successfulTurns: number
  }
  lastUpdated: number
}

export interface FeedbackSignal {
  type: 'interruption' | 'long_wait' | 'perfect' | 'explicit'
  timestamp: number
  context: {
    threshold: number
    silenceDuration: number
    transcriptLength?: number
    wasCorrect?: boolean  // For explicit feedback
  }
}

export class AdaptiveLearningSystem {
  private storageKey = 'voice-ai-user-profiles'
  private currentUserId: string
  private defaultThreshold: number
  private minThreshold: number
  private maxThreshold: number

  constructor(userId: string = 'default', defaultThreshold: number = 1500) {
    this.currentUserId = userId
    this.defaultThreshold = defaultThreshold
    this.minThreshold = 500    // 0.5 seconds
    this.maxThreshold = 3000   // 3.0 seconds
  }

  /**
   * Gets or creates user profile
   *
   * @returns User profile
   */
  getProfile(): UserProfile {
    const profiles = this.loadProfiles()

    if (profiles[this.currentUserId]) {
      return profiles[this.currentUserId]
    }

    // Create new profile
    const newProfile: UserProfile = {
      userId: this.currentUserId,
      optimalThreshold: this.defaultThreshold,
      learningRate: 0.1,  // Start with 10% adjustment rate
      observations: 0,
      stats: {
        averageTurnLength: 0,
        interruptionCount: 0,
        totalTurns: 0,
        interruptionRate: 0,
        averageSilenceDuration: 0,
        successfulTurns: 0
      },
      lastUpdated: Date.now()
    }

    this.saveProfile(newProfile)
    return newProfile
  }

  /**
   * Updates profile based on feedback signal
   *
   * @param signal - Feedback signal from user interaction
   */
  updateFromFeedback(signal: FeedbackSignal): void {
    const profile = this.getProfile()
    profile.observations++
    profile.stats.totalTurns++

    // Reduce learning rate over time (exploration → exploitation)
    if (profile.observations > 10) {
      profile.learningRate = Math.max(0.02, profile.learningRate * 0.98)
    }

    let adjustment = 0

    switch (signal.type) {
      case 'interruption':
        // User re-prompted immediately = threshold was too short
        profile.stats.interruptionCount++
        adjustment = profile.learningRate * 200  // Increase by ~200ms * learning rate
        console.log('[Adaptive] Interruption detected, increasing threshold')
        break

      case 'long_wait':
        // User waited awkwardly long in silence = threshold too long
        adjustment = -profile.learningRate * 100  // Decrease by ~100ms * learning rate
        console.log('[Adaptive] Long wait detected, decreasing threshold')
        break

      case 'perfect':
        // Good turn-taking, slight reinforcement
        profile.stats.successfulTurns++
        // No adjustment, just track success
        console.log('[Adaptive] Perfect turn, no adjustment needed')
        break

      case 'explicit':
        // User explicitly adjusted threshold via slider
        if (signal.context.wasCorrect !== undefined) {
          if (signal.context.wasCorrect) {
            profile.stats.successfulTurns++
          } else {
            profile.stats.interruptionCount++
          }
        }
        break
    }

    // Apply adjustment with bounds
    const newThreshold = profile.optimalThreshold + adjustment
    profile.optimalThreshold = this.clampThreshold(newThreshold)

    // Update statistics
    profile.stats.interruptionRate =
      profile.stats.interruptionCount / profile.stats.totalTurns
    profile.stats.averageSilenceDuration =
      this.updateRunningAverage(
        profile.stats.averageSilenceDuration,
        signal.context.silenceDuration,
        profile.stats.totalTurns
      )

    if (signal.context.transcriptLength) {
      profile.stats.averageTurnLength =
        this.updateRunningAverage(
          profile.stats.averageTurnLength,
          signal.context.transcriptLength,
          profile.stats.totalTurns
        )
    }

    profile.lastUpdated = Date.now()

    this.saveProfile(profile)

    console.log('[Adaptive] Profile updated:', {
      threshold: Math.round(profile.optimalThreshold),
      learningRate: profile.learningRate.toFixed(3),
      observations: profile.observations,
      interruptionRate: (profile.stats.interruptionRate * 100).toFixed(1) + '%',
      adjustment: adjustment.toFixed(0)
    })
  }

  /**
   * Detects interruption pattern
   *
   * Checks if user re-prompted immediately, indicating they were cut off
   *
   * @param previousTranscript - Previous user input
   * @param currentTranscript - Current user input
   * @param timeBetween - Time between inputs (ms)
   * @returns Whether an interruption was detected
   */
  detectInterruption(
    previousTranscript: string,
    currentTranscript: string,
    timeBetween: number
  ): boolean {
    // Quick re-prompt within 2 seconds
    if (timeBetween > 2000) return false

    // Check for:
    // 1. Same content repeated
    // 2. Continuation words ("and", "also", "wait")
    // 3. Frustration indicators ("no", "I said", "listen")

    const prev = previousTranscript.toLowerCase()
    const curr = currentTranscript.toLowerCase()

    // Same content repeated
    if (prev === curr) return true

    // Continuation indicators
    const continuationPatterns = [
      /^(and|also|plus|furthermore|moreover|wait|hold on)/i,
      /^(no|not|i said|i meant|listen|hear me)/i
    ]

    for (const pattern of continuationPatterns) {
      if (pattern.test(curr)) return true
    }

    // Very similar content (Levenshtein-like check)
    const similarity = this.calculateSimilarity(prev, curr)
    if (similarity > 0.7) return true

    return false
  }

  /**
   * Detects long awkward wait
   *
   * @param silenceDuration - Duration of silence (ms)
   * @param threshold - Current threshold (ms)
   * @returns Whether wait was too long
   */
  detectLongWait(silenceDuration: number, threshold: number): boolean {
    // If silence was >2x the threshold, it was too long
    return silenceDuration > threshold * 2.0
  }

  /**
   * Gets optimal threshold for current user
   *
   * @returns Optimal threshold in milliseconds
   */
  getOptimalThreshold(): number {
    const profile = this.getProfile()
    return profile.optimalThreshold
  }

  /**
   * Exports user profile for backup/transfer
   *
   * @returns User profile as JSON string
   */
  exportProfile(): string {
    const profile = this.getProfile()
    return JSON.stringify(profile, null, 2)
  }

  /**
   * Imports user profile from backup
   *
   * @param profileJson - JSON string of profile
   */
  importProfile(profileJson: string): void {
    try {
      const profile: UserProfile = JSON.parse(profileJson)
      this.saveProfile(profile)
      console.log('[Adaptive] Profile imported successfully')
    } catch (err) {
      console.error('[Adaptive] Failed to import profile:', err)
    }
  }

  /**
   * Resets user profile to defaults
   */
  resetProfile(): void {
    const profiles = this.loadProfiles()
    delete profiles[this.currentUserId]
    this.saveProfiles(profiles)
    console.log('[Adaptive] Profile reset to defaults')
  }

  // Private helper methods

  private loadProfiles(): Record<string, UserProfile> {
    try {
      const stored = localStorage.getItem(this.storageKey)
      return stored ? JSON.parse(stored) : {}
    } catch (err) {
      console.error('[Adaptive] Failed to load profiles:', err)
      return {}
    }
  }

  private saveProfiles(profiles: Record<string, UserProfile>): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(profiles))
    } catch (err) {
      console.error('[Adaptive] Failed to save profiles:', err)
    }
  }

  private saveProfile(profile: UserProfile): void {
    const profiles = this.loadProfiles()
    profiles[profile.userId] = profile
    this.saveProfiles(profiles)
  }

  private clampThreshold(threshold: number): number {
    return Math.max(this.minThreshold, Math.min(this.maxThreshold, threshold))
  }

  private updateRunningAverage(
    currentAvg: number,
    newValue: number,
    count: number
  ): number {
    return (currentAvg * (count - 1) + newValue) / count
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Simple word overlap similarity
    const words1 = new Set(str1.toLowerCase().split(/\s+/))
    const words2 = new Set(str2.toLowerCase().split(/\s+/))

    let overlap = 0
    for (const word of words1) {
      if (words2.has(word)) overlap++
    }

    const union = words1.size + words2.size - overlap
    return overlap / (union || 1)
  }
}
