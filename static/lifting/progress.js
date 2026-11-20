// Progress overview maths: pure functions, no DOM (tested by tests/progress.test.mjs).
// Weights in and out are kg; the page converts for display.

import { prKind } from "./stats.js";
import { toKg } from "./units.js";

// The radar chart and split use six broad groups; exercises are tagged with finer muscles.
export const GROUPS = ["chest", "back", "shoulders", "arms", "legs", "core"];
export const GROUP_LABEL = { chest: "Chest", back: "Back", shoulders: "Shoulders", arms: "Arms", legs: "Legs", core: "Core" };
export const MUSCLE_GROUP = {
  chest: "chest", back: "back", lower_back: "back", traps: "back", shoulders: "shoulders",
  biceps: "arms", triceps: "arms", forearms: "arms", quads: "legs", hamstrings: "legs",
  glutes: "legs", calves: "legs", abs: "core",
};

// Sets per group (DESIGN D27): primary muscle 1, each secondary 0.5. A group gets at most
// 1 per set, so bench (chest + triceps + shoulders) can't count as 1.5 "arms + shoulders"
// twice for the same group. `exerciseOf(key)` returns { primary, secondary }.
export function groupSets(sets, exerciseOf) {
  const out = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (const s of sets) {
    const ex = exerciseOf(s.metric);
    const credit = {};
    for (const m of ex.secondary || []) {
      const g = MUSCLE_GROUP[m];
      if (g) credit[g] = Math.max(credit[g] || 0, 0.5);
    }
    const p = MUSCLE_GROUP[ex.primary];
    if (p) credit[p] = 1;
    for (const [g, c] of Object.entries(credit)) out[g] += c;
  }
  return out;
}

// Every set that was a PR when it was done, by set id: "e1rm" or "reps".
// Walks each exercise's sets oldest first, comparing each against everything before it.
export function prEvents(sets) {
  const byKey = new Map();
  for (const s of sets) {
    if (!byKey.has(s.metric)) byKey.set(s.metric, []);
    byKey.get(s.metric).push(s);
  }
  const events = new Map();
  for (const list of byKey.values()) {
    list.sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : a.recorded_at > b.recorded_at ? 1 : 0));
    for (let i = 1; i < list.length; i++) {
      const kind = prKind(list[i], list.slice(0, i));
      if (kind) events.set(list[i].client_id, kind);
    }
  }
  return events;
}

// Lifetime totals. `workouts` are grouped workouts (workouts.js).
export function totals(workouts) {
  let volumeKg = 0, sets = 0, reps = 0, minutes = 0;
  for (const w of workouts) {
    minutes += w.duration_min || 0;
    for (const x of w.exercises) for (const s of x.sets) {
      if (s.data?.type === "warmup") continue; // warm-ups don't count (DESIGN D37)
      sets += 1;
      reps += s.data?.reps || 0;
      volumeKg += toKg(s.value, s.unit) * (s.data?.reps || 0);
    }
  }
  return { workouts: workouts.length, volumeKg, sets, reps, minutes };
}

// Real-life objects to compare total volume with, lightest first. Weights are rough,
// commonly cited figures in kg.
export const OBJECTS = [
  { name: "Labrador", kg: 30, icon: "🐕" },
  { name: "Motorcycle", kg: 200, icon: "🏍️" },
  { name: "Grand piano", kg: 450, icon: "🎹" },
  { name: "Horse", kg: 500, icon: "🐎" },
  { name: "Car", kg: 1_400, icon: "🚗" },
  { name: "Pickup truck", kg: 2_500, icon: "🛻" },
  { name: "African elephant", kg: 6_000, icon: "🐘" },
  { name: "T. rex", kg: 8_000, icon: "🦖" },
  { name: "School bus", kg: 11_000, icon: "🚌" },
  { name: "Humpback whale", kg: 30_000, icon: "🐋" },
  { name: "Boeing 737", kg: 41_000, icon: "✈️" },
  { name: "Space shuttle", kg: 78_000, icon: "🚀" },
  { name: "Blue whale", kg: 150_000, icon: "🐳" },
  { name: "Locomotive", kg: 200_000, icon: "🚂" },
  { name: "Statue of Liberty", kg: 204_000, icon: "🗽" },
  { name: "Space station", kg: 420_000, icon: "🛰️" },
  { name: "Saturn V rocket", kg: 2_900_000, icon: "🚀" },
  { name: "Eiffel Tower", kg: 7_300_000, icon: "🗼" },
  { name: "Titanic", kg: 52_000_000, icon: "🚢" },
  { name: "Aircraft carrier", kg: 100_000_000, icon: "⚓" },
  { name: "Great Pyramid", kg: 5_900_000_000, icon: "🔺" },
];

// Where total volume stands: the heaviest object passed, the next one, progress to it,
// and the "journey" (how many times each passed object has been lifted).
export function milestone(volumeKg) {
  const passed = OBJECTS.filter((o) => volumeKg >= o.kg);
  const next = OBJECTS.find((o) => volumeKg < o.kg) || null;
  const last = passed.at(-1) || null;
  return {
    last, next,
    progress: next ? volumeKg / next.kg : 1,
    journey: passed.map((o) => ({ ...o, times: volumeKg / o.kg })).reverse(),
  };
}

// Only sets on or after `fromIso` (null = all time).
export const since = (sets, fromIso) => (fromIso ? sets.filter((s) => s.recorded_at >= fromIso) : sets);
