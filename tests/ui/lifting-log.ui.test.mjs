// Logging a workout on the phone: start, pick an exercise, type a set, finish, and check it
// is in the list, in local storage, and on the server after a sync.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "./lib/harness.mjs";
import { logOneSet } from "./lib/flows.mjs";

const app = useApp();

test("log a workout and it reaches the server", async () => {
  const page = await app.device();
  await page.goto("/lifting/");
  await page.waitFor('[data-act="start"]');
  await logOneSet(page);
  await page.waitFor(".wcard");
  await page.shot("lifting-log-saved");
  assert.match(await page.text(".wcard"), /Bench Press/);
  assert.match(await page.text(".wcard"), /1 set\b/);

  const local = await page.cortex("listEntries", { module: "lifting", limit: 100 });
  const set = local.find((e) => e.metric === "bench_press");
  assert.ok(set, "the set is in local storage");
  assert.equal(set.value, 100);
  assert.equal(set.data.reps, 5);
  assert.ok(local.find((e) => e.metric === "_workout" && e.client_id === set.data.workout), "and its workout");

  const status = await page.syncIdle();
  assert.equal(status.pending, 0, "outbox empty after sync");
  const server = await (await fetch(`${app.server.url}/api/entries?module=lifting&metric=bench_press`)).json();
  assert.equal(server.length, 1);
  assert.equal(server[0].client_id, set.client_id);
});
