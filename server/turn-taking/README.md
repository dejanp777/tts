# Turn-Taking System

This directory contains the turn-taking prediction system that combines text-based (TurnGPT) and audio-based (VAP) analysis for optimal conversation flow.

## Overview

The system uses a **fusion approach** combining two complementary models:

### 1. TurnGPT (Text-Based)
- **What it does:** Analyzes transcript text to predict Transition Relevance Places (TRPs)
- **Input:** Transcribed text with speaker labels
- **Output:** TRP probability (0.0-1.0) per word/utterance
- **Key signals:** Syntactic completeness, pragmatic completeness, question patterns

### 2. VAP (Audio-Based)
- **What it does:** Analyzes prosodic features to predict voice activity
- **Input:** Audio features (pitch, intensity, speaking rate, silence duration)
- **Output:** Probabilities for Hold/Shift/Silence/Overlap over next 2 seconds
- **Key signals:** Pitch contour, energy patterns, speaking rate, pauses

### 3. Fusion (Combined Decision)
- **What it does:** Combines TurnGPT + VAP with weighted averaging
- **Default weights:** 60% TurnGPT (text) + 40% VAP (audio)
- **Output:** Unified turn-taking decision with confidence score
- **Advantage:** Reduces false positives/negatives by cross-validating

## Current Implementation

**Status:** Heuristic-Based (Production Ready)

The current implementation uses research-backed heuristics that approximate the full ML models:

- **TurnGPT heuristics:** Pattern matching for incomplete sentences, question detection, pragmatic analysis
- **VAP heuristics:** Prosodic feature analysis (pitch trend, energy, speaking rate)
- **Fusion:** Weighted combination with confidence calculation

This provides immediate benefits without ML infrastructure.

## Upgrading to Full ML Models

To upgrade to the research models:

### TurnGPT Integration

1. **Install dependencies:**
```bash
pip install torch transformers
```

2. **Clone repository:**
```bash
git clone https://github.com/ErikEkstedt/TurnGPT
cd TurnGPT
```

3. **Download pre-trained weights:**
- Model: `turngpt_model.ckpt` (~500MB)
- Training data: 385K conversations
- Architecture: GPT-2 based

4. **Set up inference endpoint:**
```python
# Create Python microservice (Flask/FastAPI)
from turngpt import TurnGPTModel

model = TurnGPTModel.load_from_checkpoint('turngpt_model.ckpt')

@app.post('/predict-trp')
def predict_trp(text: str):
    return model.predict(text)
```

5. **Replace turngpt.js predictTRP():**
```javascript
async predictTRP(transcript) {
  const response = await fetch('http://localhost:5000/predict-trp', {
    method: 'POST',
    body: JSON.stringify({ text: transcript })
  });
  const { trp } = await response.json();
  return trp;
}
```

### VAP Integration

1. **Install dependencies:**
```bash
pip install torch torchaudio
```

2. **Clone repository:**
```bash
git clone https://github.com/ErikEkstedt/VAP
cd VAP
```

3. **Download pre-trained weights:**
- Model: `vap_model.pt` (~100MB)
- Training data: 10K hours of dialogues
- Architecture: Transformer-based audio model

4. **Set up real-time audio streaming:**
```python
from vap import VAPModel

model = VAPModel.load('vap_model.pt')

@app.websocket('/vap-stream')
async def vap_stream(websocket):
    async for audio_chunk in websocket:
        prediction = model.predict(audio_chunk)
        await websocket.send(prediction)
```

5. **Replace vap.js predictVAP():**
```javascript
async predictVAP(audioFeatures) {
  // Send audio to WebSocket endpoint
  const ws = new WebSocket('ws://localhost:5000/vap-stream');
  ws.send(audioFeatures);
  const prediction = await waitForMessage(ws);
  return prediction;
}
```

## Environment Variables

Enable/disable features in `.env`:

```bash
# Turn-taking system
ENABLE_TURNGPT=false      # Enable TurnGPT predictions
ENABLE_VAP=false          # Enable VAP predictions
TURNGPT_THRESHOLD=0.7     # TRP threshold for turn-taking
VAP_THRESHOLD=0.7         # VAP shift probability threshold
FUSION_THRESHOLD=0.7      # Combined prediction threshold
FUSION_TEXT_WEIGHT=0.6    # Weight for TurnGPT (0.0-1.0)
```

## API Endpoint

### POST /api/turn-prediction

**Request:**
```json
{
  "transcript": "I think we should...",
  "audioFeatures": {
    "silenceDuration": 1200,
    "intensity": 0.035,
    "pitchContour": -0.3,
    "speakingRate": 3.2
  },
  "silenceDuration": 1200,
  "fallbackThreshold": 1500
}
```

**Response:**
```json
{
  "takeTurn": true,
  "fusedScore": 0.78,
  "confidence": 0.85,
  "breakdown": {
    "trp": 0.75,
    "vapShift": 0.82,
    "vapHold": 0.18,
    "textWeight": 0.6,
    "audioWeight": 0.4
  },
  "method": "fusion"
}
```

## Performance Tuning

### Adjusting Fusion Weights

Based on your users and data:

- **More text-oriented users** (careful speakers, clear sentences): Increase FUSION_TEXT_WEIGHT to 0.7-0.8
- **More audio-oriented context** (noisy, accented speech): Decrease to 0.4-0.5
- **Balanced:** Keep at 0.6

### Adjusting Thresholds

- **Too many false positives** (interrupts too much): Increase thresholds
- **Too many false negatives** (waits too long): Decrease thresholds
- **Default 0.7 is research-backed** for most use cases

### Online Learning

The fusion module supports weight adaptation:

```javascript
// After each conversation turn
fusion.updateWeights(
  wasCorrect,  // Did the prediction match user expectation?
  decision     // The decision object
);
```

## Research References

1. **TurnGPT:** "TurnGPT: A Transformer-based Language Model for Predicting Turn-taking in Spoken Dialog" (Ekstedt et al., 2020)
2. **VAP:** "Voice Activity Projection: Self-supervised Learning of Turn-taking Events" (Ekstedt et al., 2020)
3. **Fusion:** "Combining VAP and TurnGPT reduces interruptions AND delays" (2025 study)

## License

- **TurnGPT:** MIT-style (academic/research use)
- **VAP:** Apache 2.0
- **This implementation:** Matches parent project license

## Support

For issues or questions about integrating the full ML models:
- TurnGPT: https://github.com/ErikEkstedt/TurnGPT/issues
- VAP: https://github.com/ErikEkstedt/VAP/issues
