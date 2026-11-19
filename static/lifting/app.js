// Lifting app: tabs, workout list, workout editor, exercise picker, progress, settings.
// All data goes through the Cortex core (saved on this device first, synced in the
// background). The maths and data shaping live in the pure modules imported below.
import * as cortex from "/core/cortex.js";
import { e1rm, dayKey, personalRecords, prKind, sessionSeries } from "/lifting/stats.js";
import { convert, showWeight, parseWeight, fmtNum } from "/lifting/units.js";
import { MUSCLES, resolveExercises, exerciseFor, exerciseId, newKey } from "/lifting/library.js";
import {
  EXERCISE, isSet, groupWorkouts, legacyPlan, defaultName, previousSets, volumeKg,
  newDraft, blankRow, draftFromWorkout, keptRows, commitPlan, deletePlan,
} from "/lifting/workouts.js";

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
let sets = [];           // just the sets
let workouts = [];       // grouped, newest first
let lib = new Map();     // exercise key -> definition
let unit = "lb";         // display unit (setting)
let tab = "log";
let historyShown = 40;
let progressKey = null;
let chartMetric = "e1rm"; // which line the exercise charts show: e1rm | heaviest | volume
let editor = null;       // { draft, original, dirty, menus:Set, notes:Set }

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

let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3200);
}

// The live workout draft lives in this device's storage until Finish (DESIGN D25).
function loadLive() {
  try { return JSON.parse(localStorage.getItem(LIVE_KEY)); } catch { return null; }
}
function saveLive(draft) {
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(draft)); } catch (err) { console.warn(err); }
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
document.querySelector("nav.tabbar").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-tab]");
  if (!b) return;
  history.replaceState(history.state, "", `#${b.dataset.tab}`);
  showTab(b.dataset.tab);
  scrollTo(0, 0);
});

