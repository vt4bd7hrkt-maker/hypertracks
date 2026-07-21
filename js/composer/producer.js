// The PRODUCER stage: taste, not generation.
//
//   composer  →  PRODUCER  →  user
//
// Real producers make many ideas, reject most, refine the promising one.
// produce() does the same: it composes N candidate tracks, scores each with
// critique() — a pure analysis of the SYMBOLIC score (no audio needed, so
// the whole A&R pass costs ~100 ms) — picks the strongest, then runs
// directed revision rounds: the weakest scoring axis selects a targeted fix
// (new hook / new drums / new arrangement / simplify / thicken), applied via
// the same DNA-locks machinery Mutate uses so ONLY the criticized axis can
// change. A revision is kept only if it scores higher. The user only ever
// hears the winner.
//
// Everything is deterministic per (masterSeed, macros, avoid), so history,
// export and tests behave exactly as before.

import { RNG } from '../core/rng.js';
import { compose } from './composer.js';
import { mutate } from './mutate.js';

// piecewise band score: 0 below lo0 / above hi0, 1 inside [lo1, hi1]
function band(x, lo0, lo1, hi1, hi0) {
  if (x <= lo0 || x >= hi0) return 0;
  if (x < lo1) return (x - lo0) / (lo1 - lo0);
  if (x > hi1) return (hi0 - x) / (hi0 - hi1);
  return 1;
}
const avg = (...xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const CHILL = new Set(['ambient', 'cloudrap', 'lofi', 'dreamcore']);

/**
 * Score a composition 0–100 across musical axes. The bands encode taste:
 * singable hook ranges, stepwise-but-not-static motion, grooves that align
 * kick and bass, drops that are audibly denser than breaks, arrangements
 * that breathe. Returns { score, notes, worst } where `worst` names the
 * revision directive that would help most.
 */
export function critique(comp) {
  const byType = {};
  for (const e of comp.events) (byType[e.type] = byType[e.type] || []).push(e);
  const chill = CHILL.has(comp.persona);
  const notes = {};

  // --- HOOK: range, motion, rhythm, syncopation --------------------------
  {
    const hook = comp.dna.hook;
    const degs = hook.notes.map((n) => n.deg);
    const range = Math.max(...degs) - Math.min(...degs);
    const steps = degs.slice(1).map((d, i) => Math.abs(d - degs[i]));
    const stepwise = steps.length ? steps.filter((s) => s <= 2).length / steps.length : 0;
    const onsetsBar1 = hook.notes.filter((n) => n.s < 16).length;
    const sync = hook.notes.filter((n) => n.s % 4 !== 0).length / hook.notes.length;
    notes.hook = avg(
      band(range, 1, 3, 7, 11),          // singable compass, not a drone or a leap-fest
      band(stepwise, 0.35, 0.55, 0.95, 1.01), // mostly stepwise, some character
      band(onsetsBar1, 1, 2.5, 6, 9),    // a phrase, not a stream
      band(sync, 0.0, 0.15, 0.65, 0.9),  // groove against the grid
    );
  }

  // --- MELODY: presence + literal recurrence (memorability) ---------------
  {
    const leads = byType.lead || [];
    const barLen = (60 / comp.bpm) * 4;
    const perSec = leads.length / comp.duration;
    const melodicAlt = ((byType.arp || []).length + (byType.chop || []).length) / comp.duration;
    const presence = leads.length >= 4
      ? band(perSec, 0.1, 0.3, 2.2, 3.5)
      : band(melodicAlt, 0.15, 0.4, 6, 10); // minimal personas sing through arps/chops
    let recurrence = 0.7; // neutral when there's no topline to repeat
    if (leads.length >= 6) {
      const groups = new Map();
      for (const e of leads) {
        const g = Math.floor(e.t / barLen / 2);
        const arr = groups.get(g) || [];
        if (arr[arr.length - 1] !== e.midi) arr.push(e.midi);
        groups.set(g, arr);
      }
      const sig = new Map();
      for (const arr of groups.values()) {
        if (arr.length < 2) continue;
        const rel = arr.map((m) => m - arr[0]).join(',');
        sig.set(rel, (sig.get(rel) || 0) + 1);
      }
      const maxRep = Math.max(0, ...sig.values());
      const variants = sig.size;
      recurrence = avg(
        band(maxRep, 0.5, 2, 8, 14),     // the idea is STATED repeatedly
        band(variants, 1, 2, 7, 12),     // ...but also developed
      );
    }
    notes.melody = avg(presence, recurrence);
  }

  // --- GROOVE: kick-bass lock, drum activity in the loudest stretch -------
  {
    const kicks = byType.kick || [];
    const basses = (byType.bass || []).filter((e) => e.dur < 2);
    let align = 0.75; // neutral for sustain-bass tracks
    if (kicks.length >= 4 && basses.length >= 4 && comp.dna.roles.bassPattern === 'lock') {
      const kt = kicks.map((e) => e.t);
      const hit = basses.filter((b) => kt.some((k) => Math.abs(k - b.t) < 0.035)).length;
      align = band(hit / basses.length, 0.2, 0.55, 1, 1.02);
    }
    const drumEvents = kicks.length + (byType.snare || []).length + (byType.hat || []).length;
    const density = drumEvents / comp.duration;
    notes.groove = avg(align, band(density, chill ? 0.15 : 0.8, chill ? 0.5 : 1.8, 9, 14));
  }

  // --- ARRANGEMENT: section contrast + marked drops ------------------------
  {
    const barLen = (60 / comp.bpm) * 4;
    let cursor = 0;
    const dens = [];
    const dropStarts = [];
    for (const sec of comp.sections) {
      const t0 = cursor * barLen, t1 = (cursor + sec.bars) * barLen;
      const n = comp.events.filter((e) => e.t >= t0 && e.t < t1).length;
      dens.push(n / sec.bars);
      if (sec.name === 'drop') dropStarts.push(t0);
      cursor += sec.bars;
    }
    const contrast = Math.max(...dens) / Math.max(1, Math.min(...dens));
    const fxTypes = new Set(['impact', 'crash', 'riser', 'swell']);
    const marked = dropStarts.filter((t0) =>
      comp.events.some((e) => fxTypes.has(e.type) && Math.abs(e.t - t0) < 0.8)).length;
    notes.arrangement = avg(
      band(contrast, 1.05, 1.5, 12, 30),
      dropStarts.length ? band(marked / dropStarts.length, 0, 0.4, 1, 1.02) : 0.8,
    );
  }

  // --- SPACE: overall density + layer count where it's busiest ------------
  {
    const perSec = comp.events.length / comp.duration;
    const layerTypes = ['lead', 'arp', 'stab', 'pad', 'chop'];
    const present = layerTypes.filter((t) => (byType[t] || []).length > 2).length;
    notes.space = avg(
      band(perSec, chill ? 0.5 : 1.5, chill ? 1 : 3, 15, 24),
      band(present, 0.5, 1.5, 4, 5.5),
    );
  }

  // --- REGISTER: parts sit where they read --------------------------------
  {
    const mean = (arr) => (arr.length ? arr.reduce((a, e) => a + e.midi, 0) / arr.length : null);
    const lm = mean(byType.lead || []);
    const bm = mean(byType.bass || []);
    notes.register = avg(
      lm === null ? 0.85 : band(lm, 58, 65, 88, 96),
      bm === null ? 0.6 : band(bm, 24, 28, 45, 52),
    );
  }

  const W = { hook: 0.26, melody: 0.18, groove: 0.2, arrangement: 0.14, space: 0.14, register: 0.08 };
  let score = 0;
  let worst = 'hook', worstVal = 2;
  for (const [k, w] of Object.entries(W)) {
    score += w * notes[k];
    // weight-adjusted so a weak minor axis doesn't outrank a weak major one
    const adj = notes[k] / (0.5 + w);
    if (adj < worstVal) { worstVal = adj; worst = k; }
  }
  return { score: Math.round(score * 100), notes, worst };
}

// ---------------------------------------------------------------------------
// directed revision: rebuild ONLY the criticized axis, keep everything else

function directedRevise(parent, macros, directive, seed, avoid) {
  const dna = parent.dna;
  const locks = {
    persona: parent.persona,
    bpm: parent.bpm,
    scaleName: parent.scaleName,
    rootMidi: parent.rootMidi,
    degrees: dna.degrees.slice(),
    harmonicRhythm: dna.harmonicRhythm,
    voicing: dna.voicing,
    swing: dna.swing,
    sections: parent.sections.map((s) => ({ ...s })),
    structureName: parent.structureName,
    sound: { ...parent.sound },
    roles: { ...dna.roles },
    hook: dna.hook,
    groove: dna.groove,
    bassRiff: dna.bassRiff,
    arpPattern: dna.arpPattern,
    stabSteps: dna.stabSteps,
  };
  switch (directive) {
    case 'hook':
    case 'melody':
    case 'register': {
      delete locks.hook; // write a better topline over the same track
      const r = { ...locks.roles }; delete r.leadBehavior; locks.roles = r;
      break;
    }
    case 'groove': {
      delete locks.groove; delete locks.bassRiff; // new kit + new pattern language
      const s = { ...locks.sound }; delete s.kick; delete s.snare; delete s.hat; delete s.perc;
      locks.sound = s;
      const r = { ...locks.roles }; delete r.drumStyle; delete r.bassPattern; locks.roles = r;
      break;
    }
    case 'arrangement': {
      delete locks.sections; delete locks.structureName; // new dramaturgy
      break;
    }
    case 'simplify': { // too dense: strip decoration, let it breathe
      locks.roles = { ...locks.roles, useStabs: false, useArp: false };
      locks.groove = { ...dna.groove, perc: [] };
      break;
    }
    case 'thicken': { // too empty for its persona: add committed layers
      locks.roles = { ...locks.roles, useArp: true, usePads: true, arpInBreaks: true };
      break;
    }
    default:
      break;
  }
  const child = compose(seed, macros, locks, avoid);
  child.name = parent.name;         // a revision is the same track, refined
  child.baseName = parent.baseName;
  child.lineage = parent.lineage;
  return child;
}

/** map a weak axis to the directive that addresses it */
function directiveFor(comp, crit) {
  if (crit.worst === 'space') {
    const perSec = comp.events.length / comp.duration;
    return perSec > 8 ? 'simplify' : 'thicken';
  }
  return crit.worst;
}

// ---------------------------------------------------------------------------

/**
 * The full A&R pass: N candidates → pick strongest → up to `revisions`
 * directed fixes (kept only when they score better). Deterministic per
 * (masterSeed, macros, avoid).
 */
export function produce(masterSeed, macros, avoid = [], opts = {}) {
  const N = opts.candidates ?? 6;
  const maxRev = opts.revisions ?? 2;
  const taken = [];
  let best = null;
  for (let i = 0; i < N; i++) {
    const seed = (masterSeed + i * 0x9E3779B9) >>> 0;
    const comp = compose(seed, macros, {}, avoid);
    const crit = critique(comp);
    taken.push({ seed, persona: comp.persona, score: crit.score });
    if (!best || crit.score > best.crit.score) best = { comp, crit };
  }
  let revisions = 0;
  for (let r = 0; r < maxRev && best.crit.score < 88; r++) {
    const directive = directiveFor(best.comp, best.crit);
    const seed = (masterSeed ^ (0xC0FFEE + r * 7919)) >>> 0;
    const revised = directedRevise(best.comp, macros, directive, seed, avoid);
    const rc = critique(revised);
    if (rc.score > best.crit.score + 1) {
      best = { comp: revised, crit: rc };
      revisions++;
    }
  }
  best.comp.producer = {
    score: best.crit.score,
    notes: Object.fromEntries(Object.entries(best.crit.notes).map(([k, v]) => [k, +v.toFixed(2)])),
    considered: N,
    revisions,
    candidates: taken,
  };
  return best.comp;
}

/** Mutation with taste: breed several children, keep the strongest. */
export function produceMutation(parent, macros, amount, masterSeed, avoid = [], opts = {}) {
  const N = opts.candidates ?? 4;
  let best = null;
  for (let i = 0; i < N; i++) {
    const seed = (masterSeed + i * 0x85EBCA6B) >>> 0;
    const child = mutate(parent, macros, amount, seed, avoid);
    const crit = critique(child);
    if (!best || crit.score > best.crit.score) best = { comp: child, crit };
  }
  best.comp.producer = { score: best.crit.score, considered: N, revisions: 0 };
  return best.comp;
}
