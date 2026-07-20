// Composer invariant + DIVERSITY tests — run with: node test/composer.test.mjs
// The composer is pure logic, so it's fully testable without a browser.

import { compose, DEFAULT_MACROS } from '../js/composer/composer.js';
import { PERSONAS } from '../js/composer/personas.js';
import { mutate } from '../js/composer/mutate.js';

const KNOWN_TYPES = new Set([
  'kick', 'snare', 'clap', 'hat', 'perc', 'bass', 'lead', 'stab', 'pad', 'arp',
  'chop', 'riser', 'swell', 'impact', 'crash', 'downlift', 'sweep', 'gate',
]);

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
};

// ---------------------------------------------------------------------------
// 1. hard invariants across macro corners

const macroSets = [
  DEFAULT_MACROS,
  { energy: 1, dream: 0, chaos: 1, glitch: 1, dark: 1, bounce: 1, space: 0, weird: 1 },
  { energy: 0, dream: 1, chaos: 0, glitch: 0, dark: 0, bounce: 0, space: 1, weird: 0 },
  { energy: 0.9, dream: 0.9, chaos: 0.5, glitch: 0.8, dark: 0.2, bounce: 0.7, space: 0.9, weird: 0.9 },
];

let totalEvents = 0;
const typeCounts = {};

for (let seed = 1; seed <= 60; seed++) {
  for (const m of macroSets) {
    const c = compose(seed * 7919, m);

    assert(c.duration >= 70 && c.duration <= 105, `seed ${seed}: duration ${c.duration.toFixed(1)}s out of range`);
    assert(c.bpm >= 108 && c.bpm <= 180, `seed ${seed}: bpm ${c.bpm} out of range`);
    // floor is deliberately low: near-silence IS an aesthetic (ambient at
    // zero energy) — emptiness is caught by the content assertions below
    assert(c.events.length > 60, `seed ${seed}: only ${c.events.length} events`);
    // every track needs harmonic/melodic content — sparse is fine, empty is not
    assert(c.events.some((e) => e.type === 'pad' || e.type === 'lead' || e.type === 'chop' || e.type === 'arp' || e.type === 'stab'),
      `seed ${seed}: no melodic/harmonic content at all`);
    assert(c.events.some((e) => e.type === 'bass'), `seed ${seed}: no bass at all`);
    assert(c.name.length > 3, `seed ${seed}: bad name "${c.name}"`);
    assert(typeof c.persona === 'string' && c.persona.length > 2, `seed ${seed}: missing persona`);
    assert(c.sound && c.sound.kick && c.sound.mix, `seed ${seed}: missing sound design`);

    let prev = -1;
    for (const ev of c.events) {
      assert(Number.isFinite(ev.t) && ev.t >= 0, `seed ${seed}: bad event time ${ev.t}`);
      assert(ev.t >= prev, `seed ${seed}: events not sorted`);
      assert(KNOWN_TYPES.has(ev.type), `seed ${seed}: unknown event type ${ev.type}`);
      assert(ev.t <= c.duration + 0.001, `seed ${seed}: event past end (${ev.type})`);
      if (ev.midi !== undefined) assert(ev.midi >= 20 && ev.midi <= 110, `seed ${seed}: midi ${ev.midi} out of range on ${ev.type}`);
      if (ev.dur !== undefined) assert(Number.isFinite(ev.dur) && ev.dur > 0, `seed ${seed}: bad dur on ${ev.type}`);
      if (ev.midis) assert(ev.midis.every((x) => x >= 20 && x <= 110), `seed ${seed}: chord midi out of range`);
      prev = ev.t;
      totalEvents++;
      typeCounts[ev.type] = (typeCounts[ev.type] || 0) + 1;
    }

    const c2 = compose(seed * 7919, m);
    assert(JSON.stringify(c.events) === JSON.stringify(c2.events), `seed ${seed}: non-deterministic`);
  }
}

console.log(`${60 * macroSets.length} compositions, ${totalEvents} events`);
console.log('event mix:', Object.fromEntries(Object.entries(typeCounts).sort((x, y) => y[1] - x[1])));

// ---------------------------------------------------------------------------
// 2. diversity: with NEUTRAL sliders, tracks must spread across identities

