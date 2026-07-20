// Groove vocabulary: authored rhythm language, not dice.
//
// The single biggest "machine tell" was that patterns were re-randomized
// every bar — no human plays that way. Real production commits to a loop:
// one drum groove, one bass riff, one arp figure, repeated with conviction
// and varied only at authored points (fills, every-4th-bar variations).
//
// This module holds CURATED patterns (things a producer would actually
// program) and design functions that pick + freeze one per track. The rng
// chooses between authored options; it does not invent rhythm.

// hat entries: {s: 16th step, v: velocity, o?: open}
const H = (s, v, o) => (o ? { s, v, o: true } : { s, v });

const off8 = [H(2, 0.55), H(6, 0.5), H(10, 0.55), H(14, 0.5)];
const off8open = [H(2, 0.55, true), H(6, 0.5), H(10, 0.55, true), H(14, 0.5)];
const straight8 = [H(0, 0.5), H(2, 0.32), H(4, 0.45), H(6, 0.32), H(8, 0.5), H(10, 0.32), H(12, 0.45), H(14, 0.32)];
const sixteenths = [
  H(0, 0.55), H(1, 0.22), H(2, 0.35), H(3, 0.22), H(4, 0.5), H(5, 0.22), H(6, 0.35), H(7, 0.25),
  H(8, 0.55), H(9, 0.22), H(10, 0.35), H(11, 0.22), H(12, 0.5), H(13, 0.22), H(14, 0.35), H(15, 0.28),
];
const trapHats = [ // 8ths with authored double-time stutters — the trap tell
  H(0, 0.5), H(2, 0.35), H(4, 0.45), H(6, 0.35), H(7, 0.3),
  H(8, 0.5), H(10, 0.35), H(12, 0.45), H(14, 0.35), H(15, 0.3),
];
const sparseHats = [H(4, 0.35), H(12, 0.35)];
const lazy8 = [H(2, 0.4), H(6, 0.35), H(10, 0.4), H(14, 0.35)];

// Each variant is a complete groove statement: kick + every-4th-bar
// variation + snare placement + hat pattern + where rolls live.
const GROOVES = {
  four: [
    { kick: [0, 4, 8, 12], kickVar: [0, 4, 8, 12, 14], snare: [4, 12], hat: off8, rollSlot: 12 },
    { kick: [0, 4, 8, 12], kickVar: [0, 4, 7, 8, 12], snare: [4, 12], hat: off8open, rollSlot: 8 },
    { kick: [0, 4, 8, 12], kickVar: [0, 4, 8, 11, 12], snare: [4, 12], hat: sixteenths, rollSlot: 12 },
  ],
  trap: [
    { kick: [0, 10], kickVar: [0, 10, 13], snare: [8], hat: trapHats, rollSlot: 12 },
    { kick: [0, 6, 11], kickVar: [0, 6, 11, 14], snare: [8], hat: trapHats, rollSlot: 4 },
    { kick: [0, 7, 10], kickVar: [0, 3, 7, 10], snare: [8], hat: straight8, rollSlot: 12 },
  ],
  bounce: [
    { kick: [0, 7, 10], kickVar: [0, 7, 10, 12], snare: [4, 12], hat: off8, rollSlot: 8 },
    { kick: [0, 3, 8, 11], kickVar: [0, 3, 8, 11, 14], snare: [4, 12], hat: straight8, rollSlot: 12 },
    { kick: [0, 6, 10, 12], kickVar: [0, 6, 10, 12, 15], snare: [4, 12], hat: sixteenths, rollSlot: 4 },
  ],
  sparse: [
    { kick: [0, 10], kickVar: [0, 10], snare: [8], hat: sparseHats, rollSlot: 12 },
    { kick: [0], kickVar: [0, 11], snare: [8], hat: lazy8, rollSlot: 8 },
  ],
  // 'scatter' is generated (chaotic placement) but then FROZEN — a weird
  // pattern that loops still sounds intentional; one that never repeats
  // sounds broken.
};

const PERC_PATTERNS = [[2, 9, 13], [5, 13], [2, 7, 10, 15], [3, 11], [6, 9, 14]];

