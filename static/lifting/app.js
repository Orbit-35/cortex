// Lifting app: tabs, workout list, workout editor, exercise picker, progress, settings.
// All data goes through the Cortex core (saved on this device first, synced in the
// background). The maths and data shaping live in the pure modules imported below.
import * as cortex from "/core/cortex.js";
import { ask as uiAsk, cancelAsk, noCallout, toast as uiToast } from "/core/ui.js";
import { lineChart, chartDots } from "/core/chart.js";
import { icon } from "/core/icons.js";
import { e1rm, dayKey, personalRecords, prKind, sessionSeries, seriesGain } from "/lifting/stats.js";
import { convert, showWeight, parseWeight, fmtNum } from "/lifting/units.js";
import { MUSCLES, resolveExercises, exerciseFor, exerciseId, newKey } from "/lifting/library.js";
import {
  EXERCISE, isSet, isWorking, groupWorkouts, legacyPlan, defaultName, previousSets, volumeKg,
  newDraft, blankRow, draftFromWorkout, keptRows, commitPlan, deletePlan, mergePlan,
} from "/lifting/workouts.js";
import { GROUPS, GROUP_LABEL, groupSets, prEvents, totals, milestone, since } from "/lifting/progress.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LIVE_KEY = "cortex.lifting.live";
const RPES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
// What each effort rating means, in reps left in the tank.
const RPE_TEXT = {
  10: "Max effort: no reps left", 9.5: "Maybe 1 more rep", 9: "1 more rep left", 8.5: "Maybe 2 more reps",
  8: "2 more reps left", 7.5: "Maybe 3 more reps", 7: "3 more reps left", 6.5: "Maybe 4 more reps", 6: "4+ reps left: easy",
};
const TABS = { log: "Log", progress: "Progress", exercises: "Exercises", body: "Bodyweight", profile: "Profile" };

// ---------- State ----------
let entries = [];        // every lifting entry on this device
let sets = [];           // just the sets (including warm-ups, for history)
let workSets = [];       // sets that count: no warm-ups (stats, PRs, charts)
let workouts = [];       // grouped, newest first
let lib = new Map();     // exercise key -> definition
let unit = "lb";         // display unit (setting)
let tab = "log";
let historyShown = 40;
let prs = new Map();     // set id -> "e1rm" | "reps" for every set that was a PR
let chartMetric = "e1rm"; // which line the exercise charts show: e1rm | heaviest | volume | mostReps
let editor = null;       // { draft, original, dirty, menu, notes:Set, setMenu, cueEdit }

// ---------- Small helpers ----------
const todayKey = () => dayKey(new Date().toISOString());
const noonOf = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d, 12).toISOString(); };
const exName = (key) => exerciseFor(lib, key).name;
const fmtW = (kg) => fmtNum(Math.round(convert(kg, "kg", unit) * 10) / 10); // kg number -> display string
const fmtDuration = (min) => (min == null ? "" : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);
function fmtDate(iso, opts = { weekday: "short", month: "short", day: "numeric" }) {
  const d = new Date(iso);
  if (d.getFullYear() !== new Date().getFullYear()) opts = { ...opts, year: "numeric" };
  return d.toLocaleDateString([], opts);
}
const fmtDayKey = (key) => fmtDate(noonOf(key), { month: "short", day: "numeric" });
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

// In-app confirm (DESIGN D41), shared by all apps in /core/ui.js. Lifting's calls default to a red "Delete".
const ask = (title, body = "", ok = "Delete", danger = true, no = "Cancel") => uiAsk(title, body, { yes: ok, no, danger });

// Shared toast (core/ui.js); its height above the bottom is set in index.html CSS.
const toast = (text) => uiToast(text);
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

// The live workout draft lives in this device's storage until Finish (DESIGN D25), saved on
// every change, so closing the app or the phone killing it loses nothing (D56).
function loadLive() {
  try { return JSON.parse(localStorage.getItem(LIVE_KEY)); } catch { return null; }
}
let liveSaveWarned = false;
function saveLive(draft) {
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(draft)); liveSaveWarned = false; } catch (err) {
    console.warn(err);
    // Say so once instead of failing silently: the owner should finish or note the workout.
    if (!liveSaveWarned) { liveSaveWarned = true; toast("Couldn't save this workout on the phone. Finish it soon."); }
  }
}
function clearLive() {
  try { localStorage.removeItem(LIVE_KEY); } catch {}
}

// ---------- Tabs ----------

function showTab(name) {
  tab = TABS[name] ? name : "log";
  for (const t of Object.keys(TABS)) $(`view-${t}`).hidden = t !== tab;
  document.querySelectorAll("nav.tabbar button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("title").textContent = TABS[tab];
  $("gear").hidden = tab !== "profile";
  render();
}
addEventListener("hashchange", () => { if (!stack.length) showTab(location.hash.slice(1)); });
document.querySelector("nav.tabbar").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-tab]");
  if (!b) return;
  history.replaceState(history.state, "", `#${b.dataset.tab}`);
  showTab(b.dataset.tab);
  scrollTo(0, 0);
});

noCallout();
$("gear").innerHTML = icon("settings");

let loaded = false; // nothing is drawn until storage has been read once, so empty states never flash
function render() {
  if (!loaded) return;
  if (tab === "log") renderLog();
  else if (tab === "progress") renderProgress();
  else if (tab === "exercises") renderExercises();
  else if (tab === "profile") renderProfile();
}

// ---------- Log tab ----------

function bestSet(list) {
  let best = null;
  for (const s of list) {
    const score = e1rm(convert(s.value, s.unit, "kg") || 0, s.data?.reps) || (s.data?.reps || 0) / 1000;
    if (!best || score > best.score) best = { s, score };
  }
  return best?.s;
}
const setText = (s) => (s.value ? `${showWeight(s.value, s.unit, unit)} × ${s.data?.reps}` : `${s.data?.reps} reps`)
  + (s.data?.rpe != null ? ` @${s.data.rpe}` : "");

function renderLog() {
  const live = loadLive();
  let html = live
    ? `<button class="card live wcard" data-act="resume" style="display:flex">
         <div class="grow"><b>${esc(live.name)}</b><span class="muted small">In progress · <span data-clock="${esc(live.start)}">${fmtClock(Date.now() - new Date(live.start))}</span></span></div>
         <span class="primary sm" style="display:inline-flex;align-items:center">Resume</span>
       </button>`
    : `<button class="primary" data-act="start">Start workout</button>`;
  html += `<div style="margin-top:10px"><button class="secondary" data-act="past">+ Add past workout</button></div>`;

  if (!workouts.length) {
    html += `<p class="empty">No workouts yet. Start one when you're at the gym, or add a past one.</p>`;
  } else {
    let month = "";
    for (const w of workouts.slice(0, historyShown)) {
      const m = fmtDate(w.start, { month: "long", year: "numeric" });
      if (m !== month) { html += `<h2>${esc(m)}</h2>`; month = m; }
      const all = w.exercises.flatMap((x) => x.sets).filter(isWorking);
      const nPr = all.filter((s) => prs.has(s.client_id)).length;
      // Volume counts weighted sets; a bodyweight-only workout shows its reps instead of "0 lb" (D57).
      const vol = Math.round(convert(volumeKg(all), "kg", unit));
      const reps = all.reduce((n, s) => n + (Number(s.data?.reps) || 0), 0);
      const meta = [fmtDuration(w.duration_min), vol ? `${vol.toLocaleString()} ${unit}` : reps ? plural(reps, "rep") : "", plural(all.length, "set")]
        .filter(Boolean).map(esc).concat(nPr ? [`<span class="pr-tag">${icon("trophy")} ${nPr} PR${nPr > 1 ? "s" : ""}</span>`] : []).join(" · ");
      html += `<button class="card wcard" data-act="open" data-id="${esc(w.id)}">
        <div class="head"><span class="name">${esc(w.name)}</span><span class="muted small">${esc(fmtDate(w.start))}</span></div>
        <div class="muted small">${meta}</div>
        <div class="lines">${w.exercises.filter((x) => x.sets.length).map((x) => {
          const work = x.sets.filter(isWorking);
          const b = bestSet(work);
          const count = work.length ? `${work.length} ×` : `${x.sets.length} warm-up${x.sets.length > 1 ? "s" : ""} ·`;
          return `<div class="line"><span>${count} ${esc(exName(x.key))}</span><span>${b ? esc(setText(b)) : ""}</span></div>`;
        }).join("")}</div>
        ${w.notes ? `<div class="notes">${esc(w.notes)}</div>` : ""}
      </button>`;
    }
    if (workouts.length > historyShown) html += `<div style="margin-top:14px"><button class="secondary" data-act="more">Show more</button></div>`;
  }
  $("view-log").innerHTML = html;
}

