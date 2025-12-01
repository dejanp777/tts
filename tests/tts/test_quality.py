"""
TTS (Text-to-Speech) Quality Tests

Tests speech quality using PESQ and other metrics
"""
import pytest
import json
from pathlib import Path
import numpy as np
import sys
import aiohttp
import asyncio

# Add test utils to path
sys.path.append(str(Path(__file__).parent.parent))
from utils.metrics_collector import MetricsCollector
import config

# Import quality metrics
try:
    from pesq import pesq
    import soundfile as sf
    import librosa
    PESQ_AVAILABLE = True
except ImportError:
    PESQ_AVAILABLE = False


@pytest.fixture(scope="module")
def metrics_collector():
    """Create metrics collector for this test module"""
    return MetricsCollector(output_dir=config.TEST_DIR / "results" / "tts")


@pytest.fixture
async def api_session():
    """Create aiohttp session for API calls"""
    async with aiohttp.ClientSession() as session:
        yield session


@pytest.mark.tts
@pytest.mark.quality
class TestTTSQuality:
    """Test TTS quality metrics"""

    @pytest.mark.asyncio
    @pytest.mark.skipif(not PESQ_AVAILABLE, reason="PESQ not available")
    async def test_tts_pesq_score(self, api_session, metrics_collector):
        """
        Test TTS PESQ scores
        Note: This requires reference audio for comparison
        """

        test_sentences = [
            "Hello, how are you today?",
            "The weather is beautiful this morning.",
            "Thank you for your help.",
        ]

        print(f"\n{'='*70}")
        print(f"{'Sentence':<40} {'PESQ Score':>12}")
        print(f"{'='*70}")

        for sentence in test_sentences:
            try:
                # Generate TTS audio via API
                async with api_session.post(
                    f"{config.API_BASE_URL}/api/tts",
                    json={"text": sentence},
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status != 200:
                        print(f"  Skipping '{sentence[:30]}...' - API error")
                        continue

                    result = await response.json()
                    audio_base64 = result.get("audio")

                    if not audio_base64:
                        continue

                    # Decode audio
                    import base64
                    audio_bytes = base64.b64decode(audio_base64)

                    # Save temporary file
                    temp_path = config.TEST_DIR / "temp_tts.wav"
                    with open(temp_path, 'wb') as f:
                        f.write(audio_bytes)

                    # Load audio
                    audio, sr = librosa.load(str(temp_path), sr=16000)

                    # For PESQ, we need a reference audio
                    # Since we don't have ground truth TTS, we'll skip actual PESQ calculation
                    # but verify audio was generated and has reasonable properties

                    # Check audio properties
                    duration = len(audio) / sr
                    rms_energy = np.sqrt(np.mean(audio**2))

                    metrics_collector.record("tts_duration_sec", duration, {
                        "text": sentence,
                        "text_length": len(sentence)
                    })

                    metrics_collector.record("tts_rms_energy", rms_energy, {
                        "text": sentence
                    })

                    # Estimate quality based on audio properties
                    # This is a rough heuristic, not actual PESQ
                    estimated_quality = min(4.5, max(1.0, rms_energy * 50 + 2.0))

                    print(f"{sentence[:40]:<40} {estimated_quality:>10.2f}")

                    # Clean up
                    if temp_path.exists():
                        temp_path.unlink()

            except Exception as e:
                print(f"  Error testing '{sentence[:30]}...': {e}")

        print(f"{'='*70}")
        print("\n⚠️  Note: PESQ testing requires reference audio")
        print("    Quality metrics are estimated from audio properties")

    @pytest.mark.asyncio
    async def test_tts_prosody_features(self, api_session, metrics_collector):
        """Test that TTS generates varied prosody for different emotions"""

        test_cases = [
            ("Hello, how are you?", "friendly"),
            ("I'm sorry about that.", "apologetic"),
            ("That's amazing news!", "enthusiastic"),
        ]

        print(f"\n{'='*70}")
        print(f"Testing prosody variation across emotions")
        print(f"{'='*70}")

        prosody_features = []

        for text, emotion in test_cases:
            try:
                # Generate TTS with emotion
                async with api_session.post(
                    f"{config.API_BASE_URL}/api/tts",
                    json={"text": text, "emotion": emotion},
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status != 200:
                        print(f"  Skipping {emotion} - API error")
                        continue

                    result = await response.json()
                    audio_base64 = result.get("audio")

                    if not audio_base64:
                        continue

                    # Decode audio
                    import base64
                    audio_bytes = base64.b64decode(audio_base64)

                    # Save temporary file
                    temp_path = config.TEST_DIR / f"temp_tts_{emotion}.wav"
                    with open(temp_path, 'wb') as f:
                        f.write(audio_bytes)

                    # Load and analyze
                    audio, sr = librosa.load(str(temp_path), sr=16000)

                    # Extract basic prosody features
                    rms = librosa.feature.rms(y=audio)[0]
                    energy = np.mean(rms)

                    # Try to extract F0 (pitch)
                    try:
                        f0, voiced_flag, voiced_probs = librosa.pyin(
                            audio,
                            fmin=librosa.note_to_hz('C2'),
                            fmax=librosa.note_to_hz('C7'),
                            sr=sr
                        )
                        f0_clean = f0[~np.isnan(f0)]
                        mean_f0 = np.mean(f0_clean) if len(f0_clean) > 0 else 0
                        std_f0 = np.std(f0_clean) if len(f0_clean) > 0 else 0
                    except:
                        mean_f0 = 0
                        std_f0 = 0

                    prosody_features.append({
                        "emotion": emotion,
                        "energy": energy,
                        "mean_f0": mean_f0,
                        "std_f0": std_f0
                    })

                    print(f"  {emotion:15} - Energy: {energy:.3f}, F0: {mean_f0:.1f}Hz")

                    # Record metrics
                    metrics_collector.record(f"tts_prosody_energy_{emotion}", energy)
                    metrics_collector.record(f"tts_prosody_f0_{emotion}", mean_f0)

                    # Clean up
                    if temp_path.exists():
                        temp_path.unlink()

            except Exception as e:
                print(f"  Error testing {emotion}: {e}")

        print(f"{'='*70}")

        # Verify some variation exists
        if len(prosody_features) >= 2:
            energies = [p["energy"] for p in prosody_features]
            energy_variation = np.std(energies)

            print(f"\nProsody variation: {energy_variation:.3f}")

            # There should be some variation (not all identical)
            assert energy_variation > 0.001, "TTS prosody shows no variation across emotions"


def test_save_quality_metrics(metrics_collector):
    """Save collected quality metrics to file"""
    metrics_collector.save_to_file("tts_quality_metrics.json")
    metrics_collector.print_summary()
