// Run: node tests/workouts.test.mjs
import assert from "node:assert/strict";
import { showWeight, parseWeight, convert } from "../static/lifting/units.js";
import { resolveExercises, newKey, slug, exerciseFor } from "../static/lifting/library.js";
import {
  groupWorkouts, legacyPlan, commitPlan, draftFromWorkout, newDraft, blankRow,
  previousSets, deletePlan, volumeKg, WORKOUT,
} from "../static/lifting/workouts.js";

// ---- units ----
assert.equal(showWeight(225, "lb", "lb"), "225");
assert.equal(showWeight(102.5, "kg", "kg"), "102.5");
assert.equal(showWeight(100, "kg", "lb"), "220.5");
assert.equal(parseWeight("102,5"), 102.5);
assert.equal(parseWeight(""), null);
assert.ok(Number.isNaN(parseWeight("abc")));
assert.ok(Math.abs(convert(convert(225, "lb", "kg"), "kg", "lb") - 225) < 1e-9);

// ---- library ----
assert.equal(slug("  Bench Press! "), "bench_press");
assert.equal(slug("_workout"), "workout"); // can't make a reserved metric
const lib = resolveExercises([{ data: { key: "bench_press", name: "Bench" } }, { data: { key: "zercher", name: "Zercher Squat", primary: "quads" } }]);
assert.equal(lib.get("bench_press").name, "Bench");
assert.equal(lib.get("bench_press").primary, "chest");      // edit keeps built-in muscles
assert.equal(lib.get("zercher").custom, true);
assert.equal(exerciseFor(lib, "old_thing").name, "Old Thing");
assert.equal(newKey("Bench Press", new Set(["bench_press", "bench_press_2"])), "bench_press_3");

// ---- legacy grouping: loose sets become one workout per day, deterministically ----
const at = (d, h) => new Date(2026, 10, d, h).toISOString();
const S = (id, metric, w, r, t, extra = {}) => ({ client_id: id, module: "lifting", metric, value: w, unit: "kg", data: { reps: r, ...extra }, recorded_at: t });
const loose = [S("a", "bench_press", 80, 5, at(1, 18)), S("b", "bench_press", 80, 5, at(1, 19)), S("c", "squat", 100, 5, at(2, 12))];
const plan = legacyPlan(loose);
const ws = plan.filter((e) => e.metric === WORKOUT);
assert.equal(ws.length, 2);
assert.equal(ws[0].data.duration_min, 60);
assert.equal(ws[1].data.duration_min, null);                 // single set: duration unknown
assert.deepEqual(legacyPlan(loose).map((e) => e.client_id), plan.map((e) => e.client_id)); // same ids every time
const after = [...plan]; // as if saved
assert.equal(legacyPlan(after).length, 0);                    // idempotent
const grouped = groupWorkouts(after);
assert.equal(grouped.length, 2);
assert.equal(grouped[0].exercises[0].key, "squat");           // newest first
assert.equal(grouped[1].exercises[0].sets.length, 2);
assert.equal(volumeKg(grouped[1].exercises[0].sets), 800);
assert.equal(previousSets(grouped, "bench_press", at(5, 0)).length, 2);
assert.equal(previousSets(grouped, "bench_press", at(1, 0)).length, 0);

// ---- live workout: only ticked sets are saved, numbered 1..n ----
const live = newDraft({ id: "w1", mode: "live", unit: "lb", start: at(10, 18), name: "Push" });
live.exercises.push({ key: "bench_press", notes: "felt good", sets: [
  { ...blankRow("s1"), weight: "225", reps: "5", rpe: 8.5, done: true, at: at(10, 18) },
  { ...blankRow("s2"), weight: "225", reps: "", done: false },
  { ...blankRow("s3"), weight: "230.5", reps: "3", done: true, at: at(10, 19) },
] });
live.exercises.push({ key: "dip", notes: "", sets: [blankRow("s4")] });
const saved = commitPlan(live, null, new Date(2026, 10, 10, 19, 30));
assert.equal(saved[0].metric, WORKOUT);
assert.equal(saved[0].data.duration_min, 90);
assert.deepEqual(saved[0].data.exercises, [{ key: "bench_press", notes: "felt good" }]); // dip had nothing done
const setsOut = saved.slice(1);
assert.deepEqual(setsOut.map((s) => [s.client_id, s.value, s.unit, s.data.set, s.data.rpe]), [["s1", 225, "lb", 1, 8.5], ["s3", 230.5, "lb", 2, null]]);