function render() {
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
      const all = w.exercises.flatMap((x) => x.sets);
      const meta = [fmtDuration(w.duration_min), all.length ? `${Math.round(convert(volumeKg(all), "kg", unit)).toLocaleString()} ${unit}` : "", `${all.length} sets`]
        .filter(Boolean).join(" · ");
      html += `<button class="card wcard" data-act="open" data-id="${esc(w.id)}">
        <div class="head"><span class="name">${esc(w.name)}</span><span class="muted small">${esc(fmtDate(w.start))}</span></div>
        <div class="muted small">${esc(meta)}</div>
        <div class="lines">${w.exercises.filter((x) => x.sets.length).map((x) => {
          const b = bestSet(x.sets);
          return `<div class="line"><span>${x.sets.length} × ${esc(exName(x.key))}</span><span>${b ? esc(setText(b)) : ""}</span></div>`;
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
function openEditor(draft, original) {
  if (!draft) return;
  editor = { draft, original, dirty: false, menus: new Set(), notes: new Set(), setMenu: null };
  history.pushState({ ui: "editor" }, "", location.hash);
  $("editor").hidden = false;
  $("editor").scrollTop = 0;
  document.body.style.overflow = "hidden";
  renderEditor();
}

function closeEditor() {
  editor = null;
  $("editor").hidden = true;
  $("picker").hidden = true;
  document.body.style.overflow = "";
  render();
}

// Overlay screens that sit on top of everything (including the editor). Each is one
// browser-history step, so the phone's back button closes the top one.
const OVERLAYS = { picker: "picker", exercise: "exsheet", settings: "settings" };
function openOverlay(ui) {
  history.pushState({ ui }, "", location.hash);
  const el = $(OVERLAYS[ui]);
  el.hidden = false;
  el.scrollTop = 0;
  document.body.style.overflow = "hidden";
  return el;
}

addEventListener("popstate", (ev) => {
  const ui = ev.state?.ui;
  for (const [name, id] of Object.entries(OVERLAYS)) if (ui !== name) $(id).hidden = true;
  if (!editor && !ui) document.body.style.overflow = "";
  if (editor && !ui) {
    // A live workout is safe in storage; an edit with unsaved changes asks first.
    if (editor.dirty && editor.draft.mode !== "live" && !confirm("Discard your changes?")) {
      history.pushState({ ui: "editor" }, "", location.hash);
      return;
    }
    closeEditor();
  }
});

// ---------- Editor ----------

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

function renderEditor() {
  const { draft: d } = editor;
  const live = d.mode === "live";
  const body = $("editor");
  const scroll = body.scrollTop;
  const title = live ? `<span data-clock="${esc(d.start)}">${fmtClock(Date.now() - new Date(d.start))}</span>`
    : d.mode === "past" ? "Add past workout" : "Edit workout";
  const h = d.duration_min != null ? Math.floor(d.duration_min / 60) : "";
  const m = d.duration_min != null ? d.duration_min % 60 : "";

  let html = `<div class="wrap">
    <div class="sheet-top">
      <button class="back" data-act="close" aria-label="Back">‹</button>
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
    const prev = previousSets(workouts, ex.key, d.start, d.id);
    const showNotes = ex.notes || editor.notes.has(xi);
    html += `<section class="ex" data-x="${xi}">
      <div class="ex-head">
        <button class="exname" data-act="exinfo">${esc(exName(ex.key))}</button>
        <button class="ghost" data-act="exmenu" aria-label="Exercise options">•••</button>
      </div>
      ${editor.menus.has(xi) ? `<div class="ex-menu">
        <button class="secondary" data-act="exnote">Add note</button>
        <button class="secondary danger" data-act="exremove">Remove</button></div>` : ""}
      ${showNotes ? `<textarea data-f="exnotes" rows="1" placeholder="Notes for ${esc(exName(ex.key))}">${esc(ex.notes)}</textarea>` : ""}
      <div class="grid ${live ? "live" : "edit"}">
        <div class="ghead">Set</div><div class="ghead l">Previous</div><div class="ghead">${esc(d.unit)}</div><div class="ghead">Reps</div>${live ? `<div class="ghead">✓</div>` : ""}
      </div>`;
    ex.sets.forEach((r, si) => {
      // Hints only in a live workout, where ticking an empty row uses them. Elsewhere an
      // empty row isn't saved, so a greyed-out number would look saved when it isn't.
      const hint = live ? hintFor(xi, si) : { weight: "", reps: "" };
      const p = prev[si];
      html += `<div class="grid setrow ${live ? "live" : "edit"}${r.done && live ? " done" : ""}" data-s="${si}">
        <button class="setno" data-act="setmenu" aria-label="Set ${si + 1} options">${r.pr ? "🏆" : si + 1}${r.rpe != null ? `<small>@${r.rpe}</small>` : ""}</button>
        <button class="prev" data-act="useprev" ${p ? "" : "disabled"}>${p ? esc(setText(p)) : "—"}</button>
        <input data-f="weight" inputmode="decimal" value="${esc(r.weight)}" placeholder="${esc(hint.weight)}" aria-label="Weight">
        <input data-f="reps" inputmode="numeric" value="${esc(r.reps)}" placeholder="${esc(hint.reps)}" aria-label="Reps">
        ${live ? `<button class="tick" data-act="tick" aria-pressed="${r.done}" aria-label="Set done">✓</button>` : ""}
      </div>`;
      if (editor.setMenu === `${xi}:${si}`) {
        html += `<div class="setmenu" data-s="${si}">
          <div class="small"><b>Effort (RPE)</b> <span class="muted">· ${r.rpe != null ? `${r.rpe}: ${RPE_TEXT[r.rpe]}` : "how many more reps could you have done?"}</span></div>
          <div class="chips">${RPES.map((v) => `<button class="chip${r.rpe === v ? " on" : ""}" data-act="rpe" data-v="${v}">${v}</button>`).join("")}</div>
          <div class="ex-menu">
            ${r.rpe != null ? `<button class="secondary" data-act="rpe" data-v="">Clear RPE</button>` : ""}
            <button class="secondary danger" data-act="delset">Delete set</button>
          </div></div>`;
      }
    });
    html += `<button class="addset" data-act="addset">+ Add set</button></section>`;
  });

  html += `<div class="addex"><button class="secondary" data-act="addex">+ Add exercise</button></div>
    <div style="margin-top:28px;text-align:center">
      ${live ? `<button class="ghost danger" data-act="discard">Discard workout</button>` : ""}
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
  else if (f === "date") {
    if (!el.value) return;
    const old = new Date(d.start);
    const [y, mo, day] = el.value.split("-").map(Number);
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

$("editor").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b || !editor) return;
  const d = editor.draft;
  const xi = Number(b.closest("[data-x]")?.dataset.x);
  const si = Number(b.closest("[data-s]")?.dataset.s);
  const ex = d.exercises[xi];
  switch (b.dataset.act) {
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
    case "rpe":
      ex.sets[si].rpe = b.dataset.v === "" ? null : Number(b.dataset.v);
      break;
    case "delset":
      ex.sets.splice(si, 1);
      editor.setMenu = null;
      break;
    case "useprev": {
      const p = previousSets(workouts, ex.key, d.start, d.id)[si];
      if (!p) return;
      Object.assign(ex.sets[si], { weight: showWeight(p.value, p.unit, d.unit), reps: String(p.data?.reps ?? "") });
      break;
    }
    case "tick": tick(xi, si); break;
    case "exmenu": editor.menus.has(xi) ? editor.menus.delete(xi) : editor.menus.add(xi); renderEditor(); return;
    case "exnote": editor.notes.add(xi); editor.menus.delete(xi); renderEditor(); return;
    case "exremove":
      if (ex.sets.some((r) => r.weight || r.reps) && !confirm(`Remove ${exName(ex.key)} and its sets?`)) return;
      d.exercises.splice(xi, 1);
      editor.menus.clear(); editor.notes.clear(); editor.setMenu = null;
      break;
    case "discard":
      if (!confirm("Discard this workout? Nothing from it will be saved.")) return;
      clearLive(); editor.dirty = false; history.back();
      return;
    case "delete":
      if (!confirm("Delete this workout and all its sets?")) return;
      await cortex.putEntries(deletePlan(editor.original));
      editor.dirty = false; history.back(); toast("Workout deleted");
      return;
    default: return;
  }
  changed();
  renderEditor();
});

// Tick a set done. Empty boxes take the greyed-out hint, so repeating last time is one tap.
function tick(xi, si) {
  const d = editor.draft, ex = d.exercises[xi], r = ex.sets[si];
  if (r.done) { r.done = false; r.pr = null; return; }
  const hint = hintFor(xi, si);
  const weight = r.weight || hint.weight, reps = r.reps || hint.reps;
  const w = parseWeight(weight), n = Number(reps);
  if (Number.isNaN(w) || !Number.isInteger(n) || n < 1) { toast("Enter the weight and reps first"); return; }
  Object.assign(r, { weight, reps, done: true, at: new Date().toISOString() });

  // PR check against every earlier set of this exercise, including earlier ones today.
  const earlier = [
    ...sets.filter((s) => s.metric === ex.key && s.recorded_at < r.at),
    ...ex.sets.filter((o) => o !== r && o.done).map((o) => ({ value: parseWeight(o.weight), unit: d.unit, data: { reps: Number(o.reps) }, recorded_at: o.at })),
  ];
  const kind = prKind({ value: w, unit: d.unit, data: { reps: n }, recorded_at: r.at }, earlier);
  r.pr = kind;
  if (kind === "e1rm") toast(`🏆 New best: ~${fmtNum(Math.round(convert(e1rm(convert(w, d.unit, "kg"), n), "kg", d.unit) * 10) / 10)} ${d.unit} estimated 1RM`);
  else if (kind === "reps") toast(`🏆 Rep PR: heaviest ${n}-rep set yet`);
  if (navigator.vibrate) navigator.vibrate(kind ? [30, 60, 30] : 25);
}

async function saveEditor() {
  const d = editor.draft;
  const total = d.exercises.reduce((n, x) => n + keptRows(d, x).length, 0);
  if (d.mode === "live") {
    const unticked = d.exercises.reduce((n, x) => n + x.sets.filter((r) => !r.done && (r.weight || r.reps)).length, 0);
    if (!total) {
      if (confirm("No sets are ticked off yet. Discard this workout?")) { clearLive(); editor.dirty = false; history.back(); }
      return;
    }
    if (unticked && !confirm(`${unticked} set${unticked > 1 ? "s aren't" : " isn't"} ticked off and won't be saved. Finish anyway?`)) return;
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
  toast(d.mode === "edit" ? "Workout updated" : `Workout saved · ${total} sets`);
}