$("view-log").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "start") startLive();
  else if (act === "resume") openEditor(loadLive(), null);
  else if (act === "past") addPast();
  else if (act === "open") editWorkout(b.dataset.id);
  else if (act === "more") { historyShown += 40; renderLog(); }
});

// ---------- Opening the editor ----------

function startLive() {
  const existing = loadLive();
  if (existing) return openEditor(existing, null);
  const draft = newDraft({ id: cortex.newId(), mode: "live", unit, start: new Date().toISOString(), name: defaultName() });
  saveLive(draft);
  openEditor(draft, null);
}

function addPast() {
  const draft = newDraft({ id: cortex.newId(), mode: "past", unit, start: noonOf(todayKey()), name: "Workout" });
  openEditor(draft, null);
}

function editWorkout(id) {
  const w = workouts.find((x) => x.id === id);
  if (w) openEditor(draftFromWorkout(w, unit), w);
}

// The editor is its own browser-history step, so the phone's back button closes it.
// replace: reuse the current history step (a reload that reopens the live workout).
function openEditor(draft, original, { replace = false } = {}) {
  if (!draft) return;
  editor = { draft, original, dirty: false, menu: null, notes: new Set(), setMenu: null, cueEdit: null };
  history[replace ? "replaceState" : "pushState"]({ ui: "editor" }, "", location.hash);
  $("editor").hidden = false;
  $("editor").scrollTop = 0;
  document.body.style.overflow = "hidden";
  renderEditor();
}

let updateWaiting = false; // a new version arrived mid-edit: load it once the editor closes
function closeEditor() {
  if (updateWaiting) { location.reload(); return; }
  editor = null;
  $("editor").hidden = true;
  $("picker").hidden = true;
  document.body.style.overflow = "";
  render();
}

// Overlay screens stack on top of the tabs and the editor (e.g. workout → exercise →
// edit → picker). Each is one browser-history step, so the phone's back button
// closes exactly the top one.
const OVERLAYS = { picker: "picker", exercise: "exsheet", exedit: "exedit", settings: "settings" };
const stack = [];
function openOverlay(ui) {
  history.pushState({ ui }, "", location.hash);
  stack.push(ui);
  const el = $(OVERLAYS[ui]);
  el.hidden = false;
  el.scrollTop = 0;
  document.body.style.overflow = "hidden";
  return el;
}

addEventListener("popstate", (ev) => {
  const ui = ev.state?.ui;
  cancelAsk(); // back gesture cancels an open question
  while (stack.length && stack.at(-1) !== ui) $(OVERLAYS[stack.pop()]).hidden = true;
  if (!editor && !ui) document.body.style.overflow = "";
  if (editor && !ui) {
    // A live workout is safe in storage; an edit with unsaved changes asks first.
    if (editor.dirty && editor.draft.mode !== "live") {
      history.pushState({ ui: "editor" }, "", location.hash);
      ask("Discard your changes?", "Your edits to this workout won't be saved.", "Discard")
        .then((yes) => { if (yes) { editor.dirty = false; history.back(); } });
      return;
    }
    closeEditor();
  }
});

// ---------- Editor ----------

const SET_TYPES = { warmup: ["W", "Warm-up"], drop: ["D", "Drop set"], failure: ["F", "Failure"] };

function changed() {
  editor.dirty = true;
  if (editor.draft.mode === "live") saveLive(editor.draft);
}

// What a row shows greyed out when empty: the same set from last time, else the row above.
function hintFor(xi, si) {
  const d = editor.draft, ex = d.exercises[xi];
  const prev = previousSets(workouts, ex.key, d.start, d.id)[si];
  if (prev) return { weight: showWeight(prev.value, prev.unit, d.unit), reps: String(prev.data?.reps ?? "") };
  for (let k = si - 1; k >= 0; k--) {
    const r = ex.sets[k];
    if (r.weight || r.reps) return { weight: r.weight, reps: r.reps };
  }
  return { weight: "", reps: "" };
}

// Set labels: warm-ups show "W" (and aren't numbered), drop sets "D", failure "F";
// normal sets are numbered 1, 2, 3… skipping warm-ups.
function setLabels(rows) {
  let n = 0;
  return rows.map((r) => {
    if (r.type === "warmup") return "W";
    n++;
    return r.type ? SET_TYPES[r.type][0] : String(n);
  });
}

// Supersets: consecutive exercises sharing a `group`. Colour cycles per superset.
function supersetInfo(exercises) {
  const info = exercises.map(() => ({ first: false, last: false, color: null }));
  let colorIdx = 0;
  for (let i = 0; i < exercises.length; i++) {
    const g = exercises[i].group;
    if (!g) continue;
    const prevSame = i > 0 && exercises[i - 1].group === g;
    const nextSame = i < exercises.length - 1 && exercises[i + 1].group === g;
    if (!prevSame && !nextSame) continue; // a lone member isn't a superset
    if (!prevSame) colorIdx++;
    info[i] = { first: !prevSame, last: !nextSame, color: `var(--ss-${colorIdx % 3})` };
  }
  return info;
}