{
  const N = 40;
  const personas = new Set(); const leads = new Set(); const basses = new Set();
  const drums = new Set(); const structures = new Set(); const scaleSet = new Set();
  const bpms = []; const kickF0s = [];
  for (let s = 1; s <= N; s++) {
    const c = compose(s * 104729, DEFAULT_MACROS);
    personas.add(c.persona);
    leads.add(c.sound.lead.type);
    basses.add(c.sound.bass.type);
    drums.add(c.drumStyle);
    structures.add(c.structureName);
    scaleSet.add(c.scaleName);
    bpms.push(c.bpm);
    kickF0s.push(c.sound.kick.f0);
  }
  const spread = Math.max(...bpms) - Math.min(...bpms);
  const kickSpread = Math.max(...kickF0s) - Math.min(...kickF0s);
  assert(personas.size >= 5, `only ${personas.size} personas in ${N} tracks`);
  assert(leads.size >= 3, `only ${leads.size} lead types in ${N} tracks`);
  assert(basses.size >= 3, `only ${basses.size} bass types in ${N} tracks`);
  assert(drums.size >= 3, `only ${drums.size} drum styles in ${N} tracks`);
  assert(structures.size >= 3, `only ${structures.size} structures in ${N} tracks`);
  assert(scaleSet.size >= 4, `only ${scaleSet.size} scales in ${N} tracks`);
  assert(spread >= 20, `bpm spread only ${spread}`);
  assert(kickSpread >= 40, `kick f0 spread only ${kickSpread.toFixed(0)} Hz — kits too samey`);
  console.log(`diversity @ neutral sliders (${N} tracks): ${personas.size} personas, ${leads.size} lead types, ${basses.size} bass types, ${drums.size} drum styles, ${structures.size} structures, ${scaleSet.size} scales, bpm spread ${spread}, kick f0 spread ${kickSpread.toFixed(0)} Hz`);
}

// ---------------------------------------------------------------------------
// 3. sliders steer identity: extreme macros must shift the persona distribution

{
  const count = (macros, ids) => {
    let hit = 0;
    for (let s = 1; s <= 40; s++) {
      if (ids.has(compose(s * 15485863, macros).persona)) hit++;
    }
    return hit / 40;
  };
  const dreamy = count(
    { energy: 0.1, dream: 1, chaos: 0.1, glitch: 0.1, dark: 0.2, bounce: 0.15, space: 0.95, weird: 0.3 },
    new Set(['dreamcore', 'ambient', 'cloudrap', 'lofi']),
  );
  const hard = count(
    { energy: 1, dream: 0.15, chaos: 0.85, glitch: 0.9, dark: 0.6, bounce: 0.7, space: 0.25, weird: 0.5 },
    new Set(['digicore', 'rage', 'glitchpop', 'hyperpop']),
  );
  assert(dreamy >= 0.6, `dreamy sliders only landed in dreamy personas ${(dreamy * 100).toFixed(0)}% of the time`);
  assert(hard >= 0.6, `hard sliders only landed in hard personas ${(hard * 100).toFixed(0)}% of the time`);
  console.log(`persona steering: dreamy sliders -> dreamy personas ${(dreamy * 100).toFixed(0)}%, hard sliders -> hard personas ${(hard * 100).toFixed(0)}%`);
}

// ---------------------------------------------------------------------------
// 4. energy contrast (density + tempo) still holds

{
  let loDen = 0, hiDen = 0, loBpm = 0, hiBpm = 0;
  const N = 24;
  for (let s = 1; s <= N; s++) {
    const lo = compose(s * 31, { ...DEFAULT_MACROS, energy: 0.05 });
    const hi = compose(s * 31, { ...DEFAULT_MACROS, energy: 0.95 });
    loDen += lo.events.length / lo.duration / N;
    hiDen += hi.events.length / hi.duration / N;
    loBpm += lo.bpm / N; hiBpm += hi.bpm / N;
  }
  assert(hiBpm - loBpm > 25, `energy barely moves tempo (${loBpm.toFixed(0)} -> ${hiBpm.toFixed(0)} bpm)`);
  assert(hiDen / loDen > 1.8, `energy barely moves density (${loDen.toFixed(1)} -> ${hiDen.toFixed(1)} ev/s)`);
  console.log(`energy contrast: ${loBpm.toFixed(0)}->${hiBpm.toFixed(0)} bpm, ${loDen.toFixed(1)}->${hiDen.toFixed(1)} events/s`);
}

