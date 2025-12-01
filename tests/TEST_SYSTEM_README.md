# Voice AI Automated Testing System

Comprehensive automated testing framework for STT, TTS, and conversation quality using Python and pytest.

## Overview

This testing system provides:
- **STT Testing**: Accuracy (WER) and latency benchmarks
- **TTS Testing**: Quality (PESQ) and latency (TTFAC) measurements
- **Conversation Testing**: End-to-end flow and turn-taking accuracy
- **Regression Detection**: Automatic comparison against baseline metrics
- **Parameter Optimization**: Grid search and Bayesian optimization
- **CI/CD Integration**: Automated runs on every PR

## Quick Start

### 1. Install Dependencies

```bash
pip install -r tests/requirements.txt
```

### 2. Generate Test Audio

```bash
cd tests/fixtures
python generate_test_audio.py
```

### 3. Run Tests

```bash
cd tests

# Run all tests
pytest -v

# Run specific test suites
pytest stt/test_accuracy.py -v
pytest tts/test_latency.py -v
pytest conversation/test_turn_taking.py -v
```

## Test Structure

```
tests/
├── stt/                    # Speech-to-Text tests
│   ├── test_accuracy.py    # WER and transcription accuracy
│   └── test_latency.py     # Transcription latency benchmarks
├── tts/                    # Text-to-Speech tests
│   ├── test_quality.py     # PESQ and prosody analysis
│   └── test_latency.py     # TTFAC and synthesis latency
├── conversation/           # End-to-end conversation tests
│   ├── test_flow.py        # Conversation flow and context
│   └── test_turn_taking.py # Turn-taking accuracy
├── fixtures/               # Test data
│   ├── audio/              # Ground truth audio samples
│   ├── scripts/            # Conversation scripts
│   └── generate_test_audio.py
├── utils/                  # Testing utilities
│   ├── audio_generator.py  # Audio manipulation
│   ├── conversation_simulator.py  # Automated conversation testing
│   └── metrics_collector.py  # Metrics collection and storage
├── config.py               # Test configuration
├── pytest.ini              # Pytest configuration
└── requirements.txt        # Test dependencies
```

## Configuration

Edit `tests/config.py` to customize:

- **API endpoints**: Where to send test requests
- **Quality thresholds**: WER, PESQ, latency limits
- **Test data paths**: Where audio files are stored
- **Optimization parameters**: Grid search ranges

## Metrics

### STT Metrics
- **WER (Word Error Rate)**: Target <5% for clean audio, <15% for noisy
- **Latency**: Target <500ms processing time
- **RTF (Real-Time Factor)**: Should be <1.0 for real-time processing

### TTS Metrics
- **PESQ**: Target >3.5 (scale 1.0-4.5)
- **TTFAC**: Time to First Audio Chunk, target <300ms
- **Prosody variation**: Verify emotional range

### Conversation Metrics
- **End-to-end latency**: p95 target <2.5s
- **Turn-taking accuracy**: Target >90%
- **False interruption rate**: Target <10%
- **Context preservation**: Must maintain multi-turn context

## Regression Detection

Detect regressions automatically:

```bash
cd tests
python regression_detector.py baseline/ results/
```

This compares current metrics against baseline and alerts on:
- **Critical**: >20% WER increase, >30% latency increase
- **Warning**: >10% WER increase, >20% latency increase

## Parameter Optimization

### Grid Search

Test all parameter combinations:

```bash
cd optimization
python grid_search.py
```

### Bayesian Optimization

Efficient parameter space exploration:

```bash
cd optimization
python bayesian_optimization.py
```

## CI/CD Integration

Tests run automatically on every PR via GitHub Actions (`.github/workflows/voice-ai-tests.yml`):

1. Generate test audio
2. Run all test suites
3. Check for regressions vs baseline
4. Post results as PR comment
5. Update baseline on main branch merge

## Extending the Tests

### Add New Test

1. Create test file: `tests/category/test_feature.py`
2. Use pytest fixtures from `conftest.py`
3. Record metrics with `MetricsCollector`
4. Run with `pytest tests/category/test_feature.py -v`

### Add New Conversation Script

1. Add to `fixtures/scripts/test_conversations.json`
2. Generate audio with `generate_test_audio.py`
3. Reference in conversation tests

### Add New Metric Threshold

1. Edit `config.py` to add threshold constant
2. Use in test assertions
3. Add to regression detection rules

## Troubleshooting

### Tests failing with audio not found

Run the audio generator:
```bash
cd tests/fixtures
python generate_test_audio.py
```

### API connection errors

Check that the voice AI server is running:
```bash
# Set API URL
export TEST_API_BASE_URL=http://localhost:3000

# Or in tests/config.py
API_BASE_URL = "http://localhost:3000"
```

### Missing dependencies

Install all requirements:
```bash
pip install -r tests/requirements.txt

# For system dependencies (Ubuntu/Debian)
sudo apt-get install ffmpeg libsndfile1
```

## Best Practices

1. **Run tests locally** before pushing
2. **Check regression reports** on every PR
3. **Update baselines** after intentional improvements
4. **Monitor trends** in metrics over time
5. **Optimize parameters** monthly with Bayesian optimization

## Metrics Dashboard

Results are saved to `tests/results/` as JSON files. View with:

```bash
cd tests/results
cat *_metrics.json | jq '.metrics'
```

Or set up Grafana with InfluxDB for live dashboards (see `ideas/automated_test.md`).

## Contact

For issues or questions about the testing system, see:
- Full design doc: `ideas/automated_test.md`
- GitHub issues: Report bugs or feature requests