function renderEditor() {
  const { draft: d } = editor;
  const live = d.mode === "live";
  const body = $("editor");
  const scroll = body.scrollTop;
  const title = live ? `<span data-clock="${esc(d.start)}">${fmtClock(Date.now() - new Date(d.start))}</span>`
    : d.mode === "past" ? "Add past workout" : "Edit workout";
  const h = d.duration_min != null ? Math.floor(d.duration_min / 60) : "";
  const m = d.duration_min != null ? d.duration_min % 60 : "";
  const ss = supersetInfo(d.exercises);

  let html = `<div class="wrap">
    <div class="sheet-top">
      <button class="back" data-act="close" aria-label="Back">${icon("chevron-left")}</button>
      <div class="title">${title}</div>
      <button class="primary sm" data-act="save">${live ? "Finish" : "Save"}</button>
    </div>
    <div class="sheet-body">
      <input class="ed-name" data-f="name" value="${esc(d.name)}" aria-label="Workout name" autocomplete="off">
      ${live
        ? `<div class="muted small">Started ${esc(new Date(d.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</div>`
        : `<div class="fields" style="margin-top:8px">
             <label>Date<input type="date" data-f="date" max="${todayKey()}" value="${dayKey(d.start)}" required></label>
             <label>Duration<div class="dur">
               <input data-f="dur_h" inputmode="numeric" placeholder="0" value="${h}" aria-label="Hours"><span class="muted">h</span>
               <input data-f="dur_m" inputmode="numeric" placeholder="0" value="${m}" aria-label="Minutes"><span class="muted">min</span>
             </div></label>
           </div>`}
      <textarea data-f="notes" rows="2" placeholder="Workout notes" style="margin-top:10px">${esc(d.notes)}</textarea>`;

  d.exercises.forEach((ex, xi) => {
    const def = exerciseFor(lib, ex.key);
    const prev = previousSets(workouts, ex.key, d.start, d.id);
    const showNotes = ex.notes || editor.notes.has(xi);
    const labels = setLabels(ex.sets);
    const s = ss[xi];
    const menuOpen = editor.menu === xi;
    html += `<section class="ex${s.color ? " ss" : ""}${s.color && !s.last ? " ss-mid" : ""}" data-x="${xi}" ${s.color ? `style="--ss:${s.color}"` : ""}>
      ${s.first ? `<div class="sslabel">Superset</div>` : ""}
      <div class="ex-head">
        <button class="exname" data-act="exinfo">${esc(def.name)}</button>
        <button class="ghost dots${menuOpen ? " on" : ""}" data-act="exmenu" aria-label="Options for ${esc(def.name)}" aria-expanded="${menuOpen}">${icon("ellipsis")}</button>
      </div>
      ${menuOpen ? `<div class="menu-grid">
        <button class="secondary" data-act="exnote">${icon("notebook-pen")} Note for today</button>
        <button class="secondary" data-act="excue">${icon("pin")} ${def.cue ? "Edit" : "Add"} cue</button>
        <button class="secondary" data-act="exup" ${xi === 0 ? "disabled" : ""}>${icon("arrow-up")} Move up</button>
        <button class="secondary" data-act="exdown" ${xi === d.exercises.length - 1 ? "disabled" : ""}>${icon("arrow-down")} Move down</button>
        ${ex.group && s.color ? `<button class="secondary" data-act="exunss">${icon("unlink-2")} Leave superset</button>`
          : `<button class="secondary" data-act="exss" ${xi === d.exercises.length - 1 ? "disabled" : ""}>${icon("link-2")} Superset with next</button>`}
        <button class="secondary danger" data-act="exremove">${icon("x")} Remove</button>
      </div>` : ""}
      ${editor.cueEdit === xi
        ? `<div class="cue-edit"><textarea data-f="cue" rows="2" placeholder="Cues that work for you, shown every time you do ${esc(def.name)}">${esc(def.cue)}</textarea>
            <div class="ex-menu"><button class="secondary" data-act="cuecancel">Cancel</button><button class="primary sm" data-act="cuesave">Save cue</button></div></div>`
        : def.cue ? `<button class="cue" data-act="excue">${icon("pin")} ${esc(def.cue)}</button>` : ""}
      ${showNotes ? `<textarea data-f="exnotes" rows="1" placeholder="Notes for today's ${esc(def.name)}">${esc(ex.notes)}</textarea>` : ""}
      <div class="grid ${live ? "live" : "edit"}">
        <div class="ghead">Set</div><div class="ghead l">Previous</div><div class="ghead">${esc(d.unit)}</div><div class="ghead">Reps</div>${live ? `<div class="ghead">${icon("check", { label: "Done" })}</div>` : ""}
      </div>`;
    ex.sets.forEach((r, si) => {
      // Hints only in a live workout, where ticking an empty row uses them. Elsewhere an
      // empty row isn't saved, so a greyed-out number would look saved when it isn't.
      const hint = live ? hintFor(xi, si) : { weight: "", reps: "" };
      const p = prev[si];
      const label = labels[si];
      html += `<div class="swipe" data-s="${si}">
        <button class="trash" data-act="delset" aria-label="Delete set" tabindex="-1">${icon("trash-2")}</button>
        <div class="grid setrow ${live ? "live" : "edit"}${r.done && live ? " done" : ""}">
          <button class="setno t-${r.type || "normal"}" data-act="setmenu" aria-label="Set ${label} options${r.pr ? ", personal record" : ""}">${r.pr ? icon("trophy") : label}${r.rpe != null ? `<small>@${esc(r.rpe)}</small>` : ""}</button>
          <button class="prev" data-act="useprev" ${p ? "" : "disabled"}>${p ? esc(setText(p)) : "—"}</button>
          <input data-f="weight" inputmode="decimal" enterkeyhint="next" value="${esc(r.weight)}" placeholder="${esc(hint.weight)}" aria-label="Weight">
          <input data-f="reps" inputmode="numeric" enterkeyhint="next" value="${esc(r.reps)}" placeholder="${esc(hint.reps)}" aria-label="Reps">
          ${live ? `<button class="tick" data-act="tick" aria-pressed="${r.done}" aria-label="Set done">${icon("check")}</button>` : ""}
        </div>
      </div>`;
      if (editor.setMenu === `${xi}:${si}`) {
        html += `<div class="setmenu" data-s="${si}">
          <div class="small"><b>Set type</b></div>
          <div class="chips wrapchips">${[[null, "Normal"], ...Object.entries(SET_TYPES).map(([k, v]) => [k, v[1]])].map(([k, label]) =>
            `<button class="chip${(r.type || null) === k ? " on" : ""}" data-act="settype" data-v="${k || ""}">${label}</button>`).join("")}</div>
          <div class="small" style="margin-top:8px"><b>Effort (RPE)</b> <span class="muted">· ${r.rpe != null ? `${esc(r.rpe)}: ${esc(RPE_TEXT[r.rpe] ?? "")}` : "how many more reps could you have done?"}</span></div>
          <div class="chips wrapchips">${RPES.map((v) => `<button class="chip${r.rpe === v ? " on" : ""}" data-act="rpe" data-v="${v}">${v}</button>`).join("")}
            ${r.rpe != null ? `<button class="chip" data-act="rpe" data-v="">Clear</button>` : ""}</div>
          <div class="ex-menu">
            <button class="secondary" data-act="setup" ${si === 0 ? "disabled" : ""} aria-label="Move set up">${icon("arrow-up")}</button>
            <button class="secondary" data-act="setdown" ${si === ex.sets.length - 1 ? "disabled" : ""} aria-label="Move set down">${icon("arrow-down")}</button>
            <button class="secondary danger" data-act="delset">Delete set</button>
          </div></div>`;
      }
    });
    html += `<button class="addset" data-act="addset">+ Add set</button></section>`;
  });

  html += `<div class="addex"><button class="secondary" data-act="addex">+ Add exercises</button></div>
    <p class="muted small" style="text-align:center">Swipe a set left to delete it · tap a set's number for type, effort and order</p>
    <div style="margin-top:20px;text-align:center">
      ${live ? `<button class="ghost danger" data-act="discard">Cancel workout</button>` : ""}
      ${d.mode === "edit" ? `<button class="ghost danger" data-act="delete">Delete workout</button>` : ""}
    </div>
    </div></div>`;
  body.innerHTML = html;
  body.scrollTop = scroll;
}

$("editor").addEventListener("input", (ev) => {
  const el = ev.target, f = el.dataset.f;
  if (!editor || !f) return;
  const d = editor.draft;
  const xi = Number(el.closest("[data-x]")?.dataset.x);
  const si = Number(el.closest("[data-s]")?.dataset.s);
  if (f === "name") d.name = el.value;
  else if (f === "notes") d.notes = el.value;
  else if (f === "exnotes") d.exercises[xi].notes = el.value;
  else if (f === "cue") return; // saved with the "Save cue" button
  else if (f === "date") {
    if (!el.value) return;
    const old = new Date(d.start);
    const [y, mo, day] = el.value.split("-").map(Number);
    if (!(y >= 1970) || el.value > todayKey()) return; // a half-typed or future year never gets saved (it would block syncing)
    d.start = new Date(y, mo - 1, day, old.getHours(), old.getMinutes()).toISOString();
  } else if (f === "dur_h" || f === "dur_m") {
    const hv = $("editor").querySelector('[data-f="dur_h"]').value.trim();
    const mv = $("editor").querySelector('[data-f="dur_m"]').value.trim();
    d.duration_min = hv === "" && mv === "" ? null : (parseInt(hv, 10) || 0) * 60 + (parseInt(mv, 10) || 0);
  } else if (f === "weight" || f === "reps") {
    d.exercises[xi].sets[si][f] = el.value.trim();
  }
  changed();
});

const swap = (arr, i, j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; };

// The keyboard's Next key walks weight → reps → the next set's weight, for one-handed logging.
$("editor").addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" || !ev.target.matches?.('input[data-f="weight"], input[data-f="reps"]')) return;
  ev.preventDefault();
  const fields = [...$("editor").querySelectorAll('input[data-f="weight"], input[data-f="reps"]')];
  const next = fields[fields.indexOf(ev.target) + 1];
  if (next) next.focus(); else ev.target.blur();
});

$("editor").addEventListener("click", async (ev) => {
  if (swipeJustMoved) { swipeJustMoved = false; return; }
  const b = ev.target.closest("[data-act]");
  if (!b || !editor) { closeSwipe(); return; }
  const d = editor.draft;
  const xi = Number(b.closest("[data-x]")?.dataset.x);
  const si = Number(b.closest("[data-s]")?.dataset.s);
  const ex = d.exercises[xi];
  const act = b.dataset.act;
  if (act !== "delset") closeSwipe();
  switch (act) {
    case "close": history.back(); return;
    case "save": await saveEditor(); return;
    case "addex": openPicker(); return;
    case "addset": ex.sets.push(blankRow(cortex.newId())); break;
    case "exinfo": openExercise(ex.key); return;
    case "setmenu": {
      const id = `${xi}:${si}`;
      editor.setMenu = editor.setMenu === id ? null : id;
      renderEditor();
      return;
    }
    case "settype": ex.sets[si].type = b.dataset.v || null; if (b.dataset.v === "warmup") ex.sets[si].pr = null; break;
    case "rpe": ex.sets[si].rpe = b.dataset.v === "" ? null : Number(b.dataset.v); break;
    case "setup": swap(ex.sets, si, si - 1); editor.setMenu = `${xi}:${si - 1}`; break;
    case "setdown": swap(ex.sets, si, si + 1); editor.setMenu = `${xi}:${si + 1}`; break;
    case "delset": // no confirm for a single set (owner's choice, DESIGN D49)
      ex.sets.splice(si, 1); editor.setMenu = null; swipedRow = null;
      break;
    case "useprev": {
      const p = previousSets(workouts, ex.key, d.start, d.id)[si];
      if (!p) return;
      Object.assign(ex.sets[si], { weight: showWeight(p.value, p.unit, d.unit), reps: String(p.data?.reps ?? "") });
      break;
    }
    case "tick": tick(xi, si); break;
    case "exmenu": editor.menu = editor.menu === xi ? null : xi; renderEditor(); return;
    case "exnote": editor.notes.add(xi); editor.menu = null; renderEditor(); return;
    case "excue": editor.cueEdit = xi; editor.menu = null; renderEditor(); return;
    case "cuecancel": editor.cueEdit = null; renderEditor(); return;
    case "cuesave": {
      const text = b.closest(".cue-edit").querySelector("textarea").value.trim();
      editor.cueEdit = null;
      await saveExerciseDef(ex.key, { cue: text });
      renderEditor();
      toast(text ? "Cue saved: it'll show every time you do this exercise" : "Cue removed");
      return;
    }
    case "exup": swap(d.exercises, xi, xi - 1); editor.menu = null; resetMenus(); break;
    case "exdown": swap(d.exercises, xi, xi + 1); editor.menu = null; resetMenus(); break;
    case "exss": {
      const next = d.exercises[xi + 1];
      const g = ex.group || next.group || cortex.newId().slice(0, 8);
      ex.group = g; next.group = g; editor.menu = null;
      break;
    }
    case "exunss": {
      const g = ex.group;
      ex.group = null; editor.menu = null;
      const left = d.exercises.filter((x) => x.group === g);
      if (left.length === 1) left[0].group = null;
      break;
    }
    case "exremove":
      {
        const n = ex.sets.filter((r) => r.weight || r.reps || r.done).length;
        if (!(await ask(`Remove ${exName(ex.key)}?`, n ? `Its ${n} set${n > 1 ? "s" : ""} in this workout will be deleted too.` : "", "Remove"))) return;
      }
      d.exercises.splice(xi, 1);
      resetMenus();
      break;
    case "discard":
      if (!(await ask("Cancel this workout?", "Nothing from it will be saved. This can't be undone.", "Cancel workout", true, "Keep going"))) return;
      clearLive(); editor.dirty = false; history.back();
      return;
    case "delete":
      if (!(await ask("Delete this workout?", "All of its sets are deleted too. This can't be undone.", "Delete workout"))) return;
      await cortex.putEntries(deletePlan(editor.original));
      editor.dirty = false; history.back(); toast("Workout deleted");
      return;
    default: return;
  }
  changed();
  renderEditor();
});

function resetMenus() {
  editor.menu = null; editor.notes.clear(); editor.setMenu = null; editor.cueEdit = null;
}

// ---- Swipe a set row left to reveal its delete button ----
let swipe = null;          // gesture in progress
let swipedRow = null;      // the row currently swiped open
let swipeJustMoved = false;
const SWIPE_W = 76;

function closeSwipe() {
  if (swipedRow) { swipedRow.style.transform = ""; swipedRow.closest(".swipe")?.classList.remove("open"); swipedRow = null; }
}
$("editor").addEventListener("pointerdown", (ev) => {
  const row = ev.target.closest(".setrow");
  if (!row || ev.target.closest(".trash")) return;
  if (swipedRow && swipedRow !== row) closeSwipe();
  swipe = { row, x: ev.clientX, y: ev.clientY, base: row === swipedRow ? -SWIPE_W : 0, dx: 0, horizontal: null };
});
$("editor").addEventListener("pointermove", (ev) => {
  if (!swipe) return;
  const dx = ev.clientX - swipe.x, dy = ev.clientY - swipe.y;
  if (swipe.horizontal === null && Math.hypot(dx, dy) > 8) swipe.horizontal = Math.abs(dx) > Math.abs(dy);
  if (!swipe.horizontal) return;
  swipe.dx = dx;
  const x = Math.min(0, Math.max(-SWIPE_W - 20, swipe.base + dx));
  swipe.row.style.transition = "none";
  swipe.row.style.transform = `translateX(${x}px)`;
});
const endSwipe = () => {
  if (!swipe) return;
  const { row, base, dx, horizontal } = swipe;
  swipe = null;
  row.style.transition = "";
  if (!horizontal) return;
  swipeJustMoved = Math.abs(dx) > 8;
  setTimeout(() => (swipeJustMoved = false), 300);
  if (base + dx < -SWIPE_W / 2) {
    row.style.transform = `translateX(${-SWIPE_W}px)`;
    row.closest(".swipe").classList.add("open");
    swipedRow = row;
  } else {
    row.style.transform = "";
    row.closest(".swipe").classList.remove("open");
    if (swipedRow === row) swipedRow = null;
  }
};
$("editor").addEventListener("pointerup", endSwipe);
$("editor").addEventListener("pointercancel", endSwipe);

// Tick a set done. Empty boxes take the greyed-out hint, so repeating last time is one tap.
function tick(xi, si) {
  const d = editor.draft, ex = d.exercises[xi], r = ex.sets[si];
  if (r.done) { r.done = false; r.pr = null; return; }
  const hint = hintFor(xi, si);
  const weight = r.weight || hint.weight, reps = r.reps || hint.reps;
  const w = parseWeight(weight), n = Number(reps);
  if (Number.isNaN(w) || !Number.isInteger(n) || n < 1) { toast("Enter the weight and reps first"); return; }
  Object.assign(r, { weight, reps, done: true, at: new Date().toISOString() });
  if (r.type === "warmup") { r.pr = null; if (navigator.vibrate) navigator.vibrate(25); return; }

  // PR check against every earlier working set of this exercise, including earlier ones today.
  const earlier = [
    ...workSets.filter((s) => s.metric === ex.key && s.recorded_at < r.at),
    ...ex.sets.filter((o) => o !== r && o.done && o.type !== "warmup").map((o) => ({ value: parseWeight(o.weight), unit: d.unit, data: { reps: Number(o.reps) }, recorded_at: o.at })),
  ];
  const kind = prKind({ value: w, unit: d.unit, data: { reps: n }, recorded_at: r.at }, earlier);
  r.pr = kind;
  if (kind === "e1rm") { const step = d.unit === "kg" ? 0.5 : 1, est = convert(e1rm(convert(w, d.unit, "kg"), n), "kg", d.unit);
    toast(`New best · est. 1RM ${fmtNum(Math.round(est / step) * step)} ${d.unit}`); }
  else if (kind === "reps") toast(`Rep PR: heaviest ${n}-rep set yet`);
  if (navigator.vibrate) navigator.vibrate(kind ? [30, 60, 30] : 25);
}

async function saveEditor() {
  const d = editor.draft;
  const total = d.exercises.reduce((n, x) => n + keptRows(d, x).length, 0);
  if (d.mode === "live") {
    const unticked = d.exercises.reduce((n, x) => n + x.sets.filter((r) => !r.done && (r.weight || r.reps)).length, 0);
    if (!total) {
      if (await ask("No sets ticked off yet", "Finishing now saves nothing. Cancel this workout instead?", "Cancel workout", true, "Keep going")) { clearLive(); editor.dirty = false; history.back(); }
      return;
    }
    if (!(await ask("Finish workout?", unticked ? `${unticked} set${unticked > 1 ? "s aren't" : " isn't"} ticked off and won't be saved.` : `${total} set${total > 1 ? "s" : ""} will be saved.`, "Finish", false))) return;
  } else if (!total) {
    toast("Add at least one set with reps");
    return;
  }
  try {
    await cortex.putEntries(commitPlan(d, editor.original, new Date()));
  } catch (err) {
    toast("Couldn't save: " + err.message);
    return;
  }
  if (d.mode === "live") clearLive();
  editor.dirty = false;
  history.back();
  toast(d.mode === "edit" ? "Workout updated" : `Workout saved · ${plural(total, "set")}`);
}

// ---------- Exercise picker ----------
// Add exercises to a workout ({ kind: "add" }): tap to select several (they highlight),
// then "Add". Or choose a merge target ({ kind: "merge", from }): one tap picks.

let pickerMode = { kind: "add" };
let pickerSel = [];
function openPicker(mode = { kind: "add" }) {
  pickerMode = mode;
  pickerSel = [];
  openOverlay("picker").innerHTML = `<div class="wrap">
    <div class="sheet-top">
      <button class="back" data-act="pkclose" aria-label="Back">${icon("chevron-left")}</button>
      <input class="pk-search" id="pksearch" placeholder="${mode.kind === "merge" ? `Merge ${esc(exName(mode.from))} into…` : "Search"}" autocomplete="off" enterkeyhint="search">
      <button class="ghost" data-act="pknew">${mode.kind === "merge" ? "" : "+ New"}</button>
    </div>
    <div id="pklist" class="sheet-body" style="padding-top:4px"></div>
    <div class="pkbar" id="pkbar" hidden></div></div>`;
  renderPicker();
  $("pksearch").addEventListener("input", renderPicker);
}

function renderPicker() {
  const q = ($("pksearch")?.value || "").trim();
  const ql = q.toLowerCase();
  const merge = pickerMode.kind === "merge";
  const blocked = merge ? new Set([pickerMode.from]) : new Set(editor?.draft.exercises.map((x) => x.key));
  const all = allExercises().filter((x) => !x.hidden);
  const match = (x) => !ql || x.name.toLowerCase().includes(ql);
  const item = (x) => {
    const i = pickerSel.indexOf(x.key);
    return `<button class="pkitem${i >= 0 ? " sel" : ""}" data-key="${esc(x.key)}" ${blocked.has(x.key) ? "disabled" : ""} aria-pressed="${i >= 0}">
      <span>${esc(x.name)}<br><small>${esc([MUSCLES[x.primary], x.equipment].filter(Boolean).join(" · ") || "no muscle set")}</small></span>
      <span class="pkcheck">${i >= 0 ? i + 1 : ""}</span></button>`;
  };

  let html = "";
  if (!merge && q && !all.some((x) => x.name.toLowerCase() === ql)) {
    html += `<button class="pkitem create" data-act="pknew">+ Create “${esc(q)}”…</button>`;
  }
  const recent = [...new Set(workouts.flatMap((w) => w.exercises.map((x) => x.key)))].slice(0, 8)
    .map((k) => exerciseFor(lib, k)).filter((x) => !x.hidden && match(x));
  if (recent.length && !q) html += `<h2>Recent</h2>` + recent.map(item).join("");
  const rest = all.filter(match).sort((a, b) => a.name.localeCompare(b.name));
  html += `<h2>${q ? "Results" : "All exercises"}</h2>` + (rest.map(item).join("") || `<p class="empty">No match.</p>`);
  $("pklist").innerHTML = html;

  const n = pickerSel.length;
  $("pkbar").hidden = merge || !n;
  $("pkbar").innerHTML = n ? `${n > 1 ? `<button class="secondary" data-act="pkss">Add as superset</button>` : ""}
    <button class="primary" data-act="pkadd">Add ${n} exercise${n > 1 ? "s" : ""}</button>` : "";
}

function addSelected(asSuperset) {
  const d = editor.draft;
  const group = asSuperset && pickerSel.length > 1 ? cortex.newId().slice(0, 8) : null;
  for (const key of pickerSel) {
    const n = Math.max(1, previousSets(workouts, key, d.start, d.id).length);
    d.exercises.push({ key, notes: "", group, sets: Array.from({ length: n }, () => blankRow(cortex.newId())) });
  }
  pickerSel = [];
  changed();
  history.back(); // closes the picker
  renderEditor();
  requestAnimationFrame(() => $("editor").scrollTo({ top: $("editor").scrollHeight }));
}

$("picker").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "pkclose") { history.back(); return; }
  if (pickerMode.kind === "merge") {
    if (b.dataset.key) await mergeExercise(pickerMode.from, b.dataset.key);
    return;
  }
  if (act === "pknew") { openExerciseEdit(null, { name: $("pksearch").value.trim(), pick: true }); return; }
  if (!editor) return;
  if (act === "pkadd") { addSelected(false); return; }
  if (act === "pkss") { addSelected(true); return; }
  const key = b.dataset.key;
  if (!key) return;
  const i = pickerSel.indexOf(key);
  if (i >= 0) pickerSel.splice(i, 1); else pickerSel.push(key);
  renderPicker();
});

