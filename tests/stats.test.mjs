// Run: node tests/stats.test.mjs
import assert from "node:assert/strict";
import { e1rm, bestPerDay, personalRecords, prKind, dayKey } from "../static/lifting/stats.js";

const E = (w, r, t) => ({ value: w, data: { reps: r }, recorded_at: t });

assert.equal(e1rm(100, 1), 100);
assert.equal(e1rm(90, 10), 120);
assert.equal(e1rm(0, 5), 0);
assert.equal(e1rm(100, undefined), 0);

const t = (d, h) => new Date(2026, 10, d, h).toISOString();
const sets = [
  E(60, 8, t(1, 10)), E(70, 5, t(1, 11)),   // day 1 best: 70x5 = 81.67
  E(80, 3, t(3, 10)), E(75, 3, t(3, 11)),   // day 3 best: 80x3 = 88
  E(85, 1, t(5, 10)),                         // day 5: 85
];
const days = bestPerDay(sets);
assert.deepEqual(days.map((d) => d.day), [dayKey(t(1, 0)), dayKey(t(3, 0)), dayKey(t(5, 0))]);
assert.deepEqual(days.map((d) => d.weight), [70, 80, 85]);

const pr = personalRecords(sets);
assert.equal(pr.best.weight, 80);                     // 88 > 85
assert.deepEqual(pr.reps.map((r) => [r.reps, r.weight]), [[1, 85], [3, 80], [5, 70], [8, 60]]);

assert.equal(prKind(E(90, 3, t(6, 10)), sets), "e1rm");
assert.equal(prKind(E(65, 8, t(6, 10)), sets), "reps");     // heavier 8 than before, lower e1RM than 80x3
assert.equal(prKind(E(70, 2, t(6, 10)), sets), "reps");     // first-ever double
assert.equal(prKind(E(70, 5, t(6, 10)), sets), null);       // tie isn't a PR
assert.equal(prKind(E(60, 5, t(6, 10)), []), null);         // first set ever isn't announced

// Units: a 225 lb set and a 102.06 kg set are the same lift.
const lb = { value: 225, unit: "lb", data: { reps: 1 }, recorded_at: t(7, 10) };
assert.ok(Math.abs(e1rm(102.0583, 1) - personalRecords([lb]).best.e1rm) < 0.001);
assert.equal(prKind({ value: 200, unit: "lb", data: { reps: 1 }, recorded_at: t(8, 10) }, sets), "e1rm"); // 90.7 kg > 88
console.log("stats.js: all tests passed");

import { sessionSeries } from "../static/lifting/stats.js";
const series = sessionSeries(sets);
assert.deepEqual(series.map((d) => [d.heaviest, d.volume, d.sets]), [[70, 830, 2], [80, 465, 2], [85, 85, 1]]);
assert.equal(series[0].best.weight, 70);
console.log("sessionSeries: ok");
