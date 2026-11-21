// Shared SVG line chart maths (DESIGN D19, D50). Pure: returns markup strings, no DOM,
// so every app can draw the same chart and Node can test it.

// Round [lo, hi] out to about four "nice" steps (1, 2, 2.5, 5 × 10^n). Never below 0.
export function niceTicks(lo, hi) {
  if (hi - lo < 5) { lo -= 2.5; hi += 2.5; }
  const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw);
  return { lo: Math.max(0, Math.floor(lo / step) * step), hi: Math.ceil(hi / step) * step, step };
}

// points: [{ t: ms, v: number }] oldest first. One point is drawn as a centred dot with no line.
// Returns { markup, xs, ys, W, H, pad } so the page can add its own crosshair and tooltip.
export function lineChart(points, { W = 340, H = 220, pad = { l: 48, r: 12, t: 40, b: 26 },
  fmtY = String, xLabel = () => "" } = {}) {
  const t = points.map((p) => p.t), v = points.map((p) => p.v);
  const { lo, hi, step } = niceTicks(Math.min(...v), Math.max(...v));
  const span = t.at(-1) - t[0];
  const x = (ms) => (span ? pad.l + (ms - t[0]) / span * (W - pad.l - pad.r) : (pad.l + W - pad.r) / 2);
  const y = (val) => pad.t + (hi - val) / (hi - lo) * (H - pad.t - pad.b);
  const xs = t.map(x), ys = v.map(y);
  let markup = "";
  for (let g = lo; g <= hi + 1e-9; g += step) {
    markup += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(g)}" y2="${y(g)}" stroke="var(--grid, var(--line))" stroke-width="1"/>`
      + `<text x="${pad.l - 8}" y="${y(g) + 4}" text-anchor="end">${fmtY(g)}</text>`;
  }
  const labelIdx = points.length === 1 ? [0] : [0, points.length - 1];
  for (const i of labelIdx) {
    const anchor = points.length === 1 ? "middle" : i === 0 ? "start" : "end";
    markup += `<text x="${xs[i]}" y="${H - 6}" text-anchor="${anchor}">${xLabel(i)}</text>`;
  }
  if (points.length > 1) {
    const d = xs.map((px, i) => `${i ? "L" : "M"}${px.toFixed(1)},${ys[i].toFixed(1)}`).join("");
    markup += `<path class="line" d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  return { markup, xs, ys, W, H, pad };
}

// The dots go on top of the crosshair, so they're separate.
export const chartDots = ({ xs, ys }) =>
  xs.map((px, i) => `<circle class="dot" cx="${px}" cy="${ys[i]}" r="4" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>`).join("");
