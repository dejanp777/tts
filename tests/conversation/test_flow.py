"""
End-to-End Conversation Flow Tests

Tests complete conversation flows with simulated user interactions
"""
import pytest
import json
import sys
from pathlib import Path
import asyncio

# Add test utils to path
sys.path.append(str(Path(__file__).parent.parent))
from utils.conversation_simulator import ConversationSimulator
from utils.metrics_collector import MetricsCollector
import config


@pytest.fixture(scope="module")
def metrics_collector():
    """Create metrics collector for this test module"""
    return MetricsCollector(output_dir=config.TEST_DIR / "results" / "conversation")


@pytest.fixture
def conversation_scripts():
    """Load conversation scripts"""
    scripts_path = config.SCRIPTS_DIR / "test_conversations.json"

    if not scripts_path.exists():
        pytest.skip(f"Conversation scripts not found: {scripts_path}")

    with open(scripts_path, 'r') as f:
        return json.load(f)


@pytest.mark.conversation
@pytest.mark.integration
class TestConversationFlow:
    """Test end-to-end conversation flows"""

    @pytest.mark.asyncio
    async def test_quick_question(self, conversation_scripts, metrics_collector):
        """Test quick question-answer exchange"""

        # Find quick question script
        script_data = next(
            (c for c in conversation_scripts["conversations"]
             if c["name"] == "quick_question"),
            None
        )

        if not script_data:
            pytest.skip("Quick question script not found")

        print(f"\n{'='*70}")
        print(f"Testing: {script_data['description']}")
        print(f"{'='*70}")

        async with ConversationSimulator(config.API_BASE_URL) as sim:
            # Run conversation
            script = []
            for turn in script_data["turns"]:
                audio_path = config.FIXTURES_DIR / turn["audio_file"]
                if not audio_path.exists():
                    pytest.skip(f"Audio file not found: {audio_path}")

                script.append({
                    "user": str(audio_path),
                    "expect_keywords": turn.get("expect_keywords", [])
                })

            results = await sim.run_conversation(script)

            # Verify results
            assert len(results) > 0, "No results returned"

            for result in results:
                # Record metrics
                metrics_collector.record("conversation_latency_ms",
                                        result["total_time_ms"], {
                    "conversation": "quick_question",
                    "turn": result["turn"]
                })

                # Verify validation passed
                assert result["validation_passed"], \
                    f"Turn {result['turn']} validation failed"

            # Get summary
            summary = sim.get_metrics_summary()
            print(f"\nConversation Summary:")
            print(f"  Total turns: {summary['total_turns']}")
            print(f"  Success rate: {summary['success_rate']:.0%}")
            print(f"  Avg latency: {summary['avg_total_latency_ms']:.0f}ms")

            # Assert success
            assert summary['success_rate'] == 1.0, \
                "Some turns failed validation"

            # Assert reasonable latency
            assert summary['avg_total_latency_ms'] < config.END_TO_END_LATENCY_P95_MS, \
                f"Average latency ({summary['avg_total_latency_ms']:.0f}ms) exceeds threshold"

    @pytest.mark.asyncio
    async def test_multi_turn_context(self, conversation_scripts, metrics_collector):
        """Test multi-turn conversation with context preservation"""

        # Find multi-turn script
        script_data = next(
            (c for c in conversation_scripts["conversations"]
             if c["name"] == "multi_turn_context"),
            None
        )

        if not script_data:
            pytest.skip("Multi-turn context script not found")

        print(f"\n{'='*70}")
        print(f"Testing: {script_data['description']}")
        print(f"{'='*70}")

        async with ConversationSimulator(config.API_BASE_URL) as sim:
            # Build script
            script = []
            for turn in script_data["turns"]:
                audio_path = config.FIXTURES_DIR / turn["audio_file"]
                if not audio_path.exists():
                    # Skip if audio not found, but warn
                    print(f"⚠️  Audio file not found: {audio_path.name}")
                    pytest.skip(f"Required audio missing: {audio_path}")

                script.append({
                    "user": str(audio_path),
                    "expect_keywords": turn.get("expect_keywords", [])
                })

            results = await sim.run_conversation(script)

            # Verify results
            assert len(results) == len(script), \
                f"Expected {len(script)} turns, got {len(results)}"

            # Check that context was preserved (second turn should reference first)
            if len(results) >= 2:
                # The second turn asks "What's my name?" and should get "Alice"
                second_response = results[1]["assistant_text"].lower()
                assert "alice" in second_response, \
                    "Context not preserved: assistant forgot user's name"

            # Record metrics
            for result in results:
                metrics_collector.record("conversation_context_latency_ms",
                                        result["total_time_ms"], {
                    "conversation": "multi_turn_context",
                    "turn": result["turn"]
                })

            # Get summary
            summary = sim.get_metrics_summary()
            print(f"\nConversation Summary:")
            print(f"  Success rate: {summary['success_rate']:.0%}")

            assert summary['success_rate'] == 1.0, \
                "Context preservation test failed"

    @pytest.mark.asyncio
    async def test_polite_exchange(self, conversation_scripts, metrics_collector):
        """Test polite conversation flow"""

        # Find polite exchange script
        script_data = next(
            (c for c in conversation_scripts["conversations"]
             if c["name"] == "polite_exchange"),
            None
        )

        if not script_data:
            pytest.skip("Polite exchange script not found")

        print(f"\n{'='*70}")
        print(f"Testing: {script_data['description']}")
        print(f"{'='*70}")

        async with ConversationSimulator(config.API_BASE_URL) as sim:
            # Build script
            script = []
            for turn in script_data["turns"]:
                audio_path = config.FIXTURES_DIR / turn["audio_file"]
                if not audio_path.exists():
                    pytest.skip(f"Audio file not found: {audio_path}")

                script.append({
                    "user": str(audio_path),
                    "expect_keywords": turn.get("expect_keywords", [])
                })

            results = await sim.run_conversation(script)

            # Verify results
            for result in results:
                metrics_collector.record("conversation_polite_latency_ms",
                                        result["total_time_ms"], {
                    "turn": result["turn"]
                })

                assert result["validation_passed"], \
                    f"Turn {result['turn']} validation failed"

            summary = sim.get_metrics_summary()
            assert summary['success_rate'] > 0.8, \
                f"Success rate too low: {summary['success_rate']:.0%}"

    @pytest.mark.asyncio
    async def test_end_to_end_latency_threshold(self, metrics_collector):
        """Test that end-to-end latency meets threshold"""

        # Get all conversation latency metrics
        stats = metrics_collector.get_stats("conversation_latency_ms")

        if not stats or stats['count'] == 0:
            pytest.skip("No conversation metrics collected")

        print(f"\n{'='*70}")
        print(f"End-to-End Latency Statistics:")
        print(f"  Count: {stats['count']}")
        print(f"  Mean:   {stats['mean']:.0f}ms")
        print(f"  Median: {stats['median']:.0f}ms")
        print(f"  p95:    {stats['p95']:.0f}ms")
        print(f"  p99:    {stats['p99']:.0f}ms")
        print(f"{'='*70}")

        # Assert p95 is within threshold
        assert stats['p95'] < config.END_TO_END_LATENCY_P95_MS, \
            f"p95 latency ({stats['p95']:.0f}ms) exceeds threshold ({config.END_TO_END_LATENCY_P95_MS}ms)"

        # Warn if above target
        if stats['mean'] > config.END_TO_END_TARGET_MS:
            print(f"\n⚠️  Warning: Mean latency ({stats['mean']:.0f}ms) exceeds target ({config.END_TO_END_TARGET_MS}ms)")


def test_save_conversation_metrics(metrics_collector):
    """Save collected conversation metrics to file"""
    metrics_collector.save_to_file("conversation_metrics.json")
    metrics_collector.print_summary()
