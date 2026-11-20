// Guitar tuner page. Audio stays on the device: the mic feeds an analyser, nothing is stored or sent.
import { detectPitch } from "./pitch.js";
import { TUNINGS, parseNote, midiToFreq, centsOff, nearestNote, closestString, median, display } from "./music.js";

const $ = (id) => document.getElementById(id);
const IN_TUNE = 3;   // cents: green
const NEAR = 12;     // cents: amber
const HOLD_MS = 500; // in tune this long marks the string done

// Per-device preferences (DESIGN D43): plain localStorage, guarded.
const pref = {
  get(k, d) { try { const v = localStorage.getItem("guitar:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("guitar:" + k, JSON.stringify(v)); } catch {} },
};

let tuning = TUNINGS.find((t) => t.id === pref.get("tuning", "standard")) || TUNINGS[0];
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
};

// ---------- Static UI ----------

function drawGauge() {
  // Semicircle from -50 to +50 cents. Needle pivots at (190, 200).
  const cx = 190, cy = 200, r = 170;
  const at = (c, rad) => {
    const a = ((c / 50) * 60 - 90) * Math.PI / 180;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  let s = "";
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 25 === 0;
    const [x1, y1] = at(c, r - (major ? 22 : 12)), [x2, y2] = at(c, r);
    s += `<line class="tick${major ? " major" : ""}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  const [zx1, zy1] = at(-IN_TUNE, r + 10), [zx2, zy2] = at(IN_TUNE, r + 10);
  s += `<path class="zone" d="M${zx1} ${zy1} A${r + 10} ${r + 10} 0 0 1 ${zx2} ${zy2}"/>`;
  for (const c of [-50, -25, 25, 50]) {
    const [x, y] = at(c, r - 38);
    s += `<text class="lbl" x="${x}" y="${y + 4}">${c > 0 ? "+" : ""}${c}</text>`;
  }
  s += `<g class="needle idle" id="needle"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 4}"/><circle cx="${cx}" cy="${cy}" r="9"/></g>`;
  $("gauge").innerHTML = s;
}

function renderTunings() {
  $("tunings").innerHTML = TUNINGS.map((t) =>
    `<button class="chip${t === tuning ? " on" : ""}" role="tab" aria-selected="${t === tuning}" data-t="${t.id}">${t.name}</button>`).join("");
}

function renderStrings() {
  const chromatic = !tuning.notes.length;
  $("strings").hidden = chromatic;
  $("strings").innerHTML = tuning.notes.map((n, i) => {
    const cls = ["str", i === locked ? "locked" : i === current ? "active" : "", done.has(i) ? "done" : ""].join(" ");
    return `<button class="${cls}" data-i="${i}" aria-label="String ${6 - i}, ${display(n).name}${done.has(i) ? ", tuned" : ""}">${display(n).name}</button>`;
  }).join("");
  $("hint").textContent = chromatic ? "Shows the nearest note to whatever you play"
    : locked !== null ? `Locked to string ${6 - locked}. Tap it again for auto.`
    : "Auto: picks the closest string. Tap a string to lock it.";
  $("ref").disabled = chromatic;
}

function renderA4() { $("a4").textContent = `A4 ${a4} Hz`; }

// ---------- Live reading ----------

function show(freq) {
  const stage = $("stage"), needle = $("needle");
  if (freq == null) {
    stage.className = "stage state-idle";
    needle.classList.add("idle");
    needle.style.transform = "rotate(0deg)";
    $("status").textContent = "Play a string";
    $("readout").textContent = "";
    if (current !== null && locked === null) { current = null; renderStrings(); }
    return;
  }
  let name, octave, cents;
  if (!tuning.notes.length) {
    ({ name, octave, cents } = nearestNote(freq, a4));
  } else {
    const i = locked ?? closestString(freq, tuning.notes, a4);
    if (i !== current) { current = i; inTuneSince = 0; renderStrings(); }
    const n = tuning.notes[i];
    ({ name, octave } = display(n));
    cents = centsOff(freq, midiToFreq(parseNote(n), a4));
  }
  const abs = Math.abs(cents);
  const state = abs <= IN_TUNE ? "in" : abs <= NEAR ? "near" : "far";
  stage.className = `stage state-${state}`;
  needle.classList.remove("idle");
  needle.style.transform = `rotate(${(Math.max(-50, Math.min(50, cents)) / 50) * 60}deg)`;
  $("note").innerHTML = `${name}<sub>${octave}</sub>`;
  // Too low means the string is too loose: tighten (tune up).
  $("status").innerHTML = state === "in" ? `${ICON.check} In tune`
    : cents < 0 ? `${ICON.up} Tune up` : `${ICON.down} Tune down`;
  const rc = Math.round(cents) || 0; // no "-0"
  $("readout").textContent = `${freq.toFixed(1)} Hz · ${rc > 0 ? "+" : ""}${rc} cents`;

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

async function start() {
  const msg = $("startmsg");
  if (!navigator.mediaDevices?.getUserMedia) {
    msg.innerHTML = `<span class="err">The microphone needs a secure page. Open Cortex through its Tailscale (https) address.</span>`;
    return;
  }
  let state = "unknown";
  try { state = (await navigator.permissions.query({ name: "microphone" })).state; } catch {}
  msg.textContent = `Asking for the microphone… (site setting: ${state})`;
  const slow = setTimeout(() => {
    msg.innerHTML = `<span class="err">Still waiting for an answer about the microphone, but no question appeared. (site setting: ${state})</span>`;
  }, 4000);
  try {
    // Phone voice processing would treat a guitar note as noise and squash it: turn it all off.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    clearTimeout(slow);
    // Which layer said no: Chrome's per-site setting ("denied") or something below it ("prompt"/"granted").
    const why = `${err.message}; site setting: ${state}`; // DOMException.message is read-only
    msg.innerHTML = `<span class="err">${err.name === "NotAllowedError"
      ? "Microphone access is blocked. Installed web apps get it through Chrome: open Chrome → ⋮ → Settings → Site settings → Microphone, find the Cortex address and set it to Allow. Also check Android Settings → Apps → Chrome → Permissions → Microphone is allowed. Then reopen Cortex. (Chrome says: " + why + ")"
      : "Couldn't open the microphone: " + why}</span>`;
    return;
  }
  clearTimeout(slow);
  ctx = ctx && ctx.state !== "closed" ? ctx : new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 4096; // ~85 ms of sound: enough cycles of the low E (82 Hz)
  buf = new Float32Array(analyser.fftSize);
  ctx.createMediaStreamSource(stream).connect(analyser);
  $("start").hidden = true;
  try { wake = await navigator.wakeLock?.request("screen"); } catch {}
  cancelAnimationFrame(raf);
  tickLoop();
}

function stop() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  wake?.release().catch(() => {});
  wake = null;
  recent = [];
  show(null);
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

$("go").addEventListener("click", start);
$("tunings").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-t]");
  if (!b) return;
  tuning = TUNINGS.find((t) => t.id === b.dataset.t);
  pref.set("tuning", tuning.id);
  locked = current = null;
  done = new Set();
  renderTunings(); renderStrings(); show(null);
});
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
$("tunings").querySelector(".on")?.scrollIntoView({ inline: "center", block: "nearest" });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
