// The hook system: Stage 2 + 3 of the compose-first pipeline.
//
// A HOOK is the track's core musical idea — a 2-bar phrase designed before
// any sound-design decision exists. It is what the listener remembers.
// A PHRASE PLAN then develops that hook across the arrangement through
// classical devices (repetition, call & response, thinning, octave lift,
// ornament, fragmentation) instead of continuously inventing new material.
// Randomness is BUDGETED: ~70% of slots are coherent statements of the idea,
// ~30% (scaled by chaos) are surprises — decoration, never replacement.
//
// Pure module: no audio, JSON-able output, deterministic via the passed rng.

import { degreeToSemis } from '../core/theory.js';

// Curated rhythm cells (bar-1 onsets in 16th steps). Curation is what makes
// phrases feel authored — these are rhythms a producer would actually play,
// grouped by hook character.
const RHYTHM_CELLS = {
  melodic: [
    [0, 3, 6, 10, 12], [0, 4, 6, 8, 12], [0, 2, 4, 8, 12, 14],
    [0, 6, 8, 11], [0, 3, 8, 11, 14], [0, 4, 7, 8, 12], [0, 2, 6, 8, 10],
  ],
  anthem: [[0, 8, 12], [0, 10], [0, 6, 12], [0, 8], [0, 12, 14], [0, 4, 8]],
  minimal: [[0, 10], [0, 6], [2, 8], [0, 11, 12], [0, 14]],
  dense: [
    [0, 2, 4, 6, 8, 10, 12, 14], [0, 1, 2, 4, 8, 9, 10, 12],
    [0, 2, 3, 4, 8, 10, 11, 12], [0, 2, 4, 5, 8, 12, 13, 14],
  ],
};

const CONTOURS = ['arch', 'descent', 'rise', 'wave'];

/**
 * Design the track's core idea: a 2-bar phrase as scale-degree offsets from
 * the tonic. Bar 2 is a built-in answer — same rhythm, tail resolving HOME
 * (degree 0), which is what makes the phrase feel like a sentence instead of
 * a stream.
 */
export function designHook(rng, m, character = 'melodic') {
  const cells = RHYTHM_CELLS[character] || RHYTHM_CELLS.melodic;
  const bar1 = rng.pick(cells).slice();
  const contour = rng.pick(CONTOURS);
  const range = character === 'anthem' ? 8 : 5 + Math.round(m.weird * 3);
  const n1 = bar1.length;

  // pitch walk shaped by the contour, mostly stepwise, at most rare leaps
  const degs = [rng.pick([0, 2, 4])]; // start on a stable degree
  for (let i = 1; i < n1; i++) {
    const t = i / Math.max(1, n1 - 1);
    let dir;
    if (contour === 'arch') dir = t < 0.5 ? 1 : -1;
    else if (contour === 'descent') dir = -1;
    else if (contour === 'rise') dir = 1;
    else dir = i % 2 ? -1 : 1; // wave
    let step = dir * rng.weighted([[1, 3], [2, 1.5], [0, 1]]);
    if (rng.chance(m.weird * 0.25)) step = dir * rng.pick([3, 4]); // rare leap
    let d = degs[i - 1] + step;
    if (Math.abs(d) > range) d = degs[i - 1] - step; // reflect at the range edge
    degs.push(d);
  }

  // bar 2: same rhythm (recognition), slightly varied pitches, resolved ending
  const degs2 = degs.map((d, i) => {
    if (i === n1 - 1) return rng.pick([0, 0, 4]); // land home (or on the fifth)
    return d + rng.pick([0, 0, 0, -1, 1]);
  });

  const notes = [];
  bar1.forEach((s, i) => notes.push({
    s, deg: degs[i], len: (i + 1 < n1 ? bar1[i + 1] : 16) - s,
  }));
  bar1.forEach((s, i) => notes.push({
    s: s + 16, deg: degs2[i], len: (i + 1 < n1 ? bar1[i + 1] + 16 : 32) - (s + 16),
  }));
  return { notes, character, contour, range };
}

// ---------------------------------------------------------------------------
// development transforms — how a producer varies an idea without losing it

