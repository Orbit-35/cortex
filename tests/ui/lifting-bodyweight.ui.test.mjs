// Bodyweight exercises (DESIGN D57): no "0 lb" anywhere, gains start at the first weighted
// day, and a "Most reps" chart for sets with no weight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "./lib/harness.mjs";
import { SEEDS } from "./lib/seed.mjs";

const app = useApp({ seed: SEEDS.bodyweight });
const hero = (page) => page.eval(() => document.querySelector("#exbody .hero").innerText.replace(/\s+/g, " ").trim());
const chips = (page) => page.eval(() => [...document.querySelectorAll("#exbody .chip")].map((c) => c.innerText.trim()));

async function openEx(page, key) {
  await page.goto("/lifting/#exercises");
  await page.waitFor(`#view-exercises .rowbtn[data-key="${key}"]`);
  await page.click(`#view-exercises .rowbtn[data-key="${key}"]`);
  await page.waitFor("#exbody .hero");
}

test("a bodyweight-only workout shows its reps, never 0 lb", async () => {
  const page = await app.device();
  await page.goto("/lifting/");
  await page.waitFor(".wcard");
  const cards = await page.eval(() => [...document.querySelectorAll(".wcard")].map((c) => c.innerText.replace(/\s+/g, " ")));
  await page.shot("bodyweight-log");
  assert.equal(cards.length, 3);
  assert.ok(cards.every((c) => !/\b0 (lb|kg)\b/.test(c)), cards.join(" | "));
  assert.match(cards[0], /21 reps/, "newest: 12 + 9 reps");
  assert.match(cards[1], /\b\d+ lb\b/, "the weighted workout still shows volume");
  assert.match(cards[2], /24 reps/, "oldest: 8 + 10 + 6 reps");
});

test("pull-ups: weight numbers ignore no-weight days; Most reps tracks bodyweight sets", async () => {
  const page = await app.device();
  await openEx(page, "pull_up");
  assert.deepEqual(await chips(page), ["Est. 1RM", "Heaviest", "Volume", "Most reps"]);
  // Only one weighted session, so no "+X since" from a 0 lb day.
  for (const label of ["Est. 1RM", "Heaviest", "Volume"]) {
    await page.clickText(label, "#exbody .chip");
    assert.doesNotMatch(await hero(page), /since/, `${label}: no gain from a bodyweight day`);
    assert.doesNotMatch(await hero(page), /—/, `${label}: has a number`);
  }
  await page.clickText("Most reps", "#exbody .chip");
  const h = await hero(page);
  assert.match(h, /most reps in a set 12 reps/i, h);
  assert.match(h, /\+2 reps since/, h);
  assert.match(await page.text("#exbody .list"), /Most reps in a set\s+12/);
  const ys = await page.eval(() => document.querySelectorAll("#exbody .chart svg circle.dot").length);
  assert.equal(ys, 2, "only the two bodyweight days are on the reps chart");
  await page.shot("bodyweight-pullup-reps");
  await page.eval(() => document.querySelector("#exbody .chart svg").dispatchEvent(new PointerEvent("pointerdown", { clientX: 200, bubbles: true })));
  assert.match(await page.text("#exbody .tip"), /reps/, "chart tooltip in reps");
});

test("chin-ups (never weighted): one Most reps view, no empty weight charts", async () => {
  const page = await app.device();
  await openEx(page, "chin_up");
  assert.deepEqual(await chips(page), [], "no chips when there's only one view");
  assert.match(await hero(page), /9 reps.*\+3 reps since/i);
  assert.equal(await page.count("#exbody .chart svg"), 1, "the chart draws");
  await page.shot("bodyweight-chinup");

  await page.goto("/lifting/#progress");
  await page.waitFor("#view-progress h2");
  const top = await page.eval(() => [...document.querySelectorAll("#view-progress .rowbtn")].map((b) => b.innerText.replace(/\s+/g, " ")));
  assert.ok(top.some((t) => /Chin-up.*9 reps most in a set/.test(t)), top.join(" | "));
  assert.ok(top.every((t) => !/\b0 (lb|kg)\b/.test(t)), top.join(" | "));
  await page.shot("bodyweight-progress", { full: true });
});

test("narrow phone: the chosen chart chip is scrolled into view", async () => {
  const page = await app.device({ device: "small" });
  await openEx(page, "pull_up");
  await page.clickText("Most reps", "#exbody .chip");
  const fits = await page.eval(() => {
    const row = document.querySelector("#exbody .chips").getBoundingClientRect();
    const on = document.querySelector("#exbody .chip.on").getBoundingClientRect();
    return on.left >= row.left - 1 && on.right <= row.right + 1;
  });
  assert.ok(fits, "Most reps chip fully visible at 360 px");
  await page.shot("bodyweight-small-chips");
});

test("bodyweight only: Progress shows no 0 lb volume or milestone", async () => {
  const { startServer } = await import("../lib/server.mjs");
  const { seedServer, workout, daysAgo } = await import("./lib/seed.mjs");
  const server = await startServer();
  try {
    await seedServer(server, workout({ at: daysAgo(2), name: "Bars", sets: [["pull_up", null, 10], ["chin_up", null, 8]] }));
    const page = await app.browser.newDevice({ base: server.url });
    app.open.push(page);
    await page.goto("/lifting/#progress");
    await page.waitFor("#view-progress .tiles");
    const text = await page.text("#view-progress");
    assert.doesNotMatch(text, /\b0 (lb|kg)\b/, text.slice(0, 300));
    assert.equal(await page.count("#view-progress .milestone"), 0, "no milestone card without weight");
    assert.match(text, /18 reps/);
    await page.shot("bodyweight-only-progress");
  } finally { await server.stop(); }
});
