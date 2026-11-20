// Note math for the tuner. Pure functions, no DOM, so they run in Node tests.
// MIDI numbers name pitches: 69 = A4. One semitone = 1, one cent = 1/100 of a semitone.

export const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const midiToFreq = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
export const freqToMidi = (freq, a4 = 440) => 69 + 12 * Math.log2(freq / a4);
export const centsOff = (freq, target) => 1200 * Math.log2(freq / target);

// "E2", "Eb2", "F#3" -> MIDI number.
export function parseNote(s) {
  const m = /^([A-G])([#b♯♭]?)(-?\d)$/.exec(s);
  if (!m) throw new Error(`bad note ${s}`);
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + LETTER[m[1]] + acc;
}

// How a note is shown: letter with ♯/♭, octave separately ("E♭", 2).
export function display(s) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  return { name: m[1] + (m[2] === "#" ? "♯" : m[2] === "b" ? "♭" : ""), octave: Number(m[3]) };
}

export function nearestNote(freq, a4 = 440) {
  const midi = Math.round(freqToMidi(freq, a4));
  return {
    midi,
    name: SHARPS[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents: centsOff(freq, midiToFreq(midi, a4)),
  };
}

// Strings listed low (6th) to high (1st).
export const TUNINGS = [
  { id: "standard", name: "Standard", notes: ["E2", "A2", "D3", "G3", "B3", "E4"] },
  { id: "dropd", name: "Drop D", notes: ["D2", "A2", "D3", "G3", "B3", "E4"] },
  { id: "half", name: "Half step down", notes: ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"] },
  { id: "whole", name: "Whole step down", notes: ["D2", "G2", "C3", "F3", "A3", "D4"] },
  { id: "dropc", name: "Drop C", notes: ["C2", "G2", "C3", "F3", "A3", "D4"] },
  { id: "openg", name: "Open G", notes: ["D2", "G2", "D3", "G3", "B3", "D4"] },
  { id: "opend", name: "Open D", notes: ["D2", "A2", "D3", "F#3", "A3", "D4"] },
  { id: "dadgad", name: "DADGAD", notes: ["D2", "A2", "D3", "G3", "A3", "D4"] },
  { id: "chromatic", name: "Chromatic", notes: [] },
];

// Index of the string whose target pitch is closest (in cents) to freq.
export function closestString(freq, notes, a4 = 440) {
  let best = -1, bestAbs = Infinity;
  notes.forEach((n, i) => {
    const c = Math.abs(centsOff(freq, midiToFreq(parseNote(n), a4)));
    if (c < bestAbs) { bestAbs = c; best = i; }
  });
  return best;
}

// Median of a short list: steadies the reading without lagging behind a real change.
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
