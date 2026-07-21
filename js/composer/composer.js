// The composer: (seed, macros) -> Composition.
//
// PURE layer — no Web Audio, no DOM. Emits a symbolic score plus a fully
// resolved SOUND DESIGN (numeric synth/mix parameters), consumed identically
// by the live player and the offline export renderer.
//
// Generation is HIERARCHICAL to maximize diversity:
//   1. pickPersona(rng, macros)  — a hidden creative identity (dreamcore,
//      digicore, cloudrap, rage, ...). Sliders steer which persona is likely.
//   2. persona conditions everything downstream: tempo, scale language,
//      progression pool, harmonic rhythm, voicing, structure family, drum
//      algorithm, synth types, melody behavior, chop style, groove, FX
//      vocabulary, mix character.
//   3. designSound() resolves every timbre to jittered numbers, so no two
//      tracks share exact sounds even inside one persona.
//
// Determinism is a hard invariant: same seed + same macros -> identical score.

import { RNG } from '../core/rng.js';
import {
  SCALES, PROGRESSIONS, degreeChord, degreeToSemis, quantizeToScale, noteName,
} from '../core/theory.js';
import { makeName } from '../core/names.js';
import { PERSONAS, pickPersona, effectiveMacros } from './personas.js';
import {
  designHook, variantNotes, makePhrasePlan, renderHook, deriveChopSeq,
} from './hooks.js';
import {
  designGroove, designBassRiff, designArpPattern, designStabs,
} from './groove.js';
import { SAMPLES, WAVES } from '../assets/manifest.js';

export const DEFAULT_MACROS = {
  energy: 0.6, dream: 0.5, chaos: 0.35, glitch: 0.35,
  dark: 0.4, bounce: 0.55, space: 0.5, weird: 0.3,
};

// sample library pools, grouped once (manifest is static data)
const POOL = {};
for (const s of SAMPLES) (POOL[s.k] = POOL[s.k] || []).push(s);
// pitched 'keys' samples grouped into instrument families by id prefix
const KEY_FAMILIES = {};
for (const s of POOL.keys || []) {
  const fam = s.id.replace(/-\d+$/, '');
  (KEY_FAMILIES[fam] = KEY_FAMILIES[fam] || []).push({ id: s.id, root: s.root });
}
const KEY_FAMILY_NAMES = Object.keys(KEY_FAMILIES);
// wavetables by family
const WAVE_FAMS = {};
for (const w of WAVES) (WAVE_FAMS[w.fam] = WAVE_FAMS[w.fam] || []).push(w);

// How sample-hungry each producer is, per department. This is the "different
// studio setup" knob: rage is nearly all synthesis, lofi reaches for recorded
// sound constantly, ambient builds on field recordings.
const SAMPLE_AFFINITY = {
  hyperpop:    { drums: 0.80, ac: 0.05, keys: 0.40, tex: 0.20, fx: 0.6, bass: 0.60, vox: 0.70 },
  dreamcore:   { drums: 0.35, ac: 0.35, keys: 0.75, tex: 0.60, fx: 0.5, bass: 0.30, vox: 0.50 },
  digicore:    { drums: 0.85, ac: 0.03, keys: 0.30, tex: 0.15, fx: 0.5, bass: 0.70, vox: 0.40 },
  cloudrap:    { drums: 0.55, ac: 0.20, keys: 0.60, tex: 0.70, fx: 0.3, bass: 0.70, vox: 0.40 },
  ambient:     { drums: 0.20, ac: 0.45, keys: 0.70, tex: 0.85, fx: 0.5, bass: 0.20, vox: 0.30 },
  glitchpop:   { drums: 0.75, ac: 0.10, keys: 0.50, tex: 0.40, fx: 0.6, bass: 0.50, vox: 0.40 },
  emo:         { drums: 0.60, ac: 0.20, keys: 0.60, tex: 0.40, fx: 0.4, bass: 0.50, vox: 0.50 },
  futurepop:   { drums: 0.70, ac: 0.10, keys: 0.45, tex: 0.20, fx: 0.5, bass: 0.60, vox: 0.40 },
  lofi:        { drums: 0.60, ac: 0.50, keys: 0.80, tex: 0.80, fx: 0.3, bass: 0.40, vox: 0.30 },
  rage:        { drums: 0.85, ac: 0.03, keys: 0.15, tex: 0.15, fx: 0.4, bass: 0.80, vox: 0.20 },
  experimental:{ drums: 0.45, ac: 0.45, keys: 0.50, tex: 0.70, fx: 0.6, bass: 0.40, vox: 0.50 },
  chopcore:    { drums: 0.60, ac: 0.15, keys: 0.30, tex: 0.30, fx: 0.4, bass: 0.50, vox: 0.95 },
  y2k:         { drums: 0.85, ac: 0.08, keys: 0.50, tex: 0.25, fx: 0.6, bass: 0.50, vox: 0.30 },
};

// bass one-shot families (dg-808 / dg-808dist / dg-reese), root-tagged
const BASS_FAMILIES = {};
for (const s of POOL.bass || []) {
  const fam = s.id.replace(/-\d+$/, '');
  (BASS_FAMILIES[fam] = BASS_FAMILIES[fam] || []).push({ id: s.id, root: s.root });
}
const BASS_FAMILY_NAMES = Object.keys(BASS_FAMILIES);
const VOX_FAMILY = (POOL.vox || []).map((s) => ({ id: s.id, root: s.root }));
const ELEC_PERSONAS = new Set(['hyperpop', 'digicore', 'glitchpop', 'rage', 'y2k', 'chopcore', 'futurepop']);

