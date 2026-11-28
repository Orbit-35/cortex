// /api/sync on a throwaway server (DESIGN D5-D9, D52). Run: node --test tests/api/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, sync } from "../lib/server.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

let n = 0;
const id = (p = "c") => `${p}-${String(++n).padStart(8, "0")}`;
const E = (over = {}) => ({
  client_id: id(), module: "test", metric: "m", value: 1, unit: null, data: {},
  recorded_at: "2026-11-20T10:00:00Z", source: "manual", external_id: null,
  updated_at: "2026-11-20T12:00:00Z", deleted_at: null, ...over,
});
const find = (reply, cid) => reply.entries.find((e) => e.client_id === cid);

test("a push comes back in the pull and the cursor goes up", async () => {
  const a = await sync(srv, [], 0);
  const e = E();
  const b = await sync(srv, [e], a.body.cursor);
  assert.equal(b.status, 200);
  assert.ok(b.body.cursor > a.body.cursor);
  assert.ok(find(b.body, e.client_id));
});

test("the same batch twice changes nothing", async () => {
  const e = E();
  const first = await sync(srv, [e], 0);
  const again = await sync(srv, [e], first.body.cursor);
  assert.equal(again.body.cursor, first.body.cursor);
  assert.deepEqual(again.body.entries, []);
});

test("last write wins: newer replaces, older and equal are ignored", async () => {
  const e = E({ value: 1, updated_at: "2026-11-20T12:00:00Z" });
  const r0 = await sync(srv, [e], 0);
  const newer = await sync(srv, [{ ...e, value: 2, updated_at: "2026-11-20T12:05:00Z" }], r0.body.cursor);
  assert.equal(find(newer.body, e.client_id).value, 2);
  const equal = await sync(srv, [{ ...e, value: 3, updated_at: "2026-11-20T12:05:00Z" }], newer.body.cursor);
  assert.deepEqual(equal.body.entries, [], "a retry (same time) sends nothing back");
  const older = await sync(srv, [{ ...e, value: 4, updated_at: "2026-11-20T12:01:00Z" }], newer.body.cursor);
  const back = find(older.body, e.client_id);
  assert.ok(back, "an older edit gets the winner back (D52): nothing came back");
  assert.equal(back.value, 2, "an older edit gets the winner back (D52)");
});

test("a soft delete shows in pulls and is hidden from GET /api/entries", async () => {
  const e = E({ module: "deltest" });
  const r0 = await sync(srv, [e], 0);
  const r1 = await sync(srv, [{ ...e, deleted_at: "2026-11-20T13:00:00Z", updated_at: "2026-11-20T13:00:00Z" }], r0.body.cursor);
  assert.ok(find(r1.body, e.client_id).deleted_at);
  const list = await (await fetch(`${srv.url}/api/entries?module=deltest`)).json();
  assert.equal(list.length, 0);
});

test("a cursor ahead of the server's resends everything", async () => {
  const e = E();
  await sync(srv, [e], 0);
  const r = await sync(srv, [], 10 ** 9);
  assert.ok(find(r.body, e.client_id));
});

test("a UNIQUE(source, external_id) clash is rejected alone", async () => {
  const a = E({ source: "import", external_id: "x1" }), b = E({ source: "import", external_id: "x1" }), c = E();
  const r = await sync(srv, [a, b, c], 0);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rejected, [b.client_id]);
  assert.ok(find(r.body, a.client_id) && find(r.body, c.client_id));
});

test("one bad entry is rejected alone, the rest are saved (D52)", async () => {
  const good = E(), bad = E({ recorded_at: "+020261-11-21T17:00:00.000Z" }), short = E({ client_id: "short" });
  const r = await sync(srv, [good, bad, short, { junk: true }], 0);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rejected.sort(), [bad.client_id, "short", ""].sort());
  assert.ok(find(r.body, good.client_id));
});

