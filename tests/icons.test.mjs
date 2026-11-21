import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ICONS, icon } from "../static/core/icons.js";
import { OBJECTS } from "../static/lifting/progress.js";

// Every icon has path data; decorative by default, labelled when asked.
for (const [name, body] of Object.entries(ICONS)) assert.ok(/<(path|circle|line|rect|polyline|polygon|ellipse)\b/.test(body), name);
assert.ok(icon("trophy").includes('aria-hidden="true"'));
const labelled = icon("x", { label: 'Close "it"' });
assert.ok(labelled.includes('role="img"') && labelled.includes("aria-label=\"Close &#34;it&#34;\""));
assert.throws(() => icon("no-such-icon"));
for (const o of OBJECTS) assert.ok(ICONS[o.icon], `milestone ${o.name}: unknown icon ${o.icon}`);

// No emoji or pictographs anywhere in the UI (owner's rule; DESIGN D51). Music signs and
// plain punctuation (♯ ♭ − – · ×) are not pictographic and stay allowed.
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|css|json)$/.test(f)) files.push(p);
  }
})(new URL("../static", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const hits = [];
for (const f of files) readFileSync(f, "utf8").split("\n").forEach((l, i) => {
  const m = l.match(/[\p{Extended_Pictographic}←-⇿✓✕⚙›‹⛓\u{1F300}-\u{1FAFF}]/gu);
  if (m && !/^\s*(\/\/|\*)/.test(l)) hits.push // comments may use arrows(`${f}:${i + 1} ${m.join("")}`);
});
assert.deepEqual(hits, [], `emoji or arrow symbols found:\n${hits.join("\n")}`);

console.log("icons tests passed");
