"""
Audio generation utilities for testing
"""
import numpy as np
import soundfile as sf
from pathlib import Path
from typing import Optional
import librosa


def add_noise(audio: np.ndarray, snr_db: float) -> np.ndarray:
    """
    Add white noise to audio at specified SNR level

    Args:
        audio: Clean audio signal
        snr_db: Signal-to-noise ratio in decibels

    Returns:
        Noisy audio signal
    """
    rms_audio = np.sqrt(np.mean(audio**2))
    rms_noise = rms_audio / (10**(snr_db / 20))
    noise = np.random.normal(0, rms_noise, len(audio))
    return audio + noise


def generate_silence(duration_sec: float, sample_rate: int = 16000) -> np.ndarray:
    """
    Generate silence

    Args:
        duration_sec: Duration in seconds
        sample_rate: Sample rate in Hz

    Returns:
        Silence audio signal
    """
    num_samples = int(duration_sec * sample_rate)
    return np.zeros(num_samples, dtype=np.float32)


def generate_tone(frequency: float, duration_sec: float, sample_rate: int = 16000) -> np.ndarray:
    """
    Generate a pure tone

    Args:
        frequency: Frequency in Hz
        duration_sec: Duration in seconds
        sample_rate: Sample rate in Hz

    Returns:
        Tone audio signal
    """
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), False)
    tone = np.sin(2 * np.pi * frequency * t)
    return tone.astype(np.float32)


def concatenate_audio(segments: list[np.ndarray], pause_sec: float = 0.0,
                      sample_rate: int = 16000) -> np.ndarray:
    """
    Concatenate audio segments with optional pauses

    Args:
        segments: List of audio arrays
        pause_sec: Pause duration between segments in seconds
        sample_rate: Sample rate in Hz

    Returns:
        Concatenated audio signal
    """
    if pause_sec > 0:
        pause = generate_silence(pause_sec, sample_rate)
        segments_with_pauses = []
        for i, segment in enumerate(segments):
            segments_with_pauses.append(segment)
            if i < len(segments) - 1:
                segments_with_pauses.append(pause)
        segments = segments_with_pauses

    return np.concatenate(segments)


def change_speed(audio: np.ndarray, speed_factor: float, sample_rate: int = 16000) -> np.ndarray:
    """
    Change audio playback speed

    Args:
        audio: Input audio
        speed_factor: Speed multiplier (>1 = faster, <1 = slower)
        sample_rate: Sample rate in Hz

    Returns:
        Speed-adjusted audio
    """
    return librosa.effects.time_stretch(audio, rate=speed_factor)


def change_pitch(audio: np.ndarray, semitones: float, sample_rate: int = 16000) -> np.ndarray:
    """
    Change audio pitch

    Args:
        audio: Input audio
        semitones: Pitch shift in semitones (positive = higher, negative = lower)
        sample_rate: Sample rate in Hz

    Returns:
        Pitch-shifted audio
    """
    return librosa.effects.pitch_shift(audio, sr=sample_rate, n_steps=semitones)


def save_audio(audio: np.ndarray, path: Path, sample_rate: int = 16000):
    """
    Save audio to file

    Args:
        audio: Audio signal
        path: Output file path
        sample_rate: Sample rate in Hz
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, sample_rate)


def load_audio(path: Path, sample_rate: Optional[int] = 16000) -> tuple[np.ndarray, int]:
    """
    Load audio from file

    Args:
        path: Input file path
        sample_rate: Target sample rate (None to keep original)

    Returns:
        Tuple of (audio signal, sample rate)
    """
    audio, sr = librosa.load(str(path), sr=sample_rate)
    return audio, sr


def extract_prosody_features(audio: np.ndarray, sample_rate: int = 16000) -> dict:
    """
    Extract prosodic features from audio

    Args:
        audio: Audio signal
        sample_rate: Sample rate in Hz

    Returns:
        Dictionary of prosody features
    """
    # Extract pitch (F0)
    f0, voiced_flag, voiced_probs = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz('C2'),
        fmax=librosa.note_to_hz('C7'),
        sr=sample_rate
    )

    # Remove NaN values
    f0_clean = f0[~np.isnan(f0)]

    # Calculate intensity (RMS energy)
    rms = librosa.feature.rms(y=audio)[0]

    # Calculate speaking rate (very rough estimate using zero crossings)
    zcr = librosa.feature.zero_crossing_rate(audio)[0]

    return {
        'f0_mean': np.mean(f0_clean) if len(f0_clean) > 0 else 0,
        'f0_std': np.std(f0_clean) if len(f0_clean) > 0 else 0,
        'f0_min': np.min(f0_clean) if len(f0_clean) > 0 else 0,
        'f0_max': np.max(f0_clean) if len(f0_clean) > 0 else 0,
        'intensity_mean': np.mean(rms),
        'intensity_std': np.std(rms),
        'zero_crossing_rate': np.mean(zcr),
        'duration': len(audio) / sample_rate
    }


def calculate_snr(signal: np.ndarray, noise: np.ndarray) -> float:
    """
    Calculate signal-to-noise ratio

    Args:
        signal: Clean signal
        noise: Noise signal

    Returns:
        SNR in decibels
    """
    signal_power = np.mean(signal ** 2)
    noise_power = np.mean(noise ** 2)

    if noise_power == 0:
        return float('inf')

    snr = 10 * np.log10(signal_power / noise_power)
    return snr