// ---------- Progress tab: overview ----------

const RANGES = { "4w": ["4 weeks", 28], "3m": ["3 months", 91], "1y": ["1 year", 365], all: ["All time", null] };
let range = "3m";
let journeyOpen = false;
const fmtBig = (n) => Math.round(n).toLocaleString();

function renderProgress() {
  const el = $("view-progress");
  if (!sets.length) { el.innerHTML = `<p class="empty">Log a workout and your progress shows up here.</p>`; return; }
  const t = totals(workouts);
  const vol = convert(t.volumeKg, "kg", unit);
  const ms = milestone(t.volumeKg);
  const days = RANGES[range][1];
  const fromIso = days ? new Date(Date.now() - days * 864e5).toISOString() : null;
  const groups = groupSets(since(workSets, fromIso), (k) => exerciseFor(lib, k));

  // Most-trained exercises, with their best estimated 1RM.
  const sessionsByKey = new Map();
  for (const w of workouts) for (const x of w.exercises) if (x.sets.length) sessionsByKey.set(x.key, (sessionsByKey.get(x.key) || 0) + 1);
  const top = [...sessionsByKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, n]) => {
    const mine = workSets.filter((s) => s.metric === key);
    const { best } = personalRecords(mine);
    const mostReps = Math.max(0, ...mine.filter((s) => !(s.value > 0)).map((s) => Number(s.data?.reps) || 0));
    return { key, n, best, mostReps };
  });

  el.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="k">Workouts</div><div class="v">${t.workouts.toLocaleString()}</div></div>
      <div class="tile"><div class="k">Total volume</div><div class="v">${fmtBig(vol)} <small>${unit}</small></div></div>
      <div class="tile"><div class="k">PRs</div><div class="v">${prs.size.toLocaleString()}</div></div>
      <div class="tile"><div class="k">Time training</div><div class="v">${t.minutes ? fmtDuration(t.minutes) : "—"}</div></div>
    </div>
    <div class="muted small" style="margin-top:8px">${plural(t.sets, "set")} · ${plural(t.reps, "rep")}</div>

    <div class="card milestone">
      <div class="k">You've lifted</div>
      <div class="v">${fmtBig(vol)} ${unit}</div>
      ${ms.last ? `<div>That's <b>${fmtTimes(t.volumeKg / ms.last.kg)} × ${esc(ms.last.name)}</b> ${icon(ms.last.icon)}</div>` : ""}
      ${ms.next ? `<div class="bar" role="progressbar" aria-valuenow="${Math.round(ms.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${(ms.progress * 100).toFixed(1)}%"></span></div>
        <div class="muted small">Next: ${icon(ms.next.icon)} ${esc(ms.next.name)} (${fmtBig(convert(ms.next.kg, "kg", unit))} ${unit}) · ${Math.floor(ms.progress * 100)}%</div>` : ""}
      ${ms.journey.length ? `<button class="ghost" data-act="journey" style="padding:0;margin-top:6px">${journeyOpen ? "Hide" : "See"} your journey ${icon(journeyOpen ? "chevron-up" : "chevron-down")}</button>` : ""}
      ${journeyOpen ? `<ul class="list journey">${ms.journey.map((o) =>
        `<li><span>${icon(o.icon)} ${esc(o.name)} <span class="muted small">${fmtBig(convert(o.kg, "kg", unit))} ${unit}</span></span><b>${fmtTimes(o.times)}×</b></li>`).join("")}</ul>` : ""}
    </div>

    <h2>Muscles worked</h2>
    <div class="chips" role="group" aria-label="Time range">${Object.entries(RANGES).map(([k, [label]]) =>
      `<button class="chip${k === range ? " on" : ""}" data-range="${k}">${label}</button>`).join("")}</div>
    <div class="muted small">Sets per muscle group. Helper muscles count half a set (bench press: 1 chest, ½ arms, ½ shoulders).</div>
    ${radarSvg(groups)}

    <h2>Training split</h2>
    ${splitHtml(groups)}

    <h2>Top lifts</h2>
    <ul class="list">${top.map((x) => `<li><button class="rowbtn" data-key="${esc(x.key)}">
      <span>${esc(exName(x.key))}<br><span class="muted small">${plural(x.n, "session")}</span></span>
      <span class="val">${x.best ? `${fmtW(x.best.e1rm)} ${unit}<br><span class="muted small">est. 1RM</span>`
        : x.mostReps ? `${fmtNum(x.mostReps)} reps<br><span class="muted small">most in a set</span>` : ""}</span></button></li>`).join("")}</ul>`;
}

// 2.2 -> "2.2", 1234.5 -> "1,235", 0.4 -> "0.4"
const fmtTimes = (n) => (n >= 100 ? fmtBig(n) : fmtNum(Math.round(n * 10) / 10));

// Radar chart: one axis per group, rings at 25/50/75/100% of the busiest group.
function radarSvg(groups) {
  const vals = GROUPS.map((g) => groups[g]);
  const max = Math.max(...vals);
  if (!max) return `<p class="empty">No sets in this range.</p>`;
  const W = 380, H = 290, cx = W / 2, cy = H / 2 + 4, R = 90; // wide enough for side labels
  const pt = (i, f) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / GROUPS.length;
    return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f];
  };
  const ring = (f) => GROUPS.map((_, i) => pt(i, f).map((n) => n.toFixed(1)).join(",")).join(" ");
  const shape = vals.map((v, i) => pt(i, v / max).map((n) => n.toFixed(1)).join(",")).join(" ");
  const labels = GROUPS.map((g, i) => {
    const [x, y] = pt(i, 1.28);
    const anchor = Math.abs(x - cx) < 4 ? "middle" : x > cx ? "start" : "end";
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" class="rl">${GROUP_LABEL[g]}</text>
      <text x="${x.toFixed(1)}" y="${(y + 15).toFixed(1)}" text-anchor="${anchor}" class="rv">${fmtNum(groups[g])}</text>`;
  }).join("");
  return `<div class="radar"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sets per muscle group: ${GROUPS.map((g) => `${GROUP_LABEL[g]} ${fmtNum(groups[g])}`).join(", ")}">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${ring(f)}" fill="none" stroke="var(--grid)" stroke-width="1"/>`).join("")}
    ${GROUPS.map((_, i) => { const [x, y] = pt(i, 1); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>`; }).join("")}
    <polygon points="${shape}" fill="rgb(255 46 136 / .22)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    ${vals.map((v, i) => { const [x, y] = pt(i, v / max); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>`; }).join("")}
    ${labels}
  </svg></div>`;
}

// Donut of each group's share of sets, with a legend that carries names and numbers
// (colour is never the only cue).
function splitHtml(groups) {
  const total = GROUPS.reduce((n, g) => n + groups[g], 0);
  if (!total) return `<p class="empty">No sets in this range.</p>`;
  const R = 70, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = GROUPS.filter((g) => groups[g] > 0).map((g) => {
    const len = (groups[g] / total) * C;
    const arc = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="var(--g-${g})" stroke-width="26"
      stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${(C - Math.max(0, len - 2)).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
    offset += len;
    return arc;
  }).join("");
  return `<div class="split">
    <svg viewBox="0 0 180 180" role="img" aria-label="Training split">
      <g transform="rotate(-90 90 90)">${arcs}</g>
      <text x="90" y="88" text-anchor="middle" class="sv">${fmtNum(total)}</text>
      <text x="90" y="106" text-anchor="middle" class="sk">sets</text>
    </svg>
    <ul class="legend">${GROUPS.map((g) => `<li><i style="background:var(--g-${g})"></i>${GROUP_LABEL[g]}
      <span>${Math.round((groups[g] / total) * 100)}%</span></li>`).join("")}</ul>
  </div>`;
}

$("view-progress").addEventListener("click", (ev) => {
  const r = ev.target.closest("[data-range]")?.dataset.range;
  if (r) { range = r; renderProgress(); return; }
  if (ev.target.closest("[data-act=journey]")) { journeyOpen = !journeyOpen; renderProgress(); return; }
  const k = ev.target.closest("[data-key]")?.dataset.key;
  if (k) openExercise(k);
});

// ---------- Exercise detail (Progress tab, and the screen behind an exercise's name) ----------

const METRICS = {
  e1rm: { label: "Est. 1RM", hero: "best estimated 1RM" },
  heaviest: { label: "Heaviest", hero: "heaviest weight" },
  volume: { label: "Volume", hero: "best session volume" },
  mostReps: { label: "Most reps", hero: "most reps in a set", reps: true }, // bodyweight sets (D57)
};

// Everything about one exercise: a per-session chart (est. 1RM, heaviest or volume),
// records, and every session it was done in.
function renderExerciseInto(el, key) {
  const mine = workSets.filter((s) => s.metric === key);
  const cue = exerciseFor(lib, key).cue;
  if (!mine.length) { el.innerHTML = `${cue ? `<div class="cue static">${icon("pin")} ${esc(cue)}</div>` : ""}<p class="empty">No sets of ${esc(exName(key))} yet.</p>`; return; }
  const series = sessionSeries(mine);
  const { best, reps } = personalRecords(mine);
  // Weight charts need weighted sets; "Most reps" is offered when there are bodyweight sets.
  // A pure bodyweight exercise (pull-ups with no belt) shows only that one.
  const weighted = mine.some((s) => s.value > 0), bodyweight = mine.some((s) => !(s.value > 0));
  const shown = Object.keys(METRICS).filter((k) => (k === "mostReps" ? bodyweight : weighted));
  const metric = shown.includes(chartMetric) ? chartMetric : shown[0];
  const m = METRICS[metric];
  const fmtV = (v) => (m.reps ? fmtNum(v) : fmtW(v));
  const vUnit = m.reps ? "reps" : unit;
  const { top, first, gain } = seriesGain(series, metric);
  const mostReps = Math.max(0, ...series.map((d) => d.mostReps));
  const sessions = workouts.filter((w) => w.exercises.some((x) => x.key === key && x.sets.length));

  el.innerHTML = `${cue ? `<div class="cue static">${icon("pin")} ${esc(cue)}</div>` : ""}
    ${shown.length > 1 ? `<div class="chips" role="group" aria-label="Chart">${shown.map((k) =>
      `<button class="chip${k === metric ? " on" : ""}" data-metric="${k}">${METRICS[k].label}</button>`).join("")}</div>` : ""}
    <div class="hero">
      <div class="label">${esc(exName(key))} · ${m.hero}</div>
      <div class="big">${top ? fmtV(top[metric]) : "—"} <small>${vUnit}</small></div>
      <div class="sub">${top ? esc(fmtDayKey(top.day)) : ""}${gain > 0 ? ` · +${fmtV(gain)} ${vUnit} since ${esc(fmtDayKey(first.day))}` : ""}</div>
    </div>
    <div class="chart"></div>
    <h2>Records</h2>
    <ul class="list">
      ${best ? `<li><span>Best est. 1RM</span><span>${fmtW(best.e1rm)} ${unit} <span class="muted small">(${fmtW(best.weight)} × ${best.reps})</span></span></li>` : ""}
      ${bodyweight && mostReps ? `<li><span>Most reps in a set</span><span>${fmtNum(mostReps)}</span></li>` : ""}
      <li><span>Sessions · sets</span><span>${series.length} · ${mine.length}</span></li>
    </ul>
    ${reps.length ? `<h2>Rep records</h2>
    <table>
      <thead><tr><th>Reps</th><th class="r">Heaviest</th><th class="r">Est. 1RM</th><th class="r">Date</th></tr></thead>
      <tbody>${reps.map((r) => `<tr>
        <td>${esc(r.reps)}</td><td class="r">${fmtW(r.weight)} ${unit}</td>
        <td class="r">${fmtW(r.e1rm)}</td><td class="r">${esc(fmtDayKey(dayKey(r.recorded_at)))}</td>
      </tr>`).join("")}</tbody>
    </table>` : ""}
    <h2>History</h2>
    ${sessions.map((w) => {
      const x = w.exercises.find((e) => e.key === key);
      return `<div class="card hist">
        <div class="head"><b>${esc(w.name)}</b><span class="muted small">${esc(fmtDate(w.start))}</span></div>
        ${x.notes ? `<div class="notes">${esc(x.notes)}</div>` : ""}
        ${(() => { let n = 0; return x.sets.map((st) => {
          const t = st.data?.type;
          const label = t === "warmup" ? "W" : (n++, prs.has(st.client_id) ? icon("trophy", { label: "PR" }) : t ? SET_TYPES[t][0] : n);
          return `<div class="line${t === "warmup" ? " muted" : ""}"><span class="muted">${label}</span><span>${esc(setText(st))}</span></div>`;
        }).join(""); })()}
      </div>`;
    }).join("")}`;

  const points = series.map((d) => ({
    day: d.day, v: m.reps ? d[metric] : convert(d[metric], "kg", unit),
    sub: metric === "volume" || m.reps ? plural(d.sets, "set") : d.best ? `${fmtW(d.best.weight)}×${d.best.reps}` : "",
  })).filter((p) => p.v > 0);
  drawChart(el.querySelector(".chart"), points, vUnit);
}

let exsheetKey = null;
function openExercise(key) {
  exsheetKey = key;
  openOverlay("exercise").innerHTML = `<div class="wrap">
    <div class="sheet-top">
      <button class="back" data-act="close" aria-label="Back">${icon("chevron-left")}</button>
      <div class="title" id="extitle">${esc(exName(key))}</div>
      <button class="ghost accent" data-act="editex">Edit</button>
    </div>
    <div class="sheet-body" id="exbody"></div></div>`;
  renderExerciseInto($("exbody"), key);
}

$("exsheet").addEventListener("click", (ev) => {
  if (ev.target.closest("[data-act=close]")) { history.back(); return; }
  if (ev.target.closest("[data-act=editex]")) { openExerciseEdit(exsheetKey); return; }
  const m = ev.target.closest("[data-metric]")?.dataset.metric;
  if (!m) return;
  chartMetric = m;
  renderExerciseInto($("exbody"), exsheetKey);
});

// Hand-drawn SVG line chart (DESIGN D19): one point per session, x = real time.
// points: [{ day: "YYYY-MM-DD", v: number in display unit, sub: extra tooltip text }]
function drawChart(el, points, vUnit = unit) {
  if (!points.length) {
    el.innerHTML = `<p class="empty">No data for this chart yet.</p>`;
    return;
  }
  const r1 = (n) => (n >= 1000 ? Math.round(n).toLocaleString() : fmtNum(Math.round(n * 10) / 10));
  const c = lineChart(points.map((d) => ({ t: new Date(noonOf(d.day)).getTime(), v: d.v })), {
    W: el.clientWidth || 340, fmtY: r1, xLabel: (i) => esc(fmtDayKey(points[i].day)),
  });
  const { W, H, pad, xs, ys } = c;
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Per-session chart">
      ${c.markup}
      <line class="cross" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>
      ${chartDots(c)}
      <circle class="focus" r="6" fill="var(--accent)" stroke="var(--text)" stroke-width="2" visibility="hidden"/>
    </svg>
    <div class="tip" hidden></div>${points.length === 1 ? `<p class="muted small">Log another session to see a trend.</p>` : ""}`;
  const svg = el.querySelector("svg"), cross = el.querySelector(".cross"), focus = el.querySelector(".focus"), tip = el.querySelector(".tip");
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = (clientX - r.left) * (W / r.width);
    let i = 0;
    for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - px) < Math.abs(xs[i] - px)) i = k;
    const cx = xs[i], cy = ys[i];
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    focus.setAttribute("cx", cx); focus.setAttribute("cy", cy); focus.setAttribute("visibility", "visible");
    const d = points[i];
    tip.innerHTML = `<b>${r1(d.v)} ${esc(vUnit)}</b> <span>· ${esc(d.sub)}${d.sub ? " · " : ""}${esc(fmtDayKey(d.day))}</span>`;
    tip.hidden = false;
    const left = cx * (r.width / W);
    tip.style.left = `${Math.min(Math.max(left, tip.offsetWidth / 2), r.width - tip.offsetWidth / 2)}px`;
  };
  const hide = () => { cross.setAttribute("visibility", "hidden"); focus.setAttribute("visibility", "hidden"); tip.hidden = true; };
  svg.addEventListener("pointerdown", (e) => show(e.clientX));
  svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.buttons) show(e.clientX); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
}

