# Codex's Recommendations for Test Improvements

**Date:** 2025-11-03  
**Consultant:** Codex (Solana Expert Engineer)  
**Context:** 10-exchange test with 100% success rate, ~2.8s avg latency, chat first token variance 402ms-2421ms (6x)

---

## 🎯 Quick Wins to Reduce Chat First-Token Variance

1. **Keep-alive agents for upstream axios** (often the biggest easy win - reduces 100-300ms TLS handshake)
2. **Switch to a lower-latency model** for production (fast/mini variants)
3. **Warm connection** at server start with trivial streamed request
4. **Trim/optimize system prompt** and message history length
5. **Use HTTP/2 client** (e.g., undici) for better connection reuse

---

## 1. Making Tests More Robust

### Drive Full STT → Chat → TTS Path
- **Current**: Tests use hardcoded `userMessage`
- **Improvement**: Feed STT `transcript` into Chat, fallback to `userMessage` if empty
- **File**: `tests/conversation-test.js`

### Real Audio Fixtures
- **Current**: Silent audio only
- **Add**: Clean speech, noisy speech, different sample rates/encodings (wav/webm/ogg), long/short utterances
- **File**: `tests/utils/audio-generator.js`

### Multi-Turn Context
- **Current**: Single-turn exchanges
- **Add**: Carry prior turns into `messages` array
- **Verify**: No regression with growing history

### Warm-Up Exchanges
- **Add**: `--warmup N` flag to run N warm-up exchanges
- **Exclude**: Warm-up from metrics (prevents cold-start skew)
- **File**: `tests/conversation-test.js`

### Negative Test Cases
- Invalid API keys
- Timeouts (upstream 429/5xx)
- Truncated SSE streams
- Mid-stream cancel (client abort)
- **Verify**: Server frees upstream resources (already has `req.on('close')` handlers)

---

## 2. Better Performance Monitoring

### Percentiles + Tail Latencies
**Current**: Only averages  
**Add**: p50, p90, p95, p99, coefficient of variation

```javascript
const p = (arr, q) => {
  const s = [...arr].sort((a,b) => a-b);
  const i = Math.floor((q/100) * (s.length-1));
  return s[i];
};
```

**File**: `tests/conversation-test.js`

### First-Byte vs First-Token
**Current**: Measures first parsed token  
**Add**: Record TTFB as `response.data.once('data')` separately

**Why**: Separates network/handshake from model latency

```javascript
let ttfb = null;
response.data.once('data', () => {
  ttfb = Date.now() - startTime;
});
```

**Files**: `tests/conversation-test.js`, `tests/quick-test.js`

### Persist Test Runs
- Write JSON per run under `tests/results/` with timestamp
- Add tiny compare script for trend/regression detection
- Track: model name, commit, Node version, CPU load, memory, test start time

### Server-Side Spans
- Add correlation ID to all 3 calls (STT, Chat, TTS)
- Log upstream `x-request-id` from OpenRouter/Cartesia
- Forward timings in first SSE event as meta frame:

```javascript
res.write(`data: {"type":"meta","upstream_ttfb_ms":${ttfb}}\n\n`);
```

**File**: `server/index.js`

---

## 3. Identifying Bottlenecks

### Connection Reuse (CRITICAL!)
**Problem**: Each request creates new TLS handshake (100-300ms overhead)  
**Solution**: Use keep-alive agents

```javascript
const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  keepAliveMsecs: 30000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  keepAliveMsecs: 30000
});

// Use in axios calls
axios.post(url, data, {
  httpAgent,
  httpsAgent,
  // ... other options
});
```

**File**: `server/index.js`  
**Impact**: Reduces chat first-token variance significantly

### Proxy Buffering
**Problem**: SSE may be buffered by proxies/CDNs  
**Solution**: Add anti-buffering header

```javascript
res.setHeader('X-Accel-Buffering', 'no');
```

**Files**: `server/index.js` (both `/api/chat/stream` and `/api/tts/stream`)

### Split Chat First-Token into Phases
Measure on server:
1. **Upstream TTFB** (OpenRouter first chunk)
2. **Client first token** (when client receives)
3. **Server overhead** (difference)

Already logging upstream first chunk - forward as SSE meta event!

