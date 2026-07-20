// AudioGraph: the per-composition mixing console.
//
// Built against BaseAudioContext, so the identical graph runs live
// (AudioContext) and during export (OfflineAudioContext). One graph is
// created per composition; NEXT fades the old graph out and spins up a new
// one, which keeps crossfades trivial and guarantees no state leaks between
// tracks.
//
// The mix itself is part of each track's identity: comp.sound.mix (resolved
// by the composer's persona-driven sound design) sets reverb size/damping,
// delay character (dotted/quarter/eighth/slapback), lo-fi crush, an optional
// procedural noise bed (vinyl crackle / air hiss), sidechain pump depth and
// drive amount — so a cloudrap track and a digicore track get different
// consoles, not just different notes.
//
// Routing:
//   drums ────────────────────────────┐
//   bass ──┐                          ├─ sum ─ tone ─ drive ─ comp ─ limiter ─ out
//   music ─┼─ pump (sidechain duck) ──┘
//   fx ────┤
//   reverb ┘  (wet returns duck too — that pumping wash IS the genre)

// The performance FX panel. Every control is BIPOLAR around 0.5:
// 0.5 = "as the persona designed it", below cuts, above boosts. This keeps
// each track's mix identity intact until the user deliberately sculpts it,
// and makes one panel meaningful across wildly different personas.
export const DEFAULT_FX = {
  cutoff: 0.5, res: 0.5, drive: 0.5, crush: 0.5, reverb: 0.5,
  echo: 0.5, width: 0.5, texture: 0.5, glide: 0.5, punch: 0.5,
};

