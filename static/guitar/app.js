// Guitar tuner page. Audio stays on the device: the mic feeds an analyser, nothing is recorded or sent.
// Custom tunings are Cortex entries (module=guitar, metric=_tuning), so they sync like everything else (D44).
import * as cortex from "/core/cortex.js";
import { ask, cancelAsk, toast, keepUpdated } from "/core/ui.js";
import { detectPitch } from "./pitch.js";
import { TUNINGS, noteText, parseNote, midiToFreq, centsOff, nearestNote, closestString, median, display } from "./music.js";

const $ = (id) => document.getElementById(id);
const IN_TUNE = 3;   // cents: green
const NEAR = 12;     // cents: amber
const HOLD_MS = 500; // in tune this long marks the string done

// Per-device preferences (DESIGN D43): plain localStorage, guarded.
const pref = {
  get(k, d) { try { const v = localStorage.getItem("guitar:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("guitar:" + k, JSON.stringify(v)); } catch {} },
};

const TUNING = "_tuning";
let custom = [];            // the player's own tunings: { id, name, notes, custom: true }
const allTunings = () => [...TUNINGS, ...custom];
let tuning = TUNINGS.find((t) => t.id === pref.get("tuning", "standard")) || TUNINGS[1];
let a4 = pref.get("a4", 440);
let locked = null;          // string index the player picked, or null for auto
let current = null;         // string index being tuned right now
let done = new Set();       // strings that have been in tune this session
let recent = [];            // last few detected frequencies, for a steady median
let lastHeard = 0, inTuneSince = 0, muteUntil = 0, frame = 0;
let ctx = null, analyser = null, stream = null, buf = null, raf = 0, wake = null;

const ICON = {
  up: '<svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  pencil: '<svg class="i" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
};
const noteLabel = (n) => { const d = display(n); return `${d.name}<sub>${d.octave}</sub>`; };
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- Static UI ----------

// Meter geometry: the needle pivots at (CX, CY); the scale is an arc of radius R spanning 2 x SWEEP degrees
// for -50..+50 cents.
const CX = 200, CY = 214, R = 176, SWEEP = 62;
const rad = (c) => ((Math.max(-50, Math.min(50, c)) / 50) * SWEEP - 90) * Math.PI / 180;
const pt = (c, r = R) => [CX + r * Math.cos(rad(c)), CY + r * Math.sin(rad(c))];
const f1 = (n) => n.toFixed(1);
function arc(c1, c2, r = R) { // c1 < c2, drawn clockwise
  const [x1, y1] = pt(c1, r), [x2, y2] = pt(c2, r);
  return `M${f1(x1)} ${f1(y1)}A${r} ${r} 0 0 1 ${f1(x2)} ${f1(y2)}`;
}

function drawGauge() {
  let s = `<defs><filter id="blur" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="9"/></filter></defs>`;
  // Coloured zones just inside the ticks: pink far, amber close, green in tune.
  const zones = [[-50, -NEAR, "far"], [-NEAR, -IN_TUNE, "near"], [-IN_TUNE, IN_TUNE, "in"], [IN_TUNE, NEAR, "near"], [NEAR, 50, "far"]];
  for (const [a, b, k] of zones) s += `<path class="zone z-${k}" d="${arc(a, b, R - 16)}"/>`;
  // Ticks every cent; longer every 5, longest with a number every 10.
  for (let c = -50; c <= 50; c++) {
    const kind = c === 0 ? "m0" : c % 10 === 0 ? "m10" : c % 5 === 0 ? "m5" : "";
    const len = c === 0 ? 22 : c % 10 === 0 ? 16 : c % 5 === 0 ? 11 : 6;
    const [x1, y1] = pt(c, R - 8), [x2, y2] = pt(c, R - 8 + len);
    s += `<line class="tk ${kind}" stroke-width="${kind ? "" : 1.2}" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`;
    if (c % 10 === 0) {
      const [x, y] = pt(c, R + 26);
      s += `<text class="num${c ? "" : " zero"}" x="${f1(x)}" y="${f1(y + 4)}">${c > 0 ? "+" + c : c}</text>`;
    }
  }
  const [lx, ly] = pt(-50, R - 40), [rx, ry] = pt(50, R - 40);
  s += `<text class="sym" x="${f1(lx + 8)}" y="${f1(ly + 8)}">♭</text><text class="sym" x="${f1(rx - 8)}" y="${f1(ry + 8)}">♯</text>`;
  // Needle: tapered, with a short tail past the pivot, a soft glow, and a cap over the pivot.
  s += `<g id="needle">
    <polygon class="glow" filter="url(#blur)" points="${CX - 5},${CY} ${CX},${CY - R + 2} ${CX + 5},${CY}"/>
    <polygon class="needle" points="${CX - 5},${CY + 18} ${CX - 3.2},${CY} ${CX - 0.9},${CY - R + 4} ${CX + 0.9},${CY - R + 4} ${CX + 3.2},${CY} ${CX + 5},${CY + 18}"/>
  </g><circle class="cap" cx="${CX}" cy="${CY}" r="13"/><circle class="capdot" cx="${CX}" cy="${CY}" r="4"/>`;
  $("gauge").innerHTML = s;
}

// The needle moves like a real meter: a spring pulls it to the reading, with a little overshoot
// that settles in a few frames. At rest (nothing heard) it returns to the centre, dimmed.
let targetCents = null, pos = 0, vel = 0;
function drawMeter() {
  const goal = targetCents == null ? 0 : Math.max(-52, Math.min(52, targetCents));
  vel = vel * 0.7 + (goal - pos) * 0.12;
  pos += vel;
  const deg = (Math.max(-52, Math.min(52, pos)) / 50) * SWEEP;
  $("needle").setAttribute("transform", `rotate(${deg.toFixed(2)} ${CX} ${CY})`);
}
// Keep the needle animating while the mic is off (e.g. returning to centre).
function idleAnimate() {
  if (raf) return;
  const step = () => {
    drawMeter();
    raf = Math.abs(pos) > 0.05 || Math.abs(vel) > 0.05 ? requestAnimationFrame(step) : 0;
  };
  raf = requestAnimationFrame(step);
}

function renderTunings() {
  $("tunname").textContent = tuning.name;
}

function setTuning(t) {
  tuning = t;
  pref.set("tuning", t.id);
  locked = current = null;
  done = new Set();
  renderTunings(); renderStrings(); show(null);
}

function renderStrings() {
  const chromatic = !tuning.notes.length;
  const count = tuning.notes.length;
  $("strings").hidden = chromatic;
  $("strings").style.gridTemplateColumns = `repeat(${Math.max(count, 4)}, 1fr)`;
  $("strings").innerHTML = tuning.notes.map((n, i) => {
    const cls = ["str", i === locked ? "locked" : i === current ? "active" : "", done.has(i) ? "done" : ""].join(" ");
    return `<button class="${cls}" data-i="${i}" aria-label="String ${count - i}, ${display(n).name}${done.has(i) ? ", tuned" : ""}">${display(n).name}</button>`;
  }).join("");
  $("hint").textContent = chromatic ? "Shows the nearest note to whatever you play"
    : locked !== null ? `Locked to string ${count - locked}. Tap it again for auto.`
    : "Auto: picks the closest string. Tap a string to lock it.";
  $("ref").disabled = chromatic;
}

function renderA4() { $("a4").textContent = `A4 ${a4} Hz`; }

// ---------- Live reading ----------

function show(freq) {
  const stage = $("stage");
  if (freq == null) {
    stage.className = "stage state-idle";
    targetCents = null;
    $("note").textContent = "–";
    $("nprev").textContent = $("nnext").textContent = "";
    $("status").textContent = tuning.notes.length ? "Play a string" : "Play a note";
    $("cents").textContent = "";
    if (current !== null && locked === null) { current = null; renderStrings(); }
    return;
  }
  let name, octave, cents, midi;
  if (!tuning.notes.length) {
    ({ name, octave, cents, midi } = nearestNote(freq, a4));
  } else {
    const i = locked ?? closestString(freq, tuning.notes, a4);
    if (i !== current) { current = i; inTuneSince = 0; renderStrings(); }
    const n = tuning.notes[i];
    ({ name, octave } = display(n));
    midi = parseNote(n);
    cents = centsOff(freq, midiToFreq(midi, a4));
  }
  // The notes either side: where the needle is heading if you go too far.
  $("nprev").textContent = display(noteText(midi - 1)).name;
  $("nnext").textContent = display(noteText(midi + 1)).name;
  const abs = Math.abs(cents);
  const state = abs <= IN_TUNE ? "in" : abs <= NEAR ? "near" : "far";
  targetCents = cents;
  stage.className = `stage state-${state} ${cents < 0 ? "flat" : "sharp"}`;
  $("note").innerHTML = `${name}<sub>${octave}</sub>`;
  // Too low means the string is too loose: tighten (tune up).
  $("status").innerHTML = state === "in" ? `${ICON.check} In tune`
    : cents < 0 ? `${ICON.up} Tune up` : `${ICON.down} Tune down`;
  const rc = Math.round(cents) || 0; // no "-0"
  $("cents").innerHTML = `${rc > 0 ? "+" : rc < 0 ? "−" : ""}${Math.abs(rc)}¢<small>${freq.toFixed(1)} Hz</small>`;

  if (state === "in" && current !== null) {
    if (!inTuneSince) inTuneSince = performance.now();
    else if (performance.now() - inTuneSince > HOLD_MS && !done.has(current)) {
      done.add(current);
      renderStrings();
      if (navigator.vibrate) navigator.vibrate(40);
    }
  } else inTuneSince = 0;
}

function tickLoop() {
  raf = requestAnimationFrame(tickLoop);
  drawMeter();
  if (++frame % 2) return; // ~30 readings a second is plenty and halves the CPU cost
  const now = performance.now();
  if (now < muteUntil) return; // ignore our own reference tone
  analyser.getFloatTimeDomainData(buf);
  const r = detectPitch(buf, ctx.sampleRate);
  if (r && r.clarity > 0.85) {
    // A jump of more than ~half a semitone means a new note: start the median over.
    if (recent.length && Math.abs(centsOff(r.freq, median(recent))) > 60) recent = [];
    recent.push(r.freq);
    if (recent.length > 5) recent.shift();
    lastHeard = now;
    show(median(recent));
  } else if (now - lastHeard > 600 && recent.length) {
    recent = [];
    show(null);
  }
}

// ---------- Microphone ----------

// Messages about the microphone appear under the meter (no full-screen start page, D47).
function micMessage(html, retry = true) {
  const m = $("micmsg");
  m.innerHTML = html + (retry ? `<button id="retry">Try again</button>` : "");
  m.hidden = false;
}

let starting = false;
async function start() {
  if (stream || starting) return;
  starting = true;
  try { await openMic(); } finally { starting = false; }
}

async function openMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    micMessage(`<span class="err">The microphone needs a secure page. Open Cortex through its Tailscale (https) address.</span>`, false);
    return;
  }
  let state = "unknown";
  try { state = (await navigator.permissions.query({ name: "microphone" })).state; } catch {}
  const slow = setTimeout(() => {
    micMessage(`<span>Waiting for microphone permission… (site setting: ${state})</span>`, false);
  }, 2500);
  try {
    // Phone voice processing would treat a guitar note as noise and squash it: turn it all off.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    clearTimeout(slow);
    // Which layer said no: Chrome's per-site setting ("denied") or something below it ("prompt"/"granted").
    const why = `${err.message}; site setting: ${state}`; // DOMException.message is read-only
    micMessage(`<span class="err">${err.name === "NotAllowedError"
      ? "The tuner can't use the microphone: access is blocked. Chrome only asks websites when its own Android microphone permission allows it."
      : "Couldn't open the microphone."}</span><span>(${why})</span>`);
    return;
  }
  clearTimeout(slow);
  $("micmsg").hidden = true;
  ctx = ctx && ctx.state !== "closed" ? ctx : new AudioContext();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 4096; // ~85 ms of sound: enough cycles of the low E (82 Hz)
  buf = new Float32Array(analyser.fftSize);
  ctx.createMediaStreamSource(stream).connect(analyser);
  // Browsers may keep audio paused until the first tap on the page; then one tap anywhere starts it.
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
    if (ctx.state === "suspended") {
      micMessage(`<span>Tap anywhere to start listening</span>`, false);
      addEventListener("pointerdown", () => { ctx.resume(); $("micmsg").hidden = true; }, { once: true });
    }
  }
  try { wake = await navigator.wakeLock?.request("screen"); } catch {}
  cancelAnimationFrame(raf);
  tickLoop();
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  wake?.release().catch(() => {});
  wake = null;
  recent = [];
  show(null);
  idleAnimate();
}

