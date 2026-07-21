// Player: streams a composition's events into the audio graph using the
// classic lookahead pattern (timer wakes every 25 ms, schedules everything
// inside the next 120 ms window). Every event is scheduled sample-accurately
// by the audio clock, not by setInterval.
//
// Performance features:
// - Seamless LOOP: when the event pointer runs out and the loop point enters
//   the lookahead window, the origin shifts and scheduling continues.
// - Live TEMPO: a playback `rate` maps composition-time to wall-time
//   (rate = comp.bpm / userBpm). Changing it rebases the origin so the
//   current musical position is preserved, and re-syncs the tempo-locked
//   delay. All relative timing (swing, humanize, durations) scales with it.
// - SEEK: rebases the origin to any position, binary-searches the event
//   pointer, backfills sustained pads/bass so the section sounds right
//   immediately, and masks the discontinuity with a short output dip.

import { AudioGraph } from './graph.js';
import { playEvent } from './instruments.js';
import { RNG } from '../core/rng.js';

const LOOKAHEAD = 0.12;   // seconds of events to schedule ahead
const TICK_MS = 25;       // scheduler wake interval

export class Player {
  /** @param {AudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.graph = null;
    this.comp = null;
    this.timer = null;
    this.startTime = 0;     // wall-clock origin of composition-time 0
    this.eventIndex = 0;
    this.rate = 1;          // wall-seconds per composition-second
  }

  /** Start a composition. Any previous one is faded out (that IS the transition). */
  play(comp, macros, fx, userBpm) {
    this.stop(0.25);
    this.comp = comp;
    this.rate = comp.bpm / (userBpm || comp.bpm);
    this.graph = new AudioGraph(this.ctx, comp, macros, new RNG(comp.seed ^ 0x51ED270B), fx);
    if (userBpm && userBpm !== comp.bpm) this.graph.setTempo(userBpm);
    this.startTime = this.ctx.currentTime + 0.08;
    this.eventIndex = 0;
    this.timer = setInterval(() => this._tick(), TICK_MS);
    this._tick();
  }

  _tick() {
    const { comp, graph, rate } = this;
    if (!comp) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    const events = comp.events;
    for (;;) {
      if (this.eventIndex < events.length) {
        const ev = events[this.eventIndex];
        const when = this.startTime + ev.t * rate;
        if (when > horizon) break;
        playEvent(graph, this._scaled(ev), Math.max(when, this.ctx.currentTime + 0.005));
        this.eventIndex++;
      } else if (this.startTime + comp.duration * rate <= horizon) {
        // seamless loop: shift the origin and rewind the pointer
        this.startTime += comp.duration * rate;
        this.eventIndex = 0;
      } else {
        break;
      }
    }
  }

  /** durations must stretch with the playback rate */
  _scaled(ev) {
    return this.rate === 1 || ev.dur === undefined ? ev : { ...ev, dur: ev.dur * this.rate };
  }

  /** current position in composition-seconds (wraps with the loop) */
  get position() {
    if (!this.comp) return 0;
    const pos = (this.ctx.currentTime - this.startTime) / this.rate;
    return Math.min(this.comp.duration, Math.max(0, pos));
  }

  get progress() {
    return this.comp ? this.position / this.comp.duration : 0;
  }

  /** effective duration in wall-seconds at the current tempo */
  get wallDuration() {
    return this.comp ? this.comp.duration * this.rate : 0;
  }

  /** Live tempo change: preserve the musical position, re-sync the delay. */
  setBpm(userBpm) {
    if (!this.comp) return;
    const newRate = this.comp.bpm / userBpm;
    if (Math.abs(newRate - this.rate) < 0.001) return;
    const pos = this.position;
    this.rate = newRate;
    this.startTime = this.ctx.currentTime - pos * newRate;
    this.graph?.setTempo(userBpm);
  }

  /** Jump to a fraction [0,1] of the composition. */
  seek(frac) {
    const { comp, rate } = this;
    if (!comp) return;
    const pos = Math.min(0.999, Math.max(0, frac)) * comp.duration;
    this.graph?.maskSeek();
    this.startTime = this.ctx.currentTime + 0.03 - pos * rate;
    // first event at or after the new position
    let lo = 0, hi = comp.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (comp.events[mid].t < pos) lo = mid + 1; else hi = mid;
    }
    this.eventIndex = lo;
    // backfill sustains (pads / held bass) that straddle the seek point so
    // the harmonic bed is present immediately instead of after the next bar
    const now = this.ctx.currentTime + 0.04;
    for (let i = lo - 1; i >= 0 && i > lo - 400; i--) {
      const ev = comp.events[i];
      if ((ev.type !== 'pad' && ev.type !== 'bass') || ev.dur === undefined) continue;
      const remain = ev.t + ev.dur - pos;
      if (remain > 0.25) {
        playEvent(this.graph, { ...ev, dur: remain * rate, glideFrom: undefined, glideTo: undefined }, now);
      }
    }
  }

  /** Update live-reactive macros + performance FX on the running graph. */
  setLive(macros, fx) {
    this.graph?.applyLive(macros, fx);
  }

  stop(fadeSeconds = 0.4) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.graph?.dispose(fadeSeconds);
    this.graph = null;
    this.comp = null;
  }
}
