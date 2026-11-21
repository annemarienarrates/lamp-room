# Makes the test audio in dev/fixtures (WAVs aren't stored in the repo). Run once before the tests:
#   python3 dev/fixtures/make_fixtures.py
# Everything here is made up: tones and noise shaped like speech, no real recordings.
import os, wave, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
np.random.seed(7)
R = 44100
def speech(sec):
    n = int(sec * R); t = np.arange(n) / R
    env = 0.5 + 0.5 * np.sin(2 * np.pi * 3.1 * t) ** 2
    x = (np.random.randn(n) * 0.18 + 0.2 * np.sin(2 * np.pi * 180 * t)) * env
    f = int(0.02 * R); x[:f] *= np.linspace(0, 1, f); x[-f:] *= np.linspace(1, 0, f); return x
def sil(sec): return np.random.randn(int(sec * R)) * 0.0006
def click():
    n = int(0.006 * R); x = np.random.randn(n) * 0.7 * np.exp(-np.arange(n) / (0.0015 * R)); return x
def save(name, x, stereo=True):
    x = np.clip(x, -1, 1); y = (x * 32767).astype(np.int16)
    if stereo: y = np.repeat(y[:, None], 2, axis=1).reshape(-1)
    w = wave.open(name, "wb"); w.setnchannels(2 if stereo else 1); w.setsampwidth(2); w.setframerate(R); w.writeframes(y.tobytes()); w.close()
# Cast 1, clicks between lines, ch1 has 3 lines + ch2 has 2 → 5 lines; line 2 has a re-read (two reads, 2 s apart, same section)
parts = [sil(0.8)]
for i, dur in enumerate([1.2, 1.6, 0.9, 1.1, 0.8]):
    if i: parts += [sil(0.7), click(), sil(0.7)]
    if i == 1: parts += [speech(1.0), sil(2.0)]
    parts += [speech(dur)]
parts += [sil(1.0)]
save(os.path.join(HERE, "cast1_clicks.wav"), np.concatenate(parts))
# Cast 1, no clicks: 3 lines, line 2 has an internal 0.9 s pause (should be joined back by the count)
parts = [sil(0.6), speech(1.2), sil(1.6), speech(0.7), sil(0.9), speech(0.8), sil(1.7), speech(1.0), sil(0.8)]
save(os.path.join(HERE, "cast1_pauses.wav"), np.concatenate(parts))
# Cast 1 pickups file: 2 pickups with a clap between
parts = [sil(0.5), speech(1.3), sil(0.6), click(), sil(0.6), speech(0.9), sil(0.5)]
save(os.path.join(HERE, "cast1_pickups.wav"), np.concatenate(parts), stereo=False)


# finished-chapter stand-ins: 40 s of 1 s tone, 0.5 s quiet, at 44.1 kHz
def tones(path, sec=40, rate=44100):
    t = np.arange(int(rate * 1.0)) / rate; on = 0.19 * np.sin(2 * np.pi * 220 * t); off = np.zeros(int(rate * 0.5))
    x = np.tile(np.concatenate([on, off]), int(sec / 1.5) + 1)[: int(sec * rate)]
    w = wave.open(path, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes((x * 32767).astype(np.int16).tobytes()); w.close()
for k in (1, 2, 3): tones(os.path.join(HERE, "ch%02d.wav" % k))
# a 3 s tone at 48 kHz (character-guide samples)
t = np.arange(48000 * 3) / 48000; x = 0.25 * np.sin(2 * np.pi * 330 * t)
w = wave.open(os.path.join(HERE, "tone3s.wav"), "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000); w.writeframes((x * 32767).astype(np.int16).tobytes()); w.close()
print("fixtures ready in", HERE)
