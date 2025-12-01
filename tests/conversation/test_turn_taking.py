"""
Turn-Taking Accuracy Tests

Tests backchannel detection, interruption handling, and silence threshold
"""
import pytest
import json
import sys
from pathlib import Path
import asyncio
import time

# Add test utils to path
sys.path.append(str(Path(__file__).parent.parent))
from utils.conversation_simulator import TurnTakingTester
from utils.metrics_collector import MetricsCollector, send_alert
import config


@pytest.fixture(scope="module")
def metrics_collector():
    """Create metrics collector for this test module"""
    return MetricsCollector(output_dir=config.TEST_DIR / "results" / "conversation")


@pytest.fixture
def conversation_scripts():
    """Load conversation scripts with backchannel samples"""
    scripts_path = config.SCRIPTS_DIR / "test_conversations.json"

    if not scripts_path.exists():
        pytest.skip(f"Conversation scripts not found: {scripts_path}")

    with open(scripts_path, 'r') as f:
        return json.load(f)


@pytest.mark.conversation
@pytest.mark.integration
@pytest.mark.slow
class TestTurnTaking:
    """Test turn-taking accuracy"""

    @pytest.mark.asyncio
    async def test_backchannel_no_interrupt(self, conversation_scripts, metrics_collector):
        """
        Test that backchannels (mm-hmm, uh-huh) don't interrupt AI
        This is critical for natural conversation flow
        """

        backchannel_samples = conversation_scripts.get("backchannel_samples", [])

        if not backchannel_samples:
            pytest.skip("No backchannel samples found")

        print(f"\n{'='*70}")
        print(f"Testing backchannel detection (should NOT interrupt)")
        print(f"{'='*70}")

        tester = TurnTakingTester(config.API_BASE_URL)

        results = []

        for bc in backchannel_samples:
            audio_path = config.FIXTURES_DIR / bc["audio_file"]

            if not audio_path.exists():
                print(f"  Skipping {bc['text']} - audio not found")
                continue

            try:
                # Test that backchannel doesn't interrupt
                did_not_interrupt = await tester.test_backchannel_no_interrupt(audio_path)

                result = {
                    "text": bc["text"],
                    "passed": did_not_interrupt,
                    "expected": "no_interrupt"
                }

                results.append(result)

                # Record metric
                metrics_collector.record("backchannel_test",
                                        1.0 if did_not_interrupt else 0.0, {
                    "text": bc["text"],
                    "duration_ms": bc.get("duration_ms", 0)
                })

                status = "✓ PASS" if did_not_interrupt else "✗ FAIL"
                print(f"  {bc['text']:15} - {status}")

            except Exception as e:
                print(f"  {bc['text']:15} - Error: {e}")

        # Calculate success rate
        if results:
            passed = sum(1 for r in results if r["passed"])
            total = len(results)
            success_rate = passed / total

            print(f"\n{'='*70}")
            print(f"Backchannel Detection Success Rate: {success_rate:.0%} ({passed}/{total})")
            print(f"{'='*70}")

            # Record overall metric
            metrics_collector.record("backchannel_accuracy", success_rate)

            # Should have high accuracy
            assert success_rate >= 0.75, \
                f"Backchannel detection accuracy too low: {success_rate:.0%}"

            # Warn if not perfect
            if success_rate < 1.0:
                send_alert(
                    "Backchannel detection not perfect",
                    {"success_rate": f"{success_rate:.0%}", "failures": total - passed}
                )

    @pytest.mark.asyncio
    async def test_true_interruption(self, conversation_scripts, metrics_collector):
        """
        Test that true interruptions DO stop AI
        """

        interruption_samples = conversation_scripts.get("interruption_samples", [])

        if not interruption_samples:
            pytest.skip("No interruption samples found")

        print(f"\n{'='*70}")
        print(f"Testing interruption handling (SHOULD interrupt)")
        print(f"{'='*70}")

        tester = TurnTakingTester(config.API_BASE_URL)

        results = []

        for intr in interruption_samples:
            audio_path = config.FIXTURES_DIR / intr["audio_file"]

            if not audio_path.exists():
                print(f"  Skipping {intr['text'][:20]}... - audio not found")
                continue

            try:
                # Test that interruption stops AI
                did_interrupt = await tester.test_true_interruption(audio_path)

                result = {
                    "text": intr["text"],
                    "passed": did_interrupt,
                    "expected": "interrupt"
                }

                results.append(result)

                # Record metric
                metrics_collector.record("interruption_test",
                                        1.0 if did_interrupt else 0.0, {
                    "text": intr["text"]
                })

                status = "✓ PASS" if did_interrupt else "✗ FAIL"
                print(f"  {intr['text'][:30]:32} - {status}")

            except Exception as e:
                print(f"  {intr['text'][:30]:32} - Error: {e}")

        # Calculate success rate
        if results:
            passed = sum(1 for r in results if r["passed"])
            total = len(results)
            success_rate = passed / total

            print(f"\n{'='*70}")
            print(f"Interruption Handling Success Rate: {success_rate:.0%} ({passed}/{total})")
            print(f"{'='*70}")

            # Record overall metric
            metrics_collector.record("interruption_accuracy", success_rate)

            # Should have high accuracy
            assert success_rate >= 0.75, \
                f"Interruption handling accuracy too low: {success_rate:.0%}"

    @pytest.mark.asyncio
    async def test_false_interruption_rate(self, metrics_collector):
        """
        Calculate false interruption rate
        False interruptions are when backchannels incorrectly trigger interruption
        """

        # Get backchannel test results
        backchannel_stats = metrics_collector.get_stats("backchannel_test")

        if not backchannel_stats or backchannel_stats['count'] == 0:
            pytest.skip("No backchannel metrics collected")

        # False interruption = 1 - backchannel accuracy
        backchannel_accuracy = backchannel_stats['mean']
        false_interruption_rate = 1.0 - backchannel_accuracy

        print(f"\n{'='*70}")
        print(f"False Interruption Rate: {false_interruption_rate:.1%}")
        print(f"Threshold: {config.FALSE_INTERRUPTION_RATE_MAX:.1%}")
        print(f"{'='*70}")

        # Record metric
        metrics_collector.record("false_interruption_rate", false_interruption_rate)

        # Assert under threshold
        assert false_interruption_rate <= config.FALSE_INTERRUPTION_RATE_MAX, \
            f"False interruption rate ({false_interruption_rate:.1%}) exceeds threshold ({config.FALSE_INTERRUPTION_RATE_MAX:.1%})"

        if false_interruption_rate > config.FALSE_INTERRUPTION_RATE_MAX * 0.5:
            print(f"\n⚠️  Warning: False interruption rate is approaching threshold")

    @pytest.mark.asyncio
    async def test_overall_turn_taking_accuracy(self, metrics_collector):
        """
        Calculate overall turn-taking accuracy
        Combines backchannel and interruption accuracy
        """

        backchannel_acc = metrics_collector.get_stats("backchannel_accuracy")
        interruption_acc = metrics_collector.get_stats("interruption_accuracy")

        if not backchannel_acc or not interruption_acc:
            pytest.skip("Insufficient metrics for overall accuracy calculation")

        # Overall accuracy is average of both
        overall_accuracy = (backchannel_acc['mean'] + interruption_acc['mean']) / 2

        print(f"\n{'='*70}")
        print(f"Turn-Taking Accuracy Breakdown:")
        print(f"  Backchannel detection: {backchannel_acc['mean']:.0%}")
        print(f"  Interruption handling: {interruption_acc['mean']:.0%}")
        print(f"  Overall accuracy:      {overall_accuracy:.0%}")
        print(f"{'='*70}")
        print(f"Minimum threshold: {config.TURN_TAKING_ACCURACY_MIN:.0%}")
        print(f"{'='*70}")

        # Record overall metric
        metrics_collector.record("turn_taking_overall_accuracy", overall_accuracy)

        # Assert meets threshold
        assert overall_accuracy >= config.TURN_TAKING_ACCURACY_MIN, \
            f"Turn-taking accuracy ({overall_accuracy:.0%}) below minimum ({config.TURN_TAKING_ACCURACY_MIN:.0%})"

        if overall_accuracy < 0.95:
            print(f"\n⚠️  Note: Turn-taking accuracy could be improved")


def test_save_turn_taking_metrics(metrics_collector):
    """Save collected turn-taking metrics to file"""
    metrics_collector.save_to_file("turn_taking_metrics.json")
    metrics_collector.print_summary()
