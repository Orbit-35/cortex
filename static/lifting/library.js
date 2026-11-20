// Exercise library. Built-in exercises ship with the app (this file); your own exercises
// and your edits to built-ins are `_exercise` entries that sit on top, keyed by the same
// `key`. A set's `metric` is its exercise key, which never changes: renaming an exercise
// only changes its display name, so history stays attached.
//
// Muscles: `primary` gets 1 set of credit per set, each `secondary` muscle 0.5
// (fractional counting, see DESIGN.md D27).

export const MUSCLES = {
  chest: "Chest", back: "Back", lower_back: "Lower back", traps: "Traps",
  shoulders: "Shoulders", biceps: "Biceps", triceps: "Triceps", forearms: "Forearms",
  abs: "Abs", quads: "Quads", hamstrings: "Hamstrings", glutes: "Glutes", calves: "Calves",
};

// [key, name, equipment, primary, secondary...]
const RAW = [
  // Chest
  ["bench_press", "Bench Press", "barbell", "chest", "triceps", "shoulders"],
  ["incline_bench_press", "Incline Bench Press", "barbell", "chest", "shoulders", "triceps"],
  ["decline_bench_press", "Decline Bench Press", "barbell", "chest", "triceps"],
  ["dumbbell_bench_press", "Dumbbell Bench Press", "dumbbell", "chest", "triceps", "shoulders"],
  ["incline_dumbbell_press", "Incline Dumbbell Press", "dumbbell", "chest", "shoulders", "triceps"],
  ["chest_press_machine", "Chest Press Machine", "machine", "chest", "triceps", "shoulders"],
  ["dumbbell_fly", "Dumbbell Fly", "dumbbell", "chest"],
  ["cable_fly", "Cable Fly", "cable", "chest"],
  ["pec_deck", "Pec Deck", "machine", "chest"],
  ["push_up", "Push-up", "bodyweight", "chest", "triceps", "shoulders"],
  ["dip", "Dip", "bodyweight", "triceps", "chest", "shoulders"],
  // Shoulders
  ["overhead_press", "Overhead Press", "barbell", "shoulders", "triceps"],
  ["dumbbell_shoulder_press", "Dumbbell Shoulder Press", "dumbbell", "shoulders", "triceps"],
  ["shoulder_press_machine", "Shoulder Press Machine", "machine", "shoulders", "triceps"],
  ["arnold_press", "Arnold Press", "dumbbell", "shoulders", "triceps"],
  ["lateral_raise", "Lateral Raise", "dumbbell", "shoulders"],
  ["cable_lateral_raise", "Cable Lateral Raise", "cable", "shoulders"],
  ["rear_delt_fly", "Rear Delt Fly", "dumbbell", "shoulders", "back"],
  ["face_pull", "Face Pull", "cable", "shoulders", "back", "traps"],
  ["upright_row", "Upright Row", "barbell", "shoulders", "traps"],
  ["shrug", "Shrug", "dumbbell", "traps", "forearms"],
  // Back
  ["deadlift", "Deadlift", "barbell", "lower_back", "glutes", "hamstrings", "traps", "forearms"],
  ["pull_up", "Pull-up", "bodyweight", "back", "biceps"],
  ["chin_up", "Chin-up", "bodyweight", "back", "biceps"],
  ["lat_pulldown", "Lat Pulldown", "cable", "back", "biceps"],
  ["barbell_row", "Barbell Row", "barbell", "back", "biceps", "lower_back"],
  ["dumbbell_row", "Dumbbell Row", "dumbbell", "back", "biceps"],
  ["seated_cable_row", "Seated Cable Row", "cable", "back", "biceps"],
  ["t_bar_row", "T-Bar Row", "barbell", "back", "biceps"],
  ["machine_row", "Machine Row", "machine", "back", "biceps"],
  ["back_extension", "Back Extension", "bodyweight", "lower_back", "glutes", "hamstrings"],
  // Arms
  ["barbell_curl", "Barbell Curl", "barbell", "biceps", "forearms"],
  ["dumbbell_curl", "Dumbbell Curl", "dumbbell", "biceps", "forearms"],
  ["hammer_curl", "Hammer Curl", "dumbbell", "biceps", "forearms"],
  ["preacher_curl", "Preacher Curl", "machine", "biceps"],
  ["cable_curl", "Cable Curl", "cable", "biceps"],
  ["triceps_pushdown", "Triceps Pushdown", "cable", "triceps"],
  ["skull_crusher", "Skull Crusher", "barbell", "triceps"],
  ["overhead_triceps_extension", "Overhead Triceps Extension", "cable", "triceps"],
  ["close_grip_bench_press", "Close-Grip Bench Press", "barbell", "triceps", "chest", "shoulders"],
  ["wrist_curl", "Wrist Curl", "dumbbell", "forearms"],
  // Legs
  ["squat", "Squat", "barbell", "quads", "glutes", "hamstrings"],
  ["front_squat", "Front Squat", "barbell", "quads", "glutes", "abs"],
  ["goblet_squat", "Goblet Squat", "dumbbell", "quads", "glutes"],
  ["hack_squat", "Hack Squat", "machine", "quads", "glutes"],
  ["leg_press", "Leg Press", "machine", "quads", "glutes"],
  ["lunge", "Lunge", "dumbbell", "quads", "glutes", "hamstrings"],
  ["bulgarian_split_squat", "Bulgarian Split Squat", "dumbbell", "quads", "glutes"],
  ["leg_extension", "Leg Extension", "machine", "quads"],
  ["romanian_deadlift", "Romanian Deadlift", "barbell", "hamstrings", "glutes", "lower_back"],
  ["leg_curl", "Leg Curl", "machine", "hamstrings"],
  ["hip_thrust", "Hip Thrust", "barbell", "glutes", "hamstrings"],
  ["calf_raise", "Standing Calf Raise", "machine", "calves"],
  ["seated_calf_raise", "Seated Calf Raise", "machine", "calves"],
  // Core
  ["crunch", "Crunch", "bodyweight", "abs"],
  ["cable_crunch", "Cable Crunch", "cable", "abs"],
  ["hanging_leg_raise", "Hanging Leg Raise", "bodyweight", "abs"],
  ["plank", "Plank", "bodyweight", "abs"],
];

