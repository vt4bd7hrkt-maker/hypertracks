// Offline export renderer — CHUNKED.
//
// Rebuilds the exact composition using the same AudioGraph + instrument code
// as live playback (so exports match what you hear), but renders in
// overlapping time chunks rather than one giant OfflineAudioContext.
//
// Why chunks: a ~90 s dense track schedules ~2,500 events → ~16,000 audio
// nodes. Web Audio does not release a voice's gain/filter/panner nodes when
// its oscillators stop (they stay connected toward the master), so in a
// single long render every audio quantum ends up traversing all ~16k nodes —
// rendering becomes slower than realtime and effectively hangs. Rendering in
// ~12 s chunks keeps the live node count per context to a few thousand, where
// offline rendering is many times faster than realtime. Total cost stays
// roughly linear (~a second per chunk).
//
// Continuity across seams: each chunk is rendered with an 8 s PRE-ROLL — the
// preceding events are replayed to warm up reverb/delay and to re-render any
// sustained note that crosses the boundary — then only the chunk's own window
// is kept. A note split by a boundary is phase-identical on both sides (same
// seed, same relative start), so seams are inaudible; a short equal-power
// crossfade hides any residual difference in the diffuse reverb tail.
//
// Exports are SEAMLESS LOOPS: the render covers one loop plus a tail, and the
// tail is folded onto the head before the file is cut to exactly one loop.

import { AudioGraph } from './graph.js';
import { playEvent } from './instruments.js';
import { RNG } from '../core/rng.js';
import { bank } from './assetbank.js';

const SAMPLE_RATE = 44100;
// Bigger chunks = fewer boundaries = less redundant pre-roll convolution
// (the dominant cost for long-reverb tracks), while staying under the node
// count where offline rendering degrades. Pre-roll covers sustained notes +
// most of the reverb tail; the seam crossfade masks the rest.
const CHUNK = 18;     // seconds of output kept per chunk
const PREROLL = 6;    // seconds replayed before each chunk to warm tails
const TAIL = 3;       // seconds past the loop point, folded onto the head
const XFADE = 0.006;  // equal-power crossfade at each seam (seconds)

/**
 * @param {object} comp composition from compose()
 * @param {object} macros macro state (captured at export time)
 * @param {object} [fx] performance-FX state (captured at export time)
 * @param {number} [userBpm] current tempo (defaults to the composed bpm)
 * @param {(frac:number)=>void} [onProgress] 0..1 progress callback
 * @returns {Promise<{numberOfChannels:number,length:number,sampleRate:number,getChannelData:(i:number)=>Float32Array}>}
 */
export async function renderComposition(comp, macros, fx, userBpm, onProgress) {
  await bank.ensure(comp.assetIds || []); // exports always use the full palette
  const SR = SAMPLE_RATE;
  const rate = comp.bpm / (userBpm || comp.bpm);
  const loopSamp = Math.round(comp.duration * rate * SR);
  const tailSamp = Math.round(TAIL * SR);
  const totalSamp = loopSamp + tailSamp;

  const chunkSampLen = Math.round(CHUNK * SR);
  const preSampLen = Math.round(PREROLL * SR);
  const xfadeSamp = Math.round(XFADE * SR);

  // scaled event list (durations stretch with tempo)
  const events = comp.events.map((ev) => (
    rate === 1 || ev.dur === undefined ? ev : { ...ev, dur: ev.dur * rate }
  ));
  const evTimes = events.map((ev) => ev.t * rate);

  const full = [new Float32Array(totalSamp), new Float32Array(totalSamp)];
  const nChunks = Math.max(1, Math.ceil(totalSamp / chunkSampLen));

  for (let ci = 0; ci < nChunks; ci++) {
    const cs = ci * chunkSampLen;                     // chunk start (output samples)
    const chunkSamp = Math.min(chunkSampLen, totalSamp - cs);
    const ctxStartSamp = Math.max(0, cs - preSampLen);
    const preSamp = cs - ctxStartSamp;                // actual pre-roll for this chunk
    // render a little past the kept window so the seam crossfade has material
    const overSamp = ci < nChunks - 1 ? xfadeSamp : 0;
    const ctxSamp = preSamp + chunkSamp + overSamp;
    const ctxStartSec = ctxStartSamp / SR;
    const ctxEndSec = (cs + chunkSamp + overSamp) / SR;

    const ctx = new OfflineAudioContext(2, ctxSamp, SR);
    const graph = new AudioGraph(ctx, comp, macros, new RNG(comp.seed ^ 0x51ED270B), fx);
    if (userBpm && userBpm !== comp.bpm) graph.setTempo(userBpm);

    for (let i = 0; i < events.length; i++) {
      const et = evTimes[i];
      if (et >= ctxStartSec - 1e-6 && et < ctxEndSec) {
        playEvent(graph, events[i], Math.max(0, et - ctxStartSec));
      }
    }

    const rendered = await ctx.startRendering();
    for (let ch = 0; ch < 2; ch++) {
      const src = rendered.getChannelData(ch);
      const dst = full[ch];
      // Copy the kept window. Its first xfadeSamp samples overlap the previous
      // chunk's raw overflow (already sitting in dst): equal-power crossfade
      // them so any reverb-state difference at the seam is masked. The rest is
      // copied straight.
      for (let i = 0; i < chunkSamp; i++) {
        if (ci > 0 && i < xfadeSamp) {
          const t = (i + 1) / (xfadeSamp + 1);
          dst[cs + i] = dst[cs + i] * Math.cos((t * Math.PI) / 2) // prev overflow out
                      + src[preSamp + i] * Math.sin((t * Math.PI) / 2); // this chunk in
        } else {
          dst[cs + i] = src[preSamp + i];
        }
      }
      // Stash this chunk's overflow (raw) just past the boundary, for the next
      // chunk to crossfade against.
      for (let i = 0; i < overSamp && cs + chunkSamp + i < totalSamp; i++) {
        dst[cs + chunkSamp + i] = src[preSamp + chunkSamp + i];
      }
    }
    onProgress?.((ci + 1) / (nChunks + 1));
    // yield so the UI can paint progress between chunks
    await new Promise((r) => setTimeout(r, 0));
  }

  // fold the tail onto the head, cut to exactly one loop
  const channels = [];
  for (let ch = 0; ch < 2; ch++) {
    const src = full[ch];
    const out = new Float32Array(loopSamp);
    out.set(src.subarray(0, loopSamp));
    const fold = Math.min(tailSamp, totalSamp - loopSamp);
    for (let i = 0; i < fold; i++) out[i] += src[loopSamp + i];
    channels.push(out);
  }

  // normalize
  let peak = 0;
  for (const out of channels) {
    for (let i = 0; i < loopSamp; i++) peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0.98) {
    const g = 0.98 / peak;
    for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  }

  onProgress?.(1);
  return {
    numberOfChannels: 2,
    length: loopSamp,
    sampleRate: SR,
    getChannelData: (i) => channels[i],
  };
}