### Prompt/Token Size Tracking
- Track total tokens in prompt (system + history)
- First-token latency scales with prompt length
- Consider trimming/summarizing history
- Tighten system prompt (currently ~200 words)

### Concurrency Probes
- Run N parallel streams
- Look for: event loop delay, socket saturation, upstream throttling
- Log `monitorEventLoopDelay()` periodically

```javascript
const { monitorEventLoopDelay } = require('perf_hooks');
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
// Later: h.mean, h.max, h.percentile(95)
```

---

## 4. Streaming API Best Practices

### Contract Checks
Validate:
- `Content-Type: text/event-stream`
- `Connection: keep-alive`
- `Cache-Control: no-cache`
- `[DONE]` or terminal event present
- Chunk order is monotonic (add sequence number in meta frames)

### Partial/Cancel Tests
- Cancel after first token/chunk
- Assert server closes upstream
- Verify no resource leaks

### Backpressure Awareness
```javascript
if (!res.write(chunk)) {
  await new Promise(resolve => res.once('drain', resolve));
}
```

**File**: `server/index.js`

### Heartbeats
- Tolerate `:` comment lines (keep-alives)
- SSE parser already ignores non-`data:` lines ✅

### Timeouts by Phase
- Shorter "first-byte" timeout for stream setup (e.g., 5s)
- Higher ceiling for total stream (e.g., 60s)
- Configurable thresholds in tests

---

## 5. Concrete Implementation Locations

| Improvement | File | Lines/Section |
|-------------|------|---------------|
| Keep-alive agents | `server/index.js` | Top-level (create shared axios client) |
| SSE anti-buffering | `server/index.js` | `/api/chat/stream` and `/api/tts/stream` routes |
| Percentiles | `tests/conversation-test.js` | `calculateSummary()` function |
| TTFB capture | `tests/conversation-test.js`, `tests/quick-test.js` | Before `parseSSEStream()` |
| Meta SSE events | `server/index.js` | First write in stream routes |
| Meta parsing | `tests/utils/sse-parser.js` | Add `type:"meta"` handling |
| Warm-up flag | `tests/conversation-test.js` | CLI args parsing |
| Real audio | `tests/utils/audio-generator.js` | New functions |

---

## 6. Priority Order

### High Priority (Do First)
1. ✅ **Keep-alive agents** - Biggest impact on variance
2. ✅ **SSE anti-buffering header** - Easy fix
3. ✅ **Percentiles tracking** - Better metrics
4. ✅ **TTFB measurement** - Identify network vs model latency

### Medium Priority
5. **Warm-up exchanges** - Remove cold-start bias
6. **Real audio fixtures** - More realistic testing
7. **Meta SSE events** - Better server-side visibility
8. **Correlation IDs** - Cross-service tracing

### Low Priority (Nice to Have)
9. Multi-turn context testing
10. Concurrency probes
11. Negative test cases
12. Backpressure handling

---

## 7. Expected Improvements

### After Keep-Alive Agents
- **Chat first token**: Reduce variance from 6x to ~2-3x
- **Average latency**: Reduce by 100-300ms
- **Consistency**: Much more predictable performance

### After All High-Priority Changes
- **Chat first token**: 800-1500ms range (vs current 402-2421ms)
- **Total latency**: ~2.4s average (vs current 2.8s)
- **Variance**: <2x difference between min/max

---

## 8. Code Snippets Codex Can Provide

If needed, Codex can draft exact code for:
1. Axios keep-alive client in `server/index.js`
2. Meta SSE event emission + parsing
3. Percentiles and outlier detection in `tests/conversation-test.js`
4. Warm-up and cancellation tests

---

## Summary

**Key Insight**: The 6x variance in chat first-token (402ms-2421ms) is likely due to:
1. **TLS handshake overhead** (100-300ms per request) - Fixed by keep-alive
2. **Model load variability** - Mitigated by warm-up and faster model
3. **Prompt length** - Optimize system prompt

**Recommended Next Steps**:
1. Implement keep-alive agents (30 min)
2. Add SSE anti-buffering header (5 min)
3. Add percentiles to test output (15 min)
4. Measure TTFB separately (15 min)
5. Run new 10-exchange test and compare results

**Expected Outcome**: Chat first-token variance reduced from 6x to 2-3x, average latency improved by 10-15%.