// ---------------------------------------------------------------------------
// 5. mutation: children inherit by amount, stay valid, stay deterministic

{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (let i = 1; i <= 12; i++) {
    const parent = compose(i * 48271, DEFAULT_MACROS);

    // LOW: same harmony, tempo, melody, kick, structure — different details
    const lo = mutate(parent, DEFAULT_MACROS, 0.2, i * 7 + 1);
    assert(lo.persona === parent.persona, `low mut ${i}: persona changed`);
    assert(lo.bpm === parent.bpm, `low mut ${i}: bpm changed`);
    assert(eq(lo.dna.degrees, parent.dna.degrees), `low mut ${i}: chords changed`);
    assert(eq(lo.dna.hook, parent.dna.hook), `low mut ${i}: hook changed`);
    assert(eq(lo.sound.kick, parent.sound.kick), `low mut ${i}: kick changed`);
    assert(eq(lo.sections, parent.sections), `low mut ${i}: structure changed`);
    assert(!eq(lo.events, parent.events), `low mut ${i}: identical to parent — not a mutation`);
    assert(lo.name === `${parent.baseName} v2`, `low mut ${i}: bad child name "${lo.name}"`);

    // MEDIUM: harmony + key survive
    const med = mutate(parent, DEFAULT_MACROS, 0.55, i * 7 + 2);
    assert(med.persona === parent.persona, `med mut ${i}: persona changed`);
    assert(med.scaleName === parent.scaleName && med.rootMidi === parent.rootMidi, `med mut ${i}: key changed`);
    assert(eq(med.dna.degrees, parent.dna.degrees), `med mut ${i}: chords changed`);
    assert(Math.abs(med.bpm - parent.bpm) <= 5, `med mut ${i}: bpm drifted too far`);
    assert(!eq(med.events, parent.events), `med mut ${i}: identical to parent`);

    // HIGH: persona + tonal center survive; it's otherwise a remix
    const hi = mutate(parent, DEFAULT_MACROS, 0.9, i * 7 + 3);
    assert(hi.persona === parent.persona, `high mut ${i}: persona changed`);
    assert(hi.rootMidi === parent.rootMidi && hi.scaleName === parent.scaleName, `high mut ${i}: tonal center changed`);
    assert(!eq(hi.events, parent.events), `high mut ${i}: identical to parent`);

    // determinism + valid structure of children
    assert(eq(mutate(parent, DEFAULT_MACROS, 0.55, i * 7 + 2).events, med.events), `med mut ${i}: non-deterministic`);
    for (const c of [lo, med, hi]) {
      assert(c.duration >= 65 && c.duration <= 110, `mut ${i}: child duration ${c.duration.toFixed(1)}s out of range`);
      assert(c.events.every((e) => KNOWN_TYPES.has(e.type)), `mut ${i}: child has unknown event types`);
      assert(c.dna && c.sound && c.sections, `mut ${i}: child missing DNA`);
    }

    // grandchildren: lineage keeps working
    const grand = mutate(lo, DEFAULT_MACROS, 0.55, i * 7 + 4);
    assert(grand.lineage === 3 && grand.name === `${parent.baseName} v3`, `mut ${i}: lineage broken (${grand.name})`);
  }
  console.log('mutation: low/medium/high inheritance, determinism and lineage hold');
}

// ---------------------------------------------------------------------------
// 6. musicality: the hook is real, well-formed, and actually RECURS

