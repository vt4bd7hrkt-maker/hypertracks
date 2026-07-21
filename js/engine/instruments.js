// Instruments: every sound is synthesized — no samples. Instead of fixed
// recipes, each voice reads the track's resolved sound design
// (graph.sound.*, produced by composer/designSound), so drum kits, bass
// types, lead types and pad textures differ per track. playEvent() is the
// single dispatch used by BOTH the live scheduler and the offline export
// renderer — the guarantee that exports sound identical to playback.

import { midiToFreq } from '../core/theory.js';
import { bank } from './assetbank.js';

/** Dispatch a composition event at absolute context time `when`. */
export function playEvent(graph, ev, when) {
  switch (ev.type) {
    case 'kick': kick(graph, ev, when); graph.duck(when); break;
    case 'snare': snare(graph, ev, when); break;
    case 'clap': clap(graph, ev, when); break;
    case 'hat': hat(graph, ev, when); break;
    case 'perc': perc(graph, ev, when); break;
    case 'bass': bass(graph, ev, when); break;
    case 'lead': lead(graph, ev, when); break;
    case 'stab': stab(graph, ev, when); break;
    case 'pad': pad(graph, ev, when); break;
    case 'arp': pluck(graph, ev, when); break;
    case 'chop': vocalChop(graph, ev, when); break;
    case 'riser': riser(graph, ev, when); break;
    case 'swell': swell(graph, ev, when); break;
    case 'impact': impact(graph, ev, when); break;
    case 'crash': crash(graph, ev, when); break;
    case 'downlift': downlift(graph, ev, when); break;
    case 'sweep': sweep(graph, ev, when); break;
    case 'gate': graph.gateChop(when, ev.dur, ev.rate); break;
    default: break; // unknown events are ignored, never fatal
  }
}

// --- tiny helpers -----------------------------------------------------------

function env(param, when, peak, attack, decay, sustainLevel = 0, holdEnd = null) {
  param.setValueAtTime(0.0001, when);
  param.linearRampToValueAtTime(peak, when + attack);
  if (holdEnd !== null && sustainLevel > 0) {
    param.exponentialRampToValueAtTime(Math.max(peak * sustainLevel, 0.0002), when + attack + decay);
    param.setValueAtTime(Math.max(peak * sustainLevel, 0.0002), holdEnd);
    param.exponentialRampToValueAtTime(0.0001, holdEnd + 0.09);
  } else {
    param.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }
}

function noiseSource(graph, when, dur) {
  const src = graph.ctx.createBufferSource();
  src.buffer = graph.noise;
  src.loop = true;
  src.start(when);
  src.stop(when + dur + 0.1);
  return src;
}

function osc(ctx, type, freq, when, stopAt, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (detune) o.detune.value = detune;
  o.start(when);
  o.stop(stopAt);
  return o;
}

function sendTo(node, dest, amount) {
  const g = dest.context.createGain();
  g.gain.value = amount;
  node.connect(g);
  g.connect(dest);
}

const VOWELS = {
  a: [800, 1150], e: [400, 2000], i: [300, 2250], o: [450, 800], u: [325, 700],
};

/**
 * Live GLIDE control: when the performance-FX glide knob is past center,
 * every new lead/bass note slides in from the previous pitch of its role.
 * Reads graph.perf at schedule time (~120 ms lookahead), so it behaves like a
 * real-time synth parameter. portaInfo() also records the role's pitch
 * memory; applyPorta() programs one oscillator (mul handles FM ratios etc.).
 */
function portaInfo(graph, role, f, disabled = false) {
  if (disabled) return null; // stab chords don't glide and don't pollute pitch memory
  const amt = graph.perf?.glide ?? 0.5;
  const last = graph.lastFreq[role];
  graph.lastFreq[role] = f;
  if (amt > 0.52 && last && Math.abs(last - f) > 1) {
    return { from: last, t: (amt - 0.5) * 0.7 + 0.03 };
  }
  return null;
}

function applyPorta(o, p, f, when, mul = 1) {
  if (!p) { o.frequency.value = f * mul; return; }
  o.frequency.setValueAtTime(p.from * mul, when);
  o.frequency.exponentialRampToValueAtTime(f * mul, when + p.t);
}