const WAVE_ROLES = {
  lead: ['hvoice', 'distorted', 'fmsynth', 'aguitar', 'clavinet', 'oscchip', 'epiano', 'piano', 'flute', 'bitreduced'],
  pad: ['eorgan', 'stringbox', 'cello', 'granular', 'birds', 'piano', 'epiano', 'hvoice'],
  arp: ['oscchip', 'epiano', 'clavinet', 'bitreduced', 'fmsynth', 'flute'],
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rr = (rng, [a, b]) => rng.range(a, b);

// ---------------------------------------------------------------------------

/**
 * @param {number} seed
 * @param {object} macros the 8 emotional sliders
 * @param {object} locks  inherited genes for the Mutate workflow — any field
 *   present here is pinned instead of generated, so a child composition can
 *   keep its parent's persona/harmony/hook/kit/structure while the new seed
 *   regenerates everything else. Empty for fresh tracks.
 *   { persona, bpm, swing, scaleName, rootMidi, degrees, harmonicRhythm,
 *     voicing, sections, structureName, sound (per-role partial),
 *     roles (partial), hook }
 */
export function compose(seed, macros, locks = {}, avoid = []) {
  const raw = { ...DEFAULT_MACROS, ...macros };
  const rng = new RNG(seed);

  const persona = locks.persona
    ? PERSONAS.find((p) => p.id === locks.persona)
    : pickPersona(rng, raw);
  const m = effectiveMacros(raw, persona);

  // --- global musical identity ---------------------------------------------
  const bpm = locks.bpm ?? Math.round(Math.min(178, Math.max(110,
    lerp(persona.bpm[0], persona.bpm[1], m.energy) + rng.range(-3, 4))));
  const spb = 60 / bpm;
  const step = spb / 4;
  const bar = spb * 4;
  // full dreaminess floats free of groove; full bounce leans hard into it
  const swing = locks.swing ?? (m.dream > 0.85 ? 0.03 : rr(rng, persona.swing) * (0.6 + m.bounce * 0.6));
  // chaos=0 means machine-tight; high chaos means loose, human, unstable
  const humanize = (0.0015 + m.chaos * 0.006 + (persona.mix.bed === 'vinyl' ? 0.004 : 0))
    * (m.chaos < 0.15 ? 0.25 : m.chaos > 0.9 ? 2.2 : 1);

  const scaleName = locks.scaleName ?? pickScale(rng, persona, m);
  const scale = SCALES[scaleName];
  const rootMidi = locks.rootMidi ?? rng.int(57, 66);

  let degrees;
  if (locks.degrees) {
    degrees = locks.degrees.slice();
  } else {
    const progPool = rng.pick(persona.prog);
    degrees = rng.pick(PROGRESSIONS[progPool]).slice();
    if (m.weird > 0.4 && rng.chance(m.weird * 0.9)) {
      degrees[rng.int(1, degrees.length - 1)] = rng.int(0, 6);
      if (m.weird > 0.75 && degrees.length > 2 && rng.chance(0.6)) {
        degrees[rng.int(1, degrees.length - 1)] = rng.int(0, 6);
      }
    }
  }
  const harmonicRhythm = locks.harmonicRhythm ?? (m.dream > 0.85 ? 2 : rng.pick(persona.harmonicRhythm));
  const voicing = locks.voicing ?? rng.pick(persona.voicing);

  const chords = degrees.map((deg) => {
    const size = m.dream > 0.3 && rng.chance(m.dream * 0.95) ? (rng.chance(m.dream * 0.6) ? 5 : 4) : 3;
    const semis = degreeChord(scale, deg, size);
    return {
      root: rootMidi + degreeToSemis(scale, deg),
      tones: voiceChord(semis.map((s) => rootMidi + s), voicing),
    };
  });
  voiceLeadChords(chords); // hands on a keyboard, not typed registers
  const chordAt = (gb) => chords[Math.floor(gb / harmonicRhythm) % chords.length];

  // --- structure + sound ----------------------------------------------------
  const { sections, structureName } = locks.sections
    ? { sections: locks.sections.map((s) => ({ ...s })), structureName: locks.structureName ?? 'inherited' }
    : buildStructure(rng, persona, m, bar);
  const totalBars = sections.reduce((n, s) => n + s.bars, 0);
  const duration = totalBars * bar;

  const sound = designSound(rng, persona, m, new Set(avoid));
  if (locks.sound) {
    for (const k of Object.keys(locks.sound)) sound[k] = { ...locks.sound[k] };
  }

  // --- role decisions --------------------------------------------------------
  const roles = {
    drumStyle: rng.pick(persona.drums),
    leadBehavior: sound.lead.type === 'none' ? 'none' : pickLeadBehavior(rng, persona, m),
    chopStyle: rng.chance(persona.chopProb + m.weird * 0.15) ? rng.pick(persona.chopStyles) : 'none',
    useArp: rng.chance(persona.arpProb + m.dream * 0.2),
    usePads: rng.chance(persona.padProb + m.dream * 0.25),
    useStabs: persona.stabMul > 0 && m.energy > 0.2 && rng.chance(0.35 + m.bounce * 0.5),
    leadInBreaks: rng.chance(0.3 + m.dream * 0.5),
    arpInBreaks: rng.chance(m.dream),
  };
  roles.bassPattern = pickBassPattern(rng, roles.drumStyle, m);
  // macro EXTREMES reshape the world unmistakably (center stays balanced)
  if (m.dream > 0.8) { roles.usePads = true; roles.bassPattern = 'sustain'; }
  if (m.dream < 0.12) { roles.usePads = false; }
  if (m.energy < 0.18) { roles.drumStyle = 'sparse'; roles.bassPattern = pickBassPattern(rng, 'sparse', m); }
  if (m.energy < 0.15) { roles.useStabs = false; roles.useArp = false; }
  if (m.energy > 0.9 && persona.drums.includes('four')) { roles.drumStyle = 'four'; }
  if (m.energy > 0.88) { roles.useArp = true; }
  if (m.glitch > 0.88) { roles.chopStyle = 'stutter'; }
  // musical floor: a track with no topline at all still needs motion
  if (roles.leadBehavior === 'none' && roles.chopStyle === 'none') {
    roles.useArp = true;
    roles.arpInBreaks = true;
    roles.usePads = true;
  }
  if (locks.roles) Object.assign(roles, locks.roles);
  const {
    drumStyle, bassPattern, leadBehavior, chopStyle,
    useArp, usePads, useStabs, leadInBreaks, arpInBreaks,
  } = roles;

  // --- Stage 2: the core musical idea (composed BEFORE any production) -----
  // The hook is the track's DNA; chops sing it, the plan develops it.
  const HOOK_CHARACTER = { motif: 'melodic', anthem: 'anthem', burst: 'dense', minimal: 'minimal' };
  const character = HOOK_CHARACTER[leadBehavior] || 'melodic';
  const hook = locks.hook ?? designHook(rng.fork(), m, character);

  // --- Stage 3: the development plan (repetition > novelty, surprise budgeted)
  const plan = makePhrasePlan(rng.fork(), sections, m);
  const chopSeq = deriveChopSeq(hook, rng.fork(), sound.chop.vowels);

  // --- committed patterns: the LOOPS. Designed once, then repeated with
  // conviction — variation only at authored points. This is the difference
  // between a groove and dice.
  const groove = locks.groove ?? designGroove(rng.fork(), m, drumStyle, persona);
  const bassRiff = locks.bassRiff !== undefined
    ? locks.bassRiff
    : designBassRiff(rng.fork(), m, bassPattern, groove);
  const arpPattern = locks.arpPattern ?? designArpPattern(rng.fork(), m);
  const stabSteps = locks.stabSteps ?? designStabs(rng.fork(), m);
  const chopMeta = { // chop delivery decisions, frozen so the loop is a loop
    retrig: chopSeq.map(() => rng.chance(m.glitch * 0.5)),
    stutterBeat: rng.int(0, 3),
    oneshotStep: rng.pick([0, 2, 4]),
    oneshotGlide: rng.pick([-4, -2, 3, 5]),
    inDrops: rng.chance(0.4 + m.weird * 0.3),
  };

  const events = [];

  // --- render sections -------------------------------------------------------
  let barCursor = 0;
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const next = sections[si + 1];
    for (let b = 0; b < sec.bars; b++) {
      const gb = barCursor + b;
      const t0 = gb * bar;
      // swing: every odd 16th is delayed; fractional steps (rolls) stay straight
      const st = (s) => t0 + (s + (Number.isInteger(s) && s % 2 === 1 ? swing * 0.55 : 0)) * step;
      const B = {
        t0, st, step, spb, bar, gb,
        sec: sec.name, level: sec.level,
        barInSection: b,
        isLastBar: b === sec.bars - 1,
        buildAmt: sec.name === 'build' ? (b + 1) / sec.bars : 1,
        nextIsDrop: next?.name === 'drop',
        chord: chordAt(gb),
        nextChord: chordAt(gb + 1),
      };

      genDrums(events, rng, m, B, groove, drumStyle);
      genBass(events, rng, m, B, bassPattern, bassRiff, { rootMidi, scale });
      if (usePads) genPads(events, rng, m, B, harmonicRhythm, persona);
      if (useStabs) genStabs(events, m, B, stabSteps);
      if (useArp) genArp(events, m, B, arpPattern, arpInBreaks);
      if (leadBehavior !== 'none' && b % 2 === 0) {
        genLeadHook(events, rng, m, B, {
          hook,
          variant: plan[si]?.[Math.floor(b / 2)] ?? 'exact',
          halfOnly: b === sec.bars - 1, // unpaired last bar: render bar 1 only
          rootMidi, scale, reg: sound.lead.reg, leadInBreaks,
        });
      }
      if (chopStyle !== 'none') genChops(events, rng, m, B, chopStyle, chopSeq, {
        rootMidi, scale, reg: sound.chop.reg, barInSection: b, meta: chopMeta,
      });
      genGates(events, rng, m, B, persona);
    }

    genBoundaryFx(events, rng, m, persona, sec, next, barCursor, bar, spb);
    barCursor += sec.bars;
  }

  // humanize melodic/percussive timing, then sort + clamp
  for (const ev of events) {
    if (ev.type === 'lead' || ev.type === 'arp' || ev.type === 'chop' || ev.type === 'hat' || ev.type === 'perc') {
      ev.t = Math.max(0, ev.t + rng.range(-1, 1) * humanize);
    }
    ev.t = Math.min(ev.t, duration - 0.01);
  }
  events.sort((a, b) => a.t - b.t);

  const name = makeName(new RNG(seed ^ 0x9E3779B9));
  const assetIds = collectAssetIds(sound);
  return {
    seed,
    name,
    baseName: name, // mutation children keep the family name (set by mutate())
    lineage: 1,
    persona: persona.id,
    structureName,
    drumStyle,
    // DNA: everything Mutate needs to breed a child that stays related.
    // The hook IS the track's identity — children inherit it to stay family.
    dna: {
      degrees: degrees.slice(),
      harmonicRhythm,
      voicing,
      swing,
      hook,
      groove,
      bassRiff,
      arpPattern,
      stabSteps,
      roles: { ...roles },
    },
    bpm,
    key: `${noteName(rootMidi)} ${scaleName}`,
    scaleName,
    rootMidi,
    swing,
    duration,
    sections: sections.map((s) => ({ ...s })),
    macros: { ...raw },
    sound,
    assetIds,
    events,
  };
}