export function variantNotes(hook, variant, rng) {
  const src = hook.notes.map((n) => ({ ...n }));
  switch (variant) {
    case 'answer': {
      // inverted contour, ends on the fifth — a question to the hook's answer
      const last = src.length - 1;
      return src.map((n, i) => ({ ...n, deg: i === last ? 4 : Math.round(-(n.deg - 2) + 2) }));
    }
    case 'thin': {
      // strip to the structural notes, let them ring — breaks/intros
      const kept = src.filter((n) => n.s % 8 === 0 || n.s % 16 === 10);
      return kept.map((n, i) => ({
        ...n, len: (i + 1 < kept.length ? kept[i + 1].s : 32) - n.s,
      }));
    }
    case 'lift':
      return src.map((n) => ({ ...n, deg: n.deg + 7 })); // octave up, soaring
    case 'ornament': {
      // grace notes before strong beats — decoration on the same skeleton
      const out = [];
      for (const n of src) {
        if (n.s % 4 === 0 && n.s % 16 !== 0 && rng.chance(0.5)) {
          out.push({ s: n.s - 1, deg: n.deg + rng.pick([-1, 1]), len: 1 });
        }
        out.push(n);
      }
      return out;
    }
    case 'fragment': {
      // only the opening gesture of each bar, then silence — tension device
      const out = [];
      let bar1Count = 0, bar2Count = 0;
      for (const n of src) {
        if (n.s < 16 && bar1Count < 2) { out.push(n); bar1Count++; }
        else if (n.s >= 16 && bar2Count < 2) { out.push(n); bar2Count++; }
      }
      return out;
    }
    default:
      return src; // 'exact'
  }
}

/**
 * Build the development plan: one variant per 2-bar slot per section.
 * Guarantees the hook is STATED (exact) at the top of the first drop and
 * recurs throughout; chaos buys surprise slots on top of that skeleton.
 */
export function makePhrasePlan(rng, sections, m) {
  const surprise = 0.08 + m.chaos * 0.35;
  const plan = [];
  let firstDropSeen = false;
  for (const sec of sections) {
    const slots = Math.max(1, Math.ceil(sec.bars / 2));
    const arr = [];
    for (let k = 0; k < slots; k++) {
      let v;
      if (sec.name === 'drop') {
        // coherent skeleton: statement, answer, statement, decorated statement
        v = ['exact', 'answer', 'exact', 'ornament'][k % 4];
        if (k > 0 && rng.chance(surprise)) v = rng.pick(['ornament', 'fragment', 'lift']);
      } else if (sec.name === 'break') {
        v = rng.pick(['thin', 'thin', 'fragment']);
      } else if (sec.name === 'build') {
        v = rng.pick(['thin', 'exact', 'fragment']);
      } else {
        v = 'thin';
      }
      arr.push(v);
    }
    if (sec.name === 'drop' && !firstDropSeen) {
      arr[0] = 'exact'; // the idea is always stated clearly first
      firstDropSeen = true;
    }
    plan.push(arr);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// rendering: degrees -> MIDI against the current harmony

/**
 * Render variant notes to concrete pitches. Degrees are scale steps from the
 * tonic; strong beats softly snap to the current chord so the hook always
 * agrees with the harmony without losing its shape.
 */
export function renderHook(notes, { scale, rootMidi, base, chordFor }) {
  return notes.map((n) => {
    let midi = rootMidi + degreeToSemis(scale, n.deg);
    while (midi < base - 7) midi += 12;
    while (midi > base + 10) midi -= 12;
    if (n.s % 8 === 0) midi = snapToChord(midi, chordFor(n.s));
    return { s: n.s, midi, len: n.len };
  });
}

function snapToChord(midi, chord) {
  if (!chord) return midi;
  let best = midi, dist = 3; // only snap when a chord tone is genuinely close
  for (const tone of chord.tones) {
    for (const oct of [-24, -12, 0, 12, 24]) {
      const c = tone + oct;
      const d = Math.abs(c - midi);
      if (d < dist) { dist = d; best = c; }
    }
  }
  return best;
}

/**
 * Derive the vocal-chop line FROM the hook (shared DNA): the phrase's longest,
 * most structural notes become what the "voice" sings, an octave up.
 */
export function deriveChopSeq(hook, rng, vowels) {
  const sorted = hook.notes.slice().sort((a, b) => b.len - a.len);
  const picked = sorted.slice(0, Math.min(3, sorted.length))
    .sort((a, b) => a.s - b.s);
  return picked.map((n) => ({
    s: n.s % 16,
    deg: n.deg + 7, // octave above the hook
    lenSteps: Math.min(4, Math.max(1, n.len)),
    vowel: rng.pick(vowels),
    glide: rng.chance(0.6) ? rng.pick([-3, -2, 2, 4]) : 0,
  }));
}
