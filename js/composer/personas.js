// Generator personas: hidden creative identities sampled BEFORE composing.
//
// This is the anti-convergence layer. Flat randomness averages out — most
// tracks land near the statistical mean and sound like one producer.
// Instead, each track first commits to a persona (a coherent bundle of
// tempo range, harmonic language, structure family, drum philosophy, synth
// palette, groove, FX vocabulary and mix character), and every downstream
// decision is conditioned on it. Personas never appear in the UI.
//
// The emotional sliders act twice:
//   1. they steer WHICH persona is likely (macro vector vs. persona affinity)
//   2. inside the persona they still scale densities, brightness, wets, ...
//
// All fields are pools/ranges — the composer resolves them with the track's
// seeded RNG, so two tracks with the same persona still differ in kit,
// voicing, structure and melody behavior.

// Field glossary:
//   aff        macro profile this persona "sounds like" (selection weighting)
//   bias       offsets added to user macros once chosen (identity pressure)
//   bpm        tempo range; energy positions inside it
//   swing      groove range (0 straight .. ~0.5 heavy)
//   scales     [name, weight] pool
//   prog       PROGRESSIONS pool names
//   harmonicRhythm  bars per chord options
//   voicing    'close' | 'open' | 'shimmer' pool
//   structures 'club' | 'hook' | 'loop' | 'ambient' | 'collage' pool
//   drums      drum algorithm pool: 'four'|'trap'|'bounce'|'sparse'|'scatter'
//   kicks/snares/hats  kit variant pools (resolved to numbers in sound design)
//   basses/leads/pads  synth type pools
//   leadBehaviors 'motif'|'anthem'|'burst'|'minimal'|'none'
//   chopStyles 'phrase'|'stutter'|'oneshot'|'none', chopProb
//   fx         transition vocabulary subset
//   mix        { ir(s), damp, delay, crush, bed, pump, drive }

