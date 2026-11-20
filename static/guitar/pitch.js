// Pitch detection with the YIN algorithm (de Cheveigné & Kawahara, 2002).
//
// Idea: a note repeats its waveform every period. Slide a copy of the sound against itself;
// at a shift of exactly one period the two copies line up and their difference is tiny.
// YIN finds the first shift where that difference drops below a threshold, which avoids
// the classic "one octave too low" mistake, then refines it between samples.

export function detectPitch(buf, sampleRate, opts = {}) {
  const { minFreq = 60, maxFreq = 1400, threshold = 0.12, minRms = 0.008 } = opts;
  const n = buf.length;

  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < minRms) return null; // too quiet: silence or room noise

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(Math.ceil(sampleRate / minFreq), Math.floor(n / 2));
  const w = n - tauMax;

  // Difference function d(tau), then the cumulative-mean-normalised version d'(tau).
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < w; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    d[tau] = running ? (d[tau] * tau) / running : 1;
  }

  // First dip under the threshold, followed down to its bottom.
  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 < tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null; // no clear repeating shape: noise, chord, or string dying out

  // Parabola through the three points around the dip: sub-sample accuracy (~0.1 cent).
  let better = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a - 2 * b + c;
    if (den) better = tau + (a - c) / (2 * den);
  }
  return { freq: sampleRate / better, clarity: 1 - d[tau], rms };
}
