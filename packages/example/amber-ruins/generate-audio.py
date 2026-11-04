"""Generate the original Amber Ruins music loop and sound effects as PCM WAV."""

from array import array
from math import exp, sin, tau
from pathlib import Path
import sys
import wave

SAMPLE_RATE = 22_050
ASSETS = Path(__file__).with_name("assets")


def tone(track, start, duration, note, volume, decay=3):
    frequency = 440 * 2 ** ((note - 69) / 12)
    offset = round(start * SAMPLE_RATE)
    length = round(duration * SAMPLE_RATE)
    for index in range(min(length, len(track) - offset)):
        seconds = index / SAMPLE_RATE
        phase = tau * frequency * seconds
        envelope = min(1, seconds / 0.015, (length - index) / 600)
        envelope *= exp(-decay * index / length)
        track[offset + index] += volume * envelope * (
            sin(phase) + 0.24 * sin(2 * phase) + 0.12 * sin(3 * phase)
        )


def save(name, track):
    pcm = array("h", (round(32_767 * min(1, max(-1, value))) for value in track))
    if sys.byteorder != "little":
        pcm.byteswap()
    with wave.open(str(ASSETS / f"{name}.wav"), "wb") as output:
        output.setparams((1, 2, SAMPLE_RATE, 0, "NONE", "not compressed"))
        output.writeframes(pcm.tobytes())


def effect(name, notes):
    track = [0.0] * round((notes[-1][0] + notes[-1][1]) * SAMPLE_RATE)
    for note in notes:
        tone(track, *note)
    save(name, track)


def main():
    effect("pickup", [(0, 0.19, 76, 0.30), (0.085, 0.25, 84, 0.26)])
    effect("damage", [(0, 0.23, 45, 0.33), (0.055, 0.27, 38, 0.24)])
    effect("unlock", [(0, 0.34, 60, 0.25), (0.11, 0.38, 67, 0.22),
                      (0.22, 0.50, 72, 0.25)])

    music = [0.0] * (12 * SAMPLE_RATE)
    for bar, (root, melody) in enumerate([
        (45, (69, 76, 72, 74)), (41, (65, 72, 69, 67)),
        (43, (67, 74, 71, 69)), (40, (64, 71, 68, 64)),
    ]):
        start = bar * 3
        tone(music, start, 2.9, root, 0.16, decay=1.5)
        tone(music, start + 0.08, 2.7, root + 7, 0.08, decay=2)
        for beat, note in enumerate(melody):
            tone(music, start + beat * 0.72, 0.74, note, 0.11)
    save("ruins-loop", music)


if __name__ == "__main__":
    main()
