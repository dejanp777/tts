"""
Generate test audio samples for ground truth database
"""
import json
from pathlib import Path
from gtts import gTTS
import numpy as np
import soundfile as sf
import sys

# Add parent to path
sys.path.append(str(Path(__file__).parent.parent))
from utils.audio_generator import add_noise, concatenate_audio, generate_silence, load_audio


def generate_clean_samples():
    """Generate clean audio samples from text"""

    audio_dir = Path(__file__).parent / "audio" / "clean_samples"
    audio_dir.mkdir(parents=True, exist_ok=True)

    samples = [
        ("What's the weather today?", "weather_question.wav"),
        ("My name is Alice", "name_alice.wav"),
        ("What's my name?", "whats_my_name.wav"),
        ("I want to order a pizza", "pizza_order.wav"),
        ("Can you help me?", "can_you_help.wav"),
        ("Thank you", "thank_you.wav"),
        ("Can you explain how photosynthesis works in plants?", "photosynthesis_question.wav"),
        ("Wait, I have a question", "wait_question.wav"),
        ("Hold on a second", "hold_on.wav"),
        ("No, that's not what I meant", "no_not_what_i_meant.wav"),
    ]

    print("Generating clean audio samples...")
    for text, filename in samples:
        output_path = audio_dir / filename

        # Generate TTS
        tts = gTTS(text=text, lang='en', slow=False)
        temp_mp3 = audio_dir / "temp.mp3"
        tts.save(str(temp_mp3))

        # Convert MP3 to WAV at 16kHz
        import subprocess
        subprocess.run([
            "ffmpeg", "-i", str(temp_mp3), "-ar", "16000", "-ac", "1",
            "-y", str(output_path)
        ], capture_output=True)

        temp_mp3.unlink()
        print(f"  ✓ {filename}")

    # Generate thinking pause sample
    print("  Generating thinking_pause_pizza.wav...")
    try:
        # Load pizza audio
        pizza_audio, sr = load_audio(audio_dir / "pizza_order.wav", sample_rate=16000)

        # Split roughly in half
        split_point = len(pizza_audio) // 2
        part1 = pizza_audio[:split_point]
        part2 = pizza_audio[split_point:]

        # Add 1.5s pause
        pause = generate_silence(1.5, sample_rate=16000)

        # Concatenate
        with_pause = concatenate_audio([part1, pause, part2])

        # Save
        sf.write(str(audio_dir / "thinking_pause_pizza.wav"), with_pause, 16000)
        print(f"  ✓ thinking_pause_pizza.wav")
    except Exception as e:
        print(f"  ✗ Failed to create thinking pause: {e}")


def generate_backchannel_samples():
    """Generate backchannel audio samples"""

    audio_dir = Path(__file__).parent / "audio" / "backchannel_samples"
    audio_dir.mkdir(parents=True, exist_ok=True)

    backchannels = [
        ("mm-hmm", "mmhmm.wav"),
        ("uh-huh", "uhhuh.wav"),
        ("yeah", "yeah.wav"),
        ("okay", "okay.wav"),
    ]

    print("\nGenerating backchannel samples...")
    for text, filename in backchannels:
        output_path = audio_dir / filename

        # Generate TTS
        tts = gTTS(text=text, lang='en', slow=False)
        temp_mp3 = audio_dir / "temp.mp3"
        tts.save(str(temp_mp3))

        # Convert MP3 to WAV at 16kHz
        import subprocess
        subprocess.run([
            "ffmpeg", "-i", str(temp_mp3), "-ar", "16000", "-ac", "1",
            "-y", str(output_path)
        ], capture_output=True)

        temp_mp3.unlink()
        print(f"  ✓ {filename}")


def generate_noisy_samples():
    """Generate noisy versions of clean samples"""

    clean_dir = Path(__file__).parent / "audio" / "clean_samples"
    noisy_dir = Path(__file__).parent / "audio" / "noisy_samples"
    noisy_dir.mkdir(parents=True, exist_ok=True)

    snr_levels = [20, 10, 5]  # dB

    print("\nGenerating noisy samples...")

    # Get all clean samples
    clean_files = list(clean_dir.glob("*.wav"))

    for clean_file in clean_files:
        try:
            # Load clean audio
            audio, sr = load_audio(clean_file, sample_rate=16000)

            for snr in snr_levels:
                # Add noise
                noisy = add_noise(audio, snr)

                # Save
                output_filename = f"{clean_file.stem}_snr{snr}db.wav"
                output_path = noisy_dir / output_filename
                sf.write(str(output_path), noisy, sr)

            print(f"  ✓ {clean_file.name} (SNR: {snr_levels}dB)")
        except Exception as e:
            print(f"  ✗ Failed to process {clean_file.name}: {e}")


def create_ground_truth_manifest():
    """Create manifest of all ground truth audio with transcriptions"""

    manifest = {
        "clean_samples": {},
        "noisy_samples": {},
        "backchannel_samples": {}
    }

    # Load conversations
    scripts_path = Path(__file__).parent / "scripts" / "test_conversations.json"
    with open(scripts_path, 'r') as f:
        conversations = json.load(f)

    # Map clean samples
    for conv in conversations["conversations"]:
        for turn in conv["turns"]:
            filename = Path(turn["audio_file"]).name
            manifest["clean_samples"][filename] = {
                "text": turn["user_text"],
                "keywords": turn.get("expect_keywords", []),
                "notes": turn.get("note", "")
            }

    # Map backchannel samples
    for bc in conversations["backchannel_samples"]:
        filename = Path(bc["audio_file"]).name
        manifest["backchannel_samples"][filename] = {
            "text": bc["text"],
            "duration_ms": bc["duration_ms"],
            "should_not_interrupt": bc["should_not_interrupt"]
        }

    # Map interruption samples
    for intr in conversations["interruption_samples"]:
        filename = Path(intr["audio_file"]).name
        if filename not in manifest["clean_samples"]:
            manifest["clean_samples"][filename] = {
                "text": intr["text"],
                "should_interrupt": intr["should_interrupt"]
            }

    # Generate noisy sample entries
    for clean_file, data in manifest["clean_samples"].items():
        for snr in [20, 10, 5]:
            noisy_filename = f"{Path(clean_file).stem}_snr{snr}db.wav"
            manifest["noisy_samples"][noisy_filename] = {
                **data,
                "snr_db": snr,
                "source": clean_file
            }

    # Save manifest
    manifest_path = Path(__file__).parent / "audio" / "ground_truth_manifest.json"
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"\n✓ Ground truth manifest created: {manifest_path}")
    print(f"  Clean samples: {len(manifest['clean_samples'])}")
    print(f"  Noisy samples: {len(manifest['noisy_samples'])}")
    print(f"  Backchannel samples: {len(manifest['backchannel_samples'])}")


if __name__ == "__main__":
    print("=" * 80)
    print("Generating Test Audio Ground Truth Database")
    print("=" * 80)

    try:
        generate_clean_samples()
        generate_backchannel_samples()
        generate_noisy_samples()
        create_ground_truth_manifest()

        print("\n" + "=" * 80)
        print("✓ All test audio generated successfully!")
        print("=" * 80)
    except Exception as e:
        print(f"\n✗ Error generating test audio: {e}")
        import traceback
        traceback.print_exc()
