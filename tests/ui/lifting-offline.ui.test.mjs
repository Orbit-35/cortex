// Local-first (DESIGN D5): the app opens and logs with no connection, then syncs when it's back.
// Two ways to be "offline": the phone has no network, or the server is down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "./lib/harness.mjs";
import { logOneSet } from "./lib/flows.mjs";

const app = useApp();
const onServer = async () => (await (await fetch(`${app.server.url}/api/entries?module=lifting&metric=bench_press`)).json()).length;

test("no network: the app still opens, logs, and syncs later", async () => {
  const page = await app.device();
  await page.goto("/lifting/");
  await page.waitForServiceWorker();
  await page.setOffline(true);
  await page.reload();
  await page.waitFor('[data-act="start"]');
  assert.equal(await page.eval(() => navigator.onLine), false);

  await logOneSet(page, { weight: "60", reps: "8" });
  await page.waitFor(".wcard");
  const status = await page.cortex("getStatus");
  assert.ok(status.pending >= 2, `outbox holds the workout and set (pending ${status.pending})`);
  assert.equal(await onServer(), 0, "nothing reached the server");
  await page.shot("offline-logged");

  await page.setOffline(false);
  await page.waitFor(async () => (await import("/core/cortex.js")).getStatus().then((s) => s.pending === 0), { timeout: 30000 });
  assert.equal(await onServer(), 1);
});

test("server down: logs locally, syncs when the server comes back", async () => {
  const page = await app.device();
  await page.goto("/lifting/");
  await page.waitForServiceWorker();
  const before = await onServer();
  await app.server.halt();
  page.offline = true; // connection-refused messages are expected now

  await page.reload();
  await page.waitFor('[data-act="start"]');
  await logOneSet(page, { weight: "70", reps: "6" });
  const down = await page.syncIdle();
  assert.ok(down.pending >= 2 && down.online === false, JSON.stringify(down));

  await app.server.restart();
  page.offline = false;
  const up = await page.syncIdle();
  assert.equal(up.pending, 0);
  assert.equal(await onServer(), before + 1);
});
