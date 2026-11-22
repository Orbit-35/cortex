// Runs every test: unit -> api -> ui (DESIGN D55). Stops after unit if those fail.
//   node tests/run.mjs                 everything
//   node tests/run.mjs --only api      one group (unit, api, ui)
//   node tests/run.mjs --grep tuner    only files whose name contains "tuner"
// Each file runs in its own Node process; API and UI tests start their own throwaway servers.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const only = opt("--only"), grep = opt("--grep");

const list = (dir, re) => existsSync(join(ROOT, dir))
  ? readdirSync(join(ROOT, dir)).filter((f) => re.test(f)).sort().map((f) => join(ROOT, dir, f)) : [];
const GROUPS = {
  unit: list("tests", /\.test\.mjs$/),
  api: list("tests/api", /\.test\.mjs$/),
  ui: list("tests/ui", /\.ui\.test\.mjs$/),
};

// Canary: the real database must not change while tests run (unless the real server is up).
const REAL = join(ROOT, "cortex.db");
const stamp = () => (existsSync(REAL) ? `${statSync(REAL).mtimeMs}:${statSync(REAL).size}` : "none");
const before = stamp();

const results = [];
let failed = false;
for (const [group, all] of Object.entries(GROUPS)) {
  if (only && only !== group) continue;
  const files = all.filter((f) => !grep || f.includes(grep));
  if (!files.length) continue;
  console.log(`\n== ${group} (${files.length} file${files.length === 1 ? "" : "s"})`);
  for (const f of files) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [f], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
    const ok = r.status === 0;
    const name = relative(ROOT, f).split("\\").join("/");
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    if (!ok) {
      failed = true;
      const out = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n");
      console.log(out.slice(-40).map((l) => `      ${l}`).join("\n"));
      if (r.error) console.log(`      ${r.error.message}`);
    }
    results.push({ group, name, ok });
  }
  if (group === "unit" && failed) { console.log("\nUnit tests failed: skipping the rest."); break; }
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} files passed${failed ? "" : ". All good."}`);
if (stamp() !== before) {
  let realUp = false;
  try { realUp = (await fetch("http://127.0.0.1:8000/api/version")).ok; } catch {}
  if (!realUp) { console.log("WARNING: the real cortex.db changed during the tests. Check tests/lib/server.mjs."); failed = true; }
}
process.exit(failed ? 1 : 0);
