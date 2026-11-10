"""The music's tempo, beats and sections, for cutting the trailer on them.

Reads the mono 22 050 Hz s16le copy of the soundtrack, builds an onset-strength envelope (spectral flux of a short-time
Fourier transform), finds the tempo by autocorrelation of that envelope, aligns the beat grid to the onsets, and lists
loudness per bar (to see the quiet intro, the build-ups and the drops). Writes src/beats.json for the edit.
"""
import json
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent.parent
SR = 22050
HOP = 256
WIN = 1024

raw = np.fromfile(HERE / 'music-mono.raw', dtype='<i2').astype(np.float32) / 32768.0
n_frames = 1 + (len(raw) - WIN) // HOP
window = np.hanning(WIN).astype(np.float32)
frames = np.lib.stride_tricks.as_strided(raw, shape=(n_frames, WIN), strides=(raw.strides[0] * HOP, raw.strides[0]))
mag = np.abs(np.fft.rfft(frames * window, axis=1))
logmag = np.log1p(mag * 10)
flux = np.maximum(0.0, np.diff(logmag, axis=0)).sum(axis=1)
flux = np.concatenate([[0.0], flux])
# Remove the slow trend so onsets stand out.
k = 16
trend = np.convolve(flux, np.ones(k) / k, mode='same')
onset = np.maximum(0.0, flux - trend)
fps = SR / HOP  # envelope frames per second

# Tempo: autocorrelation peak between 70 and 180 BPM.
o = onset - onset.mean()
ac = np.correlate(o, o, mode='full')[len(o) - 1:]
lags = np.arange(len(ac))
bpm_of = 60.0 * fps / np.maximum(lags, 1)
mask = (bpm_of >= 70) & (bpm_of <= 180)
best = lags[mask][np.argmax(ac[mask])]
# Refine with a parabola around the peak.
y0, y1, y2 = ac[best - 1], ac[best], ac[best + 1]
shift = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) if (y0 - 2 * y1 + y2) != 0 else 0.0
period = best + shift
bpm = 60.0 * fps / period
# Prefer the 90-160 range (double or halve).
while bpm < 90:
    bpm *= 2
    period /= 2
while bpm > 160:
    bpm /= 2
    period *= 2

# Phase: the offset whose comb of beats collects the most onset energy.
beat_s = 60.0 / bpm
best_phase, best_score = 0.0, -1.0
for ph in np.arange(0, beat_s, 0.005):
    idx = np.round((np.arange(ph, len(raw) / SR, beat_s)) * fps).astype(int)
    idx = idx[idx < len(onset)]
    score = onset[idx].sum()
    if score > best_score:
        best_score, best_phase = score, ph
duration = len(raw) / SR
beats = [round(float(t), 4) for t in np.arange(best_phase, duration, beat_s)]

# Loudness per bar (RMS in dB) and the bars where it jumps (drops).
rms = []
for b in range(0, len(beats) - 4, 4):
    a, z = int(beats[b] * SR), int(beats[b + 4] * SR)
    seg = raw[a:z]
    rms.append(round(float(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9)), 1))
jumps = [i for i in range(1, len(rms)) if rms[i] - rms[i - 1] >= 3.0]
out = {'bpm': round(float(bpm), 3), 'beat': round(float(beat_s), 5), 'phase': round(float(best_phase), 4), 'duration': round(duration, 3), 'beats': beats, 'barDb': rms, 'drops': jumps}
(HERE / 'src').mkdir(exist_ok=True)
(HERE / 'src' / 'beats.json').write_text(json.dumps(out, indent=1), encoding='utf-8')
print(f"bpm {out['bpm']}  beat {out['beat']}s  phase {out['phase']}s  duration {out['duration']}s  beats {len(beats)}  bars {len(rms)}")
print('dB per bar:', ' '.join(f'{i}:{v}' for i, v in enumerate(rms)))
print('jumps at bars:', jumps)
