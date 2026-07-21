// AssetBank: lazy loader/cache for the sample library.
//
// The manifest ships as a static ES module (js/assets/manifest.js), so the
// composer can make deterministic sample choices synchronously; the AUDIO
// files are fetched + decoded only when a track actually uses them.
// Decoded AudioBuffers are context-independent (BufferSource resamples), so
// one decode serves live playback AND offline export. Instruments read the
// bank synchronously: buffer not loaded yet -> they fall back to synthesis
// for that hit and pick up the sample once it lands. Exports await
// bank.ensure() first, so rendered files always use the full palette.
// The browser HTTP cache keeps repeat visits cheap.

import { SAMPLES } from '../assets/manifest.js';

const byId = new Map(SAMPLES.map((s) => [s.id, s]));
const buffers = new Map();
const pending = new Map();
let ctxRef = null;

export const bank = {
  init(ctx) { ctxRef = ctx; },

  /** sync: decoded buffer or null (instruments fall back to synthesis) */
  get(id) { return (id && buffers.get(id)) || null; },

  meta(id) { return byId.get(id) || null; },

  load(id) {
    if (!id || !ctxRef) return Promise.resolve(null);
    if (buffers.has(id)) return Promise.resolve(buffers.get(id));
    if (pending.has(id)) return pending.get(id);
    const m = byId.get(id);
    if (!m) return Promise.resolve(null);
    const p = fetch(m.p)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((ab) => ctxRef.decodeAudioData(ab))
      .then((buf) => { buffers.set(id, buf); pending.delete(id); return buf; })
      .catch(() => { pending.delete(id); return null; }); // synthesis covers it
    pending.set(id, p);
    return p;
  },

  /** fetch+decode a track's asset set (used before export, and to prefetch) */
  ensure(ids = []) {
    return Promise.all([...new Set(ids)].map((id) => this.load(id)));
  },

  get loadedCount() { return buffers.size; },
};
