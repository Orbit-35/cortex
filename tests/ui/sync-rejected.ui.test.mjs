// Entries the server refuses are remembered and reported, never silently dropped (DESIGN D58).
// A bad entry can't be saved through the app any more (core/check.js), so these tests write
// it straight into IndexedDB, the way an older app version or a bug could have left it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "./lib/harness.mjs";

const app = useApp();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const good = (over = {}) => ({
  client_id: `rej-${Date.now()}-${++n}`, module: "test", metric: "m", value: 1, unit: null, data: {},
  recorded_at: "2026-11-20T10:00:00.000Z", source: "manual", external_id: null,
  updated_at: new Date().toISOString(), deleted_at: null, ...over,
});

// Put an entry into this device's storage and outbox directly, skipping the app's checks.
const inject = (page, entry) => page.eval((entry) => new Promise((res, rej) => {
  const req = indexedDB.open("cortex");
  req.onsuccess = () => {
    const t = req.result.transaction(["entries", "outbox"], "readwrite");
    t.objectStore("entries").put(entry);
    t.objectStore("outbox").put(entry);
    t.oncomplete = () => { req.result.close(); res(true); };
    t.onerror = () => rej(t.error);
  };
}), entry);
const local = (page, id) => page.eval((id) => new Promise((res) => {
  const req = indexedDB.open("cortex");
  req.onsuccess = () => { const g = req.result.transaction("entries").objectStore("entries").get(id); g.onsuccess = () => res(g.result ?? null); };
}), id);
const onServer = async (id) => (await (await fetch(`${app.server.url}/api/sync`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ since: 0, entries: [] }),
})).json()).entries.find((e) => e.client_id === id) ?? null;

async function device() {
  const page = await app.device();
  await page.goto("/lifting/");
  await page.waitFor('[data-act="start"]');
  await page.syncIdle();
  return page;
}

test("the app itself refuses to save an entry the server would refuse", async () => {
  const page = await device();
  await assert.rejects(page.cortex("putEntries", [good({ recorded_at: "not-a-date" })]), /can't save this entry \(recorded_at: bad date\)/);
  assert.equal((await page.cortex("getStatus")).pending, 0, "nothing was queued");
});

test("a refused entry is remembered with its reason, and fixing it clears the error", async () => {
  const a = await device(), b = await device();
  const bad = good({ recorded_at: "not-a-date" });
  await inject(a, bad);
  const s = await a.syncIdle();
  assert.deepEqual([s.pending, s.rejected], [0, 1], "refused, not pending, and counted");
  const list = await a.cortex("listRejected");
  assert.equal(list[0].client_id, bad.client_id);
  assert.match(list[0].reason, /recorded_at: bad date/);
  assert.ok(await local(a, bad.client_id), "still on this device");
  await b.syncIdle();
  assert.equal(await local(b, bad.client_id), null, "never reached the other device");

  // A retry sends it again; the same bad entry is refused again.
  const again = await a.cortex("retryRejected");
  assert.equal(again, true);
  assert.equal((await a.cortex("getStatus")).rejected, 1);

  // Fixing the entry clears the error, and the other device gets it.
  await a.cortex("putEntries", [{ ...bad, recorded_at: "2026-11-20T10:00:00.000Z", data: { fixed: true } }]);
  const fixed = await a.syncIdle();
  assert.deepEqual([fixed.pending, fixed.rejected], [0, 0]);
  await b.syncIdle();
  assert.deepEqual((await local(b, bad.client_id))?.data, { fixed: true });
});

test("a refused delete keeps the entry on the device instead of losing the delete", async () => {
  const a = await device(), b = await device();
  const e = good();
  await a.cortex("putEntries", [e]);
  await a.syncIdle();
  await b.syncIdle();
  const kept = await local(a, e.client_id);
  // A delete marker carrying a bad field (as a past bug could have written it).
  await inject(a, { ...kept, recorded_at: "bad", updated_at: new Date(Date.now() + 5).toISOString(), deleted_at: new Date(Date.now() + 5).toISOString() });
  const s = await a.syncIdle();
  assert.equal(s.rejected, 1);
  assert.ok(await local(a, e.client_id), "the delete marker is kept, not dropped");
  assert.ok(await onServer(e.client_id), "the server still has it");

  // A newer edit from another device replaces the refused one and clears the error.
  await sleep(10);
  await b.cortex("putEntries", [{ ...e, data: { from: "b" } }]);
  await b.syncIdle();
  const after = await a.syncIdle();
  assert.equal(after.rejected, 0, "nothing left to fix");
  assert.deepEqual((await local(a, e.client_id)).data, { from: "b" });
  assert.equal((await local(a, e.client_id)).deleted_at, null);
});

test("the same imported row on two devices: the second is refused as a duplicate", async () => {
  const a = await device(), b = await device();
  await a.cortex("putEntries", [good({ source: "test_import", external_id: "row-1" })]);
  await a.syncIdle();
  await b.cortex("putEntries", [good({ source: "test_import", external_id: "row-1" })]);
  const s = await b.syncIdle();
  assert.equal(s.rejected, 1);
  assert.match((await b.cortex("listRejected"))[0].reason, /duplicate import/);
});