// ---------------------------------------------------------------------------
// scale / structure / behavior selection

function pickScale(rng, persona, m) {
  const DARK_SCALES = new Set(['minor', 'phrygian', 'harmonicMinor']);
  return rng.weighted(persona.scales.map(([name, w]) => {
    const darkFit = DARK_SCALES.has(name) ? 0.4 + m.dark * 1.6 : 1.6 - m.dark * 1.2;
    return [name, w * Math.max(0.05, darkFit)];
  }));
}

function pickBassPattern(rng, drumStyle, m) {
  const pools = {
    four: ['lock', 'offbeat', 'walk'],
    trap: ['lock', 'walk'],
    bounce: ['lock'],
    sparse: ['sustain', 'lock'],
    scatter: ['lock', 'walk', 'sustain'],
  };
  if (m.dream > 0.65 && rng.chance(0.5)) return 'sustain';
  return rng.pick(pools[drumStyle] || ['lock']);
}

function pickLeadBehavior(rng, persona, m) {
  return rng.weighted(persona.leadBehaviors.map((b) => {
    let w = 1;
    if (b === 'burst') w = 0.4 + m.energy * 1.2 + m.chaos * 0.6;
    if (b === 'anthem') w = 0.5 + m.dream * 1.2;
    if (b === 'minimal') w = 0.6 + (1 - m.energy) * 0.8;
    if (b === 'motif') w = 1.1;
    if (b === 'none') w = 0.35;
    return [b, w];
  }));
}

/**
 * Structure families give tracks different dramaturgies — not every song is
 * intro/build/drop. Each section carries a `level` (intensity 0..1) that
 * scales density and velocity inside the generators, so even two 'club'
 * tracks have different energy curves.
 */