export class AudioGraph {
  /**
   * @param {BaseAudioContext} ctx
   * @param {object} comp composition (bpm + sound design)
   * @param {object} macros live macro state
   * @param {import('../core/rng.js').RNG} rng deterministic — IR + noise beds
   * @param {object} fx live performance-FX state (DEFAULT_FX shape)
   */
  constructor(ctx, comp, macros, rng, fx = DEFAULT_FX) {
    this.ctx = ctx;
    this.bpm = comp.bpm;
    this.seed = comp.seed; // deterministic per-note synthesis (KS excitation)
    this.sound = comp.sound;
    this.macros = macros;
    // NOTE: named `perf`, not `fx` — `this.fx` is the effects BUS below,
    // and the two colliding once produced a very confusing NaN bug
    this.perf = { ...fx };
    this.lastFreq = {}; // per-role last pitch, for live glide/portamento
    const mix = comp.sound.mix;
    this.delayBeats = mix.delayBeats;

    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    // input buses (instruments connect here)
    this.drums = g(1);
    this.bass = g(0.9);
    this.music = g(0.9);
    this.fx = g(1);

    // sidechain pump bus
    this.pump = g(1);
    this.bass.connect(this.pump);
    this.music.connect(this.pump);
    this.fx.connect(this.pump);

    // --- reverb (generated IR: size + damping are per-track identity) ---
    this.reverbIn = g(1);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulseResponse(ctx, rng, mix.ir, mix.damp);
    this.reverbWet = g(0.4);
    this.reverbIn.connect(this.reverb);
    this.reverb.connect(this.reverbWet);
    this.reverbWet.connect(this.pump);

    // --- ping-pong delay: tempo-synced or slapback ---
    this.delayIn = g(1);
    const dTime = mix.delayBeats > 0 ? (60 / comp.bpm) * mix.delayBeats : 0.085;
    this.delayL = ctx.createDelay(2);
    this.delayR = ctx.createDelay(2);
    this.delayL.delayTime.value = dTime;
    this.delayR.delayTime.value = dTime;
    this.delayFb = g(0.35);
    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = 'bandpass';
    this.delayFilter.frequency.value = mix.delayFilt;
    this.delayFilter.Q.value = 0.5;
    const panL = ctx.createStereoPanner(); panL.pan.value = -0.7;
    const panR = ctx.createStereoPanner(); panR.pan.value = 0.7;
    this.delayIn.connect(this.delayL);
    this.delayL.connect(panL);
    this.delayL.connect(this.delayFb);
    this.delayFb.connect(this.delayFilter);
    this.delayFilter.connect(this.delayR);
    this.delayR.connect(panR);
    this.delayR.connect(this.delayL); // ping-pong cross-feed
    this.delayWet = g(0.5);
    panL.connect(this.delayWet);
    panR.connect(this.delayWet);
    this.delayWet.connect(this.pump);

    // --- master chain ---
    this.sum = g(1);
    this.drums.connect(this.sum);
    this.pump.connect(this.sum);

    this.tone = ctx.createBiquadFilter(); // "darkness" macro tilts this live
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 18000;
    this.tone.Q.value = 0.3;

    // per-track EQ tilt: a seeded peaking filter (±3 dB somewhere in the
    // 300 Hz–4 kHz body) — every track gets its own tonal signature
    this.tilt = ctx.createBiquadFilter();
    this.tilt.type = 'peaking';
    this.tilt.frequency.value = mix.tiltFreq ?? 1000;
    this.tilt.gain.value = mix.tiltGain ?? 0;
    this.tilt.Q.value = 0.7;

    // drive doubles as the lo-fi stage: crush > 0 quantizes amplitude before
    // saturation. curveKind picks the saturation flavor per track
    // (tanh / soft-knee / asymmetric-with-even-harmonics).
    this.curveKind = mix.curveKind ?? 'tanh';
    this.drive = ctx.createWaveShaper();
    this.drive.curve = makeSaturationCurve(1.6, mix.crush, this.curveKind);
    this.drive.oversample = mix.crush > 0.05 ? 'none' : '2x';
    this.driveIn = g(1);

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.1;

    // --- stereo width (mid/side matrix): L' = a·L + b·R, R' = b·L + a·R ---
    // where a = 0.5 + 0.5w, b = 0.5 - 0.5w. w=1 is untouched.
    this.widthSplit = ctx.createChannelSplitter(2);
    this.widthMerge = ctx.createChannelMerger(2);
    this.wLL = g(1); this.wLR = g(0); this.wRL = g(0); this.wRR = g(1);
    this.widthSplit.connect(this.wLL, 0); this.widthSplit.connect(this.wLR, 0);
    this.widthSplit.connect(this.wRL, 1); this.widthSplit.connect(this.wRR, 1);
    this.wLL.connect(this.widthMerge, 0, 0); this.wRL.connect(this.widthMerge, 0, 0);
    this.wLR.connect(this.widthMerge, 0, 1); this.wRR.connect(this.widthMerge, 0, 1);

    this.out = g(0.9);

    this.sum.connect(this.tone);
    this.tone.connect(this.tilt);
    this.tilt.connect(this.driveIn);
    this.driveIn.connect(this.drive);
    this.drive.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(this.widthSplit);
    this.widthMerge.connect(this.out);
    this.out.connect(ctx.destination);

    // shared noise buffer for percussion/FX in this graph
    this.noise = makeNoiseBuffer(ctx);

    // --- procedural noise bed (lo-fi identity layer) ---
    // Always built so the TEXTURE control has something to ride, even when
    // the persona ships it silent.
    {
      const type = mix.bed || 'air';
      const bedBuf = type === 'vinyl' ? makeVinylBuffer(ctx, rng) : makeAirBuffer(ctx, rng);
      const src = ctx.createBufferSource();
      src.buffer = bedBuf;
      src.loop = true;
      this.baseBedGain = mix.bed ? mix.bedGain : 0.004;
      this.bedGain = g(mix.bed ? mix.bedGain : 0);
      src.connect(this.bedGain);
      this.bedGain.connect(this.music); // beds duck with the music — they breathe
      src.start(ctx.currentTime + 0.01);
      this.bedSource = src;
    }

    // --- chorus on the melodic bus (dreamy personas): LFO-modulated short
    // delay in parallel — the liquid wash on pads and leads
    if ((mix.chorus ?? 0) > 0.08) {
      const cDelay = ctx.createDelay(0.06);
      cDelay.delayTime.value = 0.016;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.35 + mix.chorus * 0.5;
      const lfoG = g(0.005);
      lfo.connect(lfoG);
      lfoG.connect(cDelay.delayTime);
      lfo.start(ctx.currentTime + 0.01);
      const wet = g(mix.chorus * 0.5);
      this.music.connect(cDelay);
      cDelay.connect(wet);
      wet.connect(this.pump);
      this.chorusLfo = lfo;
    }

    this.lastCrush = mix.crush;
    this.applyLive(macros, this.perf);
  }

