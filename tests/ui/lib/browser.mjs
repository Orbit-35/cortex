// Launch a headless Edge (or Chrome) for UI tests, and open pages in it.
// Each newDevice() is a separate browser context: its own IndexedDB, localStorage and service
// worker, so two "devices" can sync against one server inside one browser.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CDP } from "./cdp.mjs";
import { Page } from "./page.mjs";

const CANDIDATES = [
  process.env.CORTEX_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ headless = true } = {}) {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error("no Edge or Chrome found; set CORTEX_BROWSER to the browser's .exe");
  const dir = mkdtempSync(join(tmpdir(), "cortex-test-browser-"));
  const proc = spawn(exe, [
    ...(headless ? ["--headless=new"] : []),
    "--remote-debugging-port=0", `--user-data-dir=${dir}`,
    "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--mute-audio",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
    "--disable-features=Translate,EdgeSidebar,msEdgeShopping", "about:blank",
  ], { stdio: "ignore" });

  let ws;
  for (let i = 0; i < 100 && !ws; i++) {
    try {
      const [port, path] = readFileSync(join(dir, "DevToolsActivePort"), "utf8").split("\n");
      if (port && path) ws = `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    } catch {}
    if (!ws) await sleep(100);
  }
  if (!ws) { proc.kill(); throw new Error("the browser didn't start"); }
  const cdp = await CDP.connect(ws);

  // Service workers get their own sessions, so "offline" can cover them too.
  const workers = new Map(); // sessionId -> browserContextId
  cdp.on("Target.attachedToTarget", (p) => {
    if (p.targetInfo.type === "service_worker") workers.set(p.sessionId, p.targetInfo.browserContextId);
  });
  cdp.on("Target.detachedFromTarget", (p) => workers.delete(p.sessionId));
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
    filter: [{ type: "service_worker", exclude: false }, { exclude: true }],
  });

  const pages = [];
  const browser = {
    cdp, workers,
    // A new "device": a fresh browser context with one page.
    async newDevice(opts = {}) {
      const { browserContextId } = await cdp.send("Target.createBrowserContext", { disposeOnDetach: true });
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const page = new Page(browser, { sessionId, targetId, browserContextId, ...opts });
      await page.init();
      pages.push(page);
      return page;
    },
    async close() {
      try { await cdp.send("Browser.close"); } catch {}
      cdp.close();
      for (let i = 0; i < 30 && proc.exitCode === null; i++) await sleep(100);
      if (proc.exitCode === null) {
        try { proc.kill(); } catch {}
        if (process.platform === "win32") try { execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
      }
      for (let i = 0; i < 20; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await sleep(250); } }
    },
  };
  process.on("exit", () => { try { proc.kill(); } catch {} });
  return browser;
}