test("timestamps are stored in UTC", async () => {
  const e = E({ recorded_at: "2026-11-20T12:00:00+02:00", updated_at: "2026-11-20T14:00:00+02:00" });
  const r = await sync(srv, [e], 0);
  const got = find(r.body, e.client_id);
  assert.equal(new Date(got.recorded_at).toISOString(), "2026-11-20T10:00:00.000Z");
  assert.ok(/Z$|\+00:00$/.test(got.recorded_at), got.recorded_at);
});

test("bad requests get a 422", async () => {
  assert.equal((await sync(srv, [], -1)).status, 422);
  assert.equal((await sync(srv, Array.from({ length: 2001 }, () => E()), 0)).status, 422);
});

test("two clients interleaving pushes end up with the same data", async () => {
  const shared = E({ module: "two" });
  const a0 = await sync(srv, [shared], 0);
  const b0 = await sync(srv, [], 0);
  const a1 = await sync(srv, [{ ...shared, value: 10, updated_at: "2026-11-20T15:00:00Z" }], a0.body.cursor);
  const b1 = await sync(srv, [{ ...shared, value: 20, updated_at: "2026-11-20T14:00:00Z" }], b0.body.cursor);
  assert.equal(find(b1.body, shared.client_id).value, 10, "B's older edit loses and B gets A's");
  const a2 = await sync(srv, [], a1.body.cursor);
  assert.ok(!a2.body.entries.some((e) => e.client_id === shared.client_id && e.value !== 10));
});

test("20 concurrent pushes get unique, gap-free revs", async () => {
  const start = (await sync(srv, [], 0)).body.cursor;
  await Promise.all(Array.from({ length: 20 }, () => sync(srv, [E({ module: "conc" })], 0)));
  const after = await sync(srv, [], start);
  const conc = after.body.entries.filter((e) => e.module === "conc");
  assert.equal(conc.length, 20);
  assert.equal(after.body.cursor - start, 20, "revs have no gaps");
});

// DESIGN D58: refusals carry a reason, and blank times are refused instead of being saved
// as NULL (which used to make every later pull fail with a 500).
test("blank times are refused with a reason, and pulls keep working", async () => {
  const blankUpd = E({ updated_at: "" }), blankRec = E({ recorded_at: "" }), blankDel = E({ deleted_at: "" });
  const badDate = E({ recorded_at: "not-a-date" }), good = E();
  const r = await sync(srv, [blankUpd, blankRec, blankDel, badDate, good], 0);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rejected.sort(), [blankUpd, blankRec, blankDel, badDate].map((e) => e.client_id).sort());
  assert.match(r.body.rejected_reasons[blankUpd.client_id], /updated_at: empty time/);
  assert.match(r.body.rejected_reasons[badDate.client_id], /recorded_at: bad date/);
  assert.ok(find(r.body, good.client_id), "the good one is saved");
  const full = await sync(srv, [], 0);
  assert.equal(full.status, 200, "a full pull still works");
  assert.ok(!find(full.body, blankUpd.client_id), "nothing blank was saved");
});

test("a duplicate import is refused with its reason", async () => {
  const first = E({ source: "reason_import", external_id: "row-1" });
  await sync(srv, [first], 0);
  const again = E({ source: "reason_import", external_id: "row-1" });
  const r = await sync(srv, [again], 0);
  assert.deepEqual(r.body.rejected, [again.client_id]);
  assert.match(r.body.rejected_reasons[again.client_id], /duplicate import/);
});

test("the server and the device's own check agree on every case (D58)", async () => {
  const { base, CASES } = await import("../lib/entry-cases.mjs");
  const { checkEntry } = await import("../../static/core/check.js");
  for (const [name, over, ok] of CASES) {
    const e = { ...base(), client_id: id("case"), ...over };
    const r = await sync(srv, [e], 0);
    assert.equal(r.status, 200, name);
    const refused = r.body.rejected.includes(e.client_id);
    assert.equal(!refused, ok, `server, ${name}: ${r.body.rejected_reasons[e.client_id] ?? "accepted"}`);
    assert.equal(checkEntry(e) === null, ok, `device, ${name}`);
  }
});