export const BUILTIN = RAW.map(([key, name, equipment, primary, ...secondary]) => ({
  key, name, equipment, primary, secondary, cue: "",
}));

// "Bench Press" -> "bench_press". Leading/trailing "_" are stripped, so a typed name can
// never produce a reserved metric like "_workout".
export const slug = (name) =>
  String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

// Fallback display name for a key with no definition (e.g. very old sets): "leg_day_row" -> "Leg Day Row".
export const nameFromKey = (key) =>
  key.split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export const exerciseId = (key) => `exercise:${key}`;

// All exercises: built-ins overlaid with your `_exercise` entries, by key.
// Returns Map key -> { key, name, equipment, primary, secondary, custom, hidden }.
export function resolveExercises(exerciseEntries) {
  const map = new Map(BUILTIN.map((b) => [b.key, { ...b, custom: false, hidden: false }]));
  for (const e of exerciseEntries) {
    const d = e.data || {};
    if (!d.key) continue;
    const base = map.get(d.key);
    map.set(d.key, {
      key: d.key,
      name: d.name ?? base?.name ?? nameFromKey(d.key),
      equipment: d.equipment ?? base?.equipment ?? null,
      primary: d.primary ?? base?.primary ?? null,
      secondary: d.secondary ?? base?.secondary ?? [],
      custom: !base,
      hidden: !!d.hidden,
      cue: d.cue ?? "",
    });
  }
  return map;
}

// Look up an exercise, falling back to a name made from the key.
export function exerciseFor(map, key) {
  return map.get(key) ?? { key, name: nameFromKey(key), equipment: null, primary: null, secondary: [], custom: true, hidden: false, cue: "" };
}

// A key for a new exercise: its slug, made unique if taken ("cable_row_2").
export function newKey(name, takenKeys) {
  const base = slug(name) || "exercise";
  let key = base, n = 2;
  while (takenKeys.has(key)) key = `${base.slice(0, 37)}_${n++}`;
  return key;
}