// ---------- Exercise picker ----------

function openPicker() {
  openOverlay("picker").innerHTML = `<div class="wrap">
    <div class="sheet-top">
      <button class="back" data-act="pkclose" aria-label="Back">‹</button>
      <input class="pk-search" id="pksearch" placeholder="Search or create" autocomplete="off" enterkeyhint="search">
      <span></span>
    </div>
    <div id="pklist" class="sheet-body" style="padding-top:4px"></div></div>`;
  renderPicker();
  $("pksearch").addEventListener("input", renderPicker);
}

function renderPicker() {
  const q = ($("pksearch")?.value || "").trim();
  const ql = q.toLowerCase();
  const inWorkout = new Set(editor?.draft.exercises.map((x) => x.key));
  const all = [...lib.values()].filter((x) => !x.hidden);
  for (const s of sets) if (!lib.has(s.metric) && !all.some((x) => x.key === s.metric)) all.push(exerciseFor(lib, s.metric));
  const match = (x) => !ql || x.name.toLowerCase().includes(ql);
  const item = (x) => `<button class="pkitem" data-key="${esc(x.key)}" ${inWorkout.has(x.key) ? "disabled" : ""}>
      <span>${esc(x.name)}</span><small>${esc(MUSCLES[x.primary] || "")}</small></button>`;

  let html = "";
  if (q && !all.some((x) => x.name.toLowerCase() === ql)) {
    html += `<button class="pkitem create" data-create="${esc(q)}">+ Create “${esc(q)}”</button>`;
  }
  const recent = [...new Set(workouts.flatMap((w) => w.exercises.map((x) => x.key)))].slice(0, 8)
    .map((k) => exerciseFor(lib, k)).filter(match);
  if (recent.length && !q) html += `<h2>Recent</h2>` + recent.map(item).join("");
  const rest = all.filter(match).sort((a, b) => a.name.localeCompare(b.name));
  html += `<h2>${q ? "Results" : "All exercises"}</h2>` + (rest.map(item).join("") || `<p class="empty">No match.</p>`);
  $("pklist").innerHTML = html;
}

