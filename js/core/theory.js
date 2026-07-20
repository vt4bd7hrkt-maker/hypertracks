// Music theory primitives: scales, diatonic chords, quantization.
// Everything works in MIDI note numbers; scales are semitone offsets from a root.

export const SCALES = {
  major:         [0, 2, 4, 5, 7, 9, 11],
  minor:         [0, 2, 3, 5, 7, 8, 10],
  dorian:        [0, 2, 3, 5, 7, 9, 10],
  lydian:        [0, 2, 4, 6, 7, 9, 11],
  mixolydian:    [0, 2, 4, 5, 7, 9, 10],
  phrygian:      [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function noteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

/** Scale degree (0-based, any integer) -> semitone offset from root, octave-aware. */
export function degreeToSemis(scale, degree) {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  return scale[((degree % n) + n) % n] + 12 * oct;
}

/**
 * Diatonic chord on a scale degree: stacked thirds (size = 3..5 notes),
 * returned as semitone offsets from the scale root.
 */
export function degreeChord(scale, degree, size = 3) {
  const out = [];
  for (let i = 0; i < size; i++) out.push(degreeToSemis(scale, degree + 2 * i));
  return out;
}

/** Snap a MIDI note to the nearest note of the scale rooted at rootMidi. */
export function quantizeToScale(midi, rootMidi, scale) {
  const rel = midi - rootMidi;
  const oct = Math.floor(rel / 12);
  const pc = ((rel % 12) + 12) % 12;
  let best = scale[0], dist = 99;
  for (const s of scale) {
    const d = Math.min(Math.abs(s - pc), 12 - Math.abs(s - pc));
    if (d < dist) { dist = d; best = s; }
  }
  // pick the octave placement closest to the original pitch
  const candidates = [best + 12 * (oct - 1), best + 12 * oct, best + 12 * (oct + 1)];
  let out = candidates[0];
  for (const c of candidates) if (Math.abs(c - rel) < Math.abs(out - rel)) out = c;
  return rootMidi + out;
}

// Chord progression pools as 0-based scale degrees. Loops may be 2 or 4
// chords long — 2-chord loops give a hypnotic, suspended harmonic feel.
// Which pools a track draws from is a persona decision.
export const PROGRESSIONS = {
  bright: [
    [0, 4, 5, 3], // I V vi IV — the anthem
    [5, 3, 0, 4], // vi IV I V
    [0, 3, 4, 3], // I IV V IV
    [3, 4, 5, 4], // IV V vi V
    [0, 5, 3, 4], // I vi IV V — doo-wop, y2k pop
    [3, 0, 4, 5], // IV I V vi
  ],
  dark: [
    [0, 5, 2, 6], // i VI III VII — epic minor
    [0, 6, 5, 6], // i VII VI VII — drain
    [0, 3, 6, 5], // i iv VII VI
    [0, 5, 6, 4], // i VI VII v
    [5, 4, 0, 6], // VI v i VII
    [0, 2, 5, 6], // i III VI VII
  ],
  floaty: [
    [0, 1],       // I II — lydian suspension
    [0, 3],       // I IV — endless plagal drift
    [5, 3],       // vi IV
    [0, 1, 3, 1], // I II IV II
    [3, 1, 4, 0], // IV II V I
    [0, 2, 3, 4], // I iii IV V
  ],
  emo: [
    [0, 5, 3, 6], // i VI iv VII
    [0, 3, 5, 6], // i iv VI VII
    [0, 6, 3, 4], // i VII iv v
    [5, 3, 0, 0], // VI iv i i — dwelling on the tonic
    [0, 5, 3, 4], // i VI iv v
    [2, 5, 0, 6], // III VI i VII
  ],
};
