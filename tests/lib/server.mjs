// A throwaway Cortex server for tests (DESIGN D55). Every server gets its own temp folder
// with a fresh test.db and backups/, a random free port on 127.0.0.1, and is killed for sure.
// It refuses port 8000 and the real cortex.db, so a test can never touch the owner's data.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, realpathSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REAL_DB = join(ROOT, "cortex.db");
const PYTHON = process.platform === "win32" ? join(ROOT, ".venv", "Scripts", "python.exe") : join(ROOT, ".venv", "bin", "python");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
    s.on("error", rej);
  });
}

const same = (a, b) => {
  try { return realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase(); } catch { return resolve(a).toLowerCase() === resolve(b).toLowerCase(); }
};

// Start a server. Options: { dir } reuses a folder (same database, e.g. a restart).
// Returns { url, port, dir, db, stop(), restart() }.
export async function startServer({ dir, port } = {}) {
  dir ||= mkdtempSync(join(tmpdir(), "cortex-test-"));
  const db = join(dir, "test.db");
  if (same(db, REAL_DB) || (existsSync(REAL_DB) && same(dir, ROOT))) throw new Error("refusing to run a test server on the real cortex.db");
  port ||= await freePort();
  if (port === 8000) throw new Error("refusing port 8000: that's the real server");
  if (!existsSync(PYTHON)) throw new Error(`no Python venv at ${PYTHON}`);

  const proc = spawn(PYTHON, ["-X", "cortex-test-server", "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(port), "--log-level", "warning"], {
    cwd: ROOT,
    env: { ...process.env, CORTEX_DB: db, CORTEX_BACKUPS: join(dir, "backups"), PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`test server exited early:\n${log}`);
    try { if ((await fetch(`${url}/api/version`)).ok) break; } catch {}
    if (Date.now() > deadline) { kill(proc); throw new Error(`test server didn't start:\n${log}`); }
    await sleep(150);
  }

  let stopped = false;
  const server = {
    url, port, dir, db,
    log: () => log,
    // Stop the process but keep the folder (and database).
    async halt() {
      if (stopped) return;
      stopped = true;
      kill(proc);
      for (let i = 0; i < 50 && proc.exitCode === null; i++) await sleep(100);
      for (let i = 0; i < 50; i++) { try { await fetch(`${url}/api/version`); await sleep(100); } catch { break; } }
    },
    // Stop and delete the temp folder.
    async stop() {
      await server.halt();
      for (let i = 0; i < 10; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await sleep(200); } }
    },
    // Same database and port, new process: "the server went down and came back".
    async restart() {
      await server.halt();
      const next = await startServer({ dir, port });
      Object.assign(server, next, { stop: next.stop, halt: next.halt, restart: next.restart, log: next.log });
      stopped = false;
      return server;
    },
  };
  live.add(server);
  return server;
}

function kill(proc) {
  if (proc.exitCode !== null) return;
  try { proc.kill(); } catch {}
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  }
}

// Belt and braces: never leave a server running when the test process ends.
const live = new Set();
process.on("exit", () => { for (const s of live) try { s.halt(); } catch {} });

// POST /api/sync helper for tests.
export async function sync(server, entries = [], since = 0) {
  const res = await fetch(`${server.url}/api/sync`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ since, entries }),
  });
  return { status: res.status, body: await res.json() };
}