function buildStructure(rng, persona, m, bar) {
  // chaos at the extreme forces collage dramaturgy — unmistakable
  const structureName = m.chaos > 0.85 ? 'collage' : rng.pick(persona.structures);
  let tpl;
  const S = (name, bars, level) => ({ name, bars, level });

  // ~90 s arcs: two full waves instead of one sketch. Sections still loop
  // internally, so length reads as development, not padding.
  switch (structureName) {
    case 'club':
      tpl = [
        S('intro', 2, 0.35), S('build', rng.pick([2, 4]), 0.6),
        S('drop', 8, rng.range(0.85, 0.95)), S('break', rng.pick([2, 4]), 0.4),
        S('drop', 8, 1), S('break', 2, 0.45), S('build', 2, 0.65),
        S('drop', rng.pick([8, 10]), 1), S('outro', 2, 0.3),
      ];
      break;
    case 'hook':
      tpl = [
        S('drop', 8, rng.range(0.8, 0.9)), S('break', 4, 0.4),
        S('drop', 8, 0.95), S('break', 4, 0.45),
        S('drop', rng.pick([8, 10]), 1), S('outro', 2, 0.3),
      ];
      break;
    case 'loop': {
      // evolving jam: same groove, a long swell and a long release
      const l0 = rng.range(0.5, 0.65);
      tpl = [
        S('drop', 6, l0), S('drop', 8, l0 + 0.12), S('drop', 8, Math.min(1, l0 + 0.28)),
        S('break', 2, 0.5), S('drop', 8, Math.min(1, l0 + 0.35)),
        S('drop', 6, l0 + 0.1), S('outro', 2, 0.3),
      ];
      break;
    }
    case 'ambient':
      tpl = [
        S('intro', 4, 0.4), S('break', 8, rng.range(0.5, 0.65)),
        S('break', 8, rng.range(0.65, 0.85)), S('break', rng.pick([6, 8]), 0.7),
        S('break', 6, 0.55), S('outro', 4, 0.35),
      ];
      break;
    case 'collage': {
      tpl = [];
      const n = rng.int(8, 11);
      for (let i = 0; i < n; i++) {
        tpl.push(S(rng.weighted([['drop', 2], ['break', 1.4], ['build', 0.7], ['intro', 0.5]]),
          rng.pick([2, 4, 4]), rng.range(0.3, 1)));
      }
      tpl.push(S('outro', 2, 0.3));
      break;
    }
    default:
      tpl = [S('drop', 24, 1), S('outro', 2, 0.3)];
  }

  // stretch/shrink the largest section so duration lands in ~75–100 s
  const total = () => tpl.reduce((n, s) => n + s.bars, 0) * bar;
  let guard = 30;
  while (total() > 100 && guard--) {
    const big = tpl.slice().sort((a, b) => b.bars - a.bars)[0];
    if (big.bars <= 2) break;
    big.bars -= 2;
  }
  guard = 30;
  while (total() < 75 && guard--) {
    const big = tpl.filter((s) => s.name !== 'outro').sort((a, b) => b.bars - a.bars)[0];
    big.bars += 2;
  }
  return { sections: tpl, structureName };
}

// ---------------------------------------------------------------------------
// sound design: resolve every timbre to jittered numbers (the "infinite kit")

function designSound(rng, persona, m, avoidSet = new Set()) {
  const aggression = clamp01(m.energy * 0.5 + m.glitch * 0.25 + m.bounce * 0.15 + (1 - m.dream) * 0.15);
  const mix = persona.mix;

  const KICKS = {
    punchy: () => ({ f0: rng.range(150, 195), f1: rng.range(40, 50), pdec: rng.range(0.05, 0.08), dec: rng.range(0.2, 0.3), click: rng.range(0.3, 0.6), grit: 0, gain: 1.05 }),
    boomy:  () => ({ f0: rng.range(115, 150), f1: rng.range(31, 40), pdec: rng.range(0.07, 0.12), dec: rng.range(0.35, 0.6), click: rng.range(0.1, 0.3), grit: 0, gain: 1.1 }),
    soft:   () => ({ f0: rng.range(100, 140), f1: rng.range(38, 48), pdec: rng.range(0.05, 0.09), dec: rng.range(0.14, 0.24), click: rng.range(0, 0.15), grit: 0, gain: 0.85 }),
    clicky: () => ({ f0: rng.range(200, 270), f1: rng.range(44, 56), pdec: rng.range(0.02, 0.04), dec: rng.range(0.1, 0.18), click: rng.range(0.5, 0.85), grit: 0, gain: 0.95 }),
    harsh:  () => ({ f0: rng.range(160, 210), f1: rng.range(36, 46), pdec: rng.range(0.04, 0.07), dec: rng.range(0.25, 0.4), click: rng.range(0.4, 0.7), grit: rng.range(0.4, 0.8), gain: 1.1 }),
  };
  const SNARES = {
    tight:  () => ({ bp: rng.range(1800, 2500), q: rng.range(0.7, 1.2), dec: rng.range(0.1, 0.17), body: rng.range(0.25, 0.45), fizz: 0, triple: false, verb: 0.14 }),
    clappy: () => ({ bp: rng.range(1150, 1650), q: rng.range(1.1, 1.8), dec: rng.range(0.14, 0.22), body: 0, fizz: 0, triple: true, verb: 0.28 }),
    airy:   () => ({ bp: rng.range(850, 1400), q: rng.range(0.5, 0.9), dec: rng.range(0.25, 0.42), body: rng.range(0.1, 0.25), fizz: 0, triple: false, verb: 0.45 }),
    fizzy:  () => ({ bp: rng.range(2400, 3400), q: rng.range(0.6, 1), dec: rng.range(0.16, 0.28), body: rng.range(0, 0.2), fizz: rng.range(0.3, 0.6), triple: false, verb: 0.2 }),
  };

  const kick = KICKS[rng.pick(persona.kicks)]();
  kick.gain *= 0.9 + aggression * 0.25;
  const snare = SNARES[rng.pick(persona.snares)]();

  const sound = {
    aggression,
    kick,
    snare,
    hat: {
      type: rng.pick(persona.hats),
      hp: rng.range(6200, 10800),
      decC: rng.range(0.025, 0.08),
      decO: rng.range(0.16, 0.42),
      gain: rng.range(0.28, 0.4),
    },
    perc: { freq: rng.range(420, 1100), dec: rng.range(0.045, 0.1), tri: rng.chance(0.5) },
    bass: {
      type: rng.pick(persona.basses),
      lp: rng.range(350, 1400),
      fmRatio: rng.pick([1, 2, 2, 3]),
      fmIndex: rng.range(1.5, 4),
      sawMix: rng.range(0.08, 0.3),
      gain: 0.9 + aggression * 0.15,
    },
    lead: {
      type: rng.pick(persona.leads),
      reg: rng.int(70, 77),
      detune: rng.range(7, 16) * (1 + m.dream * 0.6),
      bright: 0.6 + (1 - m.dark) * 0.9 + m.energy * 0.4,
      vibRate: rng.range(4.4, 6.8),
      vibAmt: rng.range(6, 26),
      bellRatio: rng.pick([2, 2.76, 3.01, 3.5]),
      bellIndex: rng.range(1.8, 4.5),
      // per-track oscillator spectrum — no two tracks share a waveform
      wave: makeWaveSpec(rng, rng.weighted([['saw', 2], ['bright', 1.5], ['hollow', 1.2], ['organ', 0.8]])),
      ksDamp: rng.range(0.991, 0.9975), // string-lead decay color
    },
    pad: {
      type: rng.pick(persona.pads),
      vowel: rng.pick(['a', 'o', 'e', 'u']),
      bright: 0.5 + (1 - m.dark) * 0.9 + m.dream * 0.3,
      wide: 0.3 + m.dream * 0.5 + m.space * 0.2,
      wave: makeWaveSpec(rng, rng.weighted([['soft', 2], ['hollow', 1.5], ['organ', 1]])),
    },
    arp: {
      wave: makeWaveSpec(rng, rng.weighted([['bright', 1.5], ['soft', 1], ['hollow', 1]])),
    },
    chop: {
      vowels: rng.shuffle(['a', 'e', 'i', 'o', 'u']).slice(0, rng.int(2, 4)),
      vibRate: rng.range(4.5, 7),
      glideMul: rng.range(0.5, 1.8),
      reg: rng.int(78, 90) + Math.round(m.weird * 4),
    },
    mix: {
      ir: rr(rng, mix.ir) + m.space * 1.5,
      damp: rr(rng, mix.damp),
      delayBeats: { dotted: 0.75, quarter: 1, eighth: 0.5, slap: -1 }[mix.delay],
      delayFilt: rng.range(900, 2600),
      crush: lerp(mix.crush[0], mix.crush[1], m.glitch),
      bed: mix.bed,
      bedGain: rng.range(0.010, 0.022),
      pump: rr(rng, mix.pump),
      drive: rr(rng, mix.drive) * (0.8 + aggression * 0.5),
      // per-track master COLOR — kills the "same console" fingerprint
      curveKind: rng.weighted([['tanh', 2], ['soft', 1.5], ['asym', 1.2]]),
      tiltFreq: Math.exp(rng.range(Math.log(300), Math.log(4200))),
      tiltGain: rng.range(-3, 3),
      chorus: Math.max(0, Math.min(1, persona.aff.dream * 0.5 + m.dream * 0.45 - 0.25 + rng.range(-0.1, 0.1))),
    },
  };
  hybridize(sound, rng, persona, m, avoidSet);
  return sound;
}