// --- per-track oscillators: seeded spectra -> PeriodicWaves (cached) --------
// The composer ships harmonic tables (sound.*.wave); every track therefore
// plays custom waveforms no other track shares — a procedural wavetable.

function getWave(graph, spec) {
  if (!spec || !spec.imag) return null;
  if (!graph._waves) graph._waves = new Map();
  let w = graph._waves.get(spec);
  if (!w) {
    const imag = new Float32Array([0, ...spec.imag]);
    w = graph.ctx.createPeriodicWave(new Float32Array(imag.length), imag);
    graph._waves.set(spec, w);
  }
  return w;
}

function shapeOsc(o, graph, spec, fallback) {
  const w = getWave(graph, spec);
  if (w) o.setPeriodicWave(w);
  else o.type = fallback;
}

// --- Karplus-Strong plucked string (physical modeling, rendered to buffer) --
// Computed in JS (not a delay-node loop, whose 128-sample minimum would cap
// pitch at ~344 Hz) and cached per pitch. Deterministic: excitation noise is
// seeded from the track seed + pitch, so live and offline render identically.

function ksBuffer(graph, midi) {
  if (!graph._ks) graph._ks = new Map();
  if (graph._ks.has(midi)) return graph._ks.get(midi);
  const sr = graph.ctx.sampleRate;
  const f = midiToFreq(midi);
  const N = Math.max(2, Math.round(sr / f));
  const len = Math.floor(sr * 1.4);
  const buf = graph.ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let s = ((graph.seed ?? 1) ^ Math.imul(midi, 2654435761)) >>> 0;
  const rnd = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  for (let i = 0; i < N; i++) d[i] = rnd();
  const damp = graph.sound.lead.ksDamp ?? 0.995;
  for (let i = N + 1; i < len; i++) d[i] = damp * 0.5 * (d[i - N] + d[i - N - 1]);
  graph._ks.set(midi, buf);
  return buf;
}

// --- drums: RENDERED one-shots ------------------------------------------------
// Drums are rendered per track into buffers with per-sample layering,
// transient shaping and baked-in tanh saturation — internal resampling.
// That's why they punch like processed samples instead of raw oscillator
// patches, and why a kit sounds consistent hit after hit. Deterministic via
// the track seed, so export matches playback. Cached per graph.

function drumRnd(graph, tag) {
  let s = ((graph.seed ?? 1) ^ tag) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

function drumBuf(graph, kind) {
  if (!graph._drums) graph._drums = new Map();
  if (graph._drums.has(kind)) return graph._drums.get(kind);
  const sr = graph.ctx.sampleRate;
  const S = graph.sound;
  const rnd = drumRnd(graph, Math.imul(kind.charCodeAt(0) + kind.length, 2654435761));
  let data;

  if (kind === 'kick') {
    const k = S.kick;
    data = new Float32Array(Math.floor(sr * (k.dec + 0.12)));
    let phase = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / sr;
      const f = k.f1 + (k.f0 - k.f1) * Math.exp(-t / k.pdec);
      phase += (2 * Math.PI * f) / sr;
      let x = Math.sin(phase) * Math.exp(-t / k.dec);           // body
      if (k.grit > 0.05) x += Math.sign(Math.sin(phase * 2)) * k.grit * 0.35 * Math.exp(-t / 0.07);
      if (t < 0.008) x += rnd() * k.click * Math.exp(-t / 0.0025); // transient layer
      data[i] = Math.tanh(x * (1.4 + k.grit)) * k.gain;            // baked saturation
    }
  } else if (kind === 'snare') {
    const s2 = S.snare;
    data = new Float32Array(Math.floor(sr * (s2.dec + 0.1)));
    let lp = 0, prev = 0, phase = 0;
    const kf = Math.min(0.9, s2.bp / sr * 6.28);
    for (let i = 0; i < data.length; i++) {
      const t = i / sr;
      const w = rnd();
      const hp = w - prev; prev = w;   // 1-pole HP
      lp += kf * (hp - lp);            // 1-pole LP -> crude bandpass noise
      let x = lp * 2.4 * Math.exp(-t / s2.dec);
      if (s2.fizz > 0.05) x += hp * s2.fizz * 0.8 * Math.exp(-t / (s2.dec * 0.9));
      if (s2.body > 0.05) {            // tonal layer with pitch drop
        phase += (2 * Math.PI * Math.max(120, 190 * (1 - t * 2))) / sr;
        x += Math.sin(phase) * s2.body * Math.exp(-t / 0.06);
      }
      data[i] = Math.tanh(x * 1.6);
    }
  } else if (kind === 'clap') {
    data = new Float32Array(Math.floor(sr * 0.3));
    let lp = 0, prev = 0;
    const kf = Math.min(0.9, 1300 / sr * 6.28);
    for (let i = 0; i < data.length; i++) {
      const t = i / sr;
      const w = rnd();
      const hp = w - prev; prev = w;
      lp += kf * (hp - lp);
      let env = Math.exp(-t / 0.15) * 0.4; // tail
      for (const off of [0, 0.011, 0.022]) {
        if (t >= off) env += Math.exp(-(t - off) / 0.008); // three layered bursts
      }
      data[i] = Math.tanh(lp * 2.2 * env);
    }
  } else { // 'hatC' / 'hatO'
    const h = S.hat;
    const dec = kind === 'hatO' ? h.decO : h.decC;
    data = new Float32Array(Math.floor(sr * (dec + 0.05)));
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21]; // classic metal-hat partials
    const f0 = h.hp / 8;
    const phases = ratios.map(() => 0);
    let prev = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / sr;
      let x = 0;
      if (h.type === 'metal') {
        for (let p = 0; p < ratios.length; p++) {
          phases[p] += (2 * Math.PI * f0 * ratios[p]) / sr;
          x += Math.sign(Math.sin(phases[p]));
        }
        x /= ratios.length;
      } else {
        x = rnd();
      }
      const b = x - prev; prev = x; // first difference = crude highpass, brightens
      data[i] = b * Math.exp(-t / dec);
    }
  }

  // normalize so playback gains are predictable across kits
  let peak = 1e-4;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const scale = 0.9 / peak;
  for (let i = 0; i < data.length; i++) data[i] *= scale;

  const buf = graph.ctx.createBuffer(1, data.length, sr);
  buf.getChannelData(0).set(data);
  graph._drums.set(kind, buf);
  return buf;
}

