/**
 * Fusion Logic for TurnGPT + VAP
 *
 * Combines text-based (TurnGPT) and audio-based (VAP) predictions
 * to make optimal turn-taking decisions.
 *
 * Research shows that combining both modalities significantly improves
 * turn-taking accuracy compared to using either alone.
 *
 * Reference: "Combining VAP and TurnGPT for Improved Turn-taking" (2025)
 */

const TurnGPT = require('./turngpt');
const VAP = require('./vap');

class TurnTakingFusion {
  constructor() {
    this.turnGPT = new TurnGPT();
    this.vap = new VAP();

    // Fusion weights (can be tuned based on performance)
    this.textWeight = parseFloat(process.env.FUSION_TEXT_WEIGHT) || 0.6; // 60% TurnGPT
    this.audioWeight = 1.0 - this.textWeight; // 40% VAP

    // Decision threshold
    this.threshold = parseFloat(process.env.FUSION_THRESHOLD) || 0.7;

    console.log('[Fusion] Initialized', {
      textWeight: this.textWeight,
      audioWeight: this.audioWeight,
      threshold: this.threshold
    });
  }

  /**
   * Makes turn-taking decision by fusing TurnGPT and VAP predictions
   *
   * @param {string} transcript - User's current transcript
   * @param {object} audioFeatures - Audio features for VAP
   * @param {number} silenceDuration - Current silence duration (ms)
   * @returns {object} Decision and confidence scores
   */
  decideTurn(transcript, audioFeatures, silenceDuration) {
    // Get TurnGPT prediction (text-based)
    const trpScore = this.turnGPT.predictTRP(transcript);

    // Get VAP prediction (audio-based)
    const vapPrediction = this.vap.predictVAP({
      ...audioFeatures,
      silenceDuration
    });

    // Fuse predictions using weighted average
    const fusedScore = (trpScore * this.textWeight) +
                       (vapPrediction.shift * this.audioWeight);

    // Make decision
    const shouldTakeTurn = fusedScore >= this.threshold;

    // Calculate confidence based on agreement
    const agreement = Math.abs(trpScore - vapPrediction.shift);
    const confidence = 1.0 - (agreement * 0.5); // Low agreement = low confidence

    const decision = {
      takeTurn: shouldTakeTurn,
      fusedScore,
      confidence,
      breakdown: {
        trp: trpScore,
        vapShift: vapPrediction.shift,
        vapHold: vapPrediction.hold,
        textWeight: this.textWeight,
        audioWeight: this.audioWeight
      },
      method: 'fusion'
    };

    console.log('[Fusion] Decision:', {
      transcript: transcript.substring(0, 50) + '...',
      silenceDuration,
      trp: trpScore.toFixed(2),
      vapShift: vapPrediction.shift.toFixed(2),
      fusedScore: fusedScore.toFixed(2),
      confidence: confidence.toFixed(2),
      decision: shouldTakeTurn ? 'TAKE_TURN' : 'WAIT'
    });

    return decision;
  }

  /**
   * Fallback decision using simple threshold (when ML not available)
   *
   * @param {number} silenceDuration - Current silence duration (ms)
   * @param {number} threshold - Silence threshold (ms)
   * @returns {object} Decision
   */
  decideTurnSimple(silenceDuration, threshold) {
    const shouldTakeTurn = silenceDuration >= threshold;

    return {
      takeTurn: shouldTakeTurn,
      fusedScore: silenceDuration / threshold,
      confidence: 0.5, // Lower confidence for simple method
      breakdown: {
        silenceDuration,
        threshold
      },
      method: 'simple_threshold'
    };
  }

  /**
   * Adaptive decision that uses fusion when available, falls back to simple
   *
   * @param {object} context - Context for decision making
   * @returns {object} Decision
   */
  decide(context) {
    const {
      transcript,
      audioFeatures,
      silenceDuration,
      fallbackThreshold
    } = context;

    // Use fusion if we have both transcript and audio features
    if (transcript && audioFeatures) {
      return this.decideTurn(transcript, audioFeatures, silenceDuration);
    }

    // Fallback to simple threshold
    return this.decideTurnSimple(silenceDuration, fallbackThreshold);
  }

  /**
   * Updates fusion weights based on performance feedback
   * (Can be used for online learning)
   *
   * @param {boolean} wasCorrect - Was the decision correct?
   * @param {object} decision - The decision that was made
   */
  updateWeights(wasCorrect, decision) {
    if (!wasCorrect && decision.method === 'fusion') {
      // Simple online learning: adjust weights if prediction was wrong
      const { trp, vapShift } = decision.breakdown;

      // If TurnGPT was more wrong, reduce its weight slightly
      if (Math.abs(trp - 0.5) > Math.abs(vapShift - 0.5)) {
        this.textWeight = Math.max(0.3, this.textWeight - 0.05);
      } else {
        this.textWeight = Math.min(0.8, this.textWeight + 0.05);
      }

      this.audioWeight = 1.0 - this.textWeight;

      console.log('[Fusion] Updated weights:', {
        textWeight: this.textWeight.toFixed(2),
        audioWeight: this.audioWeight.toFixed(2)
      });
    }
  }
}

module.exports = TurnTakingFusion;
