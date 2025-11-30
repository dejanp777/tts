/**
 * TurnGPT Integration - Simplified Implementation
 *
 * This is a heuristic-based implementation that can be upgraded to the full
 * TurnGPT model when ML infrastructure is available.
 *
 * Full Model Info:
 * - Repository: https://github.com/ErikEkstedt/TurnGPT
 * - Model: GPT-2 architecture trained on 385K conversations
 * - Input: Tokenized transcript with speaker labels
 * - Output: TRP (Transition Relevance Place) probability per word
 * - License: MIT-style (academic/research use)
 *
 * To integrate the full model:
 * 1. Install Python dependencies: torch, transformers
 * 2. Download pretrained model weights (~500MB)
 * 3. Set up Python microservice or use node-python bridge
 * 4. Replace predictTRP() with actual model inference
 */

class TurnGPT {
  constructor() {
    this.enabled = process.env.ENABLE_TURNGPT === 'true';
    this.threshold = parseFloat(process.env.TURNGPT_THRESHOLD) || 0.7;
    this.initialized = false;

    console.log('[TurnGPT] Initialized (heuristic mode)');
  }

  /**
   * Predicts Transition Relevance Place (TRP) probability for a transcript
   *
   * @param {string} transcript - The text to analyze
   * @param {string} speaker - Current speaker ('user' or 'assistant')
   * @returns {number} TRP score (0.0-1.0)
   */
  predictTRP(transcript, speaker = 'user') {
    if (!this.enabled) {
      return 0.5; // Neutral score when disabled
    }

    // Heuristic-based TRP estimation
    // These patterns are based on conversation analysis research

    const text = transcript.trim().toLowerCase();
    const words = text.split(/\s+/);
    const wordCount = words.length;

    let trpScore = 0.0;

    // Factor 1: Syntactic completeness (40% weight)
    const syntacticScore = this._analyzeSyntacticCompleteness(text, words);
    trpScore += syntacticScore * 0.4;

    // Factor 2: Pragmatic completeness (30% weight)
    const pragmaticScore = this._analyzePragmaticCompleteness(text);
    trpScore += pragmaticScore * 0.3;

    // Factor 3: Utterance length (20% weight)
    const lengthScore = this._analyzeLengthPatterns(wordCount);
    trpScore += lengthScore * 0.2;

    // Factor 4: Question patterns (10% weight)
    const questionScore = this._analyzeQuestionPatterns(text);
    trpScore += questionScore * 0.1;

    console.log('[TurnGPT] TRP:', {
      transcript: transcript.substring(0, 50) + '...',
      syntactic: syntacticScore.toFixed(2),
      pragmatic: pragmaticScore.toFixed(2),
      length: lengthScore.toFixed(2),
      question: questionScore.toFixed(2),
      finalTRP: trpScore.toFixed(2)
    });

    return trpScore;
  }

  _analyzeSyntacticCompleteness(text, words) {
    // Check for incomplete sentence patterns
    const incompletePatterns = [
      /\.\.\.$/, // Trailing ellipsis
      /\b(to|at|in|from|with|and|or|but)\s*$/i, // Trailing preposition/conjunction
      /^(so|and|but|however|because)\s+\w+\s*$/i, // Short incomplete clause
      /,\s*$/  // Trailing comma
    ];

    for (const pattern of incompletePatterns) {
      if (pattern.test(text)) {
        return 0.2; // Very incomplete
      }
    }

    // Check for complete sentence markers
    const completePatterns = [
      /[.!?]$/, // Sentence ending punctuation
      /\b(done|finished|complete|that's all|okay)\s*$/i, // Explicit completion
    ];

    for (const pattern of completePatterns) {
      if (pattern.test(text)) {
        return 0.9; // Very complete
      }
    }

    // If longer than 5 words and no clear incompleteness, likely complete
    if (words.length >= 5) {
      return 0.7;
    }

    return 0.5; // Neutral
  }

  _analyzePragmaticCompleteness(text) {
    // Check if the utterance performs a complete speech act

    // Questions expecting answers
    if (/^(who|what|when|where|why|how|which|whose|whom)\b/i.test(text)) {
      if (text.includes('?')) {
        return 0.95; // Complete question
      }
      return 0.6; // Question word without punctuation
    }

    // Statements making claims
    if (/^(I think|I believe|It seems|It appears|In my opinion)\b/i.test(text)) {
      return 0.8; // Opinion statement likely complete
    }

    // Commands/requests
    if (/^(please|could you|can you|would you|let's)\b/i.test(text)) {
      return 0.85; // Directive likely complete
    }

    // Acknowledgments (very short, complete)
    if (/^(yes|no|okay|sure|right|exactly|definitely|absolutely)$/i.test(text)) {
      return 0.95;
    }

    return 0.6; // Default moderate completeness
  }

  _analyzeLengthPatterns(wordCount) {
    // Research shows turn length patterns:
    // - Very short (1-2 words): Often backchannel or incomplete
    // - Short (3-10 words): Usually complete
    // - Medium (11-25 words): Typically complete
    // - Long (26+ words): May continue or be complete

    if (wordCount <= 2) {
      return 0.4; // Likely backchannel
    } else if (wordCount <= 10) {
      return 0.8; // Typical complete turn
    } else if (wordCount <= 25) {
      return 0.75; // Slightly less likely to be ending
    } else {
      return 0.6; // Long turns may continue
    }
  }

  _analyzeQuestionPatterns(text) {
    // Questions typically signal turn completion

    // Yes/no questions
    if (/^(do|does|did|is|are|was|were|can|could|will|would|should|may|might)\b/i.test(text)) {
      if (text.includes('?')) {
        return 0.9;
      }
      return 0.7;
    }

    // Wh-questions
    if (/\b(who|what|when|where|why|how)\b.*\?/i.test(text)) {
      return 0.9;
    }

    // Tag questions
    if (/(isn't it|don't you|right|correct)\?$/i.test(text)) {
      return 0.95;
    }

    return 0.5; // Not a question
  }

  /**
   * Determines if turn should be taken based on TRP score
   *
   * @param {number} trpScore - TRP score from predictTRP()
   * @returns {boolean} Whether to take the turn
   */
  shouldTakeTurn(trpScore) {
    return trpScore >= this.threshold;
  }
}

module.exports = TurnGPT;