const DRUM_GAIN = { kick: 1.0, snare: 0.5, clap: 0.4, hatC: 0.3, hatO: 0.28 };

/** play a library sample one-shot into a bus; returns false if not loaded
 *  yet (caller falls back to synthesis for this hit) */
function playSampleHit(graph, id, when, gain, dest, verbSend = 0) {
  const buf = bank.get(id);
  if (!buf) return false;
  const src = graph.ctx.createBufferSource();
  src.buffer = buf;
  const g = graph.ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(dest);
  if (verbSend > 0.02) sendTo(g, graph.reverbIn, verbSend);
  src.start(when);
  return true;
}

function playDrum(graph, kind, when, vel, verbSend = 0) {
  const src = graph.ctx.createBufferSource();
  src.buffer = drumBuf(graph, kind);
  const g = graph.ctx.createGain();
  g.gain.value = vel * DRUM_GAIN[kind];
  src.connect(g);
  g.connect(graph.drums);
  if (verbSend > 0.02) sendTo(g, graph.reverbIn, verbSend);
  src.start(when);
}

function kick(graph, ev, when) {
  const S = graph.sound.kick;
  if (S.sampleId && playSampleHit(graph, S.sampleId, when, ev.vel, graph.drums)) {
    if (S.layer) playDrum(graph, 'kick', when, ev.vel * 0.4); // synth sub under sample
    return;
  }
  playDrum(graph, 'kick', when, ev.vel);
}

function snare(graph, ev, when) {
  const S = graph.sound.snare;
  if (S.sampleId && playSampleHit(graph, S.sampleId, when, ev.vel * 0.75, graph.drums, S.verb)) return;
  playDrum(graph, 'snare', when, ev.vel, S.verb);
}

function clap(graph, ev, when) {
  const id = graph.sound.clap && graph.sound.clap.sampleId;
  if (id && playSampleHit(graph, id, when, ev.vel * 0.65, graph.drums, 0.2)) return;
  playDrum(graph, 'clap', when, ev.vel, 0.25);
}

function hat(graph, ev, when) {
  const H = graph.sound.hat;
  const id = ev.open ? H.sampleOpenId : H.sampleId;
  if (id && playSampleHit(graph, id, when, ev.vel * 0.55, graph.drums)) return;
  playDrum(graph, ev.open ? 'hatO' : 'hatC', when, ev.vel * (H.gain * 2.4));
}