$("picker").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b || !editor) return;
  if (b.dataset.act === "pkclose") { history.back(); return; }
  let key = b.dataset.key;
  if (b.dataset.create) {
    const name = b.dataset.create.trim().slice(0, 60);
    key = newKey(name, new Set([...lib.keys(), ...sets.map((s) => s.metric)]));
    await cortex.putEntries([{ client_id: exerciseId(key), module: "lifting", metric: EXERCISE, data: { key, name, primary: null, secondary: [] } }]);
    lib.set(key, { key, name, equipment: null, primary: null, secondary: [], custom: true, hidden: false });
  }
  if (!key) return;
  const d = editor.draft;
  const n = Math.max(1, previousSets(workouts, key, d.start, d.id).length);
  d.exercises.push({ key, notes: "", sets: Array.from({ length: n }, () => blankRow(cortex.newId())) });
  changed();
  history.back(); // closes the picker
  renderEditor();
  requestAnimationFrame(() => $("editor").scrollTo({ top: $("editor").scrollHeight }));
});

// ---------- Exercise detail (Progress tab, and the screen behind an exercise's name) ----------

const METRICS = {
  e1rm: { label: "Est. 1RM", hero: "best estimated 1RM" },
  heaviest: { label: "Heaviest", hero: "heaviest weight" },
  volume: { label: "Volume", hero: "best session volume" },
};

