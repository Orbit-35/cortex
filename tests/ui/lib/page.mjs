// One browser page ("device") with the helpers UI tests use. Every helper works from outside
// the app: no test hooks in app code. page.cortex() imports /core/cortex.js inside the page, so it
// gets the same module instance the app uses and can read local storage or trigger a sync.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const OUT = fileURLToPath(new URL("../out", import.meta.url));
const FAKE_MIC = readFileSync(fileURLToPath(new URL("./fakes/fake-mic.js", import.meta.url)), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const DEVICES = {
  phone: { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, touch: true,
    ua: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" },
  small: { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, touch: true,
    ua: "Mozilla/5.0 (Linux; Android 13; SM-A136B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" },
  desktop: { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false, touch: false },
};

// Console noise that is expected while a test has the network off or the server down.
const NETWORK_NOISE = /ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|Failed to fetch|net::ERR_|Failed to load resource/;

export class Page {
  constructor(browser, { sessionId, targetId, browserContextId, device = "phone", base = "", fakeMic = false, keepServiceWorker = true }) {
    Object.assign(this, { browser, cdp: browser.cdp, sessionId, targetId, browserContextId, base, fakeMic, keepServiceWorker });
    this.device = DEVICES[device] || device;
    this.errors = [];
    this.offline = false;
  }

  send(method, params) { return this.cdp.send(method, params, this.sessionId); }

  async init() {
    const s = this.sessionId, d = this.device;
    await Promise.all(["Page.enable", "Runtime.enable", "Network.enable", "Log.enable"].map((m) => this.send(m)));
    this.cdp.on("Runtime.exceptionThrown", (p) => this.errors.push(`exception: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`), s);
    this.cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p.type !== "error") return;
      const text = p.args.map((a) => a.value ?? a.description).join(" ");
      if (!(this.offline && NETWORK_NOISE.test(text))) this.errors.push(`console.error: ${text}`);
    }, s);
    this.cdp.on("Log.entryAdded", ({ entry }) => {
      if (entry.level !== "error") return;
      const text = `${entry.text} ${entry.url || ""}`;
      if (!(this.offline && NETWORK_NOISE.test(text))) this.errors.push(`log: ${text}`);
    }, s);
    await this.send("Emulation.setDeviceMetricsOverride", { width: d.width, height: d.height, deviceScaleFactor: d.deviceScaleFactor, mobile: d.mobile });
    if (d.touch) await this.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    if (d.ua) await this.send("Emulation.setUserAgentOverride", { userAgent: d.ua, platform: "Android" });
    if (this.fakeMic) await this.send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_MIC });
  }

  // ---------- Navigation and checks ----------

  async goto(path, { wait = "load" } = {}) {
    let off;
    const loaded = new Promise((res) => { off = this.cdp.on("Page.loadEventFired", res, this.sessionId); });
    const r = await this.send("Page.navigate", { url: path.startsWith("http") ? path : this.base + path });
    if (r.errorText) { off(); throw new Error(`can't open ${path}: ${r.errorText}`); }
    // A jump within the same page (only the #hash changed) has no loaderId and no load event.
    if (wait === "load" && r.loaderId) {
      let timer;
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out loading ${path}`)), 20000); });
      try { await Promise.race([loaded, timeout]); } finally { clearTimeout(timer); off(); }
    }
    off();
    await sleep(150);
  }

  async reload() {
    const loaded = this.cdp.once("Page.loadEventFired", this.sessionId, 20000);
    await this.send("Page.reload", {});
    await loaded;
    await sleep(150);
  }

  // Run a function (or expression string) in the page and return its JSON result.
  async eval(fn, ...args) {
    const expression = typeof fn === "function" ? `(${fn})(...${JSON.stringify(args)})` : fn;
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`in page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  // Wait until a selector is visible, or a function returns something truthy.
  async waitFor(what, { timeout = 8000, visible = true } = {}) {
    const t0 = Date.now();
    for (;;) {
      const v = typeof what === "function" ? await this.eval(what) : await this.visible(what, visible);
      if (v) return v;
      if (Date.now() - t0 > timeout) {
        await this.fail(`wait-${String(what).slice(0, 30)}`);
        throw new Error(`timed out waiting for ${typeof what === "function" ? what.toString().slice(0, 80) : what}`);
      }
      await sleep(80);
    }
  }

  visible(sel, mustBeVisible = true) {
    return this.eval((sel, must) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      if (!must) return true;
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && !el.closest("[hidden]");
    }, sel, mustBeVisible);
  }

  text(sel) { return this.eval((sel) => document.querySelector(sel)?.innerText ?? null, sel); }
  count(sel) { return this.eval((sel) => document.querySelectorAll(sel).length, sel); }

  // ---------- Input ----------

  async click(sel) {
    const ok = await this.eval((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    }, sel);
    if (!ok) { await this.fail(`click-${sel}`); throw new Error(`nothing to click: ${sel}`); }
    await sleep(60);
  }

  // Click the first visible element (default: button) whose text includes `text`.
  async clickText(text, sel = "button, a, [role=button]") {
    const ok = await this.eval((text, sel) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.innerText?.includes(text) && e.getBoundingClientRect().height > 0 && !e.closest("[hidden]"));
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    }, text, sel);
    if (!ok) { await this.fail(`clickText-${text}`); throw new Error(`no ${sel} with text "${text}"`); }
    await sleep(60);
  }

  async center(sel) {
    const box = await this.eval((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, sel);
    if (!box) { await this.fail(`find-${sel}`); throw new Error(`not found: ${sel}`); }
    return box;
  }

  async tap(sel) {
    const p = await this.center(sel);
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(80);
  }

  async longPress(sel, ms = 700) {
    const p = await this.center(sel);
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await sleep(ms);
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(80);
  }

  async drag(sel, { dx = 0, dy = 0, steps = 10, hold = 0 } = {}) {
    const p = await this.center(sel);
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    if (hold) await sleep(hold);
    for (let i = 1; i <= steps; i++) {
      await this.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x + dx * i / steps, y: p.y + dy * i / steps }] });
      await sleep(16);
    }
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(80);
  }

  // Focus a field, optionally clear it, and type like a keyboard would (fires input events).
  async type(sel, text, { clear = true } = {}) {
    await this.eval((sel, clear) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no field ${sel}`);
      el.scrollIntoView({ block: "center" });
      el.focus();
      if (clear) el.select?.();
    }, sel, clear);
    await this.send("Input.insertText", { text });
    await sleep(60);
  }

  async key(key) {
    const code = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8 }[key] || 0;
    for (const type of ["keyDown", "keyUp"]) await this.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code });
    await sleep(60);
  }

  // The phone's back gesture.
  async back() { await this.eval(() => history.back()); await sleep(250); }

  // ---------- Network ----------

  // Offline for this page and its service worker (navigator.onLine turns false too).
  async setOffline(offline) {
    this.offline = offline;
    const cond = { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    await this.send("Network.emulateNetworkConditions", cond);
    for (const [sid, ctx] of this.browser.workers) {
      if (ctx !== this.browserContextId) continue;
      try { await this.cdp.send("Network.enable", {}, sid); await this.cdp.send("Network.emulateNetworkConditions", cond, sid); } catch {}
    }
  }

  // Wait for the service worker to install and control this page.
  waitForServiceWorker(timeout = 15000) {
    return this.waitFor(() => navigator.serviceWorker?.controller ? navigator.serviceWorker.ready.then(() => true) : false, { timeout });
  }

  // ---------- Local storage and sync ----------

  // Call an export of /core/cortex.js inside the page: page.cortex("listEntries", {module: "lifting"}).
  cortex(fn, ...args) {
    return this.eval(async (fn, args) => {
      const m = await import("/core/cortex.js");
      const r = await m[fn](...args);
      return r === undefined ? null : r;
    }, fn, args);
  }

  // Sync now and return { pending, online } once it settles.
  async syncIdle() {
    await this.cortex("sync");
    for (let i = 0; i < 50; i++) {
      const s = await this.cortex("getStatus");
      if (!s.syncing) return s;
      await sleep(100);
    }
    return this.cortex("getStatus");
  }

  // ---------- Evidence ----------

  async shot(name, { full = false } = {}) {
    mkdirSync(OUT, { recursive: true });
    const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
    const file = join(OUT, `${name.replace(/[^\w.-]+/g, "_")}.png`);
    writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  // A screenshot and the page HTML, saved when something goes wrong.
  async fail(name) {
    try {
      const file = await this.shot(`FAIL-${name}`);
      const html = await this.eval(() => document.body?.outerHTML || "");
      writeFileSync(file.replace(/\.png$/, ".html"), html);
    } catch {}
  }

  // Throws if the page logged errors; call at the end of every test.
  assertNoErrors() {
    if (this.errors.length) throw new Error(`console errors:\n  ${this.errors.join("\n  ")}`);
  }
}
