// Lifting maths: pure functions, no DOM, no storage. Pages (and later the desktop
// dashboards) pass in set entries and get numbers back, so this is easy to test and reuse.
// All weights coming out of here are in kg (sets may be stored in lb or kg); convert
// for display with units.js.
import { toKg } from "./units.js";

// Estimated one-rep max (Epley): weight × (1 + reps/30). A single is taken as-is.
// It's an estimate: reasonable up to ~10-12 reps, increasingly optimistic beyond.
export function e1rm(weight, reps) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

// Local calendar day of an ISO timestamp, as YYYY-MM-DD.
export function dayKey(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Oldest first. Sets saved together share one time, so ties go by workout, then set number,
// so every device counts the same PRs.
export const byTime = (a, b) =>
  (a.recorded_at < b.recorded_at ? -1 : a.recorded_at > b.recorded_at ? 1
    : String(a.data?.workout ?? "").localeCompare(String(b.data?.workout ?? "")) || (a.data?.set ?? 0) - (b.data?.set ?? 0));

const setOf = (e) => {
  const kg = toKg(e.value, e.unit);
  return { weight: kg, reps: e.data?.reps, e1rm: e1rm(kg, e.data?.reps), recorded_at: e.recorded_at };
};

// One point per training day: that day's best set by estimated 1RM, oldest first.
export function bestPerDay(entries) {
  const days = new Map();
  for (const e of entries) {
    const s = setOf(e);
    if (!s.e1rm) continue;
    const key = dayKey(e.recorded_at);
    const cur = days.get(key);
    if (!cur || s.e1rm > cur.e1rm) days.set(key, { day: key, ...s });
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

// Heaviest weight lifted at each rep count (the classic "rep PR" table), plus the best e1RM overall.
// Ties go to the earliest set: that's when the PR was first hit.
export function personalRecords(entries) {
  const byReps = new Map();
  let best = null;
  const sorted = [...entries].sort(byTime);
  for (const e of sorted) {
    const s = setOf(e);
    if (!s.e1rm) continue;
    const cur = byReps.get(s.reps);
    if (!cur || s.weight > cur.weight) byReps.set(s.reps, s);
    if (!best || s.e1rm > best.e1rm) best = s;
  }
  const reps = [...byReps.values()].sort((a, b) => a.reps - b.reps);
  return { best, reps };
}

// Does this new set beat everything before it? Returns what kind of PR, or null.
// "e1rm" = best estimated 1RM ever; "reps" = heaviest weight ever at this rep count.
export function prKind(newSet, previous) {
  const s = setOf(newSet);
  if (!s.e1rm || previous.length === 0) return null;
  const { best, reps } = personalRecords(previous);
  if (!best) return null; // only no-weight sets before: the first weighted set isn't a PR
  if (s.e1rm > best.e1rm) return "e1rm";
  const atReps = reps.find((r) => r.reps === s.reps);
  if (!atReps || s.weight > atReps.weight) return "reps";
  return null;
}

// One row per training day for an exercise, oldest first: best estimated 1RM, heaviest
// weight, and total volume (weight × reps), all in kg. Feeds the exercise charts.
export function sessionSeries(entries) {
  const days = new Map();
  for (const e of entries) {
    const s = setOf(e);
    const key = dayKey(e.recorded_at);
    const d = days.get(key) || { day: key, e1rm: 0, heaviest: 0, volume: 0, sets: 0, best: null };
    d.sets += 1;
    d.volume += s.weight * (s.reps || 0);
    if (s.weight > d.heaviest) d.heaviest = s.weight;
    if (s.e1rm > d.e1rm) { d.e1rm = s.e1rm; d.best = s; }
    days.set(key, d);
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}