// Release the mic when the app is in the background; pick it up again on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { if (stream) { stop(); resumeOnShow = true; } }
  else if (resumeOnShow) { resumeOnShow = false; start(); }
});
let resumeOnShow = false;

// ---------- Reference tone ----------

function playTone(freq) {
  ctx = ctx && ctx.state !== "closed" ? ctx : new AudioContext();
  ctx.resume();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  // A pluck: quick attack, slow fade. Kept gentle on purpose.
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 2.3);
  muteUntil = performance.now() + 2400;
  recent = [];
}

// ---------- Events ----------

$("micmsg").addEventListener("click", (ev) => { if (ev.target.id === "retry") start(); });
// ---------- Sheets: tuning list and custom tuning editor ----------
// Each open sheet is a history entry, so the phone's back gesture closes it.

const open = [];
function openSheet(id) {
  if (!open.includes(id)) { open.push(id); history.pushState({ sheet: id }, ""); }
  $(id).hidden = false;
}
const closeSheet = () => history.back();
addEventListener("popstate", (ev) => { // close every sheet above the one we landed on
  cancelAsk();
  const keep = ev.state?.sheet;
  if (open.at(-1) === "editor" && keep !== "editor" && draftDirty()) {
    history.pushState({ sheet: "editor" }, ""); // stay put and ask first
    okToLeave().then((yes) => { if (yes) { draft = null; history.back(); } });
    return;
  }
  while (open.length && open.at(-1) !== keep) $(open.pop()).hidden = true;
});
for (const id of ["picker", "editor"])
  $(id).addEventListener("click", async (ev) => { // tap the dim area
    if (ev.target.id !== id) return;
    if (id === "editor" && !(await okToLeave())) return;
    if (id === "editor") draft = null;
    closeSheet();
  });

