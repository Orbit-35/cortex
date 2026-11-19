// Workouts: pure functions, no DOM, no storage (tested by tests/workouts.test.mjs).
//
// Storage (all rows in the generic `entries` table, module "lifting"):
//   workout  metric "_workout", recorded_at = start time,
//            data { name, notes, duration_min, exercises: [{ key, notes }] }  (order of exercises)
//   set      metric = exercise key, value = weight as typed, unit "lb"|"kg",
//            data { reps, set (number within its exercise), workout (workout client_id),
//                   rpe (perceived effort 6-10 in 0.5 steps, or null) }
//
// Editing works on a "draft": a plain copy of a workout that the screen changes freely.
// Saving turns the draft back into entries (commitPlan), so a whole workout is saved
// in one go and nothing half-edited ever syncs.

import { dayKey } from "./stats.js";
import { toKg, showWeight, parseWeight } from "./units.js";

export const WORKOUT = "_workout";
export const EXERCISE = "_exercise";
export const isSet = (e) => e.module === "lifting" && !e.metric.startsWith("_");

const byTime = (a, b) => (a.recorded_at < b.recorded_at ? -1 : a.recorded_at > b.recorded_at ? 1 : 0);
const setNo = (s) => s.data?.set ?? 0;

// Turn entries into workouts with their exercises and sets, newest first.
export function groupWorkouts(entries) {
  const sets = new Map();
  for (const e of entries) {
    if (!isSet(e) || !e.data?.workout) continue;
    if (!sets.has(e.data.workout)) sets.set(e.data.workout, []);
    sets.get(e.data.workout).push(e);
  }
  const workouts = [];
  for (const w of entries) {
    if (w.metric !== WORKOUT) continue;
    const mine = (sets.get(w.client_id) || []).sort((a, b) => setNo(a) - setNo(b) || byTime(a, b));
    const listed = (w.data?.exercises || []).map((x) => x.key);
    const order = [...new Set([...listed, ...mine.map((s) => s.metric)])];
    const notes = new Map((w.data?.exercises || []).map((x) => [x.key, x.notes || ""]));
    workouts.push({
      id: w.client_id, entry: w,
      name: w.data?.name || "Workout", notes: w.data?.notes || "",
      start: w.recorded_at, duration_min: w.data?.duration_min ?? null,
      exercises: order.map((key) => ({ key, notes: notes.get(key) || "", sets: mine.filter((s) => s.metric === key) })),
    });
  }
  return workouts.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

// Sets logged before workouts existed have no `workout`. Group them by local day into
// one workout per day. The id comes from the day, so two devices doing this produce
// the same workout instead of two copies. Returns the entries to save (may be empty).
export function legacyPlan(entries) {
  const orphans = entries.filter((e) => isSet(e) && !e.data?.workout).sort(byTime);
  if (!orphans.length) return [];
  const existing = new Set(entries.filter((e) => e.metric === WORKOUT).map((e) => e.client_id));
  const days = new Map();
  for (const s of orphans) {
    const day = dayKey(s.recorded_at);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(s);
  }
  const out = [];
  for (const [day, sets] of days) {
    const id = `workout:legacy:${day}`;
    if (!existing.has(id)) {
      const span = (new Date(sets.at(-1).recorded_at) - new Date(sets[0].recorded_at)) / 60000;
      out.push({
        client_id: id, module: "lifting", metric: WORKOUT, value: null, unit: null,
        recorded_at: sets[0].recorded_at,
        data: {
          name: "Workout", notes: "",
          duration_min: span >= 1 && span < 300 ? Math.round(span) : null,
          exercises: [...new Set(sets.map((s) => s.metric))].map((key) => ({ key, notes: "" })),
        },
      });
    }
    for (const s of sets) out.push({ ...s, data: { ...s.data, workout: id } });
  }
  return out;
}

export function defaultName(date = new Date()) {
  const h = date.getHours();
  const part = h < 5 ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night";
  return `${part} workout`;
}

// The sets of `key` from the most recent other workout that started before `beforeIso`.
// Used for the "Previous" column and to prefill a new set.
export function previousSets(workouts, key, beforeIso, excludeId) {
  for (const w of workouts) { // newest first
    if (w.id === excludeId || w.start >= beforeIso) continue;
    const ex = w.exercises.find((x) => x.key === key);
    if (ex && ex.sets.length) return ex.sets;
  }
  return [];
}

// Total volume of a list of sets, in kg: weight × reps.
export const volumeKg = (sets) => sets.reduce((sum, s) => sum + toKg(s.value, s.unit) * (s.data?.reps || 0), 0);

// ---------- Drafts ----------

// mode: "live" (happening now, sets are ticked off), "past" (adding a forgotten day),
// "edit" (changing a saved workout).
export function newDraft({ id, mode, unit, start, name, duration_min = null }) {
  return { id, mode, unit, start, name, notes: "", duration_min, exercises: [] };
}

export const blankRow = (id) => ({ id, weight: "", reps: "", rpe: null, done: false, at: null });

// A saved workout as an editable draft. `orig` remembers each set as saved, so
// untouched sets are written back exactly as they were (including their unit).
export function draftFromWorkout(w, unit) {
  return {
    id: w.id, mode: "edit", unit, start: w.start, name: w.name, notes: w.notes,
    duration_min: w.duration_min,
    exercises: w.exercises.map((x) => ({
      key: x.key, notes: x.notes,
      sets: x.sets.map((s) => ({
        id: s.client_id, weight: showWeight(s.value, s.unit, unit), reps: String(s.data?.reps ?? ""),
        rpe: s.data?.rpe ?? null, done: true, at: s.recorded_at,
      })),
    })),
  };
}

const validReps = (r) => { const n = Number(r); return Number.isInteger(n) && n > 0 ? n : null; };

// Which rows get saved: live workouts keep ticked sets; past/edit keep any set with reps.
export const keptRows = (draft, ex) =>
  ex.sets.filter((r) => validReps(r.reps) && !Number.isNaN(parseWeight(r.weight)) && (draft.mode !== "live" || r.done));

// Turn a draft into the entries to save: the workout, its sets, and deletion markers
// for sets that were removed. `original` is the saved workout (edit mode) or null.
export function commitPlan(draft, original, now = new Date()) {
  const nowIso = now.toISOString();
  const origSets = new Map();
  for (const x of original?.exercises || []) for (const s of x.sets) origSets.set(s.client_id, s);
  const shift = original ? new Date(draft.start) - new Date(original.start) : 0;
  const duration = draft.mode === "live"
    ? Math.max(0, Math.round((now - new Date(draft.start)) / 60000))
    : draft.duration_min ?? null;

  const out = [];
  const kept = new Set();
  const exercises = [];
  for (const ex of draft.exercises) {
    const rows = keptRows(draft, ex);
    if (!rows.length && draft.mode === "live") continue; // nothing done for this exercise
    exercises.push({ key: ex.key, notes: ex.notes || "" });
    rows.forEach((r, i) => {
      const orig = origSets.get(r.id);
      const typed = parseWeight(r.weight);
      const untouched = orig && r.weight === showWeight(orig.value, orig.unit, draft.unit);
      kept.add(r.id);
      out.push({
        ...(orig || {}),
        client_id: r.id, module: "lifting", metric: ex.key,
        value: untouched ? orig.value : typed,
        unit: untouched ? orig.unit : draft.unit,
        recorded_at: orig ? new Date(new Date(orig.recorded_at).getTime() + shift).toISOString()
          : draft.mode === "live" ? (r.at || nowIso) : draft.start,
        data: { ...(orig?.data || {}), reps: validReps(r.reps), set: i + 1, workout: draft.id, rpe: r.rpe ?? null },
        deleted_at: null,
      });
    });
  }
  out.unshift({
    ...(original?.entry || {}),
    client_id: draft.id, module: "lifting", metric: WORKOUT, value: null, unit: null,
    recorded_at: draft.start,
    data: {
      ...(original?.entry?.data || {}),
      name: draft.name.trim() || "Workout", notes: draft.notes || "", duration_min: duration, exercises,
    },
    deleted_at: null,
  });
  for (const [id, s] of origSets) if (!kept.has(id)) out.push({ ...s, deleted_at: nowIso });
  return out;
}

// Deleting a workout deletes its sets too.
export function deletePlan(workout, now = new Date()) {
  const at = now.toISOString();
  return [workout.entry, ...workout.exercises.flatMap((x) => x.sets)].map((e) => ({ ...e, deleted_at: at }));
}

// Merge exercise `from` into `to`: every set of `from` becomes a set of `to`, workouts
// list `to` instead, and `from` is hidden. If a workout had both, the merged sets are
// numbered after `to`'s. `fromDef` is the exercise entry/definition to hide.
export function mergePlan(entries, from, to, now = new Date()) {
  if (from === to) return [];
  const workouts = groupWorkouts(entries);
  const out = [];
  for (const w of workouts) {
    const a = w.exercises.find((x) => x.key === from);
    if (!a) continue;
    const b = w.exercises.find((x) => x.key === to);
    const offset = b ? b.sets.length : 0;
    a.sets.forEach((s, i) => out.push({ ...s, metric: to, data: { ...s.data, set: offset + i + 1 } }));
    const list = (w.entry.data?.exercises || []).filter((x) => x.key !== from || !b)
      .map((x) => (x.key === from ? { ...x, key: to } : x));
    if (b && a.notes) { const t = list.find((x) => x.key === to); if (t) t.notes = [t.notes, a.notes].filter(Boolean).join("\n"); }
    out.push({ ...w.entry, data: { ...w.entry.data, exercises: list } });
  }
  // Sets that somehow have no workout still move.
  for (const s of entries) if (isSet(s) && s.metric === from && !s.data?.workout) out.push({ ...s, metric: to });
  return out;
}
