import assert from "node:assert/strict";
import { lineChart, chartDots, niceTicks } from "../static/core/chart.js";

const DAY = 86400000;
const count = (s, re) => (s.match(re) || []).length;

// One point: a centred dot, one date label, no line, no NaN.
{
  const c = lineChart([{ t: 1e12, v: 100 }], { W: 340, xLabel: () => "Mar 3" });
  const all = c.markup + chartDots(c);
  assert.ok(!all.includes("NaN"), "no NaN with one point");
  assert.equal(count(all, /<path class="line"/g), 0, "no line with one point");
  assert.equal(count(all, /class="dot"/g), 1);
  assert.equal(c.xs[0], (48 + 340 - 12) / 2, "the point sits in the middle");
  assert.equal(count(c.markup, /Mar 3/g), 1, "one date label");
  assert.ok(c.markup.includes('text-anchor="middle"'));
}

// Two points: one line with one segment, labels at both ends.
{
  const c = lineChart([{ t: 0, v: 100 }, { t: 7 * DAY, v: 110 }], { xLabel: (i) => `d${i}` });
  const line = c.markup.match(/<path class="line" d="([^"]+)"/)[1];
  assert.equal(count(line, /L/g), 1);
  assert.ok(c.markup.includes(">d0<") && c.markup.includes(">d1<"));
  assert.ok(c.xs[0] < c.xs[1] && c.ys[0] > c.ys[1], "later and higher goes right and up");
}

// Flat values still get a real range (no divide by zero).
{
  const c = lineChart([{ t: 0, v: 50 }, { t: DAY, v: 50 }, { t: 2 * DAY, v: 50 }]);
  assert.ok(!c.markup.includes("NaN") && c.ys.every(Number.isFinite));
}

// Ticks are "nice" and never below zero.
{
  const a = niceTicks(0, 7);
  assert.ok([2, 2.5].includes(a.step), `step ${a.step}`);
  assert.ok(a.lo === 0 && a.hi >= 7);
  const b = niceTicks(1, 2);
  assert.ok(b.lo >= 0 && b.hi > b.lo);
  const c = niceTicks(180, 260);
  assert.ok(c.lo <= 180 && c.hi >= 260 && (c.hi - c.lo) / c.step <= 5);
}

console.log("chart tests passed");