export const PERSONAS = [
  {
    id: 'hyperpop',
    aff: { energy: 0.8, dream: 0.5, chaos: 0.55, glitch: 0.6, dark: 0.3, bounce: 0.7, space: 0.5, weird: 0.5 },
    bias: { energy: 0.1, glitch: 0.1, bounce: 0.1 },
    bpm: [142, 172], swing: [0, 0.06],
    scales: [['major', 3], ['lydian', 2], ['mixolydian', 1.5], ['minor', 1]],
    prog: ['bright', 'emo'], harmonicRhythm: [1], voicing: ['close', 'shimmer'],
    structures: ['club', 'hook'],
    drums: ['four', 'bounce'], percProb: 0.6,
    kicks: ['punchy', 'clicky'], snares: ['tight', 'clappy'], hats: ['noise', 'metal'],
    basses: ['sub', 'square'], leads: ['supersaw', 'chip'], pads: ['sawstack', 'shimmer'],
    leadBehaviors: ['motif', 'burst'], chopStyles: ['phrase', 'stutter'], chopProb: 1,
    arpProb: 0.75, padProb: 0.7, stabMul: 1.6,
    fx: ['riser', 'impact', 'downlift', 'gate', 'crash'],
    mix: { ir: [1.4, 2.6], damp: [0.3, 0.5], delay: 'dotted', crush: [0, 0.25], bed: null, pump: [0.45, 0.75], drive: [0.9, 1.5] },
  },
  {
    id: 'dreamcore',
    aff: { energy: 0.4, dream: 0.95, chaos: 0.25, glitch: 0.25, dark: 0.25, bounce: 0.35, space: 0.85, weird: 0.45 },
    bias: { dream: 0.25, space: 0.2, energy: -0.1 },
    bpm: [122, 148], swing: [0, 0.12],
    scales: [['lydian', 3], ['major', 2], ['dorian', 1.5]],
    prog: ['floaty', 'bright'], harmonicRhythm: [1, 2, 2], voicing: ['open', 'shimmer'],
    structures: ['loop', 'club', 'ambient'],
    drums: ['four', 'sparse'], percProb: 0.25,
    kicks: ['soft', 'boomy'], snares: ['airy', 'clappy'], hats: ['noise'],
    basses: ['sub'], leads: ['air', 'bell', 'string', 'supersaw'], pads: ['shimmer', 'choir', 'sawstack'],
    leadBehaviors: ['anthem', 'minimal', 'motif'], chopStyles: ['oneshot', 'phrase'], chopProb: 0.8,
    arpProb: 0.7, padProb: 1, stabMul: 0.4,
    fx: ['swell', 'sweep', 'crash'],
    mix: { ir: [3.5, 6], damp: [0.15, 0.35], delay: 'quarter', crush: [0, 0], bed: 'air', pump: [0.25, 0.5], drive: [0.5, 0.9] },
  },
  {
    id: 'digicore',
    aff: { energy: 0.9, dream: 0.3, chaos: 0.8, glitch: 0.85, dark: 0.45, bounce: 0.6, space: 0.35, weird: 0.7 },
    bias: { chaos: 0.2, glitch: 0.2, energy: 0.1 },
    bpm: [150, 178], swing: [0, 0.04],
    scales: [['minor', 3], ['phrygian', 1.5], ['harmonicMinor', 1], ['major', 1]],
    prog: ['dark', 'emo'], harmonicRhythm: [1], voicing: ['close'],
    structures: ['hook', 'collage', 'club'],
    drums: ['scatter', 'trap', 'bounce'], percProb: 0.5,
    kicks: ['clicky', 'harsh'], snares: ['tight', 'fizzy'], hats: ['metal', 'noise'],
    basses: ['square', 'fm'], leads: ['chip', 'pluck', 'supersaw'], pads: ['sawstack'],
    leadBehaviors: ['burst', 'motif'], chopStyles: ['stutter', 'phrase'], chopProb: 0.7,
    arpProb: 0.35, padProb: 0.25, stabMul: 1,
    fx: ['gate', 'cut', 'impact', 'riser'],
    mix: { ir: [0.9, 1.8], damp: [0.4, 0.6], delay: 'eighth', crush: [0.2, 0.55], bed: null, pump: [0.5, 0.8], drive: [1.3, 2.2] },
  },
  {
    id: 'cloudrap',
    aff: { energy: 0.3, dream: 0.7, chaos: 0.2, glitch: 0.2, dark: 0.6, bounce: 0.5, space: 0.75, weird: 0.35 },
    bias: { energy: -0.2, space: 0.15, dark: 0.1 },
    bpm: [118, 140], swing: [0.08, 0.3],
    scales: [['minor', 3], ['dorian', 2], ['phrygian', 1]],
    prog: ['dark', 'emo'], harmonicRhythm: [2], voicing: ['open'],
    structures: ['loop', 'hook'],
    drums: ['trap', 'sparse'], percProb: 0.3,
    kicks: ['boomy'], snares: ['clappy', 'airy'], hats: ['noise', 'metal'],
    basses: ['sub'], leads: ['air', 'bell', 'string'], pads: ['drone', 'choir'],
    leadBehaviors: ['minimal', 'anthem', 'none'], chopStyles: ['oneshot', 'phrase'], chopProb: 0.75,
    arpProb: 0.25, padProb: 1, stabMul: 0.1,
    fx: ['sweep', 'downlift'],
    mix: { ir: [2.8, 5], damp: [0.35, 0.6], delay: 'dotted', crush: [0, 0.15], bed: 'vinyl', pump: [0.3, 0.55], drive: [0.6, 1.1] },
  },
  {
    id: 'ambient',
    aff: { energy: 0.1, dream: 0.85, chaos: 0.15, glitch: 0.15, dark: 0.4, bounce: 0.1, space: 0.95, weird: 0.5 },
    bias: { energy: -0.3, space: 0.25, dream: 0.2 },
    bpm: [112, 132], swing: [0, 0.1],
    scales: [['lydian', 2], ['dorian', 2], ['minor', 1.5], ['major', 1.5]],
    prog: ['floaty'], harmonicRhythm: [2], voicing: ['open', 'shimmer'],
    structures: ['ambient', 'loop'],
    drums: ['sparse'], percProb: 0.02,
    kicks: ['soft'], snares: ['airy'], hats: ['noise'],
    basses: ['sub'], leads: ['air', 'bell', 'none'], pads: ['drone', 'shimmer', 'choir'],
    leadBehaviors: ['minimal', 'anthem', 'none'], chopStyles: ['oneshot', 'none'], chopProb: 0.5,
    arpProb: 0.55, padProb: 1, stabMul: 0,
    fx: ['swell', 'sweep'],
    mix: { ir: [4.5, 7], damp: [0.1, 0.3], delay: 'quarter', crush: [0, 0], bed: 'air', pump: [0.1, 0.3], drive: [0.4, 0.7] },
  },
  {
    id: 'glitchpop',
    aff: { energy: 0.65, dream: 0.5, chaos: 0.7, glitch: 0.9, dark: 0.35, bounce: 0.5, space: 0.5, weird: 0.75 },
    bias: { glitch: 0.25, weird: 0.15 },
    bpm: [128, 158], swing: [0, 0.08],
    scales: [['major', 2], ['lydian', 1.5], ['minor', 2], ['mixolydian', 1]],
    prog: ['bright', 'floaty'], harmonicRhythm: [1, 2], voicing: ['close', 'shimmer'],
    structures: ['collage', 'loop', 'hook'],
    drums: ['scatter', 'bounce', 'four'], percProb: 0.6,
    kicks: ['clicky', 'punchy'], snares: ['fizzy', 'tight'], hats: ['metal'],
    basses: ['fm', 'square'], leads: ['bell', 'pluck', 'chip'], pads: ['shimmer', 'sawstack'],
    leadBehaviors: ['motif', 'burst', 'minimal'], chopStyles: ['stutter', 'phrase'], chopProb: 0.8,
    arpProb: 0.6, padProb: 0.5, stabMul: 0.7,
    fx: ['gate', 'cut', 'swell', 'crash'],
    mix: { ir: [1.5, 3], damp: [0.25, 0.5], delay: 'eighth', crush: [0.25, 0.6], bed: null, pump: [0.35, 0.6], drive: [1, 1.7] },
  },
  {
    id: 'emo',
    aff: { energy: 0.5, dream: 0.6, chaos: 0.3, glitch: 0.35, dark: 0.65, bounce: 0.45, space: 0.6, weird: 0.3 },
    bias: { dark: 0.1, dream: 0.1 },
    bpm: [126, 156], swing: [0, 0.1],
    scales: [['minor', 3], ['harmonicMinor', 1], ['dorian', 1.5]],
    prog: ['emo', 'dark'], harmonicRhythm: [1, 2], voicing: ['open', 'close'],
    structures: ['club', 'hook'],
    drums: ['trap', 'four', 'bounce'], percProb: 0.25,
    kicks: ['punchy', 'boomy'], snares: ['clappy', 'tight'], hats: ['noise'],
    basses: ['sub', 'reese'], leads: ['supersaw', 'air', 'string'], pads: ['sawstack', 'choir'],
    leadBehaviors: ['anthem', 'motif'], chopStyles: ['phrase', 'oneshot'], chopProb: 0.9,
    arpProb: 0.45, padProb: 0.85, stabMul: 0.6,
    fx: ['swell', 'impact', 'downlift', 'riser'],
    mix: { ir: [2.5, 4.5], damp: [0.25, 0.45], delay: 'dotted', crush: [0, 0.2], bed: null, pump: [0.35, 0.6], drive: [0.8, 1.3] },
  },
  {
    id: 'futurepop',
    aff: { energy: 0.7, dream: 0.55, chaos: 0.3, glitch: 0.3, dark: 0.25, bounce: 0.75, space: 0.55, weird: 0.3 },
    bias: { bounce: 0.15, energy: 0.05 },
    bpm: [132, 158], swing: [0, 0.14],
    scales: [['major', 2.5], ['mixolydian', 2], ['minor', 1.5]],
    prog: ['bright'], harmonicRhythm: [1], voicing: ['close', 'open'],
    structures: ['club', 'hook'],
    drums: ['four', 'bounce'], percProb: 0.55,
    kicks: ['punchy', 'boomy'], snares: ['clappy'], hats: ['noise', 'metal'],
    basses: ['reese', 'sub', 'square'], leads: ['supersaw', 'pluck'], pads: ['sawstack', 'shimmer'],
    leadBehaviors: ['anthem', 'motif'], chopStyles: ['phrase', 'stutter'], chopProb: 0.8,
    arpProb: 0.65, padProb: 0.6, stabMul: 1.4,
    fx: ['riser', 'impact', 'downlift', 'sweep'],
    mix: { ir: [1.8, 3.2], damp: [0.25, 0.45], delay: 'dotted', crush: [0, 0.1], bed: null, pump: [0.5, 0.8], drive: [0.9, 1.4] },
  },
  {
    id: 'lofi',
    aff: { energy: 0.25, dream: 0.6, chaos: 0.2, glitch: 0.3, dark: 0.55, bounce: 0.4, space: 0.45, weird: 0.35 },
    bias: { energy: -0.15, dark: 0.1 },
    bpm: [112, 138], swing: [0.15, 0.4],
    scales: [['dorian', 2.5], ['minor', 2], ['mixolydian', 1.5]],
    prog: ['emo', 'floaty'], harmonicRhythm: [1, 2], voicing: ['open'],
    structures: ['loop', 'ambient'],
    drums: ['sparse', 'trap'], percProb: 0.3,
    kicks: ['soft', 'boomy'], snares: ['airy', 'fizzy'], hats: ['noise'],
    basses: ['sub', 'square'], leads: ['bell', 'string', 'pluck', 'air'], pads: ['choir', 'drone'],
    leadBehaviors: ['minimal', 'motif'], chopStyles: ['phrase', 'none'], chopProb: 0.4,
    arpProb: 0.4, padProb: 0.9, stabMul: 0.3,
    fx: ['sweep'],
    mix: { ir: [1.8, 3.5], damp: [0.4, 0.65], delay: 'slap', crush: [0.15, 0.4], bed: 'vinyl', pump: [0.2, 0.45], drive: [0.7, 1.2] },
  },
  {
    id: 'rage',
    aff: { energy: 0.95, dream: 0.2, chaos: 0.6, glitch: 0.5, dark: 0.8, bounce: 0.8, space: 0.3, weird: 0.4 },
    bias: { energy: 0.15, dark: 0.15, bounce: 0.1 },
    bpm: [140, 170], swing: [0, 0.08],
    scales: [['phrygian', 3], ['minor', 2], ['harmonicMinor', 1.5]],
    prog: ['dark'], harmonicRhythm: [1, 2], voicing: ['close'],
    structures: ['hook', 'club', 'loop'],
    drums: ['bounce', 'trap'], percProb: 0.4,
    kicks: ['harsh', 'boomy'], snares: ['tight', 'fizzy'], hats: ['metal', 'noise'],
    basses: ['reese', 'fm'], leads: ['supersaw', 'chip'], pads: ['drone', 'sawstack'],
    leadBehaviors: ['minimal', 'motif'], chopStyles: ['stutter', 'phrase'], chopProb: 0.55,
    arpProb: 0.2, padProb: 0.45, stabMul: 1.1,
    fx: ['impact', 'gate', 'cut', 'riser'],
    mix: { ir: [1.2, 2.4], damp: [0.5, 0.7], delay: 'eighth', crush: [0.1, 0.4], bed: null, pump: [0.6, 0.9], drive: [1.6, 2.6] },
  },
  {
    id: 'experimental',
    aff: { energy: 0.5, dream: 0.45, chaos: 0.85, glitch: 0.6, dark: 0.5, bounce: 0.35, space: 0.6, weird: 0.95 },
    bias: { weird: 0.25, chaos: 0.15 },
    bpm: [116, 168], swing: [0, 0.25],
    scales: [['phrygian', 2], ['lydian', 2], ['harmonicMinor', 2], ['dorian', 1]],
    prog: ['dark', 'floaty', 'emo', 'bright'], harmonicRhythm: [1, 2], voicing: ['open', 'shimmer', 'close'],
    structures: ['collage', 'ambient', 'loop'],
    drums: ['scatter', 'sparse', 'bounce'], percProb: 0.65,
    kicks: ['clicky', 'harsh', 'soft'], snares: ['fizzy', 'airy'], hats: ['metal', 'noise'],
    basses: ['fm', 'square', 'reese'], leads: ['bell', 'chip', 'air', 'string', 'pluck'], pads: ['drone', 'choir', 'shimmer'],
    leadBehaviors: ['burst', 'minimal', 'anthem', 'none'], chopStyles: ['stutter', 'oneshot'], chopProb: 0.65,
    arpProb: 0.5, padProb: 0.7, stabMul: 0.5,
    fx: ['cut', 'gate', 'swell', 'crash', 'downlift'],
    mix: { ir: [2, 6], damp: [0.15, 0.6], delay: 'eighth', crush: [0.1, 0.5], bed: 'air', pump: [0.2, 0.6], drive: [0.8, 1.8] },
  },
  {
    // built almost entirely from vocal chops — the voice IS the track
    id: 'chopcore',
    aff: { energy: 0.6, dream: 0.55, chaos: 0.45, glitch: 0.65, dark: 0.35, bounce: 0.6, space: 0.55, weird: 0.6 },
    bias: { glitch: 0.15, weird: 0.1 },
    bpm: [134, 162], swing: [0, 0.1],
    scales: [['major', 2], ['minor', 2], ['mixolydian', 1.5]],
    prog: ['bright', 'emo'], harmonicRhythm: [1], voicing: ['close', 'shimmer'],
    structures: ['hook', 'loop', 'club'],
    drums: ['bounce', 'four'], percProb: 0.3,
    kicks: ['punchy', 'boomy'], snares: ['clappy'], hats: ['noise'],
    basses: ['sub'], leads: ['none', 'air'], pads: ['choir'],
    leadBehaviors: ['minimal', 'none'], chopStyles: ['phrase', 'stutter', 'oneshot'], chopProb: 1,
    arpProb: 0.15, padProb: 0.5, stabMul: 0.3,
    fx: ['gate', 'swell', 'impact'],
    mix: { ir: [1.8, 3.2], damp: [0.25, 0.45], delay: 'dotted', crush: [0, 0.2], bed: null, pump: [0.45, 0.7], drive: [0.8, 1.3] },
  },
  {
    // early-internet Y2K: chip bleeps, slap delay, naive bright major
    id: 'y2k',
    aff: { energy: 0.7, dream: 0.4, chaos: 0.35, glitch: 0.4, dark: 0.15, bounce: 0.65, space: 0.35, weird: 0.45 },
    bias: { dark: -0.15, bounce: 0.1 },
    bpm: [130, 152], swing: [0, 0.08],
    scales: [['major', 3], ['mixolydian', 2], ['lydian', 1]],
    prog: ['bright', 'floaty'], harmonicRhythm: [1], voicing: ['close'],
    structures: ['club', 'hook', 'loop'],
    drums: ['four', 'bounce'], percProb: 0.7,
    kicks: ['clicky', 'punchy'], snares: ['tight'], hats: ['metal', 'noise'],
    basses: ['square', 'sub'], leads: ['chip', 'bell', 'pluck'], pads: ['shimmer'],
    leadBehaviors: ['motif', 'minimal'], chopStyles: ['stutter', 'phrase'], chopProb: 0.6,
    arpProb: 0.85, padProb: 0.4, stabMul: 1.2,
    fx: ['riser', 'impact', 'gate', 'sweep'],
    mix: { ir: [0.9, 1.6], damp: [0.35, 0.55], delay: 'slap', crush: [0.15, 0.4], bed: null, pump: [0.4, 0.65], drive: [0.9, 1.4] },
  },
];


const MACRO_KEYS = ['energy', 'dream', 'chaos', 'glitch', 'dark', 'bounce', 'space', 'weird'];

/**
 * Sample a persona, weighted by how close the user's macro vector is to each
 * persona's affinity profile. Sliders therefore reshape the whole identity
 * distribution: full-dream/low-energy almost always lands in dreamcore /
 * ambient / cloudrap territory; maxed energy+chaos+glitch lands in digicore /
 * rage / glitchpop. A small floor keeps rare surprises possible.
 */
export function pickPersona(rng, macros) {
  const pairs = PERSONAS.map((p) => {
    let d2 = 0;
    for (const k of MACRO_KEYS) {
      const diff = (macros[k] ?? 0.5) - p.aff[k];
      d2 += diff * diff;
    }
    d2 /= MACRO_KEYS.length;
    return [p, Math.exp(-d2 * 14) + 0.03];
  });
  return rng.weighted(pairs);
}

/** Persona identity pressure: shift user macros toward the persona's home turf. */
export function effectiveMacros(macros, persona) {
  const out = { ...macros };
  for (const [k, v] of Object.entries(persona.bias)) {
    out[k] = Math.min(1, Math.max(0, (out[k] ?? 0.5) + v));
  }
  return out;
}