/**
 * Hybridization: swap parts of the synthesized studio for RECORDED sound,
 * per the persona's sample affinity. Anti-repetition: ids in avoidSet
 * (core sounds of recent tracks) keep only 12% of their selection weight.
 */
function hybridize(sound, rng, persona, m, avoidSet) {
  const aff = SAMPLE_AFFINITY[persona.id] || { drums: 0.5, ac: 0.2, keys: 0.4, tex: 0.3, fx: 0.4, bass: 0.4, vox: 0.4 };
  const elecP = ELEC_PERSONAS.has(persona.id);
  const pickS = (kind, pred) => {
    let pool = POOL[kind] || [];
    if (pred) pool = pool.filter(pred);
    if (!pool.length) return null;
    return rng.weighted(pool.map((s) => [s, avoidSet.has(s.id) ? 0.12 : 1])).id;
  };
  // sources: 0/1 modeled kits, 2 VCSL recordings, 5 rendered digital pack, 6 real machines
  const digital = (s) => s.s === 0 || s.s === 1 || s.s === 5 || s.s === 6;
  const acoustic = (s) => s.s === 2;

  // drums: electronic personas live on the digital pools; acoustic recordings
  // are reserved for the personas where they're a creative choice
  if (rng.chance(aff.drums)) {
    sound.kick.sampleId = pickS('kick', digital);
    sound.kick.layer = m.energy > 0.6 && rng.chance(0.5);
  } else if (!elecP && rng.chance(aff.ac)) {
    sound.kick.sampleId = pickS('kick', acoustic);
  }
  if (rng.chance(aff.drums)) sound.snare.sampleId = pickS('snare', digital);
  else if (!elecP && rng.chance(aff.ac)) sound.snare.sampleId = pickS('snare', acoustic);
  sound.clap = {
    sampleId: rng.chance(Math.max(aff.drums, aff.ac))
      ? pickS('clap', elecP ? digital : undefined) : null,
  };
  if (rng.chance(aff.drums * 0.8)) {
    sound.hat.sampleId = pickS('hat', elecP ? digital : undefined);
    sound.hat.sampleOpenId = pickS('hato', elecP ? digital : undefined);
  }
  const percPred = elecP ? digital : (rng.chance(aff.ac) ? acoustic : undefined);
  if (rng.chance(Math.max(aff.drums * 0.8, aff.ac))) sound.perc.sampleId = pickS('perc', percPred);

  // sampled BASS: 808 / distorted 808 / reese families, repitched per note
  if (BASS_FAMILY_NAMES.length && rng.chance(aff.bass)) {
    const fam = rng.weighted(BASS_FAMILY_NAMES.map((f) => [f, avoidSet.has('bfam:' + f) ? 0.15 : 1]));
    sound.bass.type = 'sample';
    sound.bass.famName = fam;
    sound.bass.family = BASS_FAMILIES[fam].slice().sort((a, b) => a.root - b.root);
  }

  // sampled VOCAL CHOPS: formant-voice one-shots, repitched to the sung line
  if (VOX_FAMILY.length && rng.chance(aff.vox)) {
    sound.chop.family = VOX_FAMILY;
  }

  // pitched instrument families; electronic personas prefer digital keys
  if (KEY_FAMILY_NAMES.length && sound.lead.type !== 'none' && rng.chance(aff.keys)) {
    const fam = rng.weighted(KEY_FAMILY_NAMES.map((f) => {
      const isDigital = f.startsWith('fmkeys');
      let w = elecP ? (isDigital ? 2.5 : 0.5) : (isDigital ? 0.6 : 1.4);
      if (avoidSet.has('fam:' + f)) w *= 0.15;
      return [f, w];
    }));
    sound.lead.type = 'keys';
    sound.lead.famName = fam;
    sound.lead.family = KEY_FAMILIES[fam].slice().sort((a, b) => a.root - b.root);
    if (rng.chance(0.6)) sound.arp.useKeys = true;
  }

  // texture beds: VHS/cassette/modem for the digital personas, field
  // recordings and ocean drum for the atmospheric ones
  if (rng.chance(aff.tex)) {
    sound.mix.bedSampleId = pickS('tex', elecP ? (s) => s.s === 5 : undefined);
  }

  // FX one-shots: risers/impacts/reverses/tape artifacts
  if (rng.chance(aff.fx)) {
    sound.fxS = {
      impact: elecP ? (pickS('fx', (s) => /impact|tapestop/.test(s.id)) || pickS('fx', digital))
                    : (pickS('fx', (s) => s.id.startsWith('gong')) || pickS('fx')),
      crash: pickS('fx', (s) => /crash|ride|suscym|reverse/.test(s.id)),
      riser: pickS('fx', (s) => /riser/.test(s.id)),
      downlift: pickS('fx', (s) => /downsweep/.test(s.id)),
      swell: pickS('fx', (s) => /reverse|suscym/.test(s.id)),
    };
  }

  // wavetables: real AKWF spectra replace procedural ones most of the time
  const wavePick = (role) => {
    const fams = WAVE_ROLES[role].filter((f) => WAVE_FAMS[f]);
    if (!fams.length) return null;
    const fam = rng.pick(fams);
    const w = rng.weighted(WAVE_FAMS[fam].map((x) => [x, avoidSet.has(x.id) ? 0.15 : 1]));
    return { kind: 'akwf', id: w.id, imag: w.imag };
  };
  if (rng.chance(0.65)) sound.lead.wave = wavePick('lead') || sound.lead.wave;
  if (rng.chance(0.65)) sound.pad.wave = wavePick('pad') || sound.pad.wave;
  if (rng.chance(0.6)) sound.arp.wave = wavePick('arp') || sound.arp.wave;
}

