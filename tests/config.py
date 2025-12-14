"""
Test configuration and constants
"""
import os
from pathlib import Path

# Base paths
TEST_DIR = Path(__file__).parent
FIXTURES_DIR = TEST_DIR / "fixtures"
AUDIO_DIR = FIXTURES_DIR / "audio"
CLEAN_AUDIO_DIR = AUDIO_DIR / "clean_samples"
NOISY_AUDIO_DIR = AUDIO_DIR / "noisy_samples"
BACKCHANNEL_AUDIO_DIR = AUDIO_DIR / "backchannel_samples"
SCRIPTS_DIR = FIXTURES_DIR / "scripts"

# API endpoints
API_BASE_URL = os.getenv("TEST_API_BASE_URL", "http://localhost:4000")
API_TIMEOUT = 30  # seconds

# Quality thresholds
STT_WER_THRESHOLD_CLEAN = 0.05  # 5% max WER for clean audio
STT_WER_THRESHOLD_NOISY = 0.15  # 15% max WER for noisy audio (10dB SNR)
TTS_PESQ_THRESHOLD = 3.5  # Minimum PESQ score
TTS_TTFAC_THRESHOLD_MS = 300  # Time to first audio chunk
END_TO_END_LATENCY_P95_MS = 2500  # p95 latency threshold
TURN_TAKING_ACCURACY_MIN = 0.90  # 90% minimum accuracy
FALSE_INTERRUPTION_RATE_MAX = 0.10  # 10% maximum

# Latency targets (for warnings, not failures)
STT_LATENCY_TARGET_MS = 500
TTS_TTFAC_TARGET_MS = 150
END_TO_END_TARGET_MS = 1500

# Audio processing
SAMPLE_RATE = 16000  # Hz
AUDIO_FORMAT = "wav"

# Noise levels for testing
SNR_LEVELS = [20, 10, 5]  # dB

# Test data sizes
MIN_TEST_SAMPLES = 10
RECOMMENDED_TEST_SAMPLES = 100

# Optimization
GRID_SEARCH_MIN_THRESHOLD = 500
GRID_SEARCH_MAX_THRESHOLD = 3000
GRID_SEARCH_STEP = 100

# Metrics storage
METRICS_DB_HOST = os.getenv("INFLUXDB_HOST", "localhost")
METRICS_DB_PORT = int(os.getenv("INFLUXDB_PORT", "8086"))
METRICS_DB_NAME = os.getenv("INFLUXDB_DB", "voice_ai_metrics")

# Alerting
SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
ALERT_ON_REGRESSION = os.getenv("ALERT_ON_REGRESSION", "true").lower() == "true"
