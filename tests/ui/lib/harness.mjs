// Shared setup for UI tests: one throwaway server and one headless browser per test file.
//   const app = useApp();                      // inside a test file, at the top
//   test("...", async () => { const phone = await app.device(); await phone.goto("/lifting/"); ... });
// Every page opened through app.device() is checked for console errors when its test ends.
import { before, after, afterEach } from "node:test";
import { startServer } from "../../lib/server.mjs";
import { launch } from "./browser.mjs";

export function useApp({ seed } = {}) {
  const app = { server: null, browser: null, open: [] };
  before(async () => {
    app.server = await startServer();
    if (seed) await seed(app.server);
    app.browser = await launch({ headless: process.env.CORTEX_HEADFUL !== "1" });
  });
  after(async () => {
    await app.browser?.close();
    await app.server?.stop();
  });
  afterEach(async (t) => {
    const pages = app.open.splice(0);
    const errors = pages.flatMap((p) => p.errors);
    if (errors.length && t) throw new Error(`console errors:\n  ${errors.join("\n  ")}`);
  });
  // A new device (own storage and service worker), pointed at the test server.
  app.device = async (opts = {}) => {
    const page = await app.browser.newDevice({ base: app.server.url, ...opts });
    app.open.push(page);
    return page;
  };
  // The same device after the app was closed and opened again (see browser.reopen).
  app.reopen = async (page) => {
    const next = await app.browser.reopen(page);
    app.open.push(next);
    return next;
  };
  return app;
}