function perc(graph, ev, when) {
  const { ctx } = graph;
  const p = graph.sound.perc;
  if (p.sampleId && playSampleHit(graph, p.sampleId, when, ev.vel * 0.7, graph.drums, 0.1)) return;
  const o = osc(ctx, p.tri ? 'triangle' : 'sine', p.freq, when, when + p.dec + 0.05);
  o.frequency.exponentialRampToValueAtTime(p.freq * 0.8, when + p.dec);
  const g = ctx.createGain();
  env(g.gain, when, ev.vel * 0.5, 0.001, p.dec);
  const pan = ctx.createStereoPanner();
  pan.pan.value = ((p.freq % 7) / 7 - 0.5) * 1.2;
  o.connect(g); g.connect(pan); pan.connect(graph.drums);
  sendTo(g, graph.delayIn, 0.15);
}

// --- bass: four synth types ---------------------------------------------------

function bass(graph, ev, when) {
  const { ctx } = graph;
  const bs = graph.sound.bass;
  const f = midiToFreq(ev.midi);
  const g = ctx.createGain();
  env(g.gain, when, ev.vel * bs.gain, 0.005, Math.max(ev.dur, 0.12), 0.7, when + ev.dur);
  g.connect(graph.bass);
  const stopAt = when + ev.dur + 0.25;

  const lastBass = graph.lastFreq.bass;
  graph.lastFreq.bass = f;
  const applyPitch = (o) => {
    if (ev.glideFrom !== undefined) {
      o.frequency.setValueAtTime(midiToFreq(ev.glideFrom), when);
      o.frequency.exponentialRampToValueAtTime(f, when + Math.min(0.09, ev.dur * 0.4));
    } else if (ev.glideTo !== undefined) {
      o.frequency.setValueAtTime(f, when);
      o.frequency.setValueAtTime(f, when + ev.dur * 0.55);
      o.frequency.exponentialRampToValueAtTime(midiToFreq(ev.glideTo), when + ev.dur);
    } else if ((graph.perf?.glide ?? 0.5) > 0.52 && lastBass && Math.abs(lastBass - f) > 1) {
      // live portamento from the GLIDE performance control
      o.frequency.setValueAtTime(lastBass, when);
      o.frequency.exponentialRampToValueAtTime(f, when + (graph.perf.glide - 0.5) * 0.6 + 0.03);
    } else {
      o.frequency.value = f;
    }
  };

  if (bs.type === 'reese') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.min(bs.lp, 800); lp.Q.value = 1;
    for (const det of [-14, 14]) {
      const o = osc(ctx, 'sawtooth', f, when, stopAt, det);
      applyPitch(o);
      o.connect(lp);
    }
    lp.connect(g);
  } else if (bs.type === 'square') {
    const o = osc(ctx, 'square', f, when, stopAt);
    applyPitch(o);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = bs.lp;
    o.connect(lp); lp.connect(g);
  } else if (bs.type === 'fm') {
    const car = osc(ctx, 'sine', f, when, stopAt);
    applyPitch(car);
    const mod = osc(ctx, 'sine', f * bs.fmRatio, when, stopAt);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * bs.fmIndex, when);
    mg.gain.exponentialRampToValueAtTime(f * 0.2, when + Math.max(ev.dur * 0.6, 0.15));
    mod.connect(mg); mg.connect(car.frequency);
    car.connect(g);
  } else { // 'sub'
    const o = osc(ctx, 'sine', f, when, stopAt);
    applyPitch(o);
    o.connect(g);
    const saw = osc(ctx, 'sawtooth', f, when, stopAt);
    applyPitch(saw);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 750;
    const sg = ctx.createGain(); sg.gain.value = graph.sound.bass.sawMix;
    saw.connect(lp); lp.connect(sg); sg.connect(g);
  }
}

// --- lead: five synth types -----------------------------------------------------

function lead(graph, ev, when, opts = {}) {
  const L = graph.sound.lead;
  switch (opts.forceType || L.type) {
    case 'chip': chipLead(graph, ev, when, opts); break;
    case 'bell': bellLead(graph, ev, when, opts); break;
    case 'pluck': sawPluck(graph, ev, when, opts); break;
    case 'air': airLead(graph, ev, when, opts); break;
    case 'string': stringLead(graph, ev, when, opts); break;
    case 'keys': keysLead(graph, ev, when, opts); break;
    default: supersaw(graph, ev, when, opts); break;
  }
}

