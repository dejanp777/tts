# Quick Start Guide - Conversation Tests

## TL;DR

```bash
# Quick single test
node tests/quick-test.js

# Full 5-exchange test
node tests/conversation-test.js

# Custom number of exchanges
node tests/conversation-test.js --exchanges 10

# Verbose output
node tests/conversation-test.js --verbose
```

## What These Tests Do

These tests simulate a full voice conversation without needing a browser:

1. **STT** - Sends audio to `/api/stt` endpoint
2. **Chat** - Streams chat response from `/api/chat/stream`
3. **TTS** - Streams audio from `/api/tts/stream`
4. **Measures timing** at each step

## Example Output

```
🚀 Quick Conversation Test
Server: http://localhost:4000
Message: "Hello, how are you?"
────────────────────────────────────────────────────────────

1️⃣  Testing STT...
✅ STT completed in 213ms
   Transcript: ""

2️⃣  Testing Chat Stream...
⚡ First token in 2032ms
Hey there, sugar! I'm fabulous.
✅ Chat completed in 2034ms
   Response length: 31 chars

3️⃣  Testing TTS Stream...
⚡ First chunk in 176ms
✅ TTS completed in 886ms (22 chunks)

════════════════════════════════════════════════════════════
📊 SUMMARY
════════════════════════════════════════════════════════════
STT:              213ms
Chat (first):     2032ms
Chat (complete):  2034ms
TTS (first):      176ms
TTS (complete):   886ms
────────────────────────────────────────────────────────────
TOTAL:            3134ms
════════════════════════════════════════════════════════════
```

## Understanding the Results

### ✅ Good Performance
- **STT**: < 500ms
- **Chat first token**: < 2000ms
- **TTS first chunk**: < 500ms
- **Total**: < 4000ms

### ⚠️ Needs Investigation
- **STT**: > 1000ms
- **Chat first token**: > 5000ms (LLM bottleneck!)
- **TTS first chunk**: > 1500ms
- **Total**: > 7000ms

## Common Issues

### Server Not Running
```
❌ Error: connect ECONNREFUSED
```
**Fix:** Start server with `cd server && npm run dev`

### Wrong Port
The server runs on port **4000** by default (not 3000).

### Empty Transcripts
The test uses silent audio, so empty transcripts are expected. This validates the pipeline, not transcription quality.

## Advanced Usage

### JSON Output for Parsing
```bash
node tests/conversation-test.js --json > results.json
```

### Custom Server URL
```bash
SERVER_URL=http://localhost:4000 node tests/quick-test.js
```

### Benchmark Different Models
```bash
# Test baseline
node tests/conversation-test.js --json > baseline.json

# Change OPENROUTER_MODEL in server/.env
# Test new model
node tests/conversation-test.js --json > new-model.json

# Compare
node -e "
  const baseline = require('./baseline.json');
  const newModel = require('./new-model.json');
  console.log('Baseline chat:', baseline.summary.avgChatFirstToken, 'ms');
  console.log('New model chat:', newModel.summary.avgChatFirstToken, 'ms');
"
```

## Files Created

```
tests/
├── QUICKSTART.md           # This file
├── README.md               # Full documentation
├── quick-test.js          # Single exchange test ⭐
├── conversation-test.js   # Multiple exchange test ⭐
├── package.json           # NPM scripts
└── utils/
    ├── sse-parser.js      # SSE stream parser
    └── audio-generator.js # Audio file generator
```

## Next Steps

1. Run `node tests/quick-test.js` to validate your setup
2. Run `node tests/conversation-test.js` for full testing
3. Check the timing results to identify bottlenecks
4. See `tests/README.md` for detailed documentation