let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!$("exsheet").hidden && exsheetKey) renderExerciseInto($("exbody"), exsheetKey);
  }, 150);
});

// ---------- Exercises tab: browse, filter by muscle, create, edit, merge ----------

let exFilter = "all";     // muscle key or "all"
let exQuery = "";
let showHidden = false;
const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "other"];

function allExercises() {
  const list = [...lib.values()];
  for (const s of sets) if (!lib.has(s.metric) && !list.some((x) => x.key === s.metric)) list.push(exerciseFor(lib, s.metric));
  return list;
}

function renderExercises() {
  // A redraw (typing, or a background sync) keeps the search box focused, so the keyboard stays up.
  const old = $("exsearch");
  const typing = old && document.activeElement === old ? [old.selectionStart, old.selectionEnd] : null;
  const counts = new Map();
  for (const s of sets) counts.set(s.metric, (counts.get(s.metric) || 0) + 1);
  const q = exQuery.trim().toLowerCase();
  const list = allExercises().filter((x) =>
    (showHidden || !x.hidden) && (exFilter === "all" || x.primary === exFilter || (x.secondary || []).includes(exFilter))
    && (!q || x.name.toLowerCase().includes(q)));
  const hiddenCount = [...lib.values()].filter((x) => x.hidden).length;
  const groups = new Map([...Object.keys(MUSCLES), "other"].map((m) => [m, []]));
  for (const x of list) groups.get(MUSCLES[x.primary] ? x.primary : "other").push(x);

  let html = `<div class="exbar">
      <input id="exsearch" placeholder="Search exercises" value="${esc(exQuery)}" autocomplete="off" enterkeyhint="search">
      <button class="primary sm" data-act="newex">+ New</button>
    </div>
    <div class="chips">${[["all", "All"], ...Object.entries(MUSCLES)].map(([k, label]) =>
      `<button class="chip${k === exFilter ? " on" : ""}" data-filter="${k}">${label}</button>`).join("")}</div>`;
  for (const [m, items] of groups) {
    if (!items.length) continue;
    html += `<h2>${esc(MUSCLES[m] || "No muscle set")}</h2><ul class="list">` + items.sort((a, b) => a.name.localeCompare(b.name)).map((x) =>
      `<li><button class="rowbtn" data-key="${esc(x.key)}">
        <span>${esc(x.name)}${x.custom ? ` <span class="muted small">· yours</span>` : ""}${x.hidden ? ` <span class="muted small">· hidden</span>` : ""}</span>
        <span class="muted small">${counts.get(x.key) ? plural(counts.get(x.key), "set") : esc(x.equipment || "")}</span></button></li>`
    ).join("") + `</ul>`;
  }
  if (!list.length) html += `<p class="empty">No exercises match.</p>`;
  if (hiddenCount) html += `<div style="margin-top:18px"><button class="ghost" data-act="hidden">${showHidden ? "Hide" : "Show"} hidden exercises (${hiddenCount})</button></div>`;
  $("view-exercises").innerHTML = html;
  const input = $("exsearch");
  if (typing) { input.focus(); input.setSelectionRange(...typing); }
  input.addEventListener("input", () => { exQuery = input.value; renderExercises(); });
}