function renderPicker() {
  const row = (t) => `<div class="trow${t.id === tuning.id ? " on" : ""}">
      <button class="pick" data-pick="${escHtml(t.id)}">
        <span class="t"><b>${escHtml(t.name)}</b><small>${t.notes.length ? t.notes.map((n) => display(n).name).join(" ") : "Any note"}</small></span>
        ${t.id === tuning.id ? `<span class="mark">${ICON.check}</span>` : ""}
      </button>
      ${t.custom ? `<button class="edit" data-edit="${escHtml(t.id)}" aria-label="Edit ${escHtml(t.name)}">${ICON.pencil}</button>` : ""}
    </div>`;
  $("pickerpanel").innerHTML = `<div class="grab"></div><h2>Tuning</h2>
    ${row(TUNINGS[0])}
    <h3>Guitar</h3>${TUNINGS.slice(1).map(row).join("")}
    <h3>Your tunings</h3>${custom.map(row).join("")}
    <div class="trow"><button class="pick addrow" data-new="1"><span class="mark">${ICON.plus}</span><span class="t">New custom tuning</span></button></div>`;
}
$("tunbtn").addEventListener("click", () => { renderPicker(); openSheet("picker"); });
$("pickerpanel").addEventListener("click", (ev) => {
  const pick = ev.target.closest("[data-pick]"), edit = ev.target.closest("[data-edit]"), add = ev.target.closest("[data-new]");
  if (edit) openEditor(custom.find((t) => t.id === edit.dataset.edit));
  else if (add) openEditor(null);
  else if (pick) { setTuning(allTunings().find((t) => t.id === pick.dataset.pick)); closeSheet(); }
});

