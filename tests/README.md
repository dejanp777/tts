# Conversation Tests

Automated testing suite for the voice chat application. Tests the full STT → Chat → TTS pipeline without requiring browser interaction.

## Quick Start

### 1. Install Dependencies

The tests use the same dependencies as the server (axios, form-data, etc.), which should already be installed.

```bash
cd server
npm install
cd ..
```

### 2. Start the Server

Make sure your server is running:

```bash
cd server
npm run dev
```

### 3. Run Tests

**Quick Test (Single Exchange):**
```bash
node tests/quick-test.js
```

**Full Conversation Test (5 Exchanges):**
```bash
node tests/conversation-test.js
```

## Test Scripts

### `quick-test.js`

Tests a single STT → Chat → TTS exchange. Perfect for quick validation.

**Usage:**
```bash
# Default test
node tests/quick-test.js

# Custom message
node tests/quick-test.js "Tell me a joke"

# Custom server URL
SERVER_URL=http://localhost:3000 node tests/quick-test.js
```

**Output:**
```
🚀 Quick Conversation Test
Server: http://localhost:3000
Message: "Hello, how are you?"
────────────────────────────────────────────────────────────

1️⃣  Testing STT...
✅ STT completed in 314ms
   Transcript: ""

2️⃣  Testing Chat Stream...
⚡ First token in 1774ms
Hello! I'm doing well, thank you for asking...
✅ Chat completed in 1850ms
   Response length: 145 chars

3️⃣  Testing TTS Stream...
⚡ First chunk in 650ms
✅ TTS completed in 1200ms (23 chunks)

════════════════════════════════════════════════════════════
📊 SUMMARY
════════════════════════════════════════════════════════════
STT:              314ms
Chat (first):     1774ms
Chat (complete):  1850ms
TTS (first):      650ms
TTS (complete):   1200ms
────────────────────────────────────────────────────────────
TOTAL:            3364ms
════════════════════════════════════════════════════════════
```

### `conversation-test.js`

Tests multiple conversation exchanges with detailed statistics.

**Usage:**
```bash
# Default (5 exchanges)
node tests/conversation-test.js

# Custom number of exchanges
node tests/conversation-test.js --exchanges 10

# Verbose output
node tests/conversation-test.js --verbose

# JSON output (for parsing)
node tests/conversation-test.js --json > results.json

# Custom server
node tests/conversation-test.js --server http://localhost:3000
```

