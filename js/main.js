// App controller: owns the AudioContext, macro/FX state, tempo, history,
// the play/NEXT/MUTATE loop, timeline scrubbing and export. All audio work
// is delegated to engine/, all music decisions to composer/ — this file is
// only glue + UI state.

import { compose, DEFAULT_MACROS } from './composer/composer.js';
import { mutate } from './composer/mutate.js';
import { Player } from './engine/player.js';
import { DEFAULT_FX } from './engine/graph.js';
import { renderComposition } from './engine/renderer.js';
import { encodeWav, encodeMp3, deliverFile, safeFilename } from './export/encode.js';
import { Visualizer } from './ui/visualizer.js';
import { recorderSupported, startTake, decodeTake } from './engine/vocals.js';
import { bank } from './engine/assetbank.js';
import { drawSticker } from './ui/sticker.js';
import { randomSeed } from './core/rng.js';

// The 8 emotional controls (mood tab).
const MACRO_DEFS = [
  { key: 'energy', label: 'energy' },
  { key: 'dream', label: 'dreaminess' },
  { key: 'chaos', label: 'chaos' },
  { key: 'glitch', label: 'glitch' },
  { key: 'dark', label: 'darkness' },
  { key: 'bounce', label: 'bounce' },
  { key: 'space', label: 'space' },
  { key: 'weird', label: 'weirdness' },
];

// The performance-FX controls (sound tab). Bipolar around 0.5 = "as designed".
const FX_DEFS = [
  { key: 'cutoff', label: 'filter' },
  { key: 'res', label: 'resonance' },
  { key: 'drive', label: 'drive' },
  { key: 'crush', label: 'bitcrush' },
  { key: 'reverb', label: 'reverb' },
  { key: 'echo', label: 'delay' },
  { key: 'width', label: 'stereo width' },
  { key: 'texture', label: 'texture' },
  { key: 'glide', label: 'glide' },
  { key: 'punch', label: 'punch' },
];

const BPM_MIN = 90, BPM_MAX = 190;
const HISTORY_CAP = 60;

const state = {
  ctx: null,
  player: null,
  viz: null,
  macros: { ...DEFAULT_MACROS },
  fx: { ...DEFAULT_FX },
  userBpm: 150,
  comp: null,
  playing: false,
  exporting: false,
  mutation: 0.45,
  history: [],   // {comp, macros, fx, userBpm, vocal} — nothing is ever lost
  hIndex: -1,
  scrubbing: false,
  vocal: null,     // { buffer, startPos } — current take, tied to this track
  take: null,      // active recorder handle while recording
  recent: [],      // core asset ids of recent tracks (anti-repetition)
  next: null,      // prefetched { seed, sig } for an instant, warm NEXT
};

/** the sounds a listener would recognize if repeated back-to-back */
function coreIdsOf(comp) {
  const s = comp.sound;
  return [
    s.kick.sampleId, s.snare.sampleId, s.mix.bedSampleId,
    s.lead.wave && s.lead.wave.id,
    s.lead.famName && ('fam:' + s.lead.famName),
  ].filter(Boolean);
}

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// boot

function init() {
  buildSliderPanel($('#macros'), MACRO_DEFS, state.macros, () => pushLive());
  buildSliderPanel($('#fxpanel'), FX_DEFS, state.fx, () => pushLive());
  buildTabs();

  $('#overlay').addEventListener('click', enterApp, { once: true });
  $('#next').addEventListener('click', nextTrack);
  $('#mutate').addEventListener('click', mutateTrack);
  $('#back').addEventListener('click', () => navigateHistory(-1));
  $('#fwd').addEventListener('click', () => navigateHistory(1));
  $('#playpause').addEventListener('click', togglePlay);
  $('#export-wav').addEventListener('click', () => exportTrack('wav'));
  $('#export-mp3').addEventListener('click', () => exportTrack('mp3'));

  $('#mutamount').addEventListener('input', (e) => { state.mutation = e.target.value / 100; });
  if (recorderSupported()) $('#rec').hidden = false;
  $('#rec').addEventListener('click', toggleRec);
  $('#voxclear').addEventListener('click', () => setVocal(null));
  $('#bpm').addEventListener('input', (e) => {
    state.userBpm = Number(e.target.value);
    $('#bpmval').textContent = state.userBpm;
    state.player?.setBpm(state.userBpm);
  });

  initTimeline();
  requestAnimationFrame(uiLoop);
}

function enterApp() {
  const AC = window.AudioContext || window.webkitAudioContext;
  state.ctx = new AC({ latencyHint: 'interactive' });
  state.ctx.resume();
  state.player = new Player(state.ctx);
  bank.init(state.ctx);
  state.viz = new Visualizer($('#viz'), state.ctx);
  state.viz.start();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.ctx.state !== 'running' && state.playing) state.ctx.resume();
  });

  $('#overlay').classList.add('gone');
  startFresh(randomSeed());
}

// ---------------------------------------------------------------------------
// playback + history

