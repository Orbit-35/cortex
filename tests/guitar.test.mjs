import assert from "node:assert/strict";
import { detectPitch } from "../static/guitar/pitch.js";
import { noteText, parseNote, midiToFreq, nearestNote, closestString, centsOff, median, TUNINGS, display } from "../static/guitar/music.js";

const SR = 48000;
// A guitar-like tone: fundamental plus louder overtones, so octave mistakes would show up.
function tone(freq, n = 4096, partials = [1, 1.6, 1.2, 0.8, 0.5, 0.3], amp = 0.3) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++)
    b[i] = partials.reduce((s, a, k) => s + a * Math.sin(2 * Math.PI * freq * (k + 1) * i / SR), 0) * amp / partials.length;
  return b;
}

assert.equal(parseNote("A4"), 69);
assert.equal(parseNote("E2"), 40);
assert.equal(parseNote("Eb2"), 39);
assert.equal(parseNote("F#3"), 54);
assert.deepEqual(display("Bb3"), { name: "B♭", octave: 3 });
for (let m = 20; m < 90; m++) assert.equal(parseNote(noteText(m)), m);
assert.equal(noteText(40), "E2");
assert.equal(TUNINGS[0].id, "chromatic");
assert.ok(Math.abs(midiToFreq(40) - 82.4069) < 0.001);
assert.ok(Math.abs(midiToFreq(69, 432) - 432) < 1e-9);

const nn = nearestNote(445);
assert.equal(nn.name, "A");
assert.equal(nn.octave, 4);
assert.ok(Math.abs(nn.cents - 19.56) < 0.1);
assert.equal(median([5, 1, 3]), 3);
assert.equal(median([4, 1, 3, 2]), 2.5);

const std = TUNINGS.find((t) => t.id === "standard").notes;
assert.equal(closestString(83, std), 0);
assert.equal(closestString(250, std), 4); // B3 = 247 is nearest
assert.equal(closestString(190, std), 3); // G3 = 196
assert.equal(closestString(247, std), 4);

// Every string in every tuning is detected within 1 cent, including a weak fundamental.
for (const t of TUNINGS) for (const n of t.notes) {
  const f = midiToFreq(parseNote(n));
  for (const partials of [[1], [1, 1.6, 1.2, 0.8, 0.5, 0.3], [0.3, 1, 0.8, 0.6]]) {
    const r = detectPitch(tone(f, 4096, partials), SR);
    assert.ok(r, `${t.name} ${n} not detected`);
    assert.ok(Math.abs(centsOff(r.freq, f)) < 1, `${t.name} ${n}: got ${r.freq.toFixed(2)} want ${f.toFixed(2)}`);
  }
}
// Slightly out of tune is measured, not snapped.
const sharp = detectPitch(tone(110 * 2 ** (12 / 1200)), SR);
assert.ok(Math.abs(centsOff(sharp.freq, 110) - 12) < 1);

// Silence and white noise give no reading.
assert.equal(detectPitch(new Float32Array(4096), SR), null);
let seed = 1;
const noise = new Float32Array(4096).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5);
assert.equal(detectPitch(noise, SR), null);

console.log("guitar tests passed");