{
  let leadTracks = 0, recurrences = 0;
  for (let s = 1; s <= 30; s++) {
    const c = compose(s * 65537, DEFAULT_MACROS);
    const hook = c.dna.hook;
    assert(hook && hook.notes.length >= 3, `seed ${s}: hook too thin (${hook?.notes?.length})`);
    assert(hook.notes.every((n) => n.len > 0 && n.s >= 0 && n.s < 32), `seed ${s}: malformed hook note`);
    // resolution: the phrase's final note lands on a stable degree (0 or 4)
    const last = hook.notes[hook.notes.length - 1];
    assert(last.deg === 0 || last.deg === 4, `seed ${s}: hook does not resolve (deg ${last.deg})`);

    // recurrence: the same lead pitch sequence must appear multiple times —
    // repetition is what makes a track memorable instead of a stream
    const leads = c.events.filter((e) => e.type === 'lead');
    if (leads.length < 4) continue;
    leadTracks++;
    const seqs = new Map();
    const barLen = (60 / c.bpm) * 4;
    for (const e of leads) {
      const bar = Math.floor(e.t / barLen / 2); // 2-bar groups
      const key = `g${bar}`;
      seqs.set(key, (seqs.get(key) || '') + ',' + e.midi);
    }
    // normalize: collapse retrigger repeats; also compare as INTERVAL
    // sequences, because a hook restated over a different chord (transposed)
    // is still the hook
    const norm = (csv) => {
      const xs = csv.split(',').filter(Boolean).map(Number);
      const dd = xs.filter((x, i) => i === 0 || x !== xs[i - 1]);
      return dd;
    };
    const raw = {}, rel = {};
    for (const v of seqs.values()) {
      const dd = norm(v);
      if (dd.length < 2) continue;
      const rKey = dd.join(',');
      const iKey = dd.map((x) => x - dd[0]).join(',');
      raw[rKey] = (raw[rKey] || 0) + 1;
      rel[iKey] = (rel[iKey] || 0) + 1;
    }
    if (Math.max(0, ...Object.values(raw), ...Object.values(rel)) >= 2) recurrences++;
  }
  // most lead-bearing tracks should restate their phrase recognizably
  assert(recurrences / Math.max(1, leadTracks) >= 0.6,
    `hook recurs in only ${recurrences}/${leadTracks} tracks`);
  console.log(`musicality: hooks resolve; phrase recurrence in ${recurrences}/${leadTracks} lead tracks`);
}

// ---------------------------------------------------------------------------
// 7. commitment: grooves LOOP. Consecutive non-variation drop bars must play
// the identical kick pattern and bass rhythm — repetition is the language.

{
  let checked = 0, kickLoops = 0, bassLoops = 0;
  for (let s = 1; s <= 24; s++) {
    const c = compose(s * 92821, DEFAULT_MACROS);
    const barLen = (60 / c.bpm) * 4;
    const stepLen = barLen / 16;
    // locate the first drop section with at least 2 bars
    let barStart = 0, found = null;
    for (const sec of c.sections) {
      if (sec.name === 'drop' && sec.bars >= 2) { found = barStart; break; }
      barStart += sec.bars;
    }
    if (found === null) continue;
    checked++;
    const stepsIn = (type, bar) => c.events
      .filter((e) => e.type === type && e.t >= (found + bar) * barLen - 0.01 && e.t < (found + bar + 1) * barLen - 0.01)
      .map((e) => Math.round((e.t - (found + bar) * barLen) / stepLen))
      .sort((a, b) => a - b)
      .join(',');
    if (stepsIn('kick', 0) === stepsIn('kick', 1)) kickLoops++;
    if (stepsIn('bass', 0) === stepsIn('bass', 1)) bassLoops++;
  }
  assert(kickLoops === checked, `kick pattern loops in only ${kickLoops}/${checked} tracks`);
  assert(bassLoops >= checked * 0.9, `bass rhythm loops in only ${bassLoops}/${checked} tracks`);
  console.log(`commitment: kick loops ${kickLoops}/${checked}, bass rhythm loops ${bassLoops}/${checked}`);
}

// sanity: every persona is reachable at ITS OWN affinity point
for (const p of PERSONAS) {
  let hit = false;
  for (let s = 1; s <= 60 && !hit; s++) {
    if (compose(s * 2654435761 % 4294967291, p.aff).persona === p.id) hit = true;
  }
  assert(hit, `persona ${p.id} unreachable even at its own affinity`);
}

if (failures) {
  console.error(`\nFAILED: ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nall composer invariants + diversity checks hold ✓');
