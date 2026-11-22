// The plain REST endpoints, /sw.js and /api/version on a throwaway server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../lib/server.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

const post = (body) => fetch(`${srv.url}/api/entries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("a duplicate client_id is 409; deleting a missing id is 404", async () => {
  const e = { module: "rest", metric: "a", value: 1, client_id: "rest-00000001" };
  assert.equal((await post(e)).status, 201);
  assert.equal((await post(e)).status, 409);
  assert.equal((await fetch(`${srv.url}/api/entries/999999`, { method: "DELETE" })).status, 404);
});

test("/api/metrics is most recent first", async () => {
  await post({ module: "met", metric: "old", value: 1, recorded_at: "2026-01-01T00:00:00Z" });
  await post({ module: "met", metric: "new", value: 1, recorded_at: "2026-06-01T00:00:00Z" });
  assert.deepEqual(await (await fetch(`${srv.url}/api/metrics?module=met`)).json(), ["new", "old"]);
});

test("/sw.js is stamped with the version and never cached", async () => {
  const res = await fetch(`${srv.url}/sw.js`);
  const text = await res.text();
  assert.ok(!text.includes("__VERSION__"));
  assert.match(res.headers.get("cache-control") || "", /no-cache/);
  const { version } = await (await fetch(`${srv.url}/api/version`)).json();
  assert.match(version, /^[0-9a-f]{12}$/);
  assert.ok(text.includes(version));
});

test("the server wrote its startup backup into the test folder, not the real one", async () => {
  const { readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (let i = 0; i < 30; i++) {
    try { if (readdirSync(join(srv.dir, "backups")).length) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail("no backup in the test folder");
});