// Everything about one exercise: a per-session chart (est. 1RM, heaviest or volume),
// records, and every session it was done in.
function renderExerciseInto(el, key) {
  const mine = sets.filter((s) => s.metric === key);
  if (!mine.length) { el.innerHTML = `<p class="empty">No sets of ${esc(exName(key))} yet.</p>`; return; }
  const series = sessionSeries(mine);
  const { best, reps } = personalRecords(mine);
  const top = series.reduce((a, d) => (d[chartMetric] > a[chartMetric] ? d : a), series[0]);
  const first = series[0];
  const gain = series.length > 1 ? top[chartMetric] - first[chartMetric] : 0;
  const sessions = workouts.filter((w) => w.exercises.some((x) => x.key === key && x.sets.length));

  el.innerHTML = `
    <div class="chips" role="group" aria-label="Chart">${Object.entries(METRICS).map(([k, m]) =>
      `<button class="chip${k === chartMetric ? " on" : ""}" data-metric="${k}">${m.label}</button>`).join("")}</div>
    <div class="hero">
      <div class="label">${esc(exName(key))} · ${METRICS[chartMetric].hero}</div>
      <div class="big">${top[chartMetric] ? fmtW(top[chartMetric]) : "—"} <small>${unit}</small></div>
      <div class="sub">${esc(fmtDayKey(top.day))}${gain > 0 ? ` · +${fmtW(gain)} ${unit} since ${esc(fmtDayKey(first.day))}` : ""}</div>
    </div>
    <div class="chart"></div>
    <h2>Records</h2>
    <ul class="list">
      ${best ? `<li><span>Best est. 1RM</span><span>${fmtW(best.e1rm)} ${unit} <span class="muted small">(${fmtW(best.weight)} × ${best.reps})</span></span></li>` : ""}
      <li><span>Sessions · sets</span><span>${series.length} · ${mine.length}</span></li>
    </ul>
    ${reps.length ? `<h2>Rep records</h2>
    <table>
      <thead><tr><th>Reps</th><th class="r">Heaviest</th><th class="r">Est. 1RM</th><th class="r">Date</th></tr></thead>
      <tbody>${reps.map((r) => `<tr>
        <td>${r.reps}</td><td class="r">${fmtW(r.weight)} ${unit}</td>
        <td class="r">${fmtW(r.e1rm)}</td><td class="r">${esc(fmtDayKey(dayKey(r.recorded_at)))}</td>
      </tr>`).join("")}</tbody>
    </table>` : ""}
    <h2>History</h2>
    ${sessions.map((w) => {
      const x = w.exercises.find((e) => e.key === key);
      return `<div class="card hist">
        <div class="head"><b>${esc(w.name)}</b><span class="muted small">${esc(fmtDate(w.start))}</span></div>
        ${x.notes ? `<div class="notes">${esc(x.notes)}</div>` : ""}
        ${x.sets.map((st, i) => `<div class="line"><span class="muted">${i + 1}</span><span>${esc(setText(st))}</span></div>`).join("")}
      </div>`;
    }).join("")}`;

  const points = series.map((d) => ({
    day: d.day, v: convert(d[chartMetric], "kg", unit),
    sub: chartMetric === "volume" ? `${d.sets} sets` : d.best ? `${fmtW(d.best.weight)}×${d.best.reps}` : "",
  })).filter((p) => p.v > 0);
  drawChart(el.querySelector(".chart"), points);
}

function renderProgress() {
  const keys = [...new Set(sets.slice().sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1)).map((s) => s.metric))];
  if (!keys.includes(progressKey)) progressKey = keys[0] ?? null;
  $("pchips").innerHTML = keys.map((k) =>
    `<button class="chip${k === progressKey ? " on" : ""}" data-k="${esc(k)}">${esc(exName(k))}</button>`).join("");
  if (!progressKey) {
    $("pbody").innerHTML = `<p class="empty">Log a workout and your progress shows up here.</p>`;
    return;
  }
  renderExerciseInto($("pbody"), progressKey);
}

