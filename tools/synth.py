#!/usr/bin/env python3
"""Synthesizes the fishing mod's sound effects: short, original chiptune cues.

Every sound is built here from oscillators (square, triangle, sine) and
seeded noise, with simple envelopes; nothing is sampled. Run it to rebuild
the WAVs (22.05 kHz, 16-bit mono) in each theme's sounds/ folder:

    python3 tools/synth.py

Standard library only. The same seed gives the same bytes, so the committed
files can be checked against a fresh run.
"""

import math
import os
import random
import struct
import wave

RATE = 22050
HERE = os.path.dirname(os.path.abspath(__file__))
THEMES = os.path.join(HERE, '..', 'plugins', 'fishing', 'themes')


def note(name):
    """'A4' -> Hz (equal temperament, A4 = 440)."""
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4, 'F#': -3,
             'G': -2, 'G#': -1, 'A': 0, 'A#': 1, 'B': 2}
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[pitch] + 12 * (octave - 4)) / 12)


class Track:
    """A mono buffer that voices are mixed into."""

    def __init__(self, seconds):
        self.samples = [0.0] * int(seconds * RATE)
        self.noise = random.Random(7)

    def voice(self, start, length, wave_kind, freq, gain=0.5, end_freq=None,
              attack=0.004, release=None, duty=0.5, vibrato=0.0):
        """Adds one voice: a pitch (gliding to end_freq) under an envelope."""
        first = int(start * RATE)
        count = int(length * RATE)
        release = length * 0.6 if release is None else release
        phase = 0.0
        for i in range(count):
            at = first + i
            if at >= len(self.samples):
                break
            t = i / RATE
            progress = i / max(1, count - 1)
            f = freq if end_freq is None else freq * (end_freq / freq) ** progress
            f *= 1 + vibrato * math.sin(2 * math.pi * 6 * t)
            phase = (phase + f / RATE) % 1.0
            if wave_kind == 'square':
                value = 1.0 if phase < duty else -1.0
            elif wave_kind == 'triangle':
                value = 4 * abs(phase - 0.5) - 1
            elif wave_kind == 'sine':
                value = math.sin(2 * math.pi * phase)
            else:  # noise, held for a step so it reads as 8-bit hiss
                if i % 3 == 0:
                    self._held = self.noise.uniform(-1, 1)
                value = self._held
            env = min(1.0, t / attack) if attack > 0 else 1.0
            tail = length - t
            if tail < release:
                env *= max(0.0, tail / release)
            self.samples[at] += value * gain * env

    def write(self, path, peak=0.7):
        top = max(1e-9, max(abs(s) for s in self.samples))
        scale = peak / top
        # A few milliseconds of fade at each end: no clicks.
        fade = int(0.003 * RATE)
        out = bytearray()
        for i, s in enumerate(self.samples):
            edge = min(1.0, i / fade, (len(self.samples) - 1 - i) / fade) if fade else 1.0
            out += struct.pack('<h', int(max(-1, min(1, s * scale * edge)) * 32767))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with wave.open(path, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(bytes(out))


def river():
    """Bright square and triangle cues for the river village."""
    s = {}

    t = Track(0.42)  # cast: a whip of air, then the float lands
    t.voice(0.0, 0.22, 'noise', 1, gain=0.25, release=0.15)
    t.voice(0.0, 0.24, 'square', 320, end_freq=980, gain=0.22, duty=0.25)
    t.voice(0.30, 0.10, 'triangle', note('E6'), gain=0.45, release=0.08)
    s['cast'] = t

    t = Track(0.26)  # bite: two quick nibbles
    t.voice(0.00, 0.07, 'triangle', note('A5'), gain=0.6)
    t.voice(0.11, 0.10, 'triangle', note('D6'), gain=0.6)
    s['bite'] = t

    t = Track(0.62)  # catch: a splash and a climb
    t.voice(0.0, 0.18, 'noise', 1, gain=0.35, release=0.16)
    for i, n in enumerate(['A4', 'C#5', 'E5', 'A5']):
        t.voice(0.12 + i * 0.075, 0.09, 'square', note(n), gain=0.22, duty=0.25)
    t.voice(0.42, 0.18, 'triangle', note('A5'), gain=0.35)
    s['catch'] = t

    t = Track(0.34)  # snap: a crack and a slack fall
    t.voice(0.0, 0.03, 'noise', 1, gain=0.6, attack=0, release=0.02)
    t.voice(0.02, 0.30, 'square', 620, end_freq=110, gain=0.25, duty=0.5)
    s['snap'] = t

    t = Track(0.62)  # waiting: a two-note bell, asking
    t.voice(0.00, 0.26, 'triangle', note('G5'), gain=0.55, release=0.22)
    t.voice(0.18, 0.40, 'triangle', note('D6'), gain=0.55, release=0.34)
    t.voice(0.18, 0.40, 'sine', note('D7'), gain=0.08, release=0.3)
    s['waiting'] = t

    t = Track(0.95)  # done: a short rising flourish that settles
    for i, n in enumerate(['C5', 'E5', 'G5']):
        t.voice(i * 0.085, 0.08, 'square', note(n), gain=0.24, duty=0.5)
    t.voice(0.30, 0.55, 'square', note('C6'), gain=0.22, duty=0.25, vibrato=0.006)
    t.voice(0.30, 0.60, 'triangle', note('C4'), gain=0.35)
    t.voice(0.00, 0.26, 'triangle', note('G3'), gain=0.3)
    s['done'] = t
    return s


def main():
    for theme, sounds in (('river-rpg', river()),):
        for name, track in sounds.items():
            path = os.path.join(THEMES, theme, 'sounds', f'{name}.wav')
            track.write(path)
            print(f'{os.path.relpath(path, os.path.join(HERE, ".."))}  {os.path.getsize(path)} bytes')


if __name__ == '__main__':
    main()