/** every sample id a track needs — fetched lazily, awaited before export */
function collectAssetIds(sound) {
  const f = sound.fxS || {};
  const ids = [
    sound.kick.sampleId, sound.snare.sampleId, sound.clap && sound.clap.sampleId,
    sound.hat.sampleId, sound.hat.sampleOpenId, sound.perc.sampleId,
    sound.mix.bedSampleId, f.impact, f.crash, f.riser, f.downlift, f.swell,
    ...(sound.lead.family || []).map((x) => x.id),
    ...(sound.bass.family || []).map((x) => x.id),
    ...(sound.chop.family || []).map((x) => x.id),
  ].filter(Boolean);
  return [...new Set(ids)];
}

/**
 * Seeded oscillator spectrum: a procedural "wavetable". Kind sets the
 * harmonic law, per-track jitter makes every table unique — instruments
 * turn these into PeriodicWaves, so no two tracks share an oscillator.
 */
function makeWaveSpec(rng, kind) {
  const imag = [];
  for (let h = 1; h <= 20; h++) {
    let a = 0;
    if (kind === 'saw') a = 1 / h;
    else if (kind === 'hollow') a = h % 2 ? 1 / Math.pow(h, 1.3) : 0;
    else if (kind === 'bright') a = (1 / Math.pow(h, 0.8)) * (h > 6 && rng.chance(0.3) ? 2.2 : 1);
    else if (kind === 'soft') a = 1 / (h * h);
    else if (kind === 'organ') a = [1, 2, 3, 4, 6, 8].includes(h) ? rng.range(0.2, 1) : 0;
    a *= 0.75 + rng.next() * 0.5; // spectral jitter
    imag.push(Math.round(a * 1000) / 1000);
  }
  return { kind, imag };
}

// ---------------------------------------------------------------------------
// drums: emit the committed groove. Bars repeat; variation happens only at
// authored points (every-4th-bar kickVar, the roll slot, the fill into a
// drop). rng contributes only tiny velocity humanization.

function genDrums(events, rng, m, B, groove, style) {
  const { st, sec, level, spb } = B;
  const push = (type, s, vel, extra) => events.push({ t: st(s), type, vel, ...extra });

  if (sec === 'outro') {
    for (const h of groove.hat) if (h.s % 4 === 0) push('hat', h.s, h.v * 0.45);
    return;
  }
  const inBreak = sec === 'break';
  const inIntro = sec === 'intro';

  // --- kick ---
  if (!inBreak && !inIntro) {
    let kicks;
    if (sec === 'build') {
      kicks = groove.kick.filter((_, i) => i / groove.kick.length < B.buildAmt || i === 0);
    } else {
      kicks = B.barInSection % 4 === 3 ? groove.kickVar : groove.kick;
    }
    const kVel = (0.72 + m.energy * 0.23) * (0.8 + level * 0.2);
    for (const s of kicks) push('kick', s, kVel + rng.range(-0.03, 0.03));
  }

  // --- snare / clap ---
  if (!inIntro) {
    if (!inBreak) {
      for (const s of groove.snare) {
        push('snare', s, (0.62 + m.energy * 0.28) * (0.85 + level * 0.15));
        if (groove.clapLayer && level > 0.55) push('clap', s, 0.38 + m.energy * 0.35);
      }
      // authored fill into the next drop
      if (B.isLastBar && B.nextIsDrop && style !== 'sparse' && style !== 'scatter') {
        const div = m.energy > 0.6 ? 2 : 1;
        for (let i = 0; i < 4 * div; i++) push('snare', 12 + i / div, 0.4 + 0.5 * (i / (4 * div)));
      }
    } else if (B.barInSection % 2 === 0) {
      push('clap', 8, 0.5); // the lonely break clap — same place every time
    }
  }

  // --- hats: the loop, thinned to its anchors in intros/breaks ---
  const hatScale = inIntro ? 0.5 : inBreak ? 0.6 : 0.8 + level * 0.25;
  const thin = inIntro || inBreak;
  for (const h of groove.hat) {
    if (thin && h.s % 4 !== 0 && !h.o) continue;
    push('hat', h.s, h.v * hatScale + rng.range(-0.02, 0.02), h.o ? { open: true } : undefined);
  }
  // the roll lives at ITS slot, on the bar before the pattern repeats
  if (!inIntro && !inBreak && B.barInSection % 4 === 2 && m.glitch + m.chaos > 0.5) {
    const n = m.glitch > 0.6 ? 8 : 6;
    for (let i = 0; i < n; i++) {
      events.push({ t: B.t0 + groove.rollSlot * B.step + (i * spb) / n, type: 'hat', vel: 0.2 + 0.4 * (i / n) });
    }
  }

  // --- percussion loop ---
  if (!inIntro && groove.perc.length && level > 0.5) {
    for (const s of groove.perc) push('perc', s, 0.32);
  }
}

