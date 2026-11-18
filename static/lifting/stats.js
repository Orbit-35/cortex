// Lifting maths: pure functions, no DOM, no storage. Pages (and later the desktop
// dashboards) pass in entries and get numbers back, so this is easy to test and reuse.

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

const setOf = (e) => ({
  weight: e.value, reps: e.data?.reps, e1rm: e1rm(e.value, e.data?.reps), recorded_at: e.recorded_at,
});

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
  const sorted = [...entries].sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1));
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
  if (s.e1rm > best.e1rm) return "e1rm";
  const atReps = reps.find((r) => r.reps === s.reps);
  if (!atReps || s.weight > atReps.weight) return "reps";
  return null;
}

// Round a kg number for display: at most one decimal, no trailing ".0".
export const fmtKg = (n) => String(Math.round(n * 10) / 10);