/** Play `comp` and (optionally) record a history snapshot. */
function startTrack(comp, { record = true } = {}) {
  // a take belongs to its track: clear for the new one, but leave the previous
  // history entry's saved take untouched so BACK restores it
  setVocal(null, { keepHistory: true });
  state.comp = comp;
  state.userBpm = comp.bpm;
  state.player.play(comp, state.macros, state.fx, state.userBpm);
  state.viz.setHueFromSeed(comp.seed);
  state.viz.attach(state.player.graph);
  state.playing = true;
  if (record) {
    state.history.push(snapshot());
    if (state.history.length > HISTORY_CAP) state.history.shift();
    state.hIndex = state.history.length - 1;
  }
  bank.ensure(comp.assetIds); // lazy: only this track's sounds are fetched
  state.recent = [...coreIdsOf(comp), ...state.recent].slice(0, 15);
  armNext();
  syncUi();
}

/** pre-pick the next seed and warm its samples so NEXT starts fully loaded */
function armNext() {
  const seed = randomSeed();
  const sig = JSON.stringify(state.macros);
  const preview = compose(seed, state.macros, {}, state.recent);
  bank.ensure(preview.assetIds);
  state.next = { seed, sig };
}

function snapshot() {
  return {
    comp: state.comp,
    macros: { ...state.macros },
    fx: { ...state.fx },
    userBpm: state.userBpm,
    vocal: state.vocal,
  };
}

function startFresh(seed) {
  startTrack(compose(seed, state.macros, {}, state.recent));
}

function nextTrack() {
  pulse($('#next'));
  if (state.ctx.state !== 'running') state.ctx.resume();
  // use the prefetched seed when the sliders haven't moved (assets are warm)
  const warm = state.next && state.next.sig === JSON.stringify(state.macros);
  startFresh(warm ? state.next.seed : randomSeed());
}

function mutateTrack() {
  if (!state.comp) return;
  pulse($('#mutate'));
  if (state.ctx.state !== 'running') state.ctx.resume();
  startTrack(mutate(state.comp, state.macros, state.mutation, randomSeed(), state.recent));
}

/** Back/forward through history; restores composition AND slider state. */
function navigateHistory(dir) {
  const target = state.hIndex + dir;
  if (target < 0 || target >= state.history.length) return;
  // keep the current entry's latest slider state before leaving it
  if (state.hIndex >= 0) state.history[state.hIndex] = snapshot();
  state.hIndex = target;
  const snap = state.history[target];
  state.macros = { ...snap.macros };
  state.fx = { ...snap.fx };
  state.comp = snap.comp;
  state.userBpm = snap.userBpm;
  state.player.play(snap.comp, state.macros, state.fx, state.userBpm);
  setVocal(snap.vocal || null, { keepHistory: true });
  state.viz.setHueFromSeed(snap.comp.seed);
  state.viz.attach(state.player.graph);
  state.playing = true;
  syncSliders();
  syncUi();
}

function togglePlay() {
  if (!state.ctx) return;
  if (state.playing) { state.ctx.suspend(); state.playing = false; }
  else { state.ctx.resume(); state.playing = true; }
  $('#playpause').textContent = state.playing ? '❚❚' : '▶';
}

function pushLive() {
  state.player?.setLive(state.macros, state.fx);
}

// ---------------------------------------------------------------------------
// UI construction + sync

function buildSliderPanel(panel, defs, model, onInput) {
  for (const def of defs) {
    const wrap = document.createElement('label');
    wrap.className = 'macro';
    wrap.innerHTML = `
      <span class="macro-name">${def.label}</span>
      <input type="range" min="0" max="100"
             value="${Math.round(model[def.key] * 100)}"
             data-key="${def.key}" aria-label="${def.label}">
    `;
    const input = wrap.querySelector('input');
    input.addEventListener('input', () => {
      model[def.key] = input.value / 100;
      onInput();
    });
    input.addEventListener('dblclick', () => { // double-click = reset to center
      input.value = 50;
      model[def.key] = 0.5;
      onInput();
    });
    panel.appendChild(wrap);
  }
}

function buildTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((btn) => btn.addEventListener('click', () => {
    tabs.forEach((b) => b.classList.toggle('active', b === btn));
    $('#macros').hidden = btn.dataset.tab !== 'mood';
    $('#soundtab').hidden = btn.dataset.tab !== 'sound';
  }));
}

function syncSliders() {
  for (const input of document.querySelectorAll('#macros input[data-key]')) {
    input.value = Math.round((state.macros[input.dataset.key] ?? 0.5) * 100);
  }
  for (const input of document.querySelectorAll('#fxpanel input[data-key]')) {
    input.value = Math.round((state.fx[input.dataset.key] ?? 0.5) * 100);
  }
}