$("pchips").addEventListener("click", (ev) => {
  const k = ev.target.closest("[data-k]")?.dataset.k;
  if (k) { progressKey = k; renderProgress(); }
});

let exsheetKey = null;
function openExercise(key) {
  exsheetKey = key;
  openOverlay("exercise").innerHTML = `<div class="wrap">
    <div class="sheet-top">
      <button class="back" data-act="close" aria-label="Back">‹</button>
      <div class="title">${esc(exName(key))}</div><span></span>
    </div>
    <div class="sheet-body" id="exbody"></div></div>`;
  renderExerciseInto($("exbody"), key);
}

// Chart chips and the back button work the same in both places.
for (const id of ["pbody", "exsheet"]) {
  $(id).addEventListener("click", (ev) => {
    if (ev.target.closest("[data-act=close]")) { history.back(); return; }
    const m = ev.target.closest("[data-metric]")?.dataset.metric;
    if (!m) return;
    chartMetric = m;
    if (id === "pbody") renderProgress(); else renderExerciseInto($("exbody"), exsheetKey);
  });
}

// Hand-drawn SVG line chart (DESIGN D19): one point per session, x = real time.
// points: [{ day: "YYYY-MM-DD", v: number in display unit, sub: extra tooltip text }]
function drawChart(el, points) {
  if (points.length < 2) {
    el.innerHTML = `<p class="empty">One session so far. Log another day to see a trend line.</p>`;
    return;
  }
  const W = el.clientWidth || 340, H = 220;
  const pad = { l: 48, r: 12, t: 40, b: 26 };
  const t = points.map((d) => new Date(noonOf(d.day)).getTime());
  const v = points.map((d) => d.v);
  let lo = Math.min(...v), hi = Math.max(...v);
  if (hi - lo < 5) { lo -= 2.5; hi += 2.5; }
  const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw);
  lo = Math.max(0, Math.floor(lo / step) * step); hi = Math.ceil(hi / step) * step;
  const x = (ms) => pad.l + (ms - t[0]) / (t.at(-1) - t[0]) * (W - pad.l - pad.r);
  const y = (val) => pad.t + (hi - val) / (hi - lo) * (H - pad.t - pad.b);
  const r1 = (n) => (n >= 1000 ? Math.round(n).toLocaleString() : fmtNum(Math.round(n * 10) / 10));
  const grid = [];
  for (let g = lo; g <= hi + 1e-9; g += step) {
    grid.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(g)}" y2="${y(g)}" stroke="var(--grid)" stroke-width="1"/>
      <text x="${pad.l - 8}" y="${y(g) + 4}" text-anchor="end">${r1(g)}</text>`);
  }
  const xLabels = [0, t.length - 1].map((i) =>
    `<text x="${x(t[i])}" y="${H - 6}" text-anchor="${i === 0 ? "start" : "end"}">${esc(fmtDayKey(points[i].day))}</text>`);
  const path = t.map((ms, i) => `${i ? "L" : "M"}${x(ms).toFixed(1)},${y(v[i]).toFixed(1)}`).join("");
  const dots = t.map((ms, i) => `<circle cx="${x(ms)}" cy="${y(v[i])}" r="4" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>`).join("");
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Per-session chart">
      ${grid.join("")}${xLabels.join("")}
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <line class="cross" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>
      ${dots}
      <circle class="focus" r="6" fill="var(--accent)" stroke="var(--text)" stroke-width="2" visibility="hidden"/>
    </svg>
    <div class="tip" hidden></div>`;
  const svg = el.querySelector("svg"), cross = el.querySelector(".cross"), focus = el.querySelector(".focus"), tip = el.querySelector(".tip");
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = (clientX - r.left) * (W / r.width);
    let i = 0;
    for (let k = 1; k < t.length; k++) if (Math.abs(x(t[k]) - px) < Math.abs(x(t[i]) - px)) i = k;
    const cx = x(t[i]), cy = y(v[i]);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    focus.setAttribute("cx", cx); focus.setAttribute("cy", cy); focus.setAttribute("visibility", "visible");
    const d = points[i];
    tip.innerHTML = `<b>${r1(d.v)} ${unit}</b> <span>· ${esc(d.sub)}${d.sub ? " · " : ""}${esc(fmtDayKey(d.day))}</span>`;
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
    else if (tab === "progress") renderProgress();
  }, 150);
});

