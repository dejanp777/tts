/**
 * A/B Testing Framework
 *
 * Enables experimentation with different feature configurations
 * and tracks performance metrics for each variant.
 */

export interface Experiment {
    id: string
    name: string
    description: string
    variants: Variant[]
    startTime: number
    endTime?: number
    status: 'active' | 'paused' | 'completed'
    targetMetric: string
}

export interface Variant {
    id: string
    name: string
    weight: number // Percentage of traffic (0-100)
    config: Record<string, unknown>
}

export interface ExperimentMetrics {
    experimentId: string
    variantId: string
    impressions: number
    conversions: number
    conversionRate: number
    averageEngagementTime: number
    errorRate: number
    customMetrics: Record<string, number>
}

export interface UserAssignment {
    experimentId: string
    variantId: string
    assignedAt: number
}

const STORAGE_KEY = 'ab_testing_assignments'
const METRICS_KEY = 'ab_testing_metrics'

export class ABTestingFramework {
    private experiments: Map<string, Experiment> = new Map()
    private userAssignments: Map<string, UserAssignment> = new Map()
    private metrics: Map<string, ExperimentMetrics> = new Map()
    private userId: string

    constructor() {
        this.userId = this.getOrCreateUserId()
        this.loadState()
    }

    /**
     * Gets or creates a persistent user ID for consistent variant assignment
     */
    private getOrCreateUserId(): string {
        let userId = localStorage.getItem('ab_testing_user_id')
        if (!userId) {
            userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
            localStorage.setItem('ab_testing_user_id', userId)
        }
        return userId
    }

    /**
     * Loads state from localStorage
     */
    private loadState(): void {
        try {
            const assignments = localStorage.getItem(STORAGE_KEY)
            if (assignments) {
                const parsed = JSON.parse(assignments)
                this.userAssignments = new Map(Object.entries(parsed))
            }

            const metrics = localStorage.getItem(METRICS_KEY)
            if (metrics) {
                const parsed = JSON.parse(metrics)
                this.metrics = new Map(Object.entries(parsed))
            }
        } catch (error) {
            console.warn('[A/B Testing] Failed to load state:', error)
        }
    }

