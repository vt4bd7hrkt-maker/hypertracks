// Mutate: breed a child composition from a parent's DNA.
//
// Instead of regenerating from scratch, mutate() builds a `locks` object —
// the genes the child INHERITS — and lets compose(newSeed, macros, locks)
// regenerate everything unlocked. Determinism holds: a child is fully
// defined by (parentComp, macros, amount, seed), and the returned comp
// object is self-contained like any other, so history/export/looping all
// work on children unchanged.
//
// Amount picks the evolutionary distance:
//   low    (< 0.37) — refinement: same harmony, melody, kit, arrangement;
//                     one detail rerolled (fills/chops/hats/percussion/arp feel)
//   medium (< 0.7)  — same key + chords + tempo(ish); ONE major axis rerolled:
//                     melody | drums | sound design | arrangement
//   high            — remix: same persona + tonal center, and it keeps either
//                     the motif or the chords (mutated) so a family resemblance
//                     survives; everything else regenerates

import { RNG } from '../core/rng.js';
import { compose } from './composer.js';

export function mutate(parent, macros, amount, seed, avoid = []) {
  const rng = new RNG((seed ^ 0xA5F1E2D3) >>> 0);
  const dna = parent.dna;
  const locks = { persona: parent.persona };

  const lockHarmony = () => {
    locks.scaleName = parent.scaleName;
    locks.rootMidi = parent.rootMidi;
    locks.degrees = dna.degrees.slice();
    locks.harmonicRhythm = dna.harmonicRhythm;
    locks.voicing = dna.voicing;
  };
  const lockArrangement = () => {
    locks.sections = parent.sections.map((s) => ({ ...s }));
    locks.structureName = parent.structureName;
    locks.swing = dna.swing;
  };
  const lockMelody = () => { locks.hook = dna.hook; };
  const lockGrooves = () => {
    locks.groove = dna.groove;
    locks.bassRiff = dna.bassRiff;
    locks.arpPattern = dna.arpPattern;
    locks.stabSteps = dna.stabSteps;
  };
  const lockAllSound = () => { locks.sound = { ...parent.sound }; };
  const lockRoles = () => { locks.roles = { ...dna.roles }; };

  if (amount < 0.37) {
    // --- refinement: keep nearly everything, reroll one detail --------------
    locks.bpm = parent.bpm;
    lockHarmony();
    lockArrangement();
    lockMelody();
    lockGrooves();
    lockAllSound();
    lockRoles();
    const tweak = rng.pick(['chops', 'hats', 'perc', 'arp']);
    if (tweak === 'chops') { const s = { ...locks.sound }; delete s.chop; locks.sound = s; }
    if (tweak === 'hats') { const s = { ...locks.sound }; delete s.hat; locks.sound = s; }
    if (tweak === 'perc') { const s = { ...locks.sound }; delete s.perc; locks.sound = s; }
    if (tweak === 'arp') {
      const r = { ...locks.roles }; delete r.useArp; delete r.arpInBreaks; locks.roles = r;
      delete locks.arpPattern; // an alternate figure — audibly a "new take"
    }
  } else if (amount < 0.7) {
    // --- one major axis changes, the rest holds ------------------------------
    locks.bpm = Math.min(178, Math.max(110, parent.bpm + rng.int(-5, 5)));
    lockHarmony();
    const axis = rng.pick(['melody', 'drums', 'sound', 'arrangement']);
    if (axis === 'melody') {
      lockArrangement(); lockGrooves(); lockAllSound(); lockRoles();
      const r = { ...locks.roles }; delete r.leadBehavior; delete r.chopStyle; locks.roles = r;
      // hook regenerates — a new topline over the same track
    } else if (axis === 'drums') {
      lockArrangement(); lockMelody();
      locks.bassRiff = dna.bassRiff; // bass survives a drum swap
      locks.arpPattern = dna.arpPattern;
      locks.stabSteps = dna.stabSteps;
      const s = { ...parent.sound }; delete s.kick; delete s.snare; delete s.hat; delete s.perc;
      locks.sound = s; // melodic sounds stay; kit + groove regenerate
      const r = { ...dna.roles }; delete r.drumStyle; delete r.bassPattern; locks.roles = r;
    } else if (axis === 'sound') {
      lockArrangement(); lockGrooves(); lockMelody(); lockRoles();
      // full sound redesign under the same composition
    } else { // arrangement
      lockMelody(); lockGrooves(); lockAllSound(); lockRoles();
      // new structure family / energy curve for the same material
    }
  } else {
    // --- remix: persona + tonal center survive, plus ONE anchor --------------
    locks.rootMidi = parent.rootMidi;
    locks.scaleName = parent.scaleName;
    if (rng.chance(0.5)) {
      lockMelody(); // the hook survives a full remix
    } else {
      const degrees = dna.degrees.slice(); // chords survive, slightly bent
      if (degrees.length > 2 && rng.chance(0.6)) degrees[rng.int(1, degrees.length - 1)] = rng.int(0, 6);
      locks.degrees = degrees;
    }
    if (rng.chance(0.4)) locks.sound = { bass: { ...parent.sound.bass } }; // low end continuity
  }

  const child = compose(seed, macros, locks, avoid);
  child.baseName = parent.baseName;
  child.lineage = (parent.lineage ?? 1) + 1;
  child.name = `${parent.baseName} v${child.lineage}`;
  return child;
}
