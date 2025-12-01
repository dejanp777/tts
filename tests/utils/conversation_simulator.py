"""
Automated conversation simulator for testing voice AI
"""
import asyncio
import time
import json
from typing import List, Dict, Optional, Any
from pathlib import Path
import aiohttp
import websockets


class ConversationSimulator:
    """
    Simulates a human user interacting with the voice AI system.
    Sends audio, waits for responses, measures timing, validates responses.
    """

    def __init__(self, api_base_url: str = "http://localhost:3000"):
        self.api_base_url = api_base_url
        self.ws_url = api_base_url.replace("http://", "ws://").replace("https://", "wss://")
        self.conversation_history: List[Dict[str, str]] = []
        self.metrics: List[Dict[str, Any]] = []
        self.session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def send_audio(self, audio_data: bytes, mime_type: str = "audio/wav") -> Dict[str, Any]:
        """
        Send audio to the voice AI system via HTTP API

        Args:
            audio_data: Raw audio bytes
            mime_type: MIME type of audio

        Returns:
            Response dictionary with text and timing
        """
        if not self.session:
            raise RuntimeError("Session not initialized. Use async with context manager.")

        start_time = time.perf_counter()

        try:
            # Send to transcription endpoint
            form_data = aiohttp.FormData()
            form_data.add_field('audio', audio_data, content_type=mime_type)

            async with self.session.post(
                f"{self.api_base_url}/api/transcribe",
                data=form_data,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Transcription failed: {response.status} - {error_text}")

                result = await response.json()
                transcription_time = time.perf_counter() - start_time

            # Get AI response
            chat_start = time.perf_counter()
            async with self.session.post(
                f"{self.api_base_url}/api/chat",
                json={"message": result.get("text", "")},
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Chat failed: {response.status} - {error_text}")

                chat_result = await response.json()
                chat_time = time.perf_counter() - chat_start

            total_time = time.perf_counter() - start_time

            return {
                "user_text": result.get("text", ""),
                "assistant_text": chat_result.get("response", ""),
                "transcription_time_ms": transcription_time * 1000,
                "chat_time_ms": chat_time * 1000,
                "total_time_ms": total_time * 1000,
                "success": True
            }

        except Exception as e:
            return {
                "error": str(e),
                "success": False,
                "total_time_ms": (time.perf_counter() - start_time) * 1000
            }

    async def run_conversation(self, script: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Run a scripted conversation

        Args:
            script: List of conversation turns, e.g.:
                [
                    {"user": "audio_path.wav", "expect_keyword": "weather"},
                    {"user": "audio_path2.wav", "expect_keywords": ["thank", "you"]}
                ]

        Returns:
            List of metrics for each turn
        """
        results = []

        for i, turn in enumerate(script):
            print(f"\n--- Turn {i + 1}/{len(script)} ---")

            # Load audio if path is provided
            if isinstance(turn["user"], (str, Path)):
                audio_path = Path(turn["user"])
                if not audio_path.exists():
                    print(f"Warning: Audio file not found: {audio_path}")
                    continue

                with open(audio_path, 'rb') as f:
                    audio_data = f.read()
            else:
                audio_data = turn["user"]

            # Send audio and get response
            response = await self.send_audio(audio_data)

            if not response["success"]:
                print(f"❌ Turn failed: {response.get('error')}")
                results.append(response)
                continue

            # Validate response
            validation_passed = True
            if "expect_keyword" in turn:
                keyword = turn["expect_keyword"].lower()
                if keyword not in response["assistant_text"].lower():
                    print(f"❌ Expected keyword '{keyword}' not found in response")
                    validation_passed = False

            if "expect_keywords" in turn:
                keywords = [k.lower() for k in turn["expect_keywords"]]
                found = [k for k in keywords if k in response["assistant_text"].lower()]
                if len(found) < len(keywords):
                    missing = [k for k in keywords if k not in found]
                    print(f"❌ Missing keywords: {missing}")
                    validation_passed = False

            # Record metrics
            turn_metrics = {
                "turn": i + 1,
                "user_text": response["user_text"],
                "assistant_text": response["assistant_text"],
                "transcription_time_ms": response["transcription_time_ms"],
                "chat_time_ms": response["chat_time_ms"],
                "total_time_ms": response["total_time_ms"],
                "validation_passed": validation_passed
            }

            results.append(turn_metrics)
            self.metrics.append(turn_metrics)

            # Add to conversation history
            self.conversation_history.append({
                "user": response["user_text"],
                "assistant": response["assistant_text"]
            })

            print(f"✓ User: {response['user_text']}")
            print(f"✓ Assistant: {response['assistant_text']}")
            print(f"✓ Latency: {response['total_time_ms']:.0f}ms")

            # Small delay between turns
            await asyncio.sleep(0.5)

        return results

    async def check_ai_speaking(self) -> bool:
        """
        Check if AI is currently speaking

        Returns:
            True if AI is speaking, False otherwise
        """
        try:
            if not self.session:
                return False

            async with self.session.get(
                f"{self.api_base_url}/api/status",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                if response.status == 200:
                    status = await response.json()
                    return status.get("is_playing", False)
        except Exception as e:
            print(f"Error checking AI speaking status: {e}")

        return False

    def get_metrics_summary(self) -> Dict[str, Any]:
        """
        Get summary of conversation metrics

        Returns:
            Dictionary with average latencies and success rate
        """
        if not self.metrics:
            return {}

        successful = [m for m in self.metrics if m.get("validation_passed", False)]

        return {
            "total_turns": len(self.metrics),
            "successful_turns": len(successful),
            "success_rate": len(successful) / len(self.metrics) if self.metrics else 0,
            "avg_total_latency_ms": sum(m["total_time_ms"] for m in self.metrics) / len(self.metrics),
            "avg_transcription_time_ms": sum(m.get("transcription_time_ms", 0) for m in self.metrics) / len(self.metrics),
            "avg_chat_time_ms": sum(m.get("chat_time_ms", 0) for m in self.metrics) / len(self.metrics),
            "min_latency_ms": min(m["total_time_ms"] for m in self.metrics),
            "max_latency_ms": max(m["total_time_ms"] for m in self.metrics),
        }

    def save_conversation(self, output_path: Path):
        """
        Save conversation history to file

        Args:
            output_path: Path to save conversation JSON
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "conversation_history": self.conversation_history,
            "metrics": self.metrics,
            "summary": self.get_metrics_summary()
        }

        with open(output_path, 'w') as f:
            json.dump(data, f, indent=2)

        print(f"Conversation saved to {output_path}")


class TurnTakingTester:
    """
    Specialized tester for turn-taking accuracy
    """

    def __init__(self, api_base_url: str = "http://localhost:3000"):
        self.api_base_url = api_base_url
        self.simulator = ConversationSimulator(api_base_url)

    async def test_backchannel_no_interrupt(self, backchannel_audio_path: Path) -> bool:
        """
        Test that backchannel ("mm-hmm") doesn't interrupt AI

        Args:
            backchannel_audio_path: Path to backchannel audio file

        Returns:
            True if test passed (AI continued speaking)
        """
        async with self.simulator:
            # TODO: Start AI speaking with long response
            # await self.simulator.start_ai_response()
            await asyncio.sleep(1.0)

            # Check AI is speaking
            was_speaking = await self.simulator.check_ai_speaking()

            # Send backchannel
            with open(backchannel_audio_path, 'rb') as f:
                backchannel_data = f.read()

            await self.simulator.send_audio(backchannel_data)

            # Wait a bit
            await asyncio.sleep(0.5)

            # Check AI is still speaking
            still_speaking = await self.simulator.check_ai_speaking()

            return was_speaking and still_speaking

    async def test_true_interruption(self, interrupt_audio_path: Path) -> bool:
        """
        Test that true interruptions stop AI

        Args:
            interrupt_audio_path: Path to interruption audio

        Returns:
            True if test passed (AI stopped)
        """
        async with self.simulator:
            # TODO: Start AI speaking
            await asyncio.sleep(0.5)

            # Send interruption
            with open(interrupt_audio_path, 'rb') as f:
                interrupt_data = f.read()

            await self.simulator.send_audio(interrupt_data)

            # Wait for AI to stop
            await asyncio.sleep(0.5)

            # Check AI stopped
            is_speaking = await self.simulator.check_ai_speaking()

            return not is_speaking

    async def measure_silence_threshold(self, test_audios: List[Path]) -> Dict[str, Any]:
        """
        Measure effective silence threshold by testing various pause durations

        Args:
            test_audios: List of audio files with different pause durations

        Returns:
            Dictionary with threshold measurements
        """
        results = []

        async with self.simulator:
            for audio_path in test_audios:
                start = time.perf_counter()

                with open(audio_path, 'rb') as f:
                    audio_data = f.read()

                response = await self.simulator.send_audio(audio_data)
                end = time.perf_counter()

                results.append({
                    "audio_file": audio_path.name,
                    "response_time_ms": (end - start) * 1000,
                    "success": response["success"]
                })

        return {
            "test_count": len(results),
            "results": results,
            "avg_response_time_ms": sum(r["response_time_ms"] for r in results) / len(results) if results else 0
        }
