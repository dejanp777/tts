"""
STT (Speech-to-Text) Latency Tests

Tests transcription latency and real-time factor
"""
import pytest
import time
import json
from pathlib import Path
import numpy as np
import sys

# Add test utils to path
sys.path.append(str(Path(__file__).parent.parent))
from utils.metrics_collector import MetricsCollector
import config

# Import Whisper for STT testing
try:
    import whisper
    import librosa
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False


@pytest.fixture(scope="module")
def whisper_model():
    """Load Whisper model once for all tests"""
    if not WHISPER_AVAILABLE:
        pytest.skip("Whisper not available")
    return whisper.load_model("base")


@pytest.fixture(scope="module")
def test_audio_files():
    """Get list of clean audio files for testing"""
    clean_dir = config.CLEAN_AUDIO_DIR

    if not clean_dir.exists():
        pytest.skip(f"Clean audio directory not found: {clean_dir}")

    audio_files = list(clean_dir.glob("*.wav"))

    if len(audio_files) == 0:
        pytest.skip("No audio files found for testing")

    return audio_files


@pytest.fixture(scope="module")
def metrics_collector():
    """Create metrics collector for this test module"""
    return MetricsCollector(output_dir=config.TEST_DIR / "results" / "stt")


@pytest.mark.stt
@pytest.mark.latency
@pytest.mark.benchmark
class TestSTTLatency:
    """Test STT latency and performance"""

    def test_transcription_latency(self, whisper_model, test_audio_files, metrics_collector):
        """Test transcription latency for various audio lengths"""

        latencies = []
        rtfs = []  # Real-time factors

        print(f"\n{'='*70}")
        print(f"{'File':<30} {'Duration':>10} {'Latency':>12} {'RTF':>8}")
        print(f"{'='*70}")

        for audio_path in test_audio_files:
            # Load audio to get duration
            audio, sr = librosa.load(str(audio_path), sr=16000)
            duration_sec = len(audio) / sr

            # Measure transcription time
            start = time.perf_counter()
            result = whisper_model.transcribe(str(audio_path))
            end = time.perf_counter()

            latency_ms = (end - start) * 1000
            rtf = (end - start) / duration_sec

            # Record metrics
            metrics_collector.record("stt_latency_ms", latency_ms, {
                "filename": audio_path.name,
                "duration_sec": duration_sec,
                "rtf": rtf
            })

            metrics_collector.record("stt_rtf", rtf, {
                "filename": audio_path.name,
                "duration_sec": duration_sec
            })

            latencies.append(latency_ms)
            rtfs.append(rtf)

            print(f"{audio_path.name:<30} {duration_sec:>8.2f}s {latency_ms:>10.0f}ms {rtf:>8.2f}x")

        # Calculate statistics
        stats = {
            "mean_latency_ms": np.mean(latencies),
            "median_latency_ms": np.median(latencies),
            "p95_latency_ms": np.percentile(latencies, 95),
            "mean_rtf": np.mean(rtfs),
            "median_rtf": np.median(rtfs)
        }

        print(f"{'='*70}")
        print(f"\nStatistics:")
        print(f"  Mean latency:   {stats['mean_latency_ms']:.0f}ms")
        print(f"  Median latency: {stats['median_latency_ms']:.0f}ms")
        print(f"  p95 latency:    {stats['p95_latency_ms']:.0f}ms")
        print(f"  Mean RTF:       {stats['mean_rtf']:.2f}x")
        print(f"  Median RTF:     {stats['median_rtf']:.2f}x")
        print(f"{'='*70}")

        # Assert p95 latency is reasonable (not a hard requirement for Whisper base)
        # This is just for tracking, not for failure
        if stats['p95_latency_ms'] > config.STT_LATENCY_TARGET_MS:
            print(f"\n⚠️  Warning: p95 latency ({stats['p95_latency_ms']:.0f}ms) exceeds target ({config.STT_LATENCY_TARGET_MS}ms)")

        # RTF should be reasonable (< 1.0 is real-time)
        assert stats['mean_rtf'] < 5.0, f"Mean RTF ({stats['mean_rtf']:.2f}x) is too high"

    def test_time_to_first_word(self, whisper_model, test_audio_files, metrics_collector):
        """
        Test time to first word (TTFW)
        Note: Whisper is not streaming, so this is approximate
        """

        print(f"\n{'='*70}")
        print(f"{'File':<35} {'TTFW (approx)':>15}")
        print(f"{'='*70}")

        for audio_path in test_audio_files[:5]:  # Test first 5 files
            # Measure time to first transcription result
            start = time.perf_counter()
            result = whisper_model.transcribe(str(audio_path), verbose=False)
            first_word_time = time.perf_counter() - start

            ttfw_ms = first_word_time * 1000

            # Record metric
            metrics_collector.record("stt_ttfw_ms", ttfw_ms, {
                "filename": audio_path.name
            })

            print(f"{audio_path.name:<35} {ttfw_ms:>13.0f}ms")

        print(f"{'='*70}")


def test_save_latency_metrics(metrics_collector):
    """Save collected latency metrics to file"""
    metrics_collector.save_to_file("stt_latency_metrics.json")
    metrics_collector.print_summary()
