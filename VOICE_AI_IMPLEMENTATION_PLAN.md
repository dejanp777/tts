# Voice AI Implementation Plan
**Based on:** natural-voice-ai-complete-guide.md
**Current App:** Angry Secretary Voice Chat
**Date:** 2025-11-30

---

## Executive Summary

### Current State Analysis
Your app already has several advanced features:
- ✅ **Full-duplex audio** (simultaneous listening/speaking)
- ✅ **Barge-in capability** (interrupt AI on user speech)
- ✅ **Audio ducking** (reduce AI volume when user speaks)
- ✅ **Streaming TTS and Chat** (low-latency responses)
- ✅ **VAD with silence detection** (800ms threshold)
- ✅ **Cartesia TTS with emotion** (frustrated persona)

### Critical Problems Identified
1. **❌ 800ms silence threshold is TOO SHORT** - Danger zone according to research
2. **❌ No intelligent turn-taking** - Fixed threshold causes premature interruptions
3. **❌ No backchannel detection** - "mm-hmm" treated as full interruption
4. **❌ No thinking fillers** - Silent LLM delays feel awkward
5. **❌ Binary audio ducking** - Lacks graduated response
6. **❌ Limited prosody control** - Not using full emotional range

### The Core Insight
> "Naturalness requires far more than full-duplex—it's **distinguishing 'thinking' pauses from 'done' pauses**"

