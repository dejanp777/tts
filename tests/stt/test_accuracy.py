"""
STT (Speech-to-Text) Accuracy Tests

Tests Word Error Rate (WER) and transcription accuracy
"""
import pytest
import json
from pathlib import Path
import sys

# Add test utils to path
sys.path.append(str(Path(__file__).parent.parent))
from utils.audio_generator import load_audio
from utils.metrics_collector import MetricsCollector
import config

# Import Whisper for STT testing
try:
    import whisper
    from jiwer import wer
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
def ground_truth():
    """Load ground truth manifest"""
    manifest_path = config.AUDIO_DIR / "ground_truth_manifest.json"

    if not manifest_path.exists():
        pytest.skip(f"Ground truth manifest not found: {manifest_path}")

    with open(manifest_path, 'r') as f:
        return json.load(f)


@pytest.fixture(scope="module")
def metrics_collector():
    """Create metrics collector for this test module"""
    return MetricsCollector(output_dir=config.TEST_DIR / "results" / "stt")


@pytest.mark.stt
@pytest.mark.quality
class TestSTTAccuracy:
    """Test STT accuracy on clean audio"""

    def test_clean_audio_accuracy(self, whisper_model, ground_truth, metrics_collector):
        """Test WER on clean audio samples"""
        clean_samples = ground_truth["clean_samples"]

        total_wer = 0
        test_count = 0

        for filename, data in clean_samples.items():
            audio_path = config.CLEAN_AUDIO_DIR / filename

            if not audio_path.exists():
                print(f"Skipping {filename} - file not found")
                continue

            # Transcribe
            result = whisper_model.transcribe(str(audio_path))
            predicted = result["text"].strip()
            expected = data["text"].strip()

            # Calculate WER
            error_rate = wer(expected, predicted)

            # Record metric
            metrics_collector.record("stt_wer_clean", error_rate, {
                "filename": filename,
                "expected": expected,
                "predicted": predicted
            })

            print(f"\n{filename}:")
            print(f"  Expected:  {expected}")
            print(f"  Predicted: {predicted}")
            print(f"  WER: {error_rate:.2%}")

            total_wer += error_rate
            test_count += 1

        # Calculate average WER
        avg_wer = total_wer / test_count if test_count > 0 else 1.0

        print(f"\n{'='*60}")
        print(f"Average WER (clean): {avg_wer:.2%}")
        print(f"Threshold: {config.STT_WER_THRESHOLD_CLEAN:.2%}")
        print(f"{'='*60}")

        # Assert threshold
        assert avg_wer < config.STT_WER_THRESHOLD_CLEAN, \
            f"Average WER ({avg_wer:.2%}) exceeds threshold ({config.STT_WER_THRESHOLD_CLEAN:.2%})"

        # Warn if above target
        if avg_wer > config.STT_WER_THRESHOLD_CLEAN * 0.6:  # 60% of threshold
            print(f"⚠️  Warning: WER is above target ({config.STT_WER_THRESHOLD_CLEAN * 0.6:.2%})")

    def test_noisy_audio_accuracy(self, whisper_model, ground_truth, metrics_collector):
        """Test WER on noisy audio samples (10dB SNR)"""
        noisy_samples = ground_truth["noisy_samples"]

        # Filter for 10dB SNR samples
        snr_10db_samples = {k: v for k, v in noisy_samples.items() if v.get("snr_db") == 10}

        total_wer = 0
        test_count = 0

        for filename, data in snr_10db_samples.items():
            audio_path = config.NOISY_AUDIO_DIR / filename

            if not audio_path.exists():
                print(f"Skipping {filename} - file not found")
                continue

            # Transcribe
            result = whisper_model.transcribe(str(audio_path))
            predicted = result["text"].strip()
            expected = data["text"].strip()

            # Calculate WER
            error_rate = wer(expected, predicted)

            # Record metric
            metrics_collector.record("stt_wer_noisy_10db", error_rate, {
                "filename": filename,
                "expected": expected,
                "predicted": predicted,
                "snr_db": 10
            })

            print(f"\n{filename}:")
            print(f"  Expected:  {expected}")
            print(f"  Predicted: {predicted}")
            print(f"  WER: {error_rate:.2%}")

            total_wer += error_rate
            test_count += 1

        # Calculate average WER
        avg_wer = total_wer / test_count if test_count > 0 else 1.0

        print(f"\n{'='*60}")
        print(f"Average WER (noisy 10dB): {avg_wer:.2%}")
        print(f"Threshold: {config.STT_WER_THRESHOLD_NOISY:.2%}")
        print(f"{'='*60}")

        # Assert threshold
        assert avg_wer < config.STT_WER_THRESHOLD_NOISY, \
            f"Average WER ({avg_wer:.2%}) exceeds threshold ({config.STT_WER_THRESHOLD_NOISY:.2%})"


@pytest.mark.stt
@pytest.mark.quality
def test_keyword_detection(whisper_model, ground_truth):
    """Test that expected keywords are detected in transcription"""
    clean_samples = ground_truth["clean_samples"]

    failures = []

    for filename, data in clean_samples.items():
        if "keywords" not in data or not data["keywords"]:
            continue

        audio_path = config.CLEAN_AUDIO_DIR / filename

        if not audio_path.exists():
            continue

        # Transcribe
        result = whisper_model.transcribe(str(audio_path))
        predicted = result["text"].lower()

        # Check keywords
        missing_keywords = []
        for keyword in data["keywords"]:
            if keyword.lower() not in predicted:
                missing_keywords.append(keyword)

        if missing_keywords:
            failures.append({
                "file": filename,
                "missing_keywords": missing_keywords,
                "transcription": predicted
            })

    if failures:
        print("\n⚠️  Keyword detection failures:")
        for f in failures:
            print(f"\n  {f['file']}:")
            print(f"    Missing: {f['missing_keywords']}")
            print(f"    Transcription: {f['transcription']}")

        assert False, f"{len(failures)} files had missing keywords"


def test_save_metrics(metrics_collector):
    """Save collected metrics to file"""
    metrics_collector.save_to_file("stt_accuracy_metrics.json")
    metrics_collector.print_summary()
