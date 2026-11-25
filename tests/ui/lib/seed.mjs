// Test data in the shapes the apps save (lifting: DESIGN D22-D26, workouts.js commitPlan).
// Push it to a test server with seedServer() before the page opens, or into one device's
// local storage only with page.cortex("putEntries", list) while offline.
import { randomUUID } from "node:crypto";
import { sync } from "../../lib/server.mjs";

const base = (over) => ({
  client_id: randomUUID(), value: null, unit: null, data: {}, source: "manual", external_id: null,
  updated_at: new Date().toISOString(), deleted_at: null, ...over,
});

export const entry = (over = {}) => base({ module: "test", metric: "m", recorded_at: new Date().toISOString(), ...over });

// workout({ at, name, sets: [["bench_press", 100, 5], ...], unit }) -> [workout entry, ...set entries]
export function workout({ at = new Date(), name = "Workout", sets = [], unit = "kg", duration_min = 45, id = randomUUID() } = {}) {
  const start = new Date(at).toISOString();
  const keys = [...new Set(sets.map(([k]) => k))];
  const n = new Map();
  const out = [base({
    client_id: id, module: "lifting", metric: "_workout", recorded_at: start,
    data: { name, notes: "", duration_min, exercises: keys.map((key) => ({ key, notes: "" })) },
  })];
  for (const [key, weight, reps] of sets) {
    n.set(key, (n.get(key) || 0) + 1);
    out.push(base({
      module: "lifting", metric: key, value: weight, unit, recorded_at: start,
      data: { reps, set: n.get(key), workout: id, rpe: null, type: null },
    }));
  }
  return out;
}

export const daysAgo = (d, hour = 18) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(hour, 0, 0, 0); return t; };

export async function seedServer(server, entries) {
  const r = await sync(server, entries, 0);
  if (r.status !== 200 || r.body.rejected.length) throw new Error(`seeding failed: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

// Named data sets for step files ("seed": "two-workouts") and tests.
export const SEEDS = {
  empty: async () => {},
  "two-workouts": (server) => seedServer(server, [
    ...workout({ at: daysAgo(3), name: "Push day", sets: [["bench_press", 80, 5], ["bench_press", 80, 5], ["overhead_press", 40, 8]] }),
    ...workout({ at: daysAgo(1), name: "Pull day", sets: [["deadlift", 120, 5], ["barbell_row", 60, 8]] }),
  ]),
  // Bodyweight work (D57): pull-ups with no weight, then once with 10 kg, and chin-ups that
  // never have weight. Bodyweight sets have value null.
  bodyweight: (server) => seedServer(server, [
    ...workout({ at: daysAgo(6), name: "Back day", sets: [["pull_up", null, 8], ["pull_up", null, 10], ["chin_up", null, 6]] }),
    ...workout({ at: daysAgo(3), name: "Weighted", sets: [["pull_up", 10, 5], ["pull_up", 10, 4]] }),
    ...workout({ at: daysAgo(1), name: "Back day", sets: [["pull_up", null, 12], ["chin_up", null, 9]] }),
  ]),
  // About two months of training, so charts and Progress have something to show.
  history: (server) => seedServer(server, Array.from({ length: 16 }, (_, i) => workout({
    at: daysAgo(60 - i * 4), name: i % 2 ? "Pull day" : "Push day",
    sets: i % 2
      ? [["deadlift", 100 + i * 2, 5], ["deadlift", 100 + i * 2, 5], ["barbell_row", 50 + i, 8]]
      : [["bench_press", 60 + i * 1.5, 5], ["bench_press", 60 + i * 1.5, 5], ["overhead_press", 30 + i, 8]],
  })).flat()),
};