export function designGroove(rng, m, style, persona) {
  let g;
  if (style === 'scatter') {
    const n = rng.int(2, 3 + Math.round(m.chaos * 2));
    const kick = [0, ...rng.shuffle([2, 3, 5, 6, 7, 9, 10, 11, 13, 14]).slice(0, n)].sort((a, b) => a - b);
    g = {
      kick,
      kickVar: [...kick, rng.pick([13, 14, 15])].sort((a, b) => a - b),
      snare: rng.pick([[4, 12], [8], [4, 11], [6, 12]]),
      hat: rng.pick([trapHats, sixteenths, straight8]),
      rollSlot: rng.pick([4, 8, 12]),
    };
  } else {
    const pool = GROOVES[style] || GROOVES.four;
    const v = rng.pick(pool);
    g = { kick: v.kick.slice(), kickVar: v.kickVar.slice(), snare: v.snare.slice(), hat: v.hat.map((h) => ({ ...h })), rollSlot: v.rollSlot };
  }
  // low energy commits to a thinner loop (fixed transformation, not per-bar dice)
  if (m.energy < 0.35) g.hat = g.hat.filter((_, i) => i % 2 === 0);
  if (m.energy < 0.25 && g.kick.length > 2) g.kick = g.kick.slice(0, 2);
  // percussion line: decided once, then part of the loop
  g.perc = rng.chance(persona.percProb + m.bounce * 0.15) ? rng.pick(PERC_PATTERNS).slice() : [];
  g.clapLayer = m.energy > 0.35; // committed, not re-rolled per bar
  return g;
}

// ---------------------------------------------------------------------------
// bass riffs: one figure per track, transposed with the harmony.
// iv = interval in semitones from the chord root (quantized to scale later).

const WALK_RIFFS = [
  [{ s: 0, iv: 0, d: 3 }, { s: 3, iv: 0, d: 4 }, { s: 8, iv: 7, d: 2 }, { s: 11, iv: 0, d: 4 }],
  [{ s: 0, iv: 0, d: 4 }, { s: 4, iv: 0, d: 3 }, { s: 8, iv: 12, d: 2 }, { s: 12, iv: 10, d: 3 }],
  [{ s: 0, iv: 0, d: 6 }, { s: 6, iv: 5, d: 2 }, { s: 8, iv: 0, d: 4 }, { s: 14, iv: 12, d: 2 }],
  [{ s: 0, iv: 0, d: 2 }, { s: 3, iv: 0, d: 3 }, { s: 6, iv: 0, d: 2 }, { s: 10, iv: 7, d: 3 }, { s: 14, iv: 0, d: 2 }],
];

export function designBassRiff(rng, m, pattern, groove) {
  if (pattern === 'sustain') return null; // handled as held notes
  let riff;
  if (pattern === 'offbeat') {
    riff = [2, 6, 10, 14].map((s) => ({ s, iv: 0, d: 3 }));
    if (rng.chance(0.5)) riff[3].iv = 12; // authored lift into the next bar
  } else if (pattern === 'walk') {
    riff = rng.pick(WALK_RIFFS).map((n) => ({ ...n }));
  } else { // 'lock': ride the kick — the genre default
    const steps = [...new Set(groove.kick)].sort((a, b) => a - b);
    riff = steps.map((s, i) => ({
      s, iv: 0, d: Math.min((i + 1 < steps.length ? steps[i + 1] : 16) - s, 6),
    }));
    if (m.bounce > 0.45 && riff.length > 1) {
      riff[rng.int(1, riff.length - 1)].iv = 12; // ONE octave pop, same spot every bar
    }
  }
  return riff;
}

// ---------------------------------------------------------------------------
// arp: one figure (direction + authored rests), repeated

export function designArpPattern(rng, m) {
  const rate = m.energy > 0.55 ? 1 : 2; // 16ths vs 8ths
  const slots = 16 / rate;
  const dir = rng.pick(['up', 'down', 'updown']);
  const restEvery = m.energy > 0.7 ? 0 : rng.pick([0, 4, 8]); // authored breathing
  const seq = [];
  for (let k = 0; k < slots; k++) {
    if (restEvery && k % restEvery === restEvery - 1) { seq.push(null); continue; }
    seq.push(k); // resolved against chord tones at render time
  }
  return { rate, dir, seq };
}

/** stab placement: chosen once; hits the same offbeats every bar */
export function designStabs(rng, m) {
  const pool = [[2, 10], [6, 14], [2, 6, 10, 14], [2, 10, 14], [6, 10]];
  const weights = pool.map((p) => [p, p.length <= 2 ? 1.5 - m.bounce * 0.5 : 0.5 + m.bounce * 1.2]);
  return rng.weighted(weights).slice();
}