**Options:**
- `--exchanges <n>` - Number of conversation exchanges (default: 5)
- `--server <url>` - Server URL (default: http://localhost:3000)
- `--verbose` - Show detailed logs including tokens and chunks
- `--json` - Output results as JSON

**Output:**
```
🚀 Starting Conversation Test
Server: http://localhost:3000
Exchanges: 5
════════════════════════════════════════════════════════════
[13:02:05] ℹ️ Exchange 1: "Hello, how are you today?"
[13:02:05] ℹ️ Testing STT...
[13:02:06] ⏱️ STT completed in 314ms
[13:02:06] ℹ️ Testing Chat...
[13:02:08] ⏱️ Chat first token in 1774ms
[13:02:08] ⏱️ Chat completed in 1850ms
[13:02:08] ℹ️ Testing TTS...
[13:02:09] ⏱️ TTS first chunk in 650ms
[13:02:10] ⏱️ TTS completed in 1200ms
[13:02:10] ✅ Exchange 1 completed in 3765ms
────────────────────────────────────────────────────────────
...

════════════════════════════════════════════════════════════
📊 CONVERSATION TEST SUMMARY
════════════════════════════════════════════════════════════
Total Exchanges: 5
Success Rate: 100.0%
Total Time: 18825ms

Average Timings:
  STT:                320ms
  Chat First Token:   1800ms
  Chat Complete:      1900ms
  TTS First Chunk:    680ms
  TTS Complete:       1250ms
  Exchange Total:     3765ms
════════════════════════════════════════════════════════════
```

## Utilities

### `utils/sse-parser.js`

Parses Server-Sent Events (SSE) streams from Chat and TTS endpoints.

**Functions:**
- `parseSSEStream(stream, onData, isTTS)` - Generic SSE parser
- `parseChatStream(stream, onToken)` - Parse chat tokens
- `parseTTSStream(stream, onChunk)` - Parse TTS audio chunks

### `utils/audio-generator.js`

Generates test audio files for STT testing.

**Functions:**
- `generateSilentAudio(durationMs, sampleRate)` - Generate silent WAV
- `generateToneAudio(durationMs, frequency, sampleRate)` - Generate tone WAV
- `loadFixtureAudio(filename)` - Load pre-recorded audio from fixtures/
- `saveAudioToFile(buffer, filename)` - Save audio to output/ (for debugging)

**Note:** Currently generates silent audio as a placeholder. The STT endpoint will return an empty transcript, but the test still validates the full pipeline.

## Understanding the Results

### Key Metrics

1. **STT Time** - Speech-to-text processing time
   - Target: < 800ms
   - Includes: Network + Cartesia STT API

2. **Chat First Token** - Time to first LLM response
   - Target: < 1500ms
   - **Most important metric** for perceived latency
   - Bottleneck: Usually the LLM model speed

3. **Chat Complete** - Total chat response time
   - Should be close to "first token" for streaming
   - Large difference indicates slow token generation

4. **TTS First Chunk** - Time to first audio chunk
   - Target: < 500ms
   - Includes: Network + Cartesia TTS API

5. **TTS Complete** - Total TTS generation time
   - Depends on response length
   - More chunks = longer time

6. **Total Exchange Time** - End-to-end latency
   - Target: < 4000ms (4 seconds)
   - Sum of all steps + overhead

### Identifying Bottlenecks

**If STT is slow (> 1500ms):**
- Check audio file size
- Check network to Cartesia
- Consider using WAV format client-side

**If Chat First Token is slow (> 3000ms):**
- **Most common bottleneck**
- Try faster LLM model
- Reduce conversation history
- Check OpenRouter status

**If TTS is slow (> 1500ms):**
- Check response text length
- Check network to Cartesia
- Consider splitting long responses

**If Total Time is high but individual steps are fast:**
- Network overhead between steps
- Server processing overhead
- Consider optimizing request handling

## Troubleshooting

### Server Not Running
```
❌ Error: connect ECONNREFUSED 127.0.0.1:3000
```
**Solution:** Start the server with `cd server && npm run dev`

### Missing Dependencies
```
Error: Cannot find module 'axios'
```
**Solution:** Install dependencies with `cd server && npm install`

### Timeout Errors
```
❌ Error: timeout of 30000ms exceeded
```
**Solution:** 
- Check server is responding
- Increase timeout in test script
- Check API keys are configured

### Empty STT Transcripts
```
Transcript: ""
```
**Expected:** The test uses silent audio, so empty transcripts are normal. The test validates the pipeline, not the actual transcription quality.

To test with real audio:
1. Record a WAV file
2. Save it to `tests/fixtures/sample.wav`
3. Modify test to use `loadFixtureAudio('sample.wav')`

## Advanced Usage

### Running Tests in CI/CD

```bash
# Run tests and save results
node tests/conversation-test.js --json > test-results.json

# Check if average exchange time is acceptable
node -e "
  const results = require('./test-results.json');
  const avgTime = results.summary.avgExchangeTime;
  if (avgTime > 5000) {
    console.error('Performance regression: avg time', avgTime, 'ms');
    process.exit(1);
  }
  console.log('Performance OK:', avgTime, 'ms');
"
```

### Benchmarking Different Models

```bash
# Test with current model
node tests/conversation-test.js --json > baseline.json

# Change model in server/.env
# OPENROUTER_MODEL=anthropic/claude-3-haiku

# Test with new model
node tests/conversation-test.js --json > haiku.json

# Compare results
node -e "
  const baseline = require('./baseline.json');
  const haiku = require('./haiku.json');
  console.log('Baseline avg:', baseline.summary.avgChatFirstToken, 'ms');
  console.log('Haiku avg:', haiku.summary.avgChatFirstToken, 'ms');
  const improvement = baseline.summary.avgChatFirstToken - haiku.summary.avgChatFirstToken;
  console.log('Improvement:', improvement, 'ms');
"
```

### Load Testing

```bash
# Run multiple tests in parallel
for i in {1..5}; do
  node tests/quick-test.js &
done
wait
```

## Future Enhancements

- [ ] Add real audio fixtures for STT testing
- [ ] Add WebSocket TTS testing (in addition to SSE)
- [ ] Add error injection tests (network failures, API errors)
- [ ] Add performance regression detection
- [ ] Add visual performance graphs
- [ ] Add comparison between different models/configurations
- [ ] Add memory/CPU usage monitoring
- [ ] Add concurrent request testing

## Files

```
tests/
├── README.md                    # This file
├── quick-test.js               # Single exchange test
├── conversation-test.js        # Multiple exchange test
├── utils/
│   ├── sse-parser.js          # SSE stream parser
│   └── audio-generator.js     # Audio file generator
├── fixtures/                   # Pre-recorded audio files (optional)
└── output/                     # Generated files (created automatically)
```