// The editor works on a draft: { id (null = new), name, midis: [low ... high] }.
let draft = null;
const MIN_MIDI = 23, MAX_MIDI = 79; // B0 .. G5: covers bass, baritone and high tunings

function openEditor(t) {
  const base = t || (tuning.notes.length ? tuning : TUNINGS[1]);
  draft = { id: t?.id || null, name: t?.name || "", midis: base.notes.map(parseNote) };
  draft.orig = JSON.stringify([draft.name, draft.midis]);
  renderEditor();
  openSheet("editor");
}
function renderEditor() {
  const n = draft.midis.length;
  $("editorpanel").innerHTML = `<div class="grab"></div><h2>${draft.id ? "Edit tuning" : "New tuning"}</h2>
    <label class="field">Name<input id="tname" maxlength="40" placeholder="e.g. Open E" value="${escHtml(draft.name)}"></label>
    <div class="countrow"><span>Strings</span>
      <div class="step"><button data-count="-1" aria-label="Fewer strings">−</button><span class="nt">${n}</span><button data-count="1" aria-label="More strings">+</button></div></div>
    ${draft.midis.map((m, i) => `<div class="srow"><span class="lab">String ${n - i}${i === 0 ? " · thickest" : i === n - 1 ? " · thinnest" : ""}</span>
      <div class="step"><button data-s="${i}" data-d="-1" aria-label="Lower string ${n - i}">−</button>
        <button class="nt" data-play="${i}" aria-label="Play ${display(noteText(m)).name}">${noteLabel(noteText(m))}</button>
        <button data-s="${i}" data-d="1" aria-label="Raise string ${n - i}">+</button></div></div>`).join("")}
    <p class="hint" style="text-align:left">Tap a note to hear it. Starts from ${escHtml(draft.id ? "your saved tuning" : (tuning.notes.length ? tuning.name : "Standard"))}.</p>
    <div class="actions"><button class="btn2" data-act="cancel">Cancel</button><button class="btn1" data-act="save">Save</button></div>
    ${draft.id ? `<button class="btndel" data-act="delete">Delete tuning</button>` : ""}`;
}
$("editorpanel").addEventListener("input", (ev) => { if (ev.target.id === "tname") draft.name = ev.target.value; });
$("editorpanel").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.d) {
    const i = Number(b.dataset.s);
    draft.midis[i] = Math.max(MIN_MIDI, Math.min(MAX_MIDI, draft.midis[i] + Number(b.dataset.d)));
    playTone(midiToFreq(draft.midis[i], a4));
  } else if (b.dataset.play) {
    playTone(midiToFreq(draft.midis[Number(b.dataset.play)], a4));
    return;
  } else if (b.dataset.count) {
    const m = draft.midis;
    if (b.dataset.count === "1" && m.length < 8) m.unshift(Math.max(MIN_MIDI, m[0] - 5)); // new low string, a fourth down
    if (b.dataset.count === "-1" && m.length > 4) m.shift();
  } else if (b.dataset.act === "cancel") { if (await okToLeave()) { draft = null; closeSheet(); } return; }
  else if (b.dataset.act === "save") { await saveDraft(); return; }
  else if (b.dataset.act === "delete") { await deleteDraft(); return; }
  renderEditor();
});

