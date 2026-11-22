// Two devices (separate browser storage) syncing through one server (DESIGN D5-D9, D52).
import { test } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "./lib/harness.mjs";
import { logOneSet } from "./lib/flows.mjs";

const app = useApp();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function twoDevices() {
  const a = await app.device(), b = await app.device();
  for (const p of [a, b]) { await p.goto("/lifting/"); await p.waitFor('[data-act="start"]'); }
  return [a, b];
}
const local = (page, id) => page.eval(async (id) => {
  const m = await import("/core/cortex.js");
  return (await m.listEntries({ module: "lifting", limit: Infinity })).find((e) => e.client_id === id) || null;
}, id);

test("A logs a workout, B sees it; A deletes it, B loses it", async () => {
  const [a, b] = await twoDevices();
  await logOneSet(a, { weight: "80", reps: "3" });
  const setId = (await a.cortex("listEntries", { module: "lifting", limit: 100 })).find((e) => e.metric === "bench_press").client_id;
  assert.equal(await local(b, setId), null, "B's storage is separate: nothing until it syncs");
  await a.syncIdle();
  await b.syncIdle();
  await b.waitFor(".wcard");
  assert.match(await b.text(".wcard"), /Bench Press/);

  const ids = (await a.cortex("listEntries", { module: "lifting", limit: 100 })).map((e) => e.client_id);
  for (const id of ids) await a.cortex("deleteEntry", id);
  await a.syncIdle();
  await b.syncIdle();
  await b.waitFor(() => !document.querySelector(".wcard"));
  for (const id of ids) assert.equal(await local(b, id), null);
});

test("both edit the same exercise offline: the later edit wins on both", async () => {
  const [a, b] = await twoDevices();
  const ex = (name) => ({ client_id: "exercise:test_curl", module: "lifting", metric: "_exercise", data: { name, equipment: "dumbbell", primary: "biceps", secondary: [] } });
  await a.cortex("putEntries", [ex("Curl (first)")]);
  await a.syncIdle();
  await b.syncIdle();
  await a.setOffline(true);
  await b.setOffline(true);
  await a.cortex("putEntries", [ex("Curl from A")]);
  await sleep(20);
  await b.cortex("putEntries", [ex("Curl from B")]); // later
  await a.setOffline(false);
  await b.setOffline(false);
  await a.syncIdle();
  await b.syncIdle();
  await a.syncIdle();
  assert.equal((await local(a, "exercise:test_curl")).data.name, "Curl from B");
  assert.equal((await local(b, "exercise:test_curl")).data.name, "Curl from B");
});

test("an unsent edit survives an incoming older change, then wins everywhere", async () => {
  const [a, b] = await twoDevices();
  const ex = (name) => ({ client_id: "exercise:test_row", module: "lifting", metric: "_exercise", data: { name, equipment: "cable", primary: "back", secondary: [] } });
  await a.cortex("putEntries", [ex("Row")]);
  await a.syncIdle();
  await b.syncIdle();
  await b.setOffline(true);
  await a.cortex("putEntries", [ex("Row from A")]); // earlier edit, synced
  await a.syncIdle();
  await sleep(20);
  await b.cortex("putEntries", [ex("Row from B")]); // later edit, not sent yet
  await b.setOffline(false);
  await b.syncIdle();
  assert.equal((await local(b, "exercise:test_row")).data.name, "Row from B", "B kept its own edit");
  await a.syncIdle();
  assert.equal((await local(a, "exercise:test_row")).data.name, "Row from B", "and A got it");
});