/** pitched library instrument (mallets/kalimba/bells): nearest sampled note,
 *  repitched via playbackRate — a real recorded instrument as the lead */
function keysLead(graph, ev, when, opts = {}) {
  const L = graph.sound.lead;
  let best = null, bd = 1e9;
  for (const e of L.family || []) {
    const b = bank.get(e.id);
    if (!b) continue;
    const d = Math.abs(e.root - ev.midi);
    if (d < bd) { bd = d; best = { root: e.root, buf: b }; }
  }
  if (!best) { supersaw(graph, ev, when, opts); return; } // not loaded yet
  const master = voiceOut(graph, when, Math.max(ev.dur, 0.25), (opts.gain ?? 0.55) * ev.vel, {
    attack: 0.003, sus: 0.6, echo: 0.14,
  });
  const src = graph.ctx.createBufferSource();
  src.buffer = best.buf;
  src.playbackRate.value = Math.pow(2, (ev.midi - best.root) / 12);
  src.connect(master);
  src.start(when);
}

/** plucked-string lead via Karplus-Strong buffers — a different timbre class */
function stringLead(graph, ev, when, opts = {}) {
  const master = voiceOut(graph, when, Math.min(ev.dur, 1.3), (opts.gain ?? 0.55) * ev.vel, {
    attack: 0.002, sus: 0.5, echo: 0.16,
  });
  const src = graph.ctx.createBufferSource();
  src.buffer = ksBuffer(graph, ev.midi);
  src.start(when);
  src.stop(when + 1.4);
  src.connect(master);
}

function voiceOut(graph, when, dur, peak, opts = {}) {
  const master = graph.ctx.createGain();
  env(master.gain, when, peak, opts.attack ?? 0.006, Math.max(dur, 0.1), opts.sus ?? 0.65, when + dur);
  master.connect(graph.music);
  sendTo(master, graph.reverbIn, 0.12 + graph.macros.space * 0.2);
  sendTo(master, graph.delayIn, (opts.echo ?? 0.08) + graph.macros.space * 0.22);
  return master;
}

function supersaw(graph, ev, when, opts = {}) {
  const { ctx, macros: m } = graph;
  const L = graph.sound.lead;
  const f = midiToFreq(ev.midi);
  const master = voiceOut(graph, when, ev.dur, (opts.gain ?? 0.34) * ev.vel);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const bright = (800 + 6200 * (L.bright / 1.9)) * 1.0;
  lp.frequency.setValueAtTime(bright, when);
  lp.frequency.exponentialRampToValueAtTime(Math.max(500, bright * 0.35), when + Math.max(ev.dur, 0.2));
  lp.Q.value = 0.8;
  const porta = portaInfo(graph, 'lead', f, opts.noPorta);
  const pans = [-0.5, 0, 0.5];
  for (let i = 0; i < 3; i++) {
    const o = osc(ctx, 'sawtooth', f, when, when + ev.dur + 0.2, (i - 1) * L.detune);
    shapeOsc(o, graph, L.wave, 'sawtooth'); // per-track spectrum
    applyPorta(o, porta, f, when);
    const p = ctx.createStereoPanner();
    p.pan.value = pans[i] * (0.4 + m.dream * 0.6);
    const og = ctx.createGain(); og.gain.value = 1 / 3;
    o.connect(og); og.connect(p); p.connect(lp);
  }
  lp.connect(master);
}

function chipLead(graph, ev, when, opts = {}) {
  const { ctx } = graph;
  const L = graph.sound.lead;
  const f = midiToFreq(ev.midi);
  const master = voiceOut(graph, when, ev.dur, (opts.gain ?? 0.2) * ev.vel, { echo: 0.22 });
  const o = osc(ctx, 'square', f, when, when + ev.dur + 0.1);
  applyPorta(o, portaInfo(graph, 'lead', f, opts.noPorta), f, when);
  const vib = osc(ctx, 'sine', L.vibRate + 1.5, when, when + ev.dur + 0.1);
  const vg = ctx.createGain(); vg.gain.value = L.vibAmt;
  vib.connect(vg); vg.connect(o.detune);
  o.connect(master);
}