const draftDirty = () => draft && JSON.stringify([draft.name, draft.midis]) !== draft.orig;
const draftNotes = () => draft.midis.map((m) => display(noteText(m)).name).join(" ");

// Leaving the editor with changes asks first. Resolves true if it's fine to close.
async function okToLeave() {
  if (!draftDirty()) return true;
  return ask(draft.id ? "Discard your changes?" : "Discard this tuning?",
    draft.id ? "Your edits to this tuning won't be saved." : "It won't be saved.",
    { yes: "Discard", no: "Keep editing", danger: true });
}

async function saveDraft() {
  const name = draft.name.trim() || draftNotes();
  const isNew = !draft.id;
  const ok = await ask(isNew ? `Create “${name}”?` : `Save changes to “${name}”?`,
    `Strings, thickest to thinnest: ${draftNotes()}`, { yes: isNew ? "Create" : "Save" });
  if (!ok) return;
  const id = draft.id || `tuning:${cortex.newId()}`;
  const notes = draft.midis.map(noteText);
  await cortex.putEntries([{ client_id: id, module: "guitar", metric: TUNING, data: { name, notes } }]);
  draft = null;
  await loadCustom();
  setTuning(allTunings().find((t) => t.id === id));
  history.go(-2); // close the editor and the list
  toast(isNew ? `Created “${name}”` : `Saved “${name}”`);
}
async function deleteDraft() {
  const name = draft.name.trim() || draftNotes();
  if (!(await ask(`Delete “${name}”?`, "This can't be undone.", { yes: "Delete", danger: true }))) return;
  const id = draft.id;
  draft = null;
  await cortex.deleteEntry(id);
  await loadCustom();
  if (tuning.id === id) setTuning(TUNINGS[1]);
  closeSheet();
  renderPicker();
  toast(`Deleted “${name}”`);
}