// ---------- Exercises tab (browse for now; creating and editing comes next) ----------

function renderExercises() {
  const counts = new Map();
  for (const s of sets) counts.set(s.metric, (counts.get(s.metric) || 0) + 1);
  const all = [...lib.values()].filter((x) => !x.hidden);
  for (const k of counts.keys()) if (!lib.has(k)) all.push(exerciseFor(lib, k));
  const groups = new Map([...Object.keys(MUSCLES), "other"].map((m) => [m, []]));
  for (const x of all) groups.get(MUSCLES[x.primary] ? x.primary : "other").push(x);
  let html = `<p class="muted small">Creating, editing and merging exercises comes next. You can already create one from the “Add exercise” search while logging.</p>`;
  for (const [m, list] of groups) {
    if (!list.length) continue;
    html += `<h2>${esc(MUSCLES[m] || "Other")}</h2><ul class="list">` + list.sort((a, b) => a.name.localeCompare(b.name)).map((x) =>
      `<li><button class="rowbtn" data-key="${esc(x.key)}"><span>${esc(x.name)}${x.custom ? ` <span class="muted small">· yours</span>` : ""}</span><span class="muted small">${counts.get(x.key) ? `${counts.get(x.key)} sets` : esc(x.equipment || "")}</span></button></li>`
    ).join("") + `</ul>`;
  }
  $("view-exercises").innerHTML = html;
}

$("view-exercises").addEventListener("click", (ev) => {
  const k = ev.target.closest("[data-key]")?.dataset.key;
  if (k) openExercise(k);
});

// ---------- Profile tab + settings screen ----------

function renderProfile() {
  $("view-profile").innerHTML = `<p class="empty">Your profile (workout calendar, lifetime stats, picture) is coming later. Settings are behind the ⚙ button at the top.</p>`;
}

function renderSettings() {
  $("settings").innerHTML = `<div class="wrap">
    <div class="sheet-top">
      <button class="back" data-act="close" aria-label="Back">‹</button>
      <div class="title">Settings</div><span></span>
    </div>
    <div class="sheet-body">
      <ul class="list">
        <li><span>Weight unit<br><span class="muted small">Lifts and bodyweight. Saved sets keep the unit they were logged in.</span></span>
          <span class="seg" role="group" aria-label="Weight unit">
            <button data-unit="lb" aria-pressed="${unit === "lb"}">lb</button>
            <button data-unit="kg" aria-pressed="${unit === "kg"}">kg</button>
          </span></li>
      </ul>
    </div></div>`;
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
  workouts = groupWorkouts(entries);
  lib = resolveExercises(entries.filter((e) => e.metric === EXERCISE));
  if (!editor) render();
  if (!$("picker").hidden) renderPicker();
  if (!$("exsheet").hidden && exsheetKey) renderExerciseInto($("exbody"), exsheetKey);
  await showSync();
}

// Live clocks (the workout timer and the "in progress" card) tick every second.
setInterval(() => {
  document.querySelectorAll("[data-clock]").forEach((el) => {
    el.textContent = fmtClock(Date.now() - new Date(el.dataset.clock));
  });
}, 1000);

cortex.onChange(refresh);
if (history.state?.ui) history.replaceState(null, "", location.hash); // a reload closes any open editor
showTab((location.hash || "#log").slice(1));
refresh().then(() => cortex.startAutoSync());

// The service worker keeps the app shell on the device so this page opens offline.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("No service worker:", err));
}