Users simultaneously want:
- **Longer endpointing** (don't interrupt my thinking)
- **Faster responses** (reply quickly when I'm done)

**Resolution:** Intelligent prediction (VAP + TurnGPT) replaces fixed thresholds

---

## Key Recommendations from Guide

### 1. Turn-Taking Intelligence
**Problem:** Fixed 800ms threshold interrupts natural pauses (1-2 seconds for thinking)

**Solution:** Two complementary models working together:

#### VAP (Voice Activity Projection)
- **Type:** Audio-based neural model
- **Input:** Raw audio waveforms (prosody, pitch, intensity)
- **Output:** Predicts next 2 seconds of conversation (Hold/Shift/Silence/Overlap)
- **License:** Apache 2.0 (Open Source)
- **GitHub:** https://github.com/ErikEkstedt/VAP
- **Latency:** ~50ms per prediction
- **Trained on:** 10K hours of human-human dialogues

**What VAP detects:**
- Rising pitch → continuation likely
- Falling pitch → completion likely
- Final lengthening → turn-yielding cue
- Intensity patterns → holding vs. yielding turn

#### TurnGPT
- **Type:** Text-based language model (GPT-2 architecture)
- **Input:** Transcribed words with speaker labels
- **Output:** TRP (Transition Relevance Place) probability per word
- **License:** MIT-style (Open Source)
- **GitHub:** https://github.com/ErikEkstedt/TurnGPT
- **Latency:** ~10-20ms per word
- **Trained on:** 385K conversations

**What TurnGPT detects:**
- Syntactic completeness (full sentence vs. fragment)
- Pragmatic completeness (thought finished vs. continuing)
- Context-aware patterns (questions, answers, etc.)

#### Combined Power
**2025 Research Results:** VAP+TurnGPT together:
- ✅ Significantly fewer interruptions
- ✅ Shorter response delays
- ✅ More natural conversation flow
- ✅ Solves the "impossible" paradox of patience + speed

**Example:**
```javascript
// Ambiguous pause
User: "I need to book a flight..." [pause 1.2s, rising pitch]

TurnGPT: "flight..." → TRP: 0.45 (incomplete)
VAP: Rising pitch, mid-intensity → HOLD (75%)
Combined: DON'T INTERRUPT ✅

// Clear completion
User: "to Seattle." [pause 1.0s, falling pitch]

TurnGPT: "Seattle." → TRP: 0.85 (complete)
VAP: Falling pitch, lengthening → SHIFT (80%)
Combined: TAKE TURN NOW ✅
```

### 2. Backchannel Handling

#### User Backchannels (Detection)
**Problem:** "mm-hmm" during AI speech treated as full interruption

**Characteristics:**
- Duration < 1 second (typically 0.3-0.6s)
- Low intensity (quieter than normal speech)
- During AI speech (not at pause boundaries)
- Specific phonetic patterns (mm, uh-huh, yeah)

**Solution:** Classify and ignore during AI playback
```javascript
if (aiIsSpeaking &&
    duration < 1.0 &&
    intensity < avgIntensity * 0.6 &&
    isBackchannelPhoneme(phonemes)) {
  return 'BACKCHANNEL'; // Don't interrupt AI
}
```

#### AI Backchannels (Generation)
**Problem:** Long LLM delays feel awkward (>1.5s)

**Solution:** Play thinking fillers
- "Hmm..." (considering)
- "Let me see..." (retrieving)
- "Okay..." (acknowledging)

**Frequency:** Max 1-2 per response cycle
**User Control:** Make opt-in with preference toggle

### 3. Adaptive Endpointing

**Current:** Fixed 800ms threshold for all users

**Problem:** Different users need different pause times:
- Language learners: 3-4 seconds
- ADHD/processing differences: 2-3 seconds
- Native speakers: 0.5-1 second
- Complex topics: 1-2 seconds

**Solutions:**

#### Immediate: User Control
Add slider: 0.5-3.0 seconds (default 1.5s)

#### Two-Pass Verification
```
Audio → First Pass (fast acoustic) → Candidate endpoint
                                            ↓
                          Second Pass (semantic validator)
                                            ↓
                    Confirmed OR continue listening
```

#### Context-Aware Thresholds
Adjust based on:
- Question vs. statement (questions shorter)
- Sentence complexity (longer for complex)
- Speaking rate (longer for slow speakers)
- Turn number (more patient early on)
- Background noise (longer with noise)

#### Adaptive Learning
- Track interrupted turns (user re-prompts)
- Detect awkward silences (too long wait)
- Adjust per-user threshold automatically
- Store in local storage (privacy-friendly)

### 4. Prosody & Emotional Authenticity

**Research Finding:** Users prefer "warmer" voices over technically faster ones

**Current Cartesia Usage:**
```javascript
emotion: 'frustrated' // You're already using this!
```

**Expansion Needed:**
```javascript
const emotionProfiles = {
  greeting: { emotion: 'friendly', energy: 0.9 },
  error: { emotion: 'apologetic', energy: 0.6 },
  excited: { emotion: 'enthusiastic', energy: 0.95 },
  thoughtful: { emotion: 'calm', energy: 0.6 },
  default: { emotion: 'frustrated', energy: 0.7 } // Current
};

function selectProsody(messageType, content) {
  if (messageType === 'greeting') return emotionProfiles.greeting;
  if (messageType === 'error') return emotionProfiles.error;
  if (content.includes('!')) return emotionProfiles.excited;
  if (content.includes('?')) return { emotion: 'curious', energy: 0.8 };
  return emotionProfiles.default;
}
```

**Test by reading aloud:** All responses should sound natural when spoken

### 5. Advanced Interruption Handling

**Beyond simple barge-in** - Different interruption types need different responses:

#### Type 1: Pause Interruptions
**User:** "wait", "hold on", "one second"
**AI should:** Pause (not abort), maintain state, resume on "continue"

#### Type 2: Topic Shift
**User:** "Actually, what about Rome instead?"
**AI should:** Abort, acknowledge shift, address new topic

#### Type 3: Correction
**User:** "No, Austin! Not Boston."
**AI should:** Stop immediately, apologize, confirm correction

#### Type 4: Impatience
**Pattern:** Repeated interruptions (2+ times)
**AI should:** Switch to concise mode, reduce verbosity

**Implementation:**
```javascript
function classifyInterruption(userInput, context) {
  if (/^(wait|hold on)/.test(input))
    return 'PAUSE';
  if (/^(no|not|i said)/.test(input))
    return 'CORRECTION';
  if (/^(actually|what about)/.test(input))
    return 'TOPIC_SHIFT';
  if (context.recentInterruptionCount > 2)
    return 'IMPATIENCE';
}
```

### 6. Graduated Audio Ducking

**Current:** Binary on/off
**Better:** Graduated levels based on confidence

```javascript
const duckLevels = {
  BACKCHANNEL: 0.80,    // 80% volume (minor)
  TENTATIVE: 0.50,      // 50% volume (uncertain)
  CLEAR_SPEECH: 0.20,   // 20% volume (definite)
  INTERRUPTION: 0.00    // Pause completely
};
```

**Smooth transitions:** 300ms fade instead of instant changes

---

## Implementation Roadmap

### **PHASE 1: IMMEDIATE IMPROVEMENTS** (1-2 weeks)
**Impact:** 30-40% reduction in "interrupts me" complaints

#### Week 1 Tasks
1. **Increase silence threshold** ⚡ CRITICAL
   - Change `VITE_MAX_SILENCE_MS` from 800 to 1500
   - Location: `web/src/App.tsx:1146`
   - Test and monitor user feedback
   - **Effort:** 5 minutes
   - **Impact:** HIGH - Immediate relief from premature interruptions

2. **Add user control slider**
   - UI: "Response Timing: [Faster ◀──●─────▶ Slower]"
   - Range: 500-3000ms, default 1500ms
   - Persist to localStorage per user
   - **Effort:** 2-3 hours
   - **Impact:** HIGH - User empowerment

3. **Implement graduated audio ducking**
   - Replace binary volume with levels (80%, 50%, 20%, 0%)
   - Smooth 300ms transitions
   - Location: `web/src/App.tsx:1179-1214`
   - **Effort:** 1-2 hours
   - **Impact:** MEDIUM - Smoother experience

#### Week 2 Tasks
4. **Add backchannel detection**
   - Classify: duration < 0.8s + low intensity = backchannel
   - Don't treat as full interruption during AI speech
   - Location: Add to VAD logic around line 1150
   - **Effort:** 3-4 hours
   - **Impact:** HIGH - Stop false interruptions

5. **Implement AI thinking fillers**
   - Generate "hmm", "let me see", "okay" with Cartesia
   - Play after 1.5s LLM delay
   - Add user preference toggle
   - Frequency: Max 1 per 2-3 exchanges
   - **Effort:** 4-5 hours
   - **Impact:** MEDIUM - Fill awkward silences

6. **Expand emotional prosody**
   - Map message types to emotion profiles
   - Use Cartesia's emotion parameter more dynamically
   - Test warmth vs. robotic perception
   - Location: `server/index.js:548` and `web/src/App.tsx:624`
   - **Effort:** 3-4 hours
   - **Impact:** MEDIUM-HIGH - Better personality

---

### **PHASE 2: ADVANCED TURN-TAKING** (1-2 months)
**Impact:** 50-60% improvement in natural turn-taking

#### Month 1: TurnGPT Integration
**Week 1:**
- [ ] Install TurnGPT from GitHub
- [ ] Load pre-trained model (server-side)
- [ ] Test on sample conversations
- **Effort:** 6-8 hours

**Week 2:**
- [ ] Hook into ASR transcript stream
- [ ] Calculate TRP per word
- [ ] Log predictions alongside current behavior
- **Effort:** 8-10 hours

**Week 3:**
- [ ] Start with high-confidence predictions (TRP > 0.8)
- [ ] Fallback to silence threshold for ambiguous
- [ ] A/B test: TurnGPT vs. fixed threshold
- **Effort:** 8-10 hours

**Week 4:**
- [ ] Tune decision thresholds
- [ ] Handle edge cases
- [ ] Monitor false positives/negatives
- **Effort:** 6-8 hours

#### Month 2: VAP Integration
**Week 1:**
- [ ] Install VAP from GitHub
- [ ] Test audio processing pipeline
- [ ] Benchmark latency (<50ms target)
- **Effort:** 8-10 hours

**Week 2:**
- [ ] Extract stereo/multi-channel audio
- [ ] Feed to VAP in real-time (50ms updates)
- [ ] Log predictions
- **Effort:** 10-12 hours

**Week 3:**
- [ ] Combine VAP + TurnGPT predictions
- [ ] Implement weighted averaging (60% text, 40% audio)
- [ ] Test agreement/disagreement cases
- **Effort:** 8-10 hours

**Week 4:**
- [ ] Full rollout with monitoring
- [ ] Collect user feedback
- [ ] Iterate on fusion weights
- **Effort:** 6-8 hours

---

### **PHASE 3: ADAPTIVE PERSONALIZATION** (2-3 months)
**Impact:** 70-80% user satisfaction with timing

#### Month 1: Two-Pass Endpointing
- [ ] Implement first-pass detector (fast acoustic)
- [ ] Add semantic validator (check transcript completeness)
- [ ] Deploy arbitrator logic (combine both)
- **Effort:** 15-20 hours

#### Month 2: Context-Aware Adjustments
- [ ] Build context analyzer (track patterns)
- [ ] Dynamic threshold calculation
- [ ] Monitor per-user patterns
- **Effort:** 15-20 hours

#### Month 3: Adaptive Learning
- [ ] Detect interrupted turns (re-prompts, frustration)
- [ ] User profile system (localStorage)
- [ ] Feedback signals (explicit + implicit)
- **Effort:** 20-25 hours

---

### **PHASE 4: NATIVE SPEECH PROCESSING** (3-6 months)
**Impact:** "Warm" and "human-like" feedback

**Note:** This is a major architectural change - evaluate after Phase 3

Options:
1. **OpenAI GPT-4o** - Native speech processing, 320ms response
2. **Moshi** - Open source, 160ms latency, full-duplex
3. **ProsodyLM** - Paired text-prosody tokenization
4. **Stay with current pipeline** - Maximize Cartesia emotion controls

**Decision criteria:**
- Cost (API pricing vs. current)
- Latency improvements
- User perception of warmth
- Infrastructure complexity

---

## Technical Implementation Details

### 1. File Modifications Required

#### `web/src/App.tsx`
**Lines to modify:**
- **1146:** `maxSilenceMs` - Increase from 800 to 1500
- **1144-1149:** VAD parameters - Make configurable with user slider
- **1179-1214:** Audio ducking - Add graduated levels
- **1150-1300:** VAD logic - Add backchannel detection
- **624-654:** TTS calls - Add dynamic emotion selection
- **867-943:** Message flow - Add thinking filler logic

#### `server/index.js`
**Lines to modify:**
- **413-513:** TTS endpoints - Add prosody parameter mapping
- **548-552:** Generation config - Expand emotion controls
- **New routes:** `/api/turn-prediction` for TurnGPT/VAP

#### New files needed:
- `server/turn-taking/turngpt.js` - TurnGPT integration
- `server/turn-taking/vap.js` - VAP integration
- `server/turn-taking/fusion.js` - Combine predictions
- `web/src/components/SettingsPanel.tsx` - User controls
- `web/src/utils/backchannels.ts` - Backchannel detection
- `web/src/utils/interruption-classifier.ts` - Interruption types

### 2. Environment Variables to Add

```bash
# Phase 1
VITE_MAX_SILENCE_MS=1500  # Up from 800
VITE_MIN_SILENCE_MS=500   # New: minimum threshold
VITE_ENABLE_BACKCHANNELS=true
VITE_BACKCHANNEL_THRESHOLD=1500  # ms before playing "hmm"

# Phase 2
ENABLE_TURNGPT=false  # Feature flag
ENABLE_VAP=false      # Feature flag
TURNGPT_THRESHOLD=0.7  # Confidence threshold
VAP_THRESHOLD=0.7      # Confidence threshold
FUSION_TEXT_WEIGHT=0.6  # 60% TurnGPT, 40% VAP

# Phase 3
ENABLE_ADAPTIVE_ENDPOINTING=false
ENABLE_TWO_PASS=false
```

### 3. Dependencies to Install

```json
// package.json additions
{
  "dependencies": {
    // Phase 1 - No new deps needed

    // Phase 2
    "@tensorflow/tfjs-node": "^4.x",  // For TurnGPT/VAP models
    "onnxruntime-node": "^1.x",       // Alternative runtime

    // Phase 3
    "lodash": "^4.x"  // Utility functions
  }
}
```

### 4. Model Files Needed

**TurnGPT:**
- Download from: https://github.com/ErikEkstedt/TurnGPT
- File: `turngpt_model.ckpt` (~500MB)
- Location: `server/models/turngpt/`

**VAP:**
- Download from: https://github.com/ErikEkstedt/VAP
- File: `vap_model.pt` (~100MB)
- Location: `server/models/vap/`

---

## Metrics to Track

### Before/After Comparison
1. **Interruption Rate**
   - Measure: User re-prompts within 5 seconds
   - Goal: Reduce by 50%

2. **Response Latency**
   - Measure: Time from user silence to AI response
   - Goal: Stay under 500ms while reducing interruptions

3. **User Satisfaction**
   - Survey: "Does the AI interrupt you mid-thought?"
   - Goal: <20% "yes" responses

4. **Conversation Completion**
   - Measure: Multi-turn conversations completed
   - Goal: Increase by 30%

### Logging to Add
```javascript
// Track turn-taking decisions
console.log('[Turn-Taking]', {
  method: 'TurnGPT+VAP', // or 'fixed_threshold'
  trp: 0.85,
  vapShift: 0.78,
  combined: 0.82,
  decision: 'TAKE_TURN',
  silenceDuration: 1200,
  userThreshold: 1500
});

// Track interruptions
console.log('[Interruption]', {
  type: 'CORRECTION',
  aiSpeakingDuration: 2300,
  userInputPreview: 'No, I said...'
});

// Track backchannel detection
console.log('[Backchannel]', {
  detected: true,
  duration: 450,
  intensity: 0.3,
  duringAISpeech: true
});
```

---

## Priority Ranking

### 🔴 CRITICAL (Do First)
1. **Increase silence threshold to 1500ms** (5 min) - Lines: App.tsx:1146
2. **Add user control slider** (2-3h) - New component
3. **Backchannel detection** (3-4h) - Prevent false interruptions

### 🟡 HIGH IMPACT (Week 1-2)
4. **Graduated audio ducking** (1-2h) - Smoother transitions
5. **AI thinking fillers** (4-5h) - Fill LLM delays
6. **Expand emotional prosody** (3-4h) - Better personality

### 🟢 MEDIUM IMPACT (Month 1-2)
7. **TurnGPT integration** (30-40h total)
8. **VAP integration** (30-40h total)
9. **Fusion logic** (8-10h)

### 🔵 LONG-TERM (Month 2-6)
10. **Adaptive endpointing** (50-60h)
11. **Two-pass verification** (15-20h)
12. **Native speech processing** (Research + 100+ hours)

---

## Quick Wins Checklist

### Can implement TODAY:
- [x] Increase VITE_MAX_SILENCE_MS from 800 to 1500 (1 line change)
- [ ] Test new threshold with sample conversations
- [ ] Add console logging for interruption tracking

### Can implement THIS WEEK:
- [ ] User slider for silence threshold (0.5-3.0s)
- [ ] Graduated audio ducking levels
- [ ] Backchannel detection (duration + intensity)

### Can implement THIS MONTH:
- [ ] AI thinking fillers ("hmm" on LLM delay)
- [ ] Dynamic emotion selection based on message type
- [ ] Two-pass endpointing (acoustic + semantic)

---

## Resources & References

### Open Source Tools
- **TurnGPT:** https://github.com/ErikEkstedt/TurnGPT
- **VAP:** https://github.com/ErikEkstedt/VAP
- **Moshi:** https://github.com/kyutai-labs/moshi

### Research Papers
- **TurnGPT (2020):** "TurnGPT: A Transformer-based Language Model for Predicting Turn-taking in Spoken Dialog"
- **VAP (2020):** "Voice Activity Projection: Self-supervised Learning of Turn-taking Events"
- **Furhat Study (2025):** "Combining VAP and TurnGPT reduces interruptions AND delays"

### Documentation
- **Cartesia TTS:** Check emotion parameter options
- **WebAudio API:** For advanced audio processing
- **MediaRecorder API:** For audio capture enhancements

---

## Risk Mitigation

### Potential Issues

1. **Model Size & Latency**
   - **Risk:** TurnGPT/VAP add 50-70ms latency
   - **Mitigation:** Run predictions in parallel, cache results
   - **Fallback:** Keep fixed threshold as backup

2. **Server Load**
   - **Risk:** Running ML models increases CPU usage
   - **Mitigation:** Use GPU acceleration, model quantization
   - **Fallback:** Client-side processing with ONNX.js

3. **False Positives**
   - **Risk:** Still interrupt users occasionally
   - **Mitigation:** Conservative thresholds, user feedback loop
   - **Fallback:** User override button "Keep listening"

4. **User Preference Diversity**
   - **Risk:** One size doesn't fit all
   - **Mitigation:** Adaptive learning, user controls
   - **Fallback:** Multiple preset modes (Fast/Normal/Patient)

---

## Success Criteria

### Phase 1 Success
- ✅ <10% user reports of "interrupts me mid-sentence"
- ✅ Average response latency stays <500ms
- ✅ User slider adoption >40%

### Phase 2 Success
- ✅ 50% reduction in false interruptions vs. fixed threshold
- ✅ TurnGPT + VAP accuracy >80% on test set
- ✅ User feedback: "more natural" >70%

### Phase 3 Success
- ✅ Per-user thresholds converge within 10 conversations
- ✅ Adaptive system handles 90% of user diversity
- ✅ Conversation completion rate up 30%

### Overall Success
Users say: **"It feels like talking to a person"**

---

## Next Steps

1. **Read this entire plan** ✓
2. **Discuss priorities** - Which phase to start?
3. **Set timeline** - Realistic commitment?
4. **Start with quick wins** - Threshold change TODAY
5. **Iterate based on feedback** - User testing crucial

**Recommendation:** Start with Phase 1 (1-2 weeks). The quick wins have massive impact for minimal effort. Evaluate before committing to Phase 2's ML models.

---

## Questions for You

1. **Timeline:** How much time can you dedicate per week?
2. **Priorities:** Which problems annoy your users most?
3. **Resources:** Can you run ML models server-side (CPU/GPU)?
4. **Testing:** Do you have real users for A/B testing?
5. **Budget:** Open to paid services if better than open source?

Let me know where you want to start, and I'll help implement! 🚀
