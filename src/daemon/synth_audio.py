r"""
Programmatic Audio Synthesizer (NumPy + Wave + FFmpeg)
Core Audio DSP Engine for Automated Video Production

Generates studio-quality BGM (Cyber Tech, Anime Action, Acoustic Folk)
and SFX (Whoosh, Pop, Ding, Impact) completely from mathematical DSP formulas
without needing any external audio assets or sound packs.
"""

import argparse
import os
import subprocess
import wave
import numpy as np

SAMPLE_RATE = 44100

def save_wav(filename: str, data: np.ndarray, sample_rate: int = SAMPLE_RATE):
    """Normalize and save float numpy array to 16-bit PCM WAV."""
    peak = np.max(np.abs(data)) + 1e-6
    normalized = data / peak * 0.92
    int_data = (normalized * 32767).astype(np.int16)
    with wave.open(filename, 'wb') as wf:
        wf.setnchannels(2 if len(data.shape) > 1 and data.shape[1] == 2 else 1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(int_data.tobytes())

def to_mp3(wav_path: str, mp3_path: str, bitrate: str = "192k"):
    """Convert WAV to MP3 using ffmpeg."""
    subprocess.run(
        ["ffmpeg", "-y", "-i", wav_path, "-b:a", bitrate, mp3_path],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    if os.path.exists(wav_path):
        os.remove(wav_path)

def generate_cyber_bgm(duration: float = 30.0, bpm: int = 124) -> np.ndarray:
    """Cyber Tech / Sci-Fi Synthwave BGM (C minor)."""
    total_samples = int(duration * SAMPLE_RATE)
    audio = np.zeros(total_samples)
    beat_dur = 60.0 / bpm
    total_beats = int(duration / beat_dur)

    # 1. 808 Pitch-drop Kick
    for b in range(total_beats):
        start = int(b * beat_dur * SAMPLE_RATE)
        kick_len = int(0.22 * SAMPLE_RATE)
        if start + kick_len < total_samples:
            kt = np.linspace(0, 0.22, kick_len, endpoint=False)
            freq = 150 * np.exp(-28 * kt) + 45
            phase = np.cumsum(freq) / SAMPLE_RATE * 2 * np.pi
            kick = np.sin(phase) * np.exp(-12 * kt) * 0.65
            audio[start:start+kick_len] += kick

    # 2. Crisp Snare / Clap on beats 2 & 4
    for b in range(1, total_beats, 2):
        start = int(b * beat_dur * SAMPLE_RATE)
        snare_len = int(0.18 * SAMPLE_RATE)
        if start + snare_len < total_samples:
            st = np.linspace(0, 0.18, snare_len, endpoint=False)
            noise = np.random.uniform(-1, 1, snare_len) * np.exp(-18 * st)
            tone = np.sin(2 * np.pi * 180 * st) * np.exp(-15 * st)
            audio[start:start+snare_len] += (noise * 0.7 + tone * 0.3) * 0.35

    # 3. 8th-note Hi-Hats
    for b8 in range(total_beats * 2):
        start = int(b8 * (beat_dur / 2) * SAMPLE_RATE)
        hh_len = int(0.05 * SAMPLE_RATE)
        if start + hh_len < total_samples:
            ht = np.linspace(0, 0.05, hh_len, endpoint=False)
            audio[start:start+hh_len] += np.random.uniform(-1, 1, hh_len) * np.exp(-60 * ht) * 0.12

    # 4. Melodic Synth Arpeggio (C minor 16th notes)
    arp_notes = [261.63, 311.13, 392.00, 466.16, 523.25, 466.16, 392.00, 311.13]
    arp_step = beat_dur / 4
    for i in range(int(duration / arp_step)):
        start = int(i * arp_step * SAMPLE_RATE)
        note_len = int(arp_step * 0.9 * SAMPLE_RATE)
        if start + note_len < total_samples:
            freq = arp_notes[i % len(arp_notes)]
            nt = np.linspace(0, arp_step * 0.9, note_len, endpoint=False)
            synth = (np.sin(2 * np.pi * freq * nt) + 0.35 * np.sin(2 * np.pi * freq * 2 * nt)) * np.exp(-10 * nt)
            audio[start:start+note_len] += synth * 0.22

    # 5. Deep Bassline (C2, Eb2, F2, G2)
    bass_notes = [65.41, 77.78, 87.31, 98.00]
    for b in range(total_beats):
        bar = (b // 4) % len(bass_notes)
        freq = bass_notes[bar]
        start = int(b * beat_dur * SAMPLE_RATE)
        bass_len = int(beat_dur * 0.8 * SAMPLE_RATE)
        if start + bass_len < total_samples:
            bt = np.linspace(0, beat_dur * 0.8, bass_len, endpoint=False)
            bass = (np.sin(2 * np.pi * freq * bt) + 0.4 * np.sin(2 * np.pi * freq * 2 * bt)) * np.exp(-3.5 * bt)
            audio[start:start+bass_len] += bass * 0.45

    # Envelopes
    fade_in = int(1.0 * SAMPLE_RATE)
    audio[:fade_in] *= np.linspace(0, 1, fade_in)
    fade_out = int(2.5 * SAMPLE_RATE)
    audio[-fade_out:] *= np.linspace(1, 0, fade_out)
    return audio

def generate_anime_bgm(duration: float = 30.0, bpm: int = 132) -> np.ndarray:
    """Punchy Shonen Anime Action Rock BGM."""
    total_samples = int(duration * SAMPLE_RATE)
    audio = np.zeros(total_samples)
    beat_dur = 60.0 / bpm
    total_beats = int(duration / beat_dur)

    for b in range(total_beats):
        # 4-on-the-floor Kick
        start = int(b * beat_dur * SAMPLE_RATE)
        kick_len = int(0.22 * SAMPLE_RATE)
        if start + kick_len < total_samples:
            kt = np.linspace(0, 0.22, kick_len, endpoint=False)
            freq = 190 * np.exp(-35 * kt) + 48
            phase = np.cumsum(freq) / SAMPLE_RATE * 2 * np.pi
            audio[start:start+kick_len] += np.sin(phase) * np.exp(-14 * kt) * 0.72

        # Syncopated double kick
        if b % 4 == 2:
            sync_start = int((b + 0.5) * beat_dur * SAMPLE_RATE)
            if sync_start + kick_len < total_samples:
                audio[sync_start:sync_start+kick_len] += np.sin(phase) * np.exp(-14 * kt) * 0.55

    # Snare / Impact Clap
    for b in range(1, total_beats, 2):
        start = int(b * beat_dur * SAMPLE_RATE)
        snare_len = int(0.19 * SAMPLE_RATE)
        if start + snare_len < total_samples:
            st = np.linspace(0, 0.19, snare_len, endpoint=False)
            noise = np.random.uniform(-1, 1, snare_len) * np.exp(-17 * st)
            tone = (np.sin(2 * np.pi * 230 * st) + 0.4 * np.sin(2 * np.pi * 380 * st)) * np.exp(-22 * st)
            audio[start:start+snare_len] += (noise * 0.7 + tone * 0.3) * 0.42

    # Fast Hi-Hats
    for b16 in range(total_beats * 4):
        start = int(b16 * (beat_dur / 4) * SAMPLE_RATE)
        hh_len = int(0.04 * SAMPLE_RATE)
        if start + hh_len < total_samples:
            ht = np.linspace(0, 0.04, hh_len, endpoint=False)
            audio[start:start+hh_len] += np.random.uniform(-1, 1, hh_len) * np.exp(-70 * ht) * 0.12

    fade_in = int(0.8 * SAMPLE_RATE)
    audio[:fade_in] *= np.linspace(0, 1, fade_in)
    fade_out = int(2.0 * SAMPLE_RATE)
    audio[-fade_out:] *= np.linspace(1, 0, fade_out)
    return audio

def generate_acoustic_bgm(duration: float = 30.0, bpm: int = 122) -> np.ndarray:
    """Warm, uplifting folk-pop acoustic pluck & woodblock (G -> D -> Em -> C)."""
    total_samples = int(duration * SAMPLE_RATE)
    audio = np.zeros(total_samples)
    beat_dur = 60.0 / bpm
    total_beats = int(duration / beat_dur)

    chords_bass = [98.00, 146.83, 82.41, 130.81] # G, D, Em, C
    melodies = [392.00, 440.00, 493.88, 587.33, 659.25, 587.33, 493.88, 440.00]

    for b in range(total_beats):
        bar_idx = (b // 4) % len(chords_bass)
        beat_in_bar = b % 4
        start_beat = int(b * beat_dur * SAMPLE_RATE)

        # Kick on 0 and 2
        if beat_in_bar in [0, 2]:
            klen = int(0.16 * SAMPLE_RATE)
            if start_beat + klen < total_samples:
                kt = np.linspace(0, 0.16, klen, endpoint=False)
                phase = np.cumsum(120 * np.exp(-35 * kt) + 52) / SAMPLE_RATE * 2 * np.pi
                audio[start_beat:start_beat+klen] += np.sin(phase) * np.exp(-15 * kt) * 0.48

        # Woodblock snap on 1 and 3
        if beat_in_bar in [1, 3]:
            wlen = int(0.08 * SAMPLE_RATE)
            if start_beat + wlen < total_samples:
                wt = np.linspace(0, 0.08, wlen, endpoint=False)
                audio[start_beat:start_beat+wlen] += np.sin(2 * np.pi * 880 * wt) * np.exp(-40 * wt) * 0.35

        # Bass pluck
        bass_freq = chords_bass[bar_idx]
        blen = int(beat_dur * 0.9 * SAMPLE_RATE)
        if start_beat + blen < total_samples:
            bt = np.linspace(0, beat_dur * 0.9, blen, endpoint=False)
            audio[start_beat:start_beat+blen] += np.sin(2 * np.pi * bass_freq * bt) * np.exp(-4 * bt) * 0.38

        # Marimba / Pluck melody
        mfreq = melodies[b % len(melodies)]
        if start_beat + blen < total_samples:
            mt = np.linspace(0, beat_dur * 0.9, blen, endpoint=False)
            audio[start_beat:start_beat+blen] += (np.sin(2 * np.pi * mfreq * mt) + 0.3 * np.sin(4 * np.pi * mfreq * mt)) * np.exp(-6 * mt) * 0.25

    fade_in = int(1.2 * SAMPLE_RATE)
    audio[:fade_in] *= np.linspace(0, 1, fade_in)
    fade_out = int(2.5 * SAMPLE_RATE)
    audio[-fade_out:] *= np.linspace(1, 0, fade_out)
    return audio

# --- SFX GENERATORS ---

def generate_ding(duration: float = 1.2) -> np.ndarray:
    """Success chime notification (C6 & E6)."""
    total = int(duration * SAMPLE_RATE)
    t = np.linspace(0, duration, total, endpoint=False)
    sound = (np.sin(2 * np.pi * 1046.5 * t) + 0.8 * np.sin(2 * np.pi * 1318.5 * t)) * np.exp(-4 * t)
    return sound * 0.5

def generate_whoosh(duration: float = 0.5) -> np.ndarray:
    """Smooth card/scene transition whoosh."""
    total = int(duration * SAMPLE_RATE)
    t = np.linspace(0, duration, total, endpoint=False)
    noise = np.random.uniform(-1, 1, total)
    env = np.sin(np.pi * t / duration) ** 2
    return noise * env * 0.35

def generate_pop(duration: float = 0.15) -> np.ndarray:
    """Cute badge / button pop sound."""
    total = int(duration * SAMPLE_RATE)
    t = np.linspace(0, duration, total, endpoint=False)
    freq = 600 * np.exp(-20 * t) + 200
    phase = np.cumsum(freq) / SAMPLE_RATE * 2 * np.pi
    return np.sin(phase) * np.exp(-25 * t) * 0.45

def generate_all_sfx(output_dir: str):
    """Generate the standard suite of sound effects."""
    os.makedirs(output_dir, exist_ok=True)
    for name, gen_fn in [
        ("sfx_ding", generate_ding),
        ("sfx_whoosh", generate_whoosh),
        ("sfx_pop", generate_pop)
    ]:
        wav_path = os.path.join(output_dir, f"{name}.wav")
        mp3_path = os.path.join(output_dir, f"{name}.mp3")
        save_wav(wav_path, gen_fn())
        to_mp3(wav_path, mp3_path)
        print(f"[+] Created SFX: {mp3_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synthesize BGM & SFX for Remotion Videos")
    parser.add_argument("--style", choices=["cyber", "anime", "acoustic", "sfx", "all"], default="cyber")
    parser.add_argument("--duration", type=float, default=30.0)
    parser.add_argument("--output", type=str, default="public")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    if args.style in ["cyber", "all"]:
        wav = os.path.join(args.output, "bgm.wav")
        mp3 = os.path.join(args.output, "bgm.mp3")
        save_wav(wav, generate_cyber_bgm(args.duration))
        to_mp3(wav, mp3)
        print(f"[+] Created Cyber BGM: {mp3}")

    if args.style in ["anime", "all"]:
        wav = os.path.join(args.output, "comic_bgm.wav")
        mp3 = os.path.join(args.output, "comic_bgm.mp3")
        save_wav(wav, generate_anime_bgm(args.duration))
        to_mp3(wav, mp3)
        print(f"[+] Created Anime BGM: {mp3}")

    if args.style in ["acoustic", "all"]:
        wav = os.path.join(args.output, "acoustic_bgm.wav")
        mp3 = os.path.join(args.output, "acoustic_bgm.mp3")
        save_wav(wav, generate_acoustic_bgm(args.duration))
        to_mp3(wav, mp3)
        print(f"[+] Created Acoustic BGM: {mp3}")

    if args.style in ["sfx", "all"]:
        generate_all_sfx(args.output)
