// The device-side entry check (static/core/check.js, DESIGN D58). The same cases run against
// the server in tests/api/sync.test.mjs.
import assert from "node:assert/strict";
import { checkEntry, isIsoTime } from "../static/core/check.js";
import { base, CASES } from "./lib/entry-cases.mjs";

for (const [name, over, ok] of CASES) {
  const why = checkEntry({ ...base(), ...over });
  assert.equal(why === null, ok, `${name}: ${why ?? "accepted"}`);
}
assert.equal(checkEntry(null), "entry: not an object");
assert.match(checkEntry({ ...base(), recorded_at: "nope" }), /^recorded_at: bad date$/);
assert.ok(isIsoTime(new Date().toISOString()), "what the app itself makes is valid");
console.log("check.js: all tests passed");