    /**
     * Saves state to localStorage
     */
    private saveState(): void {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(Object.fromEntries(this.userAssignments))
            )
            localStorage.setItem(
                METRICS_KEY,
                JSON.stringify(Object.fromEntries(this.metrics))
            )
        } catch (error) {
            console.warn('[A/B Testing] Failed to save state:', error)
        }
    }

    /**
     * Registers a new experiment
     */
    registerExperiment(experiment: Experiment): void {
        // Validate variant weights sum to 100
        const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0)
        if (Math.abs(totalWeight - 100) > 0.01) {
            console.warn('[A/B Testing] Variant weights should sum to 100, got:', totalWeight)
        }

        this.experiments.set(experiment.id, experiment)

        // Initialize metrics for each variant
        for (const variant of experiment.variants) {
            const metricsKey = `${experiment.id}_${variant.id}`
            if (!this.metrics.has(metricsKey)) {
                this.metrics.set(metricsKey, {
                    experimentId: experiment.id,
                    variantId: variant.id,
                    impressions: 0,
                    conversions: 0,
                    conversionRate: 0,
                    averageEngagementTime: 0,
                    errorRate: 0,
                    customMetrics: {}
                })
            }
        }

        console.log('[A/B Testing] Registered experiment:', experiment.name)
    }

    /**
     * Gets the variant for a user in an experiment
     * Uses deterministic assignment based on user ID hash
     */
    getVariant(experimentId: string): Variant | null {
        const experiment = this.experiments.get(experimentId)
        if (!experiment || experiment.status !== 'active') {
            return null
        }

        // Check if user is already assigned
        const existingAssignment = this.userAssignments.get(experimentId)
        if (existingAssignment) {
            const variant = experiment.variants.find(v => v.id === existingAssignment.variantId)
            if (variant) {
                this.trackImpression(experimentId, variant.id)
                return variant
            }
        }

        // Assign user to a variant deterministically
        const variant = this.assignVariant(experiment)
        if (variant) {
            this.userAssignments.set(experimentId, {
                experimentId,
                variantId: variant.id,
                assignedAt: Date.now()
            })
            this.saveState()
            this.trackImpression(experimentId, variant.id)
        }

        return variant
    }

    /**
     * Assigns a variant based on user ID hash and variant weights
     */
    private assignVariant(experiment: Experiment): Variant | null {
        // Simple hash of user ID
        let hash = 0
        for (let i = 0; i < this.userId.length; i++) {
            const char = this.userId.charCodeAt(i)
            hash = ((hash << 5) - hash) + char
            hash = hash & hash // Convert to 32-bit integer
        }
        const normalizedHash = Math.abs(hash % 100)

        // Find variant based on weight ranges
        let cumulative = 0
        for (const variant of experiment.variants) {
            cumulative += variant.weight
            if (normalizedHash < cumulative) {
                return variant
            }
        }

        // Fallback to first variant
        return experiment.variants[0] || null
    }

    /**
     * Tracks an impression for a variant
     */
    private trackImpression(experimentId: string, variantId: string): void {
        const metricsKey = `${experimentId}_${variantId}`
        const metrics = this.metrics.get(metricsKey)
        if (metrics) {
            metrics.impressions++
            this.saveState()
        }
    }

    /**
     * Tracks a conversion for the current variant
     */
    trackConversion(experimentId: string): void {
        const assignment = this.userAssignments.get(experimentId)
        if (!assignment) return

        const metricsKey = `${experimentId}_${assignment.variantId}`
        const metrics = this.metrics.get(metricsKey)
        if (metrics) {
            metrics.conversions++
            metrics.conversionRate = metrics.impressions > 0
                ? metrics.conversions / metrics.impressions
                : 0
            this.saveState()

            console.log('[A/B Testing] Conversion tracked:', {
                experiment: experimentId,
                variant: assignment.variantId,
                rate: metrics.conversionRate.toFixed(2)
            })
        }
    }

    /**
     * Tracks an error for the current variant
     */
    trackError(experimentId: string): void {
        const assignment = this.userAssignments.get(experimentId)
        if (!assignment) return

        const metricsKey = `${experimentId}_${assignment.variantId}`
        const metrics = this.metrics.get(metricsKey)
        if (metrics) {
            const totalEvents = metrics.impressions + (metrics.customMetrics['errors'] || 0)
            metrics.customMetrics['errors'] = (metrics.customMetrics['errors'] || 0) + 1
            metrics.errorRate = totalEvents > 0
                ? metrics.customMetrics['errors'] / totalEvents
                : 0
            this.saveState()
        }
    }

    /**
     * Tracks engagement time for the current variant
     */
    trackEngagementTime(experimentId: string, durationMs: number): void {
        const assignment = this.userAssignments.get(experimentId)
        if (!assignment) return

        const metricsKey = `${experimentId}_${assignment.variantId}`
        const metrics = this.metrics.get(metricsKey)
        if (metrics) {
            const totalSessions = metrics.customMetrics['sessions'] || 0
            const totalTime = metrics.averageEngagementTime * totalSessions

            metrics.customMetrics['sessions'] = totalSessions + 1
            metrics.averageEngagementTime = (totalTime + durationMs) / (totalSessions + 1)
            this.saveState()
        }
    }

    /**
     * Tracks a custom metric
     */
    trackCustomMetric(experimentId: string, metricName: string, value: number): void {
        const assignment = this.userAssignments.get(experimentId)
        if (!assignment) return

        const metricsKey = `${experimentId}_${assignment.variantId}`
        const metrics = this.metrics.get(metricsKey)
        if (metrics) {
            metrics.customMetrics[metricName] = (metrics.customMetrics[metricName] || 0) + value
            this.saveState()
        }
    }

    /**
     * Gets metrics for all variants in an experiment
     */
    getExperimentMetrics(experimentId: string): ExperimentMetrics[] {
        const experiment = this.experiments.get(experimentId)
        if (!experiment) return []

        return experiment.variants
            .map(v => this.metrics.get(`${experimentId}_${v.id}`))
            .filter((m): m is ExperimentMetrics => m !== undefined)
    }

    /**
     * Gets the winning variant based on conversion rate
     */
    getWinningVariant(experimentId: string): {
        variant: Variant | null
        confidence: number
        improvement: number
    } {
        const experiment = this.experiments.get(experimentId)
        const metricsArray = this.getExperimentMetrics(experimentId)

        if (!experiment || metricsArray.length === 0) {
            return { variant: null, confidence: 0, improvement: 0 }
        }

        // Sort by conversion rate
        metricsArray.sort((a, b) => b.conversionRate - a.conversionRate)

        const best = metricsArray[0]
        const baseline = metricsArray[metricsArray.length - 1]

        const improvement = baseline.conversionRate > 0
            ? ((best.conversionRate - baseline.conversionRate) / baseline.conversionRate) * 100
            : 0

        // Simple confidence calculation (would use proper statistical test in production)
        const totalSamples = best.impressions + baseline.impressions
        const confidence = Math.min(
            Math.sqrt(totalSamples / 100), // More samples = more confidence
            0.95 // Cap at 95%
        )

        const variant = experiment.variants.find(v => v.id === best.variantId) || null

        return { variant, confidence, improvement }
    }

    /**
     * Pauses an experiment
     */
    pauseExperiment(experimentId: string): void {
        const experiment = this.experiments.get(experimentId)
        if (experiment) {
            experiment.status = 'paused'
            console.log('[A/B Testing] Experiment paused:', experimentId)
        }
    }

    /**
     * Completes an experiment and optionally applies winning variant
     */
    completeExperiment(experimentId: string): {
        winner: Variant | null
        metrics: ExperimentMetrics[]
    } {
        const experiment = this.experiments.get(experimentId)
        if (!experiment) {
            return { winner: null, metrics: [] }
        }

        experiment.status = 'completed'
        experiment.endTime = Date.now()

        const { variant: winner } = this.getWinningVariant(experimentId)
        const metrics = this.getExperimentMetrics(experimentId)

        console.log('[A/B Testing] Experiment completed:', {
            id: experimentId,
            winner: winner?.name,
            metrics
        })

        return { winner, metrics }
    }

    /**
     * Gets all active experiments
     */
    getActiveExperiments(): Experiment[] {
        return Array.from(this.experiments.values())
            .filter(e => e.status === 'active')
    }

    /**
     * Exports experiment data for analysis
     */
    exportData(): {
        experiments: Experiment[]
        metrics: ExperimentMetrics[]
        assignments: UserAssignment[]
    } {
        return {
            experiments: Array.from(this.experiments.values()),
            metrics: Array.from(this.metrics.values()),
            assignments: Array.from(this.userAssignments.values())
        }
    }

    /**
     * Clears all experiment data
     */
    reset(): void {
        this.experiments.clear()
        this.userAssignments.clear()
        this.metrics.clear()
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(METRICS_KEY)
        console.log('[A/B Testing] Reset all data')
    }
}

