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

test("a refused delete is kept; an older version from another device doesn't overwrite it", async () => {
  const a = await device(), b = await device();
  const e = good();
  await a.cortex("putEntries", [e]);
  await a.syncIdle();
  await b.syncIdle();
  const kept = await local(a, e.client_id);
  // A delete the server can't take: its own time is broken (month 13), as a past bug could write.
  const marker = { ...kept, updated_at: "2026-13-01T00:00:00.000Z", deleted_at: "2026-13-01T00:00:00.000Z" };
  await inject(a, marker);
  const s = await a.syncIdle();
  assert.equal(s.rejected, 1);
  assert.ok((await local(a, e.client_id)).deleted_at, "the delete marker is kept, not dropped");
  assert.ok(await onServer(e.client_id), "the server still has it");

  // Another device's edit is older than the refused delete: it must not replace it silently.
  await b.cortex("putEntries", [{ ...e, data: { from: "b" } }]);
  await b.syncIdle();
  const after = await a.syncIdle();
  assert.equal(after.rejected, 1, "still reported");
  assert.ok((await local(a, e.client_id)).deleted_at, "the refused delete is still what this device holds");
  await a.cortex("retryRejected");
  assert.equal((await a.cortex("getStatus")).rejected, 1, "a retry sends it again and it's refused again, still reported");
});

test("a newer version from another device clears a refused edit", async () => {
  const a = await device(), b = await device();
  const bad = good({ recorded_at: "not-a-date" });
  await inject(a, bad);
  assert.equal((await a.syncIdle()).rejected, 1);
  await sleep(10);
  await b.cortex("putEntries", [{ ...bad, recorded_at: "2026-11-20T10:00:00.000Z", data: { from: "b" } }]);
  await b.syncIdle();
  const s = await a.syncIdle();
  assert.equal(s.rejected, 0, "nothing left to fix");
  assert.deepEqual((await local(a, bad.client_id)).data, { from: "b" });
});

test("deleting a broken entry that never reached the server clears the error", async () => {
  const page = await device();
  const bad = good({ recorded_at: "not-a-date" });
  await inject(page, bad);
  assert.equal((await page.syncIdle()).rejected, 1);
  await page.cortex("deleteEntry", bad.client_id);
  const s = await page.syncIdle();
  assert.deepEqual([s.pending, s.rejected], [0, 0], "the delete went through");
  assert.equal(await local(page, bad.client_id), null, "gone from this device");
});

test("Try again while offline keeps the error and its reason", async () => {
  const page = await device();
  const bad = good({ recorded_at: "not-a-date" });
  await inject(page, bad);
  await page.syncIdle();
  await page.waitFor("#sync .syncbad");
  await page.setOffline(true);
  await page.click("#sync .syncbad");
  await page.waitFor(".cx-ask-box");
  await page.clickText("Try again", ".cx-ask-box button");
  await page.waitFor(() => /Couldn't reach your PC/.test(document.querySelector(".cx-toast")?.innerText || ""));
  assert.equal((await page.cortex("getStatus")).rejected, 1, "still counted");
  assert.match((await page.cortex("listRejected"))[0].reason, /bad date/, "reason kept");
  assert.equal(await page.text("#sync"), "1 not synced");
  await page.setOffline(false);
  assert.equal((await page.syncIdle()).rejected, 1, "refused again once online");
});

test("Try again after the rules were fixed: the server takes it and the error clears", async () => {
  const page = await device();
  // A refusal recorded for an entry the server takes today (as after an update that fixed the rules).
  const e = good();
  await page.eval((e) => new Promise((res) => {
    const req = indexedDB.open("cortex");
    req.onsuccess = () => {
      const t = req.result.transaction(["entries", "meta"], "readwrite");
      t.objectStore("entries").put(e);
      t.objectStore("meta").put({ [e.client_id]: { reason: "old rule", at: e.updated_at, entry: e } }, "rejected");
      t.oncomplete = () => { req.result.close(); res(true); };
    };
  }), e);
  assert.equal((await page.cortex("getStatus")).rejected, 1);
  await page.cortex("retryRejected");
  const s = await page.syncIdle();
  assert.deepEqual([s.pending, s.rejected], [0, 0]);
  assert.ok(await onServer(e.client_id), "now on the server");
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

test("the pill shows 'N not synced'; tapping it explains and offers Try again", async () => {
  const { AUDIT } = await import("./lib/audit.mjs");
  for (const size of ["phone", "small"]) {
    const page = await app.device({ device: size });
    await page.goto("/lifting/");
    await page.waitFor('[data-act="start"]');
    const bad = good({ recorded_at: "not-a-date" });
    await inject(page, bad);
    await page.syncIdle();
    await page.waitFor("#sync .syncbad");
    assert.equal(await page.text("#sync"), "1 not synced");
    assert.equal(await page.eval(() => document.getElementById("sync").className), "sync bad");
    assert.deepEqual(await page.eval(AUDIT), [], "header still passes the layout check");
    await page.shot(`sync-bad-${size}`);

    await page.click("#sync .syncbad");
    await page.waitFor(".cx-ask-box");
    const box = await page.text(".cx-ask-box");
    assert.match(box, /1 change not saved on your PC/);
    assert.match(box, /recorded_at: bad date/);
    assert.match(box, /still on this phone/);
    await page.shot(`sync-bad-dialog-${size}`);
    await page.clickText("Try again", ".cx-ask-box button");
    await page.waitFor(() => /Still refused: 1 change/.test(document.querySelector(".cx-toast")?.innerText || ""));

    await page.cortex("putEntries", [{ ...bad, recorded_at: "2026-11-20T10:00:00.000Z" }]);
    await page.syncIdle();
    await page.waitFor(() => document.getElementById("sync").innerText === "synced");
  }
});