  /**
   * One function computes every live parameter from (macros, fx).
   * Macros carry the emotional mapping; fx controls are bipolar multipliers
   * around the persona's baseline. Cheap and click-free (setTargetAtTime).
   */
  applyLive(m, fx) {
    this.macros = m;
    this.perf = { ...fx };
    const mix = this.sound.mix;
    const now = this.ctx.currentTime;
    const bi = (v) => v * 2 - 1; // bipolar -1..1

    // FILTER: darkness sets the emotional base (full dark buries the mix at
    // ~1 kHz), cutoff sweeps ±2 octaves on top
    const base = 20000 * Math.pow(1000 / 20000, m.dark);
    const f = Math.min(20000, Math.max(180, base * Math.pow(4, bi(fx.cutoff) * 1.2)));
    this.tone.frequency.setTargetAtTime(f, now, 0.05);
    // RESONANCE: from polite to full acid squelch
    this.tone.Q.setTargetAtTime(0.3 + Math.max(0, bi(fx.res)) * 12 + Math.min(0, bi(fx.res)) * 0.15, now, 0.05);

    // DRIVE: extremes must be unmistakable — whisper-clean to destroyed
    const driveAmt = mix.drive * (0.5 + m.energy * 0.9 + m.glitch * 0.3) * Math.pow(3.5, bi(fx.drive));
    this.driveIn.gain.setTargetAtTime(Math.min(5, driveAmt), now, 0.05);

    // CRUSH: persona base + knob; curve swap only when audibly different
    const crushEff = Math.min(1, Math.max(0, mix.crush + bi(fx.crush) * 0.7));
    if (Math.abs(crushEff - this.lastCrush) > 0.03) {
      this.drive.curve = makeSaturationCurve(1.6, crushEff, this.curveKind);
      this.drive.oversample = crushEff > 0.05 ? 'none' : '2x';
      this.lastCrush = crushEff;
    }

    // SPACE: dry booth at the bottom, drowned cathedral at the top;
    // delay at full tilt goes into dub self-oscillation territory
    this.reverbWet.gain.setTargetAtTime(
      Math.min(2, (0.06 + m.space * 0.85 + m.dream * 0.4) * Math.pow(5, bi(fx.reverb))), now, 0.05);
    this.delayWet.gain.setTargetAtTime(
      Math.min(1.6, (0.04 + m.space * 0.65) * Math.pow(5, bi(fx.echo))), now, 0.05);
    this.delayFb.gain.setTargetAtTime(
      Math.min(0.92, (0.12 + m.space * 0.45) * (1 + bi(fx.echo) * 0.8)), now, 0.05);

    // WIDTH: dream opens the base image, the knob goes mono -> super-wide
    const w = Math.min(2, Math.max(0, (0.85 + m.dream * 0.3) * (1 + bi(fx.width))));
    const a = 0.5 + 0.5 * w, b = 0.5 - 0.5 * w;
    this.wLL.gain.setTargetAtTime(a, now, 0.05);
    this.wRR.gain.setTargetAtTime(a, now, 0.05);
    this.wLR.gain.setTargetAtTime(b, now, 0.05);
    this.wRL.gain.setTargetAtTime(b, now, 0.05);

    // TEXTURE: ride the noise bed from silent to a foreground character layer
    this.bedGain.gain.setTargetAtTime(
      Math.min(0.2, this.baseBedGain * Math.pow(10, bi(fx.texture)) * (fx.texture < 0.05 ? 0 : 1)), now, 0.1);
  }

  /** back-compat shim — player calls applyLive via setLive */
  applyMacros(m) { this.applyLive(m, this.perf); }

  /** Re-sync the tempo-locked delay when the user drags BPM. */
  setTempo(bpm) {
    if (this.delayBeats > 0) {
      const t = (60 / bpm) * this.delayBeats;
      const now = this.ctx.currentTime;
      this.delayL.delayTime.setTargetAtTime(t, now, 0.12);
      this.delayR.delayTime.setTargetAtTime(t, now, 0.12);
    }
  }

