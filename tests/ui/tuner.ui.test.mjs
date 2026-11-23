// Guitar tuner with a fake microphone (tests/ui/lib/fakes/fake-mic.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "./lib/harness.mjs";

const app = useApp();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "A<sub>2</sub>" -> "A2" (innerText puts the octave on its own line).
const note = (page) => page.eval(() => document.getElementById("note").textContent);

async function tuner({ freq = 110, deny = false } = {}) {
  const page = await app.device({ fakeMic: true });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__fakeMic.set(${JSON.stringify({ freq, deny })})` });
  await page.goto("/guitar/");
  await page.waitFor("#tunbtn");
  return page;
}

test("110 Hz on Standard reads A2, in tune; 113 Hz reads sharp; 82.4 Hz reads E2", async () => {
  const page = await tuner({ freq: 110 });
  await page.waitFor(() => document.getElementById("stage").className.includes("state-in"), { timeout: 10000 });
  assert.equal(await note(page), "A2", "note and octave");
  assert.match(await page.text("#status"), /In tune/);
  await page.shot("tuner-in-tune");

  await page.eval(() => window.__fakeMic.set({ freq: 113 }));
  await page.waitFor(() => /Tune down/.test(document.getElementById("status").innerText), { timeout: 10000 });
  assert.equal(await note(page), "A2", "still A2 when sharp");
  assert.match(await page.text("#readout"), /\+\d+ cents/);

  await page.eval(() => window.__fakeMic.set({ freq: 82.41 }));
  await page.waitFor(() => document.getElementById("note").textContent === "E2", { timeout: 10000 });
  await page.waitFor(() => document.getElementById("stage").className.includes("state-in"), { timeout: 10000 });
});

test("a blocked microphone shows the help message", async () => {
  const page = await tuner({ deny: true });
  await page.waitFor("#micmsg", { timeout: 10000 });
  assert.match(await page.text("#micmsg"), /blocked/i);
  await page.shot("tuner-blocked");
});

test("a custom tuning is saved as a _tuning entry", async () => {
  const page = await tuner({ freq: 0 });
  await page.click("#tunbtn");
  await page.waitFor("#picker");
  await page.click("[data-new]");
  await page.waitFor("#tname");
  assert.equal(await page.eval(() => getComputedStyle(document.getElementById("picker")).visibility), "hidden", "only the editor shows");
  await page.type("#tname", "Test Drop C");
  await page.click('#editorpanel [data-s="0"][data-d="-1"]');
  await page.click('#editorpanel [data-act="save"]');
  await sleep(200);
  if (await page.visible(".cx-ask-box")) await page.click(".cx-yes");
  await page.waitFor(async () => (await (await import("/core/cortex.js")).listEntries({ module: "guitar", limit: 50 })).some((e) => e.metric === "_tuning"));
  const saved = (await page.cortex("listEntries", { module: "guitar", limit: 50 })).find((e) => e.metric === "_tuning");
  assert.equal(saved.data.name, "Test Drop C");
  assert.equal(saved.deleted_at, null);
});
