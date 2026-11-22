// Fast source scans that catch mistakes the other tests can't see (DESIGN D55).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const STATIC = fileURLToPath(new URL("../static", import.meta.url));
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(STATIC);
const web = (p) => "/" + relative(STATIC, p).split("\\").join("/"); // file path -> URL path
const src = (p) => readFileSync(p, "utf8");
const code = files.filter((p) => /\.(js|html)$/.test(p));

// 1. Pages talk to the server only through core/cortex.js (CLAUDE.md, D13).
//    /api/version in lifting/app.js is allowed until the Android work routes it through apiBase.
const ALLOWED = new Set(["/lifting/app.js:/api/version"]);
const stray = [];
for (const p of code) {
  if (web(p) === "/core/cortex.js") continue;
  for (const m of src(p).matchAll(/fetch\(\s*[`"']([^`"']*\/api[^`"']*)/g)) {
    if (!ALLOWED.has(`${web(p)}:${m[1]}`)) stray.push(`${web(p)} fetches ${m[1]}`);
  }
}
assert.deepEqual(stray, [], "pages must go through core/cortex.js");

// 2. Everything a page loads is in the service worker's SHELL, or offline use breaks silently.
const sw = src(join(STATIC, "sw.js"));
const shell = new Set(JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]")));
const needed = new Map(); // url -> who needs it
const need = (url, from) => { if (!needed.has(url)) needed.set(url, from); };
for (const p of code) {
  const s = src(p), here = posix.dirname(web(p));
  const resolveUrl = (u) => (u.startsWith("/") ? u : posix.normalize(posix.join(here, u)));
  if (p.endsWith(".html")) {
    need(posix.dirname(web(p)) === "/" ? "/" : `${posix.dirname(web(p))}/`, "page");
    for (const m of s.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)) if (!/^https?:/.test(m[1])) need(resolveUrl(m[1]), web(p));
  }
  for (const m of s.matchAll(/(?:^|[\s;])import\s[^"'`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm)) {
    const u = m[1] || m[2] || m[3];
    if (u && !/^https?:|^node:/.test(u)) need(resolveUrl(u), web(p));
  }
}
const missing = [...needed].filter(([u]) => !shell.has(u)).map(([u, from]) => `${u} (needed by ${from})`);
assert.deepEqual(missing, [], "add these to SHELL in static/sw.js");
const gone = [...shell].filter((u) => !u.endsWith("/") && !files.some((p) => web(p) === u));
assert.deepEqual(gone, [], "SHELL lists files that don't exist");

// 3. core/cortex.js stays free of page code, so the Android and Windows shells reuse it unchanged (D13).
const core = src(join(STATIC, "core", "cortex.js")).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const dom = core.match(/innerHTML|querySelector|getElementById|createElement|\.classList|\.style\./g);
assert.equal(dom, null, `DOM code in core/cortex.js: ${dom}`);

console.log("static guards passed");
