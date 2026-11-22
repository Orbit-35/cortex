// Every main screen at both phone widths: buttons at least 44 px tall, nothing wider than the
// screen, and a screenshot of each for a person (or a test agent) to look at.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "./lib/harness.mjs";
import { SEEDS } from "./lib/seed.mjs";
import { AUDIT } from "./lib/audit.mjs";

const app = useApp({ seed: SEEDS.history });

const SCREENS = [
  ["home", "/", ".apps"],
  ["log", "/lifting/#log", ".wcard"],
  ["progress", "/lifting/#progress", "#view-progress h2"],
  ["exercises", "/lifting/#exercises", "#exsearch"],
  ["body", "/lifting/#body", "#view-body"],
  ["profile", "/lifting/#profile", "#gear"],
  ["tuner", "/guitar/", "#tunbtn"],
];

for (const device of ["phone", "small"]) {
  test(`main screens pass the layout check on ${device}`, async () => {
    const page = await app.device({ device, fakeMic: true });
    const problems = [];
    for (const [name, url, ready] of SCREENS) {
      await page.goto(url);
      await page.waitFor(ready);
      await page.shot(`layout-${device}-${name}`);
      for (const p of await page.eval(AUDIT)) problems.push(`${name}: ${p}`);
    }
    // Two sheets: an exercise's detail and the workout editor.
    await page.goto("/lifting/#log");
    await page.waitFor(".wcard");
    await page.click(".wcard");
    await page.waitFor("#editor input");
    await page.shot(`layout-${device}-editor`);
    for (const p of await page.eval(AUDIT)) problems.push(`editor: ${p}`);
    assert.deepEqual(problems, []);
  });
}