async function loadCustom() {
  const rows = await cortex.listEntries({ module: "guitar", metric: TUNING, limit: Infinity });
  custom = rows
    .filter((e) => Array.isArray(e.data?.notes) && e.data.notes.length)
    .map((e) => ({ id: e.client_id, name: e.data.name || "Custom", notes: e.data.notes, custom: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // The saved choice may be a custom tuning that only just loaded, was edited, or was deleted on another device.
  const found = allTunings().find((t) => t.id === pref.get("tuning", "standard"));
  if (!found) { if (tuning.custom) setTuning(TUNINGS[1]); }
  else if (found.id !== tuning.id || found.notes.join() !== tuning.notes.join()) setTuning(found);
  else { tuning = found; renderTunings(); }
  if (!$("picker").hidden) renderPicker();
}
$("strings").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-i]");
  if (!b) return;
  const i = Number(b.dataset.i);
  locked = locked === i ? null : i;
  current = locked;
  inTuneSince = 0;
  renderStrings();
});
$("ref").addEventListener("click", () => {
  if (!tuning.notes.length) return;
  const i = locked ?? current ?? 0;
  if (locked === null && current === null) { current = 0; renderStrings(); }
  playTone(midiToFreq(parseNote(tuning.notes[i]), a4));
});
for (const [id, step] of [["a4down", -1], ["a4up", 1]]) {
  $(id).addEventListener("click", () => {
    a4 = Math.max(430, Math.min(450, a4 + step));
    pref.set("a4", a4);
    renderA4();
  });
}

drawGauge(); renderTunings(); renderStrings(); renderA4();
cortex.onChange(loadCustom);
loadCustom().then(() => cortex.startAutoSync());
drawMeter();
start(); // straight into listening: the browser asks for the mic the first time

keepUpdated(() => !draftDirty()); // don't reload away a half-made custom tuning