  /** Brief output dip to mask seek discontinuities. */
  maskSeek() {
    const now = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0.15, now, 0.008);
    this.out.gain.setTargetAtTime(0.9, now + 0.06, 0.03);
  }

  /** Sidechain duck triggered by every kick. setTargetAtTime pairs overlap safely. */
  duck(when) {
    const punch = (this.perf.punch - 0.5) * 0.7;
    const depth = Math.min(0.95, Math.max(0.05, this.sound.mix.pump + this.macros.bounce * 0.25 + punch));
    const p = this.pump.gain;
    p.setTargetAtTime(Math.max(0.05, 1 - depth), when, 0.006);
    p.setTargetAtTime(1, when + 0.05, 0.09 + this.macros.dream * 0.06);
  }

  /** Glitch gate: rhythmic hard mute-chops on the music bus for `dur` seconds. */
  gateChop(when, dur, rate) {
    const p = this.pump.gain;
    const slice = dur / rate;
    for (let i = 0; i < rate; i++) {
      p.setTargetAtTime(i % 2 === 0 ? 0.03 : 1, when + i * slice, 0.003);
    }
    p.setTargetAtTime(1, when + dur, 0.01);
  }

  /** Fade out and tear down (old graph after NEXT). */
  dispose(fadeSeconds = 0.5) {
    const now = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, now, fadeSeconds / 4);
    setTimeout(() => {
      try { this.bedSource?.stop(); } catch { /* already stopped */ }
      try { this.chorusLfo?.stop(); } catch { /* already stopped */ }
      try { this.out.disconnect(); } catch { /* already gone */ }
    }, fadeSeconds * 1000 + 300);
  }
}

// ---------------------------------------------------------------------------

/** Stereo exponential-decay noise IR with a one-pole lowpass. Deterministic. */
function makeImpulseResponse(ctx, rng, seconds, damp) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  const k = 0.2 + damp * 0.45;
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, 2.4);
      const white = (rng.next() * 2 - 1) * env;
      lp += (1 - k) * (white - lp);
      data[i] = lp;
    }
  }
  return buf;
}

/** saturation with selectable flavor; crush > 0 quantizes amplitude first
 *  (lo-fi/digital grit). 'soft' = polynomial knee, 'asym' adds even harmonics. */
function makeSaturationCurve(amount, crush = 0, kind = 'tanh') {
  const n = 1024;
  const curve = new Float32Array(n);
  const levels = crush > 0.02 ? Math.round(48 - crush * 40) : 0; // 48..8 steps
  for (let i = 0; i < n; i++) {
    let x = (i / (n - 1)) * 2 - 1;
    if (levels) x = Math.round(x * levels) / levels;
    let y;
    if (kind === 'soft') {
      const c = Math.max(-1, Math.min(1, x * amount * 0.8));
      y = (c - (c * c * c) / 3) * 1.5;
    } else if (kind === 'asym') {
      y = x >= 0 ? Math.tanh(x * amount) : Math.tanh(x * amount * 1.6);
    } else {
      y = Math.tanh(x * amount);
    }
    curve[i] = y;
  }
  return curve;
}

function makeNoiseBuffer(ctx) {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** procedural vinyl: soft hiss + sparse crackle pops (deterministic) */
function makeVinylBuffer(ctx, rng) {
  const rate = ctx.sampleRate;
  const len = rate * 2;
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += 0.04 * ((rng.next() * 2 - 1) - lp);
      d[i] = lp * 0.7; // dull hiss
    }
    const pops = 14 + Math.floor(rng.next() * 10);
    for (let p = 0; p < pops; p++) {
      const at = Math.floor(rng.next() * (len - 200));
      const amp = 0.25 + rng.next() * 0.5;
      for (let j = 0; j < 90; j++) {
        d[at + j] += (rng.next() * 2 - 1) * amp * Math.pow(1 - j / 90, 3);
      }
    }
  }
  return buf;
}

/** airy shimmer hiss for dream/ambient personas */
function makeAirBuffer(ctx, rng) {
  const rate = ctx.sampleRate;
  const len = rate * 2;
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const white = rng.next() * 2 - 1;
      d[i] = (white - prev) * 0.5; // crude highpass -> bright air
      prev = white;
    }
  }
  return buf;
}