function syncUi() {
  const { comp } = state;
  $('#trackname').textContent = comp.name;
  drawSticker($('#mascot'), comp.seed, state.macros);
  $('#trackmeta').textContent = `${comp.key.toUpperCase()} · ${Math.round(comp.duration)}S`;
  $('#bpm').value = state.userBpm;
  $('#bpmval').textContent = state.userBpm;
  $('#back').disabled = state.hIndex <= 0;
  $('#fwd').disabled = state.hIndex >= state.history.length - 1;
  $('#histpos').textContent = state.history.length ? `${state.hIndex + 1}/${state.history.length}` : '';
  const card = $('#trackcard');
  card.classList.remove('flip');
  void card.offsetWidth;
  card.classList.add('flip');
  $('#playpause').textContent = state.playing ? '❚❚' : '▶';
}

function pulse(btn) {
  btn.classList.remove('pulse');
  void btn.offsetWidth;
  btn.classList.add('pulse');
}

// ---------------------------------------------------------------------------
// timeline

function initTimeline() {
  const tl = $('#timeline');
  const frac = (e) => {
    const r = tl.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const seekTo = (e) => {
    if (!state.player?.comp) return;
    state.player.seek(frac(e));
  };
  tl.addEventListener('pointerdown', (e) => {
    state.scrubbing = true;
    tl.setPointerCapture(e.pointerId);
    seekTo(e);
  });
  tl.addEventListener('pointermove', (e) => { if (state.scrubbing) seekTo(e); });
  tl.addEventListener('pointerup', () => { state.scrubbing = false; });
  tl.addEventListener('pointercancel', () => { state.scrubbing = false; });
}

function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function uiLoop() {
  const p = state.player;
  if (p?.comp) {
    $('#progress').style.transform = `scaleX(${p.progress})`;
    $('#tcur').textContent = fmtTime(p.position * p.rate);
    $('#tlen').textContent = fmtTime(p.wallDuration);
  }
  requestAnimationFrame(uiLoop);
}

// ---------------------------------------------------------------------------
// vocal recording

function setVocal(vocal, { keepHistory = false } = {}) {
  state.vocal = vocal;
  state.player?.setVocal(vocal);
  $('#voxclear').hidden = !vocal;
  // keep the current history entry in sync so BACK/FWD restores the take
  if (!keepHistory && state.hIndex >= 0 && state.history[state.hIndex]) {
    state.history[state.hIndex].vocal = vocal;
  }
}

async function toggleRec() {
  const btn = $('#rec');
  if (state.take) {
    // stop -> decode -> attach at the position where recording started
    const { handle, startPos, timer } = state.take;
    state.take = null;
    clearInterval(timer);
    btn.classList.remove('live');
    btn.textContent = '● REC';
    try {
      const blob = await handle.stop();
      const buffer = await decodeTake(state.ctx, blob);
      // compensate output latency: the singer reacted to audio that left the
      // speaker this much earlier than the clock position we noted
      const lat = (state.ctx.outputLatency || 0) + (state.ctx.baseLatency || 0);
      setVocal({ buffer, startPos: Math.max(0, startPos - lat) });
    } catch (err) {
      console.error('take failed', err);
      $('#export-status').textContent = 'recording failed';
      setTimeout(() => { $('#export-status').textContent = ''; }, 2500);
    }
    return;
  }
  if (!state.comp) return;
  if (state.ctx.state !== 'running') { state.ctx.resume(); state.playing = true; }
  try {
    const handle = await startTake();
    const startPos = state.player.position;
    const t0 = Date.now();
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      btn.textContent = `■ 0:${String(s % 60).padStart(2, '0')}`;
    }, 250);
    state.take = { handle, startPos, timer };
    btn.classList.add('live');
    btn.textContent = '■ 0:00';
  } catch (err) {
    console.error('mic denied', err);
    $('#export-status').textContent = 'mic blocked';
    setTimeout(() => { $('#export-status').textContent = ''; }, 2500);
  }
}

// ---------------------------------------------------------------------------
// export

async function exportTrack(format) {
  if (!state.comp || state.exporting) return;
  state.exporting = true;
  const status = $('#export-status');
  status.textContent = 'rendering…';
  document.body.classList.add('exporting');
  try {
    await new Promise((r) => setTimeout(r, 30));
    const buffer = await renderComposition(
      state.comp, state.macros, state.fx, state.userBpm,
      (frac) => { status.textContent = `rendering ${Math.round(frac * 100)}%`; },
      state.vocal,
    );
    status.textContent = 'encoding…';
    await new Promise((r) => setTimeout(r, 30));
    const blob = format === 'wav' ? encodeWav(buffer) : encodeMp3(buffer);
    const result = await deliverFile(blob, safeFilename(state.comp.name, format), state.comp.name);
    status.textContent = result === 'cancelled' ? '' : 'saved ✓';
  } catch (err) {
    console.error('export failed', err);
    status.textContent = 'export failed';
  } finally {
    state.exporting = false;
    document.body.classList.remove('exporting');
    setTimeout(() => { status.textContent = ''; }, 2500);
  }
}

// ---------------------------------------------------------------------------

init();

// debug handle (console + automated smoke tests); not part of the public UI
window.__endless = state;