// ---------------------------------------------------------------------------
// bass: one riff, transposed with the harmony — a figure, not dice

function genBass(events, rng, m, B, pattern, riff, ctx) {
  if (B.sec === 'outro') return;
  const root = clampMidi(B.chord.root - 24, 28, 45);

  if (B.sec === 'intro' || pattern === 'sustain' || (B.sec === 'break' && pattern !== 'lock')) {
    if (B.sec === 'break' && pattern !== 'sustain' && B.barInSection % 2 === 1) return;
    const nextRoot = clampMidi(B.nextChord.root - 24, 28, 45);
    events.push({
      t: B.t0, type: 'bass', dur: B.bar * 0.98, midi: root,
      vel: B.sec === 'intro' ? 0.5 : 0.75,
      glideTo: nextRoot !== root && pattern === 'sustain' ? nextRoot : undefined,
    });
    return;
  }
  if (B.sec === 'break' || !riff) return;

  for (const n of riff) {
    let midi = root + n.iv;
    if (n.iv !== 0 && n.iv !== 12) midi = quantizeToScale(midi, ctx.rootMidi, ctx.scale);
    events.push({
      t: B.st(n.s), type: 'bass',
      dur: Math.min(n.d * B.step * 0.92, B.spb * 1.5),
      midi: clampMidi(midi, 26, 50),
      vel: 0.82 + rng.range(-0.04, 0.04),
    });
  }
}

// ---------------------------------------------------------------------------
// harmony layers

function genPads(events, rng, m, B, harmonicRhythm, persona) {
  const { sec, gb, bar } = B;
  const want = sec === 'intro' || sec === 'break' || sec === 'outro'
    || (sec === 'drop' && m.dream > 0.15) || (sec === 'build' && m.dream > 0.35);
  if (!want) return;
  const len = Math.max(harmonicRhythm, m.dream < 0.5 ? 2 : 1);
  if (gb % len !== 0) return;
  events.push({
    t: B.t0, type: 'pad', dur: bar * len * 0.98, midis: B.chord.tones,
    vel: (sec === 'drop' ? 0.4 : 0.55) * (0.7 + B.level * 0.3),
  });
}

/** stabs hit the SAME offbeats every bar — a part, not a probability */
function genStabs(events, m, B, stabSteps) {
  if (B.sec !== 'drop' && B.sec !== 'build') return;
  for (const s of stabSteps) {
    events.push({
      t: B.st(s), type: 'stab', dur: B.step * 1.6, midis: B.chord.tones,
      vel: (0.5 + m.bounce * 0.12) * (0.8 + B.level * 0.2),
    });
  }
}

/** one arp figure per track, re-voiced against each chord */
function genArp(events, m, B, pat, arpInBreaks) {
  const { sec } = B;
  if (sec === 'outro') return;
  if (sec === 'break' && !arpInBreaks) return;
  if (sec === 'build' && m.energy < 0.35) return;
  const tones = B.chord.tones.map((t) => clampMidi(t + 12, 70, 90));
  const L = tones.length;
  for (let k = 0; k < pat.seq.length; k++) {
    if (pat.seq[k] === null) continue;
    let idx;
    if (pat.dir === 'up') idx = k % L;
    else if (pat.dir === 'down') idx = L - 1 - (k % L);
    else idx = Math.abs(((k % (2 * L - 2)) + L - 1) % (2 * L - 2) - (L - 1));
    const s = k * pat.rate;
    events.push({
      t: B.st(s), type: 'arp', dur: B.step * pat.rate * 0.9,
      midi: tones[idx],
      vel: (s % 4 === 0 ? 0.5 : 0.35) * (0.8 + B.level * 0.2),
    });
  }
}

// ---------------------------------------------------------------------------
// lead melody — the hook, developed by the phrase plan (see hooks.js)

/**
 * Renders one 2-bar statement of the hook (or its planned variant) starting
 * at this bar. Glitch retriggers DECORATE notes on top of the plan — surprise
 * never replaces the idea.
 */
function genLeadHook(events, rng, m, B, ctx) {
  const { sec } = B;
  const inDrop = sec === 'drop';
  const inBreak = sec === 'break';
  const introEcho = sec === 'intro' && m.dream > 0.45;
  const inBuild = sec === 'build' && m.energy > 0.35;
  if (!inDrop && !(inBreak && ctx.leadInBreaks) && !introEcho && !inBuild) return;

  const notes = variantNotes(ctx.hook, ctx.variant, rng);
  const rendered = renderHook(notes, {
    scale: ctx.scale,
    rootMidi: ctx.rootMidi,
    base: ctx.reg,
    chordFor: (s) => (s < 16 ? B.chord : B.nextChord),
  });

  const baseVel = introEcho ? 0.42 : inBreak ? 0.5 : inBuild ? 0.55 : 0.68;
  for (const n of rendered) {
    if (ctx.halfOnly && n.s >= 16) continue;
    const midi = clampMidi(n.midi, 58, 97);
    const dur = Math.min(n.len * B.step * 0.94, B.spb * 2.5);
    const accent = n.s % 16 === 0 ? 0.07 : n.s % 4 === 0 ? 0.03 : 0;
    const vel = baseVel + accent + rng.range(-0.03, 0.03);
    // glitch decoration: shatter a note into a retrigger burst
    if (inDrop && rng.chance(m.glitch * 0.45)) {
      const reps = rng.pick([3, 4, 6, 8]);
      for (let k = 0; k < reps; k++) {
        events.push({
          t: B.st(n.s) + (k * dur) / reps, type: 'lead', dur: (dur / reps) * 0.85,
          midi: midi + (m.weird > 0.5 && rng.chance(0.4) ? k * rng.pick([1, 2]) : 0),
          vel: vel * (1 - 0.5 * (k / reps)),
        });
      }
    } else {
      events.push({ t: B.st(n.s), type: 'lead', dur, midi, vel });
    }
  }
}

// ---------------------------------------------------------------------------
// vocal chops — the voice SINGS the hook (shared DNA), in three deliveries