function bellLead(graph, ev, when, opts = {}) {
  const { ctx } = graph;
  const L = graph.sound.lead;
  const f = midiToFreq(ev.midi);
  const dur = Math.max(ev.dur, 0.25);
  const master = voiceOut(graph, when, dur, (opts.gain ?? 0.3) * ev.vel, { sus: 0.25, echo: 0.18 });
  const porta = portaInfo(graph, 'lead', f, opts.noPorta);
  const car = osc(ctx, 'sine', f, when, when + dur + 0.3);
  applyPorta(car, porta, f, when);
  const mod = osc(ctx, 'sine', f * L.bellRatio, when, when + dur + 0.3);
  applyPorta(mod, porta, f, when, L.bellRatio);
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(f * L.bellIndex, when);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, when + dur * 0.8);
  mod.connect(mg); mg.connect(car.frequency);
  car.connect(master);
  const oct = osc(ctx, 'sine', f * 2, when, when + dur + 0.3);
  const og = ctx.createGain(); og.gain.value = 0.15;
  oct.connect(og); og.connect(master);
}

function sawPluck(graph, ev, when, opts = {}) {
  const { ctx } = graph;
  const L = graph.sound.lead;
  const f = midiToFreq(ev.midi);
  const master = voiceOut(graph, when, ev.dur, (opts.gain ?? 0.26) * ev.vel, { sus: 0.15, echo: 0.2 });
  const o = osc(ctx, 'sawtooth', f, when, when + ev.dur + 0.15);
  shapeOsc(o, graph, L.wave, 'sawtooth');
  applyPorta(o, portaInfo(graph, 'lead', f, opts.noPorta), f, when);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1500 + L.bright * 2800, when);
  lp.frequency.exponentialRampToValueAtTime(350, when + 0.16);
  lp.Q.value = 1.2;
  o.connect(lp); lp.connect(master);
}

function airLead(graph, ev, when, opts = {}) {
  const { ctx } = graph;
  const L = graph.sound.lead;
  const f = midiToFreq(ev.midi);
  const master = voiceOut(graph, when, ev.dur, (opts.gain ?? 0.3) * ev.vel, { attack: 0.04, echo: 0.15 });
  const porta = portaInfo(graph, 'lead', f, opts.noPorta);
  const a = osc(ctx, 'sine', f, when, when + ev.dur + 0.2);
  const b = osc(ctx, 'triangle', f, when, when + ev.dur + 0.2, 6);
  applyPorta(a, porta, f, when);
  applyPorta(b, porta, f, when);
  const vib = osc(ctx, 'sine', L.vibRate, when, when + ev.dur + 0.2);
  const vg = ctx.createGain();
  vg.gain.setValueAtTime(0, when);
  vg.gain.linearRampToValueAtTime(L.vibAmt * 0.7, when + Math.min(ev.dur, 0.5));
  vib.connect(vg); vg.connect(a.detune); vg.connect(b.detune);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2600;
  a.connect(lp); b.connect(lp); lp.connect(master);
}

function stab(graph, ev, when) {
  for (const midi of ev.midis) {
    // noPorta: chord notes share a timestamp — gliding between them would smear
    lead(graph, { ...ev, midi, dur: ev.dur }, when, {
      gain: 0.13, noPorta: true,
      forceType: graph.sound.lead.type === 'none' ? 'supersaw' : undefined,
    });
  }
}

// --- pads: four textures ----------------------------------------------------------

