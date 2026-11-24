// A workout in progress must never be lost (DESIGN D25, D56): it is saved on the phone on
// every change, survives the app being closed or reloaded, and reopens by itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "./lib/harness.mjs";

const app = useApp();
const W = (s) => `#editor [data-s="${s}"] input[data-f="weight"]`;
const R = (s) => `#editor [data-s="${s}"] input[data-f="reps"]`;
const val = (page, sel) => page.eval((sel) => document.querySelector(sel)?.value ?? null, sel);
const editorOpen = (page) => page.eval(() => !document.getElementById("editor").hidden);

async function startWithTwoSets(page) {
  await page.goto("/lifting/");
  await page.waitFor('[data-act="start"]');
  await page.click('[data-act="start"]');
  await page.waitFor("#editor");
  await page.click('[data-act="addex"]');
  await page.waitFor("#picker .pkitem");
  await page.click('.pkitem[data-key="bench_press"]');
  await page.click('[data-act="pkadd"]');
  await page.waitFor(W(0));
  await page.type(W(0), "100");
  await page.type(R(0), "5");
  await page.click('#editor [data-act="addset"]');
  await page.waitFor(W(1));
  await page.type(W(1), "105");
  await page.type(R(1), "3");
}

test("closing the app mid-workout loses nothing, and the workout reopens by itself", async () => {
  let page = await app.device();
  await startWithTwoSets(page);

  // Swipe the app away and open it again: no tap on Resume needed.
  page = await app.reopen(page);
  await page.goto("/lifting/");
  await page.waitFor(W(1));
  assert.ok(await editorOpen(page), "the workout opened by itself");
  assert.deepEqual([await val(page, W(0)), await val(page, R(0)), await val(page, W(1)), await val(page, R(1))], ["100", "5", "105", "3"], "both sets kept");
  await page.shot("live-reopened");

  // A reload (what an app update does) reopens it too, with a later change kept.
  await page.type(R(1), "4");
  const steps = await page.eval(() => history.length);
  await page.reload();
  await page.waitFor(W(1));
  assert.equal(await page.eval(() => history.length), steps, "a reload doesn't add a dead Back step");
  assert.equal(await val(page, R(1)), "4", "the last change before the reload was kept");

  // Back closes the editor; the workout is still in progress on the Log tab.
  await page.back();
  await page.waitFor('[data-act="resume"]');

  // Opening on another tab still reopens the workout, and Back lands on that tab.
  page = await app.reopen(page);
  await page.goto("/lifting/#progress");
  await page.waitFor(W(0));
  await page.back();
  await page.waitFor(() => document.getElementById("editor").hidden && !document.getElementById("view-progress").hidden);

  // Finish saves both sets and clears the draft, so the next launch opens normally.
  await page.goto("/lifting/#log");
  await page.waitFor('[data-act="resume"]');
  await page.click('[data-act="resume"]');
  await page.waitFor(W(1));
  for (const s of [0, 1]) await page.click(`#editor [data-s="${s}"] [data-act="tick"]`);
  await page.click('#editor [data-act="save"]');
  await page.waitFor(".cx-ask-box");
  await page.click(".cx-yes");
  await page.waitFor(() => document.getElementById("editor").hidden);
  const sets = (await page.cortex("listEntries", { module: "lifting", limit: 100 })).filter((e) => e.metric === "bench_press");
  assert.deepEqual(sets.map((e) => [e.value, e.data.reps]).sort(), [[100, 5], [105, 4]], "both sets saved with their final values");
  assert.equal(await page.eval(() => localStorage.getItem("cortex.lifting.live")), null, "draft cleared after Finish");

  page = await app.reopen(page);
  await page.goto("/lifting/");
  await page.waitFor(".wcard");
  assert.equal(await editorOpen(page), false, "nothing reopens after Finish");
  assert.equal(await page.count('[data-act="resume"]'), 0);
});

test("if the phone can't save the workout, it says so once instead of failing silently", async () => {
  const page = await app.device();
  await startWithTwoSets(page);
  await page.eval(() => { Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); }; });
  await page.type(R(0), "6");
  await page.waitFor(() => [...document.querySelectorAll(".cx-toast")].some((t) => /Couldn't save this workout/.test(t.innerText)));
  await page.shot("live-save-failed");
  await page.type(R(0), "7");
  await new Promise((r) => setTimeout(r, 300));
  const toasts = await page.eval(() => [...document.querySelectorAll(".cx-toast")].filter((t) => /Couldn't save/.test(t.innerText)).length);
  assert.ok(toasts <= 1, `warned once, not on every keystroke (${toasts})`);
});

test("a screen tapped open during startup isn't covered by the reopening workout", async () => {
  let page = await app.device();
  await page.goto("/lifting/");
  await page.waitFor('[data-act="start"]');
  await page.click('[data-act="start"]');
  await page.waitFor("#editor");
  page = await app.reopen(page);
  // Tap the settings gear the instant it appears, before the first load finishes.
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const t = setInterval(() => { const g = document.getElementById("gear");
      if (g && !g.hidden && g.innerHTML) { clearInterval(t); g.click(); } }, 0); })();` });
  await page.goto("/lifting/#profile");
  await page.waitFor("#settings .wrap");
  await new Promise((r) => setTimeout(r, 800)); // past the first load
  const shown = () => page.eval(() => ({ editor: !document.getElementById("editor").hidden, settings: !document.getElementById("settings").hidden }));
  assert.deepEqual(await shown(), { editor: false, settings: true }, "settings stays on top, the workout waits");
  await page.back();
  assert.deepEqual(await shown(), { editor: false, settings: false }, "one Back closes settings");
});
