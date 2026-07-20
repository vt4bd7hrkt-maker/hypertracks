// Visualizer: a glowing waveform horizon + bass-reactive aura, drawn on a
// full-screen canvas behind the UI. Reads one AnalyserNode tapped off the
// current graph's master output. Deliberately soft and slow — ambience,
// not an oscilloscope.

export class Visualizer {
  /** @param {HTMLCanvasElement} canvas @param {AudioContext} ctx */
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.audioCtx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.85;
    this.wave = new Uint8Array(this.analyser.fftSize);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.hue = 310; // drifts slowly per track
    this.running = false;
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  /** Tap a graph's output into the analyser (analyser does not touch routing). */
  attach(graph) {
    try { graph.out.connect(this.analyser); } catch { /* context mismatch */ }
  }

  setHueFromSeed(seed) {
    // poster palette: each track claims one accent
    const ACCENTS = ['#2440ff', '#8a5cf5', '#d61f69', '#0a8f4e'];
    this.accent = ACCENTS[seed % ACCENTS.length];
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _draw() {
    // poster oscilloscope: flat ink trace + acid bass meter, no glow
    const c = this.ctx2d;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.analyser.getByteTimeDomainData(this.wave);
    this.analyser.getByteFrequencyData(this.freq);

    let bass = 0;
    for (let i = 1; i < 8; i++) bass += this.freq[i];
    bass /= 8 * 255;

    c.clearRect(0, 0, w, h);

    // bass block: a flat acid bar breathing from the floor
    c.fillStyle = 'rgba(198, 240, 0, 0.85)';
    c.fillRect(0, h - bass * h * 0.7, w, bass * h * 0.7);

    // ink waveform trace
    const mid = h * 0.45;
    const amp = h * 0.3;
    c.beginPath();
    const n = this.wave.length;
    for (let i = 0; i < n; i += 3) {
      const x = (i / n) * w;
      const y = mid + ((this.wave[i] - 128) / 128) * amp;
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.strokeStyle = 'rgba(20, 20, 18, 0.8)';
    c.lineWidth = 1.5;
    c.stroke();

    // per-track accent tick at the trace start (a printed registration mark)
    c.fillStyle = this.accent || '#2440ff';
    c.fillRect(0, mid - 3, 6, 6);
  }
}