function pad(graph, ev, when) {
  const { ctx, macros: m } = graph;
  const P = graph.sound.pad;
  const master = ctx.createGain();
  const attack = 0.3 + m.dream * 0.55;
  env(master.gain, when, 0.3 * ev.vel, attack, Math.max(ev.dur, 0.5), 0.8, when + ev.dur);
  master.connect(graph.music);
  sendTo(master, graph.reverbIn, 0.35 + m.space * 0.35 + m.dream * 0.2);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 450 + P.bright * 1600;
  lp.Q.value = 0.4;
  lp.connect(master);
  const stopAt = when + ev.dur + 1.2;

  const addVoice = (freq, type, det, panv, gain, wave) => {
    const o = osc(ctx, type, freq, when, stopAt, det);
    if (wave) shapeOsc(o, graph, wave, type);
    const p = ctx.createStereoPanner();
    p.pan.value = panv;
    const og = ctx.createGain(); og.gain.value = gain;
    o.connect(og); og.connect(p); p.connect(lp);
  };

  const midis = P.type === 'drone' ? ev.midis.map((x) => x - 12) : ev.midis;

  if (P.type === 'choir') {
    // formant-filtered triangles — a synthetic voice choir
    const [f1, f2] = VOWELS[P.vowel] || VOWELS.a;
    const sum = ctx.createGain();
    midis.forEach((midi, i) => {
      const f = midiToFreq(midi);
      const o = osc(ctx, 'sawtooth', f, when, stopAt, i % 2 ? 5 : -5);
      o.connect(sum);
    });
    for (const [freq, q, amt] of [[f1, 6, 1], [f2, 8, 0.6]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
      const bg = ctx.createGain(); bg.gain.value = amt / midis.length;
      sum.connect(bp); bp.connect(bg); bg.connect(lp);
    }
  } else if (P.type === 'shimmer') {
    midis.forEach((midi, i) => {
      const f = midiToFreq(midi);
      const panv = (i % 2 ? 1 : -1) * P.wide;
      addVoice(f, 'triangle', i % 2 ? 6 : -6, panv, 0.4 / midis.length);
      addVoice(f * 2, 'sine', i % 2 ? -8 : 8, -panv, 0.22 / midis.length);
    });
  } else if (P.type === 'drone') {
    midis.forEach((midi) => {
      const f = midiToFreq(midi);
      addVoice(f, 'sawtooth', -15, -P.wide * 0.8, 0.5 / midis.length, P.wave);
      addVoice(f, 'sawtooth', 15, P.wide * 0.8, 0.5 / midis.length, P.wave);
    });
  } else { // 'sawstack'
    midis.forEach((midi, i) => {
      const f = midiToFreq(midi);
      for (const det of [-6, 6]) {
        addVoice(f, i % 2 === 0 ? 'sawtooth' : 'triangle', det * (1 + m.dream),
          (i % 2 === 0 ? -1 : 1) * P.wide * (det > 0 ? 1 : -0.7), 0.5 / midis.length,
          i % 2 === 0 ? P.wave : null);
      }
    });
  }
}

function pluck(graph, ev, when) {
  const { ctx, macros: m } = graph;
  if (graph.sound.arp && graph.sound.arp.useKeys && graph.sound.lead.family) {
    keysLead(graph, ev, when, { gain: 0.3, noPorta: true });
    return;
  }
  const f = midiToFreq(ev.midi);
  const o = osc(ctx, 'square', f, when, when + ev.dur + 0.2);
  shapeOsc(o, graph, graph.sound.arp?.wave, 'square');
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2600 + (1 - m.dark) * 2000, when);
  lp.frequency.exponentialRampToValueAtTime(320, when + 0.13);
  lp.Q.value = 1.1;
  const g = ctx.createGain();
  env(g.gain, when, 0.2 * ev.vel, 0.002, Math.max(ev.dur, 0.12));
  const p = ctx.createStereoPanner();
  p.pan.value = ((ev.midi % 7) / 7 - 0.5) * 0.8;
  o.connect(lp); lp.connect(g); g.connect(p); p.connect(graph.music);
  sendTo(g, graph.delayIn, 0.12 + m.space * 0.25);
  sendTo(g, graph.reverbIn, 0.1 + m.dream * 0.15);
}

// --- vocal chop --------------------------------------------------------------------

