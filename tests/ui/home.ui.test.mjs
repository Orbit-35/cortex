// Home launcher: the app tiles open their apps, on a phone and on a desktop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "./lib/harness.mjs";

const app = useApp();

for (const device of ["phone", "desktop"]) {
  test(`home tiles work on ${device}`, async () => {
    const page = await app.device({ device });
    await page.goto("/");
    assert.equal(await page.text("h1"), "Cortex");
    assert.deepEqual(await page.eval(() => [...document.querySelectorAll(".app")].map((a) => a.getAttribute("href"))), ["/lifting/", "/guitar/"]);
    await page.shot(`home-${device}`);
    await page.click('.app[href="/lifting/"]');
    await page.waitFor("#view-log");
    assert.equal(await page.eval(() => location.pathname), "/lifting/");
    await page.click(".cx-apps");
    await page.waitFor(".apps");
    await page.click('.app[href="/guitar/"]');
    await page.waitFor("#tunbtn");
    // The page never scrolls sideways.
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
}