// ---- edit: untouched sets keep their unit, edits take the draft unit, removed sets are deleted, date moves sets ----
const db = [...saved, S("k1", "squat", 100, 5, at(10, 19), { workout: "w1", set: 1 })];
db[0] = { ...db[0], data: { ...db[0].data, exercises: [...db[0].data.exercises, { key: "squat", notes: "" }] } };
const w = groupWorkouts(db)[0];
const d = draftFromWorkout(w, "lb");
assert.equal(d.exercises[1].sets[0].weight, "220.5");         // 100 kg shown in lb
assert.equal(d.exercises[0].sets[0].rpe, 8.5);                // RPE survives the round trip
d.exercises[0].sets[0].reps = "6";                            // touch reps only
d.exercises[0].sets.splice(1, 1);                             // remove 230.5×3
d.start = at(11, 18);                                         // move to the next day
const edited = commitPlan(d, w, new Date(2026, 10, 12));
const byId = Object.fromEntries(edited.map((e) => [e.client_id, e]));
assert.equal(byId.s1.data.reps, 6);
assert.equal(byId.s1.value, 225);
assert.equal(byId.k1.unit, "kg");                             // untouched: still 100 kg exactly
assert.equal(byId.k1.value, 100);
assert.equal(byId.s3.deleted_at !== null, true);
assert.equal(byId.s1.recorded_at, at(11, 18));                // shifted by one day
d.exercises[1].sets[0].weight = "225";
assert.equal(commitPlan(d, w).find((e) => e.client_id === "k1").unit, "lb"); // edited: stored as typed

// ---- past workout: sets take the workout's time ----
const past = newDraft({ id: "p1", mode: "past", unit: "lb", start: at(3, 12), name: "Workout", duration_min: 75 });
past.exercises.push({ key: "squat", notes: "", sets: [{ ...blankRow("q1"), weight: "315", reps: "3" }, blankRow("q2")] });
const pastOut = commitPlan(past, null);
assert.equal(pastOut.length, 2);                              // workout + 1 set (empty row skipped)
assert.equal(pastOut[1].recorded_at, at(3, 12));
assert.equal(pastOut[0].data.duration_min, 75);

assert.ok(deletePlan(w).every((e) => e.deleted_at));
console.log("workouts.js, units.js, library.js: all tests passed");

// ---- merging exercises ----
import { mergePlan } from "../static/lifting/workouts.js";
{
  const W = (id, d, keys) => ({ client_id: id, module: "lifting", metric: WORKOUT, recorded_at: at(d, 12), data: { name: "W", exercises: keys.map((key) => ({ key, notes: key === "bench" ? "old note" : "" })) } });
  const st = (id, key, wid, n, d) => ({ client_id: id, module: "lifting", metric: key, value: 60, unit: "kg", data: { reps: 5, set: n, workout: wid }, recorded_at: at(d, 12) });
  const db = [W("w1", 1, ["bench", "squat"]), W("w2", 2, ["bench_press", "bench"]),
    st("x1", "bench", "w1", 1, 1), st("x2", "bench", "w2", 1, 2), st("y1", "bench_press", "w2", 1, 2), st("y2", "bench_press", "w2", 2, 2)];
  const out = mergePlan(db, "bench", "bench_press");
  const by = Object.fromEntries(out.map((e) => [e.client_id, e]));
  assert.equal(by.x1.metric, "bench_press");
  assert.equal(by.x1.data.set, 1);
  assert.equal(by.x2.data.set, 3);                                   // after the 2 existing sets
  assert.deepEqual(by.w1.data.exercises.map((x) => x.key), ["bench_press", "squat"]);
  assert.deepEqual(by.w2.data.exercises.map((x) => x.key), ["bench_press"]);
  assert.equal(by.w2.data.exercises[0].notes, "old note");
  assert.equal(mergePlan(db, "bench", "bench").length, 0);
  console.log("mergePlan: ok");
}