// Pre-defined experiments for the voice chat app
export const EXPERIMENTS = {
    SILENCE_THRESHOLD: {
        id: 'silence_threshold_v1',
        name: 'Optimal Silence Threshold',
        description: 'Tests different silence thresholds for turn detection',
        variants: [
            { id: 'control', name: 'Default (1500ms)', weight: 50, config: { threshold: 1500 } },
            { id: 'shorter', name: 'Shorter (1000ms)', weight: 25, config: { threshold: 1000 } },
            { id: 'longer', name: 'Longer (2000ms)', weight: 25, config: { threshold: 2000 } }
        ],
        startTime: Date.now(),
        status: 'active' as const,
        targetMetric: 'successful_turns'
    },

    TTS_STREAMING: {
        id: 'tts_streaming_v1',
        name: 'TTS Streaming Mode',
        description: 'Tests streaming vs non-streaming TTS',
        variants: [
            { id: 'control', name: 'Non-streaming', weight: 50, config: { streaming: false } },
            { id: 'streaming', name: 'Streaming', weight: 50, config: { streaming: true } }
        ],
        startTime: Date.now(),
        status: 'active' as const,
        targetMetric: 'perceived_latency'
    },

    THINKING_FILLERS: {
        id: 'thinking_fillers_v1',
        name: 'Thinking Filler Strategy',
        description: 'Tests different thinking filler strategies',
        variants: [
            { id: 'none', name: 'No fillers', weight: 33, config: { enabled: false } },
            { id: 'immediate', name: 'Immediate (1s)', weight: 33, config: { enabled: true, delay: 1000 } },
            { id: 'delayed', name: 'Delayed (2s)', weight: 34, config: { enabled: true, delay: 2000 } }
        ],
        startTime: Date.now(),
        status: 'active' as const,
        targetMetric: 'user_satisfaction'
    }
}