$("view-exercises").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.filter) { exFilter = b.dataset.filter; renderExercises(); }
  else if (b.dataset.act === "newex") openExerciseEdit(null);
  else if (b.dataset.act === "hidden") { showHidden = !showHidden; renderExercises(); }
  else if (b.dataset.key) openExercise(b.dataset.key);
});

// Edit form. `key` null = new exercise.
let exEdit = null; // { key, name, equipment, primary, secondary:Set, hidden, cue, pick }
// opts.name prefills a new exercise's name; opts.pick selects it in the picker after saving.
function openExerciseEdit(key, opts = {}) {
  const x = key ? exerciseFor(lib, key) : null;
  exEdit = {
    key, name: x?.name || opts.name || exQuery.trim(), equipment: x?.equipment || null, primary: x?.primary || null,
    secondary: new Set(x?.secondary || []), hidden: !!x?.hidden, cue: x?.cue || "", pick: !!opts.pick,
  };
  openOverlay("exedit");
  renderExerciseEdit();
}

function renderExerciseEdit() {
  const e = exEdit;
  const muscleChips = (attr, isOn) => Object.entries(MUSCLES).map(([k, label]) =>
    `<button class="chip${isOn(k) ? " on" : ""}" data-${attr}="${k}">${label}</button>`).join("");
  $("exedit").innerHTML = `<div class="wrap">
    <div class="sheet-top">
      <button class="back" data-act="close" aria-label="Back">${icon("chevron-left")}</button>
      <div class="title">${e.key ? "Edit exercise" : "New exercise"}</div>
      <button class="primary sm" data-act="saveex">Save</button>
    </div>
    <div class="sheet-body">
      <label class="lbl">Name<input id="exname" value="${esc(e.name)}" autocomplete="off"></label>
      ${!e.key ? `<p class="muted small">Pick the main muscle so it counts in your muscle charts.</p>` : ""}
      <div class="lbl">Equipment</div>
      <div class="chips wrapchips">${EQUIPMENT.map((q) => `<button class="chip${e.equipment === q ? " on" : ""}" data-eq="${q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join("")}</div>
      <div class="lbl">Main muscle <span class="muted">· counts 1 set</span></div>
      <div class="chips wrapchips">${muscleChips("primary", (k) => e.primary === k)}</div>
      <div class="lbl">Helper muscles <span class="muted">· count ½ set each</span></div>
      <div class="chips wrapchips">${muscleChips("secondary", (k) => e.secondary.has(k))}</div>
      <label class="lbl">${icon("pin")} Cue <span class="muted">· shown every time you do this exercise</span>
        <textarea id="excue" rows="2" placeholder="e.g. elbows tucked, pause at the bottom">${esc(e.cue)}</textarea></label>
      ${e.key ? `<h2>More</h2>
        <div class="stack">
          <button class="secondary" data-act="mergeex">Merge into another exercise…</button>
          <button class="secondary" data-act="hideex">${e.hidden ? "Unhide" : "Hide"} this exercise</button>
        </div>
        <p class="muted small">Merging moves every set of this exercise into the other one, for duplicates like “Bench” and “Bench Press”. Hiding keeps its history but removes it from the lists.</p>` : ""}
    </div></div>`;
}

async function saveExercise() {
  const e = exEdit;
  const name = ($("exname")?.value ?? e.name).trim().slice(0, 60);
  if (!name) { toast("Give it a name"); return false; }
  if (!e.key && allExercises().some((x) => x.name.toLowerCase() === name.toLowerCase())) { toast(`“${name}” already exists`); return false; }
  const key = e.key || newKey(name, new Set(allExercises().map((x) => x.key)));
  await saveExerciseDef(key, {
    name, equipment: e.equipment, primary: e.primary, hidden: e.hidden,
    secondary: [...e.secondary].filter((m) => m !== e.primary), cue: ($("excue")?.value ?? e.cue).trim(),
  });
  e.key = key;
  return true;
}

// Write an exercise's definition (DESIGN D23): current definition + changes, keeping any
// other fields a previous override had. Updates the in-memory library right away.
async function saveExerciseDef(key, changes) {
  const x = exerciseFor(lib, key);
  const prev = entries.find((en) => en.client_id === exerciseId(key) && !en.deleted_at)?.data || {};
  const data = { ...prev, key, name: x.name, equipment: x.equipment, primary: x.primary, secondary: x.secondary, hidden: x.hidden, cue: x.cue, ...changes };
  lib.set(key, { ...x, ...changes, custom: x.custom });
  await cortex.putEntries([{ client_id: exerciseId(key), module: "lifting", metric: EXERCISE, data }]);
}

$("exedit").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b || !exEdit) return;
  if ($("exname")) exEdit.name = $("exname").value;
  if ($("excue")) exEdit.cue = $("excue").value;
  const d = b.dataset;
  if (d.act === "close") { history.back(); return; }
  if (d.eq) exEdit.equipment = exEdit.equipment === d.eq ? null : d.eq;
  else if (d.primary) { exEdit.primary = exEdit.primary === d.primary ? null : d.primary; exEdit.secondary.delete(d.primary); }
  else if (d.secondary) { exEdit.secondary.has(d.secondary) ? exEdit.secondary.delete(d.secondary) : exEdit.secondary.add(d.secondary); }
  else if (d.act === "hideex") {
    if (!exEdit.hidden && !(await ask(`Hide ${exEdit.name || "this exercise"}?`, "It disappears from the lists. Its history is kept and you can unhide it later.", "Hide"))) return;
    exEdit.hidden = !exEdit.hidden;
  }
  else if (d.act === "saveex") {
    if (!(await saveExercise())) return;
    const { key, pick } = exEdit;
    history.back();
    if (pick && !pickerSel.includes(key)) { pickerSel.push(key); renderPicker(); toast("Created and selected"); }
    else toast("Exercise saved");
    return;
  } else if (d.act === "mergeex") { openPicker({ kind: "merge", from: exEdit.key }); return; }
  renderExerciseEdit();
});

async function mergeExercise(from, to) {
  if (!(await ask(`Merge into ${exName(to)}?`, `All sets of “${exName(from)}” become ${exName(to)} sets, and “${exName(from)}” gets hidden.`, "Merge", false))) return;
  const x = exerciseFor(lib, from);
  await cortex.putEntries([
    ...mergePlan(entries, from, to),
    { client_id: exerciseId(from), module: "lifting", metric: EXERCISE,
      data: { key: from, name: x.name, equipment: x.equipment, primary: x.primary, secondary: x.secondary, hidden: true, merged_into: to } },
  ]);
  exsheetKey = to;
  history.go(-2); // close the picker and the edit form; the exercise screen now shows the target
  toast(`Merged into ${exName(to)}`);
}

// ---------- Profile tab + settings screen ----------

function renderProfile() {
  $("view-profile").innerHTML = `<p class="empty">Your profile (workout calendar, lifetime stats, picture) is coming later. Settings are behind the gear button at the top.</p>`;
}

function renderSettings() {
  $("settings").innerHTML = `<div class="wrap">
    <div class="sheet-top">
      <button class="back" data-act="close" aria-label="Back">${icon("chevron-left")}</button>
      <div class="title">Settings</div><span></span>
    </div>
    <div class="sheet-body">
      <ul class="list">
        <li><span>Weight unit<span class="muted small sub">Lifts and bodyweight. Saved sets keep the unit they were logged in.</span></span>
          <span class="seg" role="group" aria-label="Weight unit">
            <button data-unit="lb" aria-pressed="${unit === "lb"}">lb</button>
            <button data-unit="kg" aria-pressed="${unit === "kg"}">kg</button>
          </span></li>
        <li><span>App version<span class="muted small sub" id="vstate">Checking…</span></span><span class="muted small" id="vlocal"></span></li>
      </ul>
    </div></div>`;
  showVersion();
}

// The version on this device (its cache name) vs the server's, so it's easy to tell
// whether the phone has picked up the latest update.
async function showVersion() {
  let local = "";
  try { local = ((await caches.keys()).find((k) => k.startsWith("cortex-shell-")) || "").replace("cortex-shell-", ""); } catch {}
  if ($("vlocal")) $("vlocal").textContent = local || "—";
  let server = null;
  try { server = (await (await fetch("/api/version", { cache: "no-store" })).json()).version; } catch {}
  const el = $("vstate");
  if (!el) return;
  el.textContent = !server ? "Can't reach the server to check" : server === local ? "Up to date" : "Updating… reopen Cortex in a moment";
}

$("gear").addEventListener("click", () => { openOverlay("settings"); renderSettings(); });
$("settings").addEventListener("click", async (ev) => {
  if (ev.target.closest("[data-act=close]")) { history.back(); return; }
  const u = ev.target.closest("[data-unit]")?.dataset.unit;
  if (!u || u === unit) return;
  unit = u;
  renderSettings();
  await cortex.putEntries([{ client_id: "setting:weight_unit", module: "settings", metric: "weight_unit", data: { value: u } }]);
});

// ---------- Data loading ----------

async function showSync() {
  const { pending, online } = await cortex.getStatus();
  const el = $("sync");
  if (pending > 0) { el.textContent = `${pending} pending`; el.className = "sync pending"; }
  else if (online) { el.textContent = "synced"; el.className = "sync ok"; }
  else { el.textContent = online === false ? "offline" : ""; el.className = "sync"; }
}

let migrating = false;
async function refresh() {
  entries = await cortex.listEntries({ module: "lifting", limit: Infinity });
  const settings = await cortex.listEntries({ module: "settings", limit: Infinity });
  unit = settings.find((e) => e.metric === "weight_unit")?.data?.value || "lb";

  // Sets from before workouts existed get grouped into one workout per day (DESIGN D26).
  const plan = legacyPlan(entries);
  if (plan.length && !migrating) {
    migrating = true;
    try { await cortex.putEntries(plan); } finally { migrating = false; }
    return; // putEntries triggers another refresh
  }
  sets = entries.filter(isSet);
  workSets = sets.filter(isWorking);
  workouts = groupWorkouts(entries);
  lib = resolveExercises(entries.filter((e) => e.metric === EXERCISE));
  loaded = true;
  reopenLive();
  try { prs = prEvents(workSets); } catch (err) { console.error("PR maths failed:", err); prs = new Map(); }
  if (!editor) render();
  if (!$("picker").hidden) renderPicker();
  if (!$("exsheet").hidden && exsheetKey) {
    $("extitle").textContent = exName(exsheetKey);
    renderExerciseInto($("exbody"), exsheetKey);
  }
  await showSync();
}

// Live clocks (the workout timer and the "in progress" card) tick every second.
setInterval(() => {
  document.querySelectorAll("[data-clock]").forEach((el) => {
    el.textContent = fmtClock(Date.now() - new Date(el.dataset.clock));
  });
}, 1000);

// A workout in progress reopens right where it was whenever the app opens (D56): after a
// swipe-away, after Android closed it in the background, or after an update. It waits for
// the first full load (so the Previous column has data), once per page load, and never
// covers something you already opened. After a reload the old editor history step is
// reused, so Back doesn't collect dead steps.
const reloadedStep = !!history.state?.ui;
let reopenChecked = false;
function reopenLive() {
  if (reopenChecked) return;
  reopenChecked = true;
  const live = loadLive();
  if (!live || editor || stack.length) return;
  openEditor(live, null, { replace: reloadedStep && history.state === null });
}

cortex.onChange(refresh);
if (history.state?.ui) history.replaceState(null, "", location.hash); // a reload closes any open editor
showTab((location.hash || "#log").slice(1));
// Sync starts even if drawing fails, so the outbox never gets stuck on the device.
refresh().catch((err) => { console.error("refresh failed:", err); reopenLive(); }).finally(() => cortex.startAutoSync());

// The service worker keeps the app shell on the device so this page opens offline.
// When a new version is installed (DESIGN D36) the page reloads itself into it, unless
// you're mid-edit on a saved workout (then it waits). A live workout is safe in storage
// and reopens after the reload, like any other time the app opens.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch((err) => console.warn("No service worker:", err));
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return; // first install: this page is already current
    if (editor?.dirty && editor.draft.mode !== "live") { updateWaiting = true; toast("Update ready: it loads when you close this workout"); return; }
    reloading = true;
    location.reload(); // a live workout reopens by itself (D56)
  });
}
