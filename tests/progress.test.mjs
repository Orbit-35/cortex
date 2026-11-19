// Run: node tests/progress.test.mjs
import assert from "node:assert/strict";
import { groupSets, prEvents, totals, milestone, OBJECTS } from "../static/lifting/progress.js";
import { resolveExercises, exerciseFor } from "../static/lifting/library.js";
import { groupWorkouts } from "../static/lifting/workouts.js";

const lib = resolveExercises([]);
const of = (k) => exerciseFor(lib, k);
const at = (d) => new Date(2026, 10, d, 12).toISOString();
const S = (id, metric, w, r, d, wid = "w" + d) => ({ client_id: id, module: "lifting", metric, value: w, unit: "kg", data: { reps: r, workout: wid }, recorded_at: at(d) });

// Bench: chest 1, arms 0.5 (triceps), shoulders 0.5. Dip: arms 1 (triceps primary), chest 0.5, shoulders 0.5.
const g = groupSets([S("a", "bench_press", 80, 5, 1), S("b", "dip", 0, 10, 1)], of);
assert.deepEqual(g, { chest: 1.5, back: 0, shoulders: 1, arms: 1.5, legs: 0, core: 0 });
// Deadlift: back 1 (lower back) + legs 0.5 (glutes, hamstrings: one group, credited once) + traps (back, already 1) + arms 0.5.
assert.deepEqual(groupSets([S("c", "deadlift", 140, 5, 1)], of), { chest: 0, back: 1, shoulders: 0, arms: 0.5, legs: 0.5, core: 0 });
// Unknown/custom exercise without muscles counts nowhere.
assert.deepEqual(Object.values(groupSets([S("d", "mystery", 10, 5, 1)], of)).reduce((a, b) => a + b), 0);

// PRs: the first set is never a PR; beating it is.
const sets = [S("1", "squat", 100, 5, 1), S("2", "squat", 100, 5, 2), S("3", "squat", 105, 5, 3), S("4", "squat", 90, 8, 4), S("5", "bench_press", 60, 5, 4)];
const ev = prEvents(sets);
assert.deepEqual([...ev.entries()].sort(), [["3", "e1rm"], ["4", "reps"]]);

// Totals over grouped workouts.
const entries = [
  ...sets,
  ...[1, 2, 3, 4].map((d) => ({ client_id: "w" + d, module: "lifting", metric: "_workout", recorded_at: at(d), data: { name: "W", duration_min: 60, exercises: [] } })),
];
const t = totals(groupWorkouts(entries));
assert.equal(t.workouts, 4);
assert.equal(t.sets, 5);
assert.equal(t.minutes, 240);
assert.equal(t.volumeKg, 500 + 500 + 525 + 720 + 300);

// Milestones.
const m = milestone(612_000);
assert.equal(m.last.name, "Space station");
assert.equal(m.next.name, "Saturn V rocket");
assert.ok(m.progress > 0.2 && m.progress < 0.22);
assert.equal(m.journey[0].name, "Space station");
assert.equal(Math.floor(m.journey.at(-1).times), 20400);   // 612 t / 30 kg Labrador
assert.equal(milestone(0).last, null);
assert.equal(milestone(1e12).next, null);
for (let i = 1; i < OBJECTS.length; i++) assert.ok(OBJECTS[i].kg > OBJECTS[i - 1].kg, "objects sorted");
console.log("progress.js: all tests passed");