function vocalChop(graph, ev, when) {
  const { ctx, macros: m } = graph;
  const C = graph.sound.chop;
  const f = midiToFreq(ev.midi);
  const o = osc(ctx, 'sawtooth', f, when, when + ev.dur + 0.15);
  if (ev.glide) {
    o.frequency.setValueAtTime(midiToFreq(ev.midi + ev.glide * C.glideMul), when);
    o.frequency.exponentialRampToValueAtTime(f, when + Math.min(0.07, ev.dur * 0.5));
  }
  const vib = osc(ctx, 'sine', C.vibRate, when, when + ev.dur + 0.1);
  const vibG = ctx.createGain();
  vibG.gain.setValueAtTime(0, when);
  vibG.gain.linearRampToValueAtTime(18, when + ev.dur);
  vib.connect(vibG); vibG.connect(o.detune);

  const [f1, f2] = VOWELS[ev.vowel] || VOWELS.a;
  const sum = ctx.createGain();
  for (const [freq, q, amt] of [[f1, 7, 1], [f2, 9, 0.7]]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const bg = ctx.createGain(); bg.gain.value = amt;
    o.connect(bp); bp.connect(bg); bg.connect(sum);
  }
  const g = ctx.createGain();
  env(g.gain, when, 0.5 * ev.vel, 0.008, Math.max(ev.dur, 0.08), 0.7, when + ev.dur);
  sum.connect(g);
  g.connect(graph.music);
  sendTo(g, graph.reverbIn, 0.3 + m.space * 0.3 + m.dream * 0.2);
  sendTo(g, graph.delayIn, 0.15 + m.space * 0.2);
}

// --- FX ---------------------------------------------------------------------------

function riser(graph, ev, when) {
  const { ctx } = graph;
  const n = noiseSource(graph, when, ev.dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(350, when);
  bp.frequency.exponentialRampToValueAtTime(6500, when + ev.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.4, when + ev.dur);
  g.gain.exponentialRampToValueAtTime(0.0001, when + ev.dur + 0.05);
  n.connect(bp); bp.connect(g); g.connect(graph.fx);
  sendTo(g, graph.reverbIn, 0.3);
}

/** softer, airier build than a riser — a reverse-cymbal-style swell */
function swell(graph, ev, when) {
  const { ctx } = graph;
  const n = noiseSource(graph, when, ev.dur);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 2800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.28, when + ev.dur);
  g.gain.exponentialRampToValueAtTime(0.0001, when + ev.dur + 0.08);
  n.connect(hp); hp.connect(g); g.connect(graph.fx);
  sendTo(g, graph.reverbIn, 0.55);
}

function impact(graph, ev, when) {
  const { ctx } = graph;
  const fxId = graph.sound.fxS && graph.sound.fxS.impact;
  if (fxId && playSampleHit(graph, fxId, when, 0.8 * ev.vel, graph.fx, 0.4)) return;
  const n = noiseSource(graph, when, 0.6);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 500;
  const g = ctx.createGain();
  env(g.gain, when, 0.7 * ev.vel, 0.002, 0.5);
  n.connect(lp); lp.connect(g); g.connect(graph.fx);
  sendTo(g, graph.reverbIn, 0.5);

  const sub = osc(ctx, 'sine', 64, when, when + 0.6);
  sub.frequency.exponentialRampToValueAtTime(36, when + 0.4);
  const sg = ctx.createGain();
  env(sg.gain, when, 0.5 * ev.vel, 0.003, 0.45);
  sub.connect(sg); sg.connect(graph.fx);
}

/** bright decaying wash at a section start — a synthesized crash */
function crash(graph, ev, when) {
  const { ctx } = graph;
  const fxId = graph.sound.fxS && graph.sound.fxS.crash;
  if (fxId && playSampleHit(graph, fxId, when, 0.5 * ev.vel, graph.fx, 0.35)) return;
  const n = noiseSource(graph, when, 1.4);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 5000;
  const g = ctx.createGain();
  env(g.gain, when, 0.4 * ev.vel, 0.002, 1.3);
  n.connect(hp); hp.connect(g); g.connect(graph.fx);
  sendTo(g, graph.reverbIn, 0.4);
}

function downlift(graph, ev, when) {
  const { ctx } = graph;
  const n = noiseSource(graph, when, ev.dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 1;
  bp.frequency.setValueAtTime(3200, when);
  bp.frequency.exponentialRampToValueAtTime(180, when + ev.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + ev.dur);
  n.connect(bp); bp.connect(g); g.connect(graph.fx);
  sendTo(g, graph.reverbIn, 0.35);
}

function sweep(graph, ev, when) {
  const { ctx } = graph;
  const n = noiseSource(graph, when, ev.dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(600, when);
  lp.frequency.exponentialRampToValueAtTime(4000, when + ev.dur);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 350;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.1, when + ev.dur * 0.6);
  g.gain.linearRampToValueAtTime(0.0001, when + ev.dur);
  n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(graph.fx);
  sendTo(g, graph.reverbIn, 0.4);
}
