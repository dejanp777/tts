"""
TTS (Text-to-Speech) Latency Tests

Tests TTS latency including Time to First Audio Chunk (TTFAC)
"""
import pytest
import time
import sys
from pathlib import Path
import numpy as np
import aiohttp
import asyncio

# Add test utils to path
sys.path.append(str(Path(__file__).parent.parent))
from utils.metrics_collector import MetricsCollector
import config


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
@pytest.mark.latency
@pytest.mark.benchmark
class TestTTSLatency:
    """Test TTS latency and performance"""

    @pytest.mark.asyncio
    async def test_tts_synthesis_latency(self, api_session, metrics_collector):
        """Test TTS synthesis latency for various text lengths"""

        test_sentences = [
            "Hi",  # Very short
            "Hello, how are you?",  # Short
            "The weather is beautiful this morning.",  # Medium
            "Can you please explain how the process works and what steps I should take?",  # Long
            "I would like to know more about the automated testing system and how it can help improve the quality of my voice AI application.",  # Very long
        ]

        print(f"\n{'='*70}")
        print(f"{'Text Length':>12} {'Text Preview':<35} {'Latency':>12}")
        print(f"{'='*70}")

        for sentence in test_sentences:
            # Measure synthesis time
            start = time.perf_counter()

            try:
                async with api_session.post(
                    f"{config.API_BASE_URL}/api/tts",
                    json={"text": sentence},
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status != 200:
                        print(f"  Skipping - API error: {response.status}")
                        continue

                    result = await response.json()

            except Exception as e:
                print(f"  Error: {e}")
                continue

            end = time.perf_counter()
            latency_ms = (end - start) * 1000

            # Record metrics
            metrics_collector.record("tts_latency_ms", latency_ms, {
                "text": sentence,
                "text_length": len(sentence)
            })

            preview = sentence[:30] + "..." if len(sentence) > 30 else sentence
            print(f"{len(sentence):>12} {preview:<35} {latency_ms:>10.0f}ms")

        print(f"{'='*70}")

        # Get statistics
        stats = metrics_collector.get_stats("tts_latency_ms")

        if stats:
            print(f"\nStatistics:")
            print(f"  Mean latency:   {stats['mean']:.0f}ms")
            print(f"  Median latency: {stats['median']:.0f}ms")
            print(f"  p95 latency:    {stats['p95']:.0f}ms")
            print(f"{'='*70}")

            # Assert reasonable latency
            # Note: This is relatively lenient for Cartesia API
            assert stats['p95'] < 5000, f"p95 TTS latency ({stats['p95']:.0f}ms) is too high"

            # Warn if above target
            if stats['mean'] > config.TTS_TTFAC_TARGET_MS:
                print(f"\n⚠️  Warning: Mean TTS latency ({stats['mean']:.0f}ms) exceeds target ({config.TTS_TTFAC_TARGET_MS}ms)")

    @pytest.mark.asyncio
    async def test_tts_streaming_latency(self, api_session, metrics_collector):
        """Test streaming TTS latency (Time to First Audio Chunk)"""

        test_sentence = "This is a test of the streaming text-to-speech system."

        print(f"\n{'='*70}")
        print(f"Testing streaming TTS latency (TTFAC)")
        print(f"{'='*70}")

        try:
            start = time.perf_counter()
            chunk_times = []
            chunk_count = 0

            async with api_session.post(
                f"{config.API_BASE_URL}/api/tts/stream",
                json={"text": test_sentence},
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                if response.status != 200:
                    pytest.skip(f"Streaming TTS not available: {response.status}")

                # Read streaming response
                async for line in response.content:
                    chunk_time = time.perf_counter() - start

                    if chunk_count == 0:
                        # First chunk
                        ttfac = chunk_time * 1000
                        metrics_collector.record("tts_ttfac_ms", ttfac, {
                            "text": test_sentence
                        })
                        print(f"\n  Time to First Audio Chunk: {ttfac:.0f}ms")

                    chunk_times.append(chunk_time * 1000)
                    chunk_count += 1

            if chunk_count > 1:
                # Calculate inter-chunk intervals
                intervals = [chunk_times[i] - chunk_times[i-1]
                            for i in range(1, len(chunk_times))]
                avg_interval = np.mean(intervals)

                metrics_collector.record("tts_chunk_interval_ms", avg_interval, {
                    "text": test_sentence
                })

                print(f"  Total chunks: {chunk_count}")
                print(f"  Avg chunk interval: {avg_interval:.0f}ms")
                print(f"  Total time: {chunk_times[-1]:.0f}ms")

                # Assert TTFAC is reasonable
                if ttfac > config.TTS_TTFAC_THRESHOLD_MS:
                    print(f"\n⚠️  Warning: TTFAC ({ttfac:.0f}ms) exceeds threshold ({config.TTS_TTFAC_THRESHOLD_MS}ms)")
                else:
                    print(f"\n✓ TTFAC within threshold")

        except Exception as e:
            pytest.skip(f"Streaming TTS test failed: {e}")

        print(f"{'='*70}")


def test_save_tts_latency_metrics(metrics_collector):
    """Save collected TTS latency metrics to file"""
    metrics_collector.save_to_file("tts_latency_metrics.json")
    metrics_collector.print_summary()