function genChops(events, rng, m, B, style, chopSeq, ctx) {
  const { sec } = B;
  const inBreak = sec === 'break';
  const inDrop = sec === 'drop';
  if (!inBreak && !(inDrop && ctx.meta.inDrops)) return; // frozen decision
  if (!chopSeq.length) return;

  const toMidi = (deg) => {
    let midi = ctx.rootMidi + degreeToSemis(ctx.scale, deg);
    while (midi < ctx.reg - 7) midi += 12;
    while (midi > ctx.reg + 9) midi -= 12;
    return midi;
  };

  if (style === 'oneshot') {
    // one long bent sung note every 2 bars — the hook's opening pitch, held
    if (ctx.barInSection % 2 === 1) return;
    events.push({
      t: B.st(ctx.meta.oneshotStep), type: 'chop', dur: B.spb * 2.2,
      midi: toMidi(chopSeq[0].deg), vel: 0.55,
      vowel: chopSeq[0].vowel, glide: ctx.meta.oneshotGlide,
    });
    return;
  }

  if (style === 'stutter') {
    // the hook's first note shattered across a beat — the classic chop loop
    if (ctx.barInSection % 2 === 1) return; // every other bar, same slot
    const beat = ctx.meta.stutterBeat;
    const midi = toMidi(chopSeq[0].deg);
    const n = rng.pick([3, 4, 4, 6, 8]);
    for (let k = 0; k < n; k++) {
      events.push({
        t: B.t0 + beat * B.spb + (k * B.spb) / n, type: 'chop', dur: (B.spb / n) * 0.85,
        midi: Math.min(105, midi + (rng.chance(m.weird * 0.5) ? Math.round(k * rng.range(0.5, 2)) : 0)),
        vel: 0.55 * (1 - 0.4 * (k / n)), vowel: chopSeq[k % chopSeq.length].vowel, glide: 0,
      });
    }
    return;
  }

  // 'phrase': sing the hook's structural notes
  if (inDrop && ctx.barInSection % 2 === 1) return;
  for (let ci = 0; ci < chopSeq.length; ci++) {
    const note = chopSeq[ci];
    const dur = Math.min(note.lenSteps * B.step * 0.95, B.spb);
    const vel = (inBreak ? 0.62 : 0.5) + rng.range(-0.03, 0.03);
    if (ctx.meta.retrig[ci]) {
      const rep = rng.pick([2, 3, 4]);
      for (let k = 0; k < rep; k++) {
        events.push({
          t: B.st(note.s) + k * (dur / rep), type: 'chop', dur: (dur / rep) * 0.9,
          midi: toMidi(note.deg), vel: vel * (1 - 0.3 * (k / rep)),
          vowel: note.vowel, glide: note.glide,
        });
      }
    } else {
      events.push({
        t: B.st(note.s), type: 'chop', dur, midi: toMidi(note.deg), vel,
        vowel: note.vowel, glide: note.glide,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// glitch gates + boundary FX (persona vocabulary)

function genGates(events, rng, m, B, persona) {
  if (B.sec !== 'drop' || m.glitch < 0.35) return;
  if (!persona.fx.includes('gate')) return;
  if (!rng.chance((m.glitch - 0.35) * 1.1 * B.level)) return;
  events.push({ t: B.t0 + 3 * B.spb, type: 'gate', dur: B.spb, rate: rng.pick([8, 12, 16]) });
}

function genBoundaryFx(events, rng, m, persona, sec, next, barCursor, bar, spb) {
  const has = (x) => persona.fx.includes(x);
  const secStart = barCursor * bar;
  const secEnd = (barCursor + sec.bars) * bar;

  if (sec.name === 'intro' && has('sweep')) {
    events.push({ t: secStart, type: 'sweep', dur: Math.min(sec.bars, 2) * bar });
  }
  if (sec.name === 'drop') {
    if (has('impact')) events.push({ t: secStart, type: 'impact', vel: 0.9 });
    if (has('crash') && rng.chance(0.6)) events.push({ t: secStart, type: 'crash', vel: 0.6 });
    if (next && (next.name === 'break' || next.name === 'outro') && has('downlift')) {
      events.push({ t: secEnd, type: 'downlift', dur: bar });
    }
  }
  if (next && next.name === 'drop') {
    if (has('riser')) {
      const bars = Math.min(2, sec.bars);
      events.push({ t: secEnd - bars * bar, type: 'riser', dur: bars * bar });
    } else if (has('swell')) {
      events.push({ t: secEnd - bar, type: 'swell', dur: bar });
    }
    if (has('cut') && rng.chance(0.4 + m.glitch * 0.4)) {
      events.push({ t: secEnd - spb * 0.5, type: 'gate', dur: spb * 0.5, rate: 2 });
    }
  }
  if (sec.name === 'break' && has('swell') && next && rng.chance(0.4)) {
    events.push({ t: secEnd - bar, type: 'swell', dur: bar });
  }
}

// ---------------------------------------------------------------------------
// helpers

function clampMidi(x, lo, hi) {
  while (x < lo) x += 12;
  while (x > hi) x -= 12;
  return x;
}

/**
 * Voice-lead the progression: after the first chord, place every tone in the
 * octave closest to the previous chord's voicing. Minimal movement between
 * chords is the difference between "typed" and "played" harmony.
 */
function voiceLeadChords(chords) {
  for (let i = 1; i < chords.length; i++) {
    const prev = chords[i - 1].tones;
    let led = chords[i].tones.map((t) => {
      let best = t, bd = Infinity;
      for (const oct of [-12, 0, 12]) {
        const c = t + oct;
        const d = Math.min(...prev.map((p) => Math.abs(p - c)));
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    });
    led = [...new Set(led)].sort((a, b) => a - b);
    // keep the register honest if leading drifted the chord out of range
    while (Math.min(...led) < 50) led = led.map((t) => t + 12);
    while (Math.max(...led) > 92) led = led.map((t) => t - 12);
    chords[i].tones = led;
  }
}

/** Voicing styles place the same chord in different registers/spreads. */
function voiceChord(tones, style) {
  const windows = { close: [60, 76], open: [53, 81], shimmer: [67, 89] };
  const [lo, hi] = windows[style] || windows.close;
  const out = tones.map((t) => clampMidi(t, lo, hi));
  out.sort((a, b) => a - b);
  for (let i = 1; i < out.length; i++) {
    if (out[i] === out[i - 1]) out[i] += 12;
    if (out[i] > hi + 6) out[i] -= 12;
  }
  const uniq = [...new Set(out)].sort((a, b) => a - b);
  // open voicing: push the top note up an octave for spread when cramped
  if (style === 'open' && uniq.length > 2 && uniq[uniq.length - 1] - uniq[0] < 10) {
    uniq[uniq.length - 1] += 12;
  }
  return uniq;
}
