// Quick visual checks from a JSON step file, with its own throwaway server and browser.
//   node tests/ui/run-steps.mjs tests/ui/steps/smoke.json [--device phone|small|desktop]
// Step file: { "url": "/lifting/", "device": "phone", "seed": "two-workouts", "fakeMic": false, "steps": [...] }
// Steps (one key each, plus options):
//   {"wait": "#sel"}  {"click": "#sel"}  {"clickText": "Save"}  {"tap": "#sel"}  {"longPress": "#sel"}
//   {"type": ["#sel", "text"]}  {"key": "Enter"}  {"back": true}  {"goto": "/guitar/"}  {"reload": true}
//   {"offline": true}  {"sleep": 500}  {"shot": "name"}  {"eval": "js expression", "expect": value}
//   {"cortex": ["getStatus"], "expect": {"pending": 0}}  {"mic": {"freq": 110}}  {"audit": "name"}
// "expect" checks that every key given matches. Screenshots go to tests/ui/out/.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { startServer } from "../lib/server.mjs";
import { launch } from "./lib/browser.mjs";
import { SEEDS } from "./lib/seed.mjs";
import { AUDIT } from "./lib/audit.mjs";
import { clearFailures } from "./lib/page.mjs";

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.log("usage: node tests/ui/run-steps.mjs <steps.json> [--device phone|small|desktop]"); process.exit(2); }
const spec = JSON.parse(readFileSync(file, "utf8"));
const di = rest.indexOf("--device");
const device = di >= 0 ? rest[di + 1] : spec.device || "phone";

clearFailures();
const server = await startServer();
const browser = await launch();
let failed = false;
try {
  if (spec.seed) await SEEDS[spec.seed](server);
  const page = await browser.newDevice({ base: server.url, device, fakeMic: !!spec.fakeMic });
  await page.goto(spec.url || "/");
  for (const [i, s] of spec.steps.entries()) {
    const label = `step ${i + 1} ${JSON.stringify(s)}`;
    try {
      let got;
      if (s.wait) await page.waitFor(s.wait);
      else if (s.click) await page.click(s.click);
      else if (s.clickText) await page.clickText(s.clickText);
      else if (s.tap) await page.tap(s.tap);
      else if (s.longPress) await page.longPress(s.longPress, s.ms);
      else if (s.type) await page.type(s.type[0], s.type[1]);
      else if (s.key) await page.key(s.key);
      else if (s.back) await page.back();
      else if (s.goto) await page.goto(s.goto);
      else if (s.reload) await page.reload();
      else if ("offline" in s) await page.setOffline(s.offline);
      else if (s.sleep) await new Promise((r) => setTimeout(r, s.sleep));
      else if (s.shot) console.log(`  shot ${await page.shot(`${s.shot}-${device}`, { full: !!s.full })}`);
      else if (s.eval) got = await page.eval(s.eval);
      else if (s.cortex) got = await page.cortex(...s.cortex);
      else if (s.mic) await page.eval((o) => window.__fakeMic.set(o), s.mic);
      else if (s.audit) { got = await page.eval(AUDIT); console.log(`  audit ${s.audit}: ${got.length ? got.join("; ") : "clean"}`); }
      else throw new Error(`unknown step: ${Object.keys(s).join(", ")} (see the list at the top of run-steps.mjs)`);
      if ("expect" in s) {
        if (s.expect && typeof s.expect === "object") for (const k of Object.keys(s.expect)) assert.deepEqual(got?.[k], s.expect[k], `${k}`);
        else assert.deepEqual(got, s.expect);
      }
      console.log(`ok    ${label}`);
    } catch (err) {
      failed = true;
      console.log(`FAIL  ${label}\n      ${err.message.split("\n").join("\n      ")}`);
      await page.fail(`step-${i + 1}`);
      break;
    }
  }
  if (page.errors.length) { failed = true; console.log(`console errors:\n  ${page.errors.join("\n  ")}`); }
} finally {
  await browser.close();
  await server.stop();
}
console.log(failed ? "FAILED" : "passed");
process.exit(failed ? 1 : 0);
