// Per-track mascot: a Bayer-dithered blob smiley, generated from the track
// seed — the "degraded hero graphic" every reference poster has (pixelated
// corndog, dithered brain, sprayed smiley). Every track gets its own
// creature; the face reacts to the mood sliders. Rendered tiny and upscaled
// with image-rendering: pixelated for the bitmap look.

export function drawSticker(canvas, seed, macros) {
  const px = 48;
  canvas.width = px;
  canvas.height = px;
  const c = canvas.getContext('2d');

  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const cx = px / 2, cy = px / 2, R = px * 0.38;
  const wob = 0.12 + (macros?.weird ?? 0.3) * 0.3;   // weirder = lumpier blob
  const lobes = 3 + Math.floor(rnd() * 4);
  const phase = rnd() * Math.PI * 2;

  const img = c.createImageData(px, px);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = x - cx, dy = y - cy;
      const a = Math.atan2(dy, dx);
      const r = Math.hypot(dx, dy);
      const edge = R * (1 + wob * Math.sin(a * lobes + phase));
      const v = r < edge ? 0.95 - (r / edge) * 0.55 : 0; // denser center
      if (v > BAYER[y % 4][x % 4] / 16) {
        const i = (y * px + x) * 4;
        img.data[i] = 20; img.data[i + 1] = 20; img.data[i + 2] = 18;
        img.data[i + 3] = 255;
      }
    }
  }
  c.putImageData(img, 0, 0);

  // face punched out in paper color; expression follows the mood
  c.fillStyle = '#f2f0e9';
  const ex = Math.round(px * 0.15);
  const eyeY = Math.round(px * 0.4);
  if ((macros?.dream ?? 0.5) > 0.65) {
    c.fillRect(cx - ex - 3, eyeY + 2, 7, 2);       // dreamy: closed eyes
    c.fillRect(cx + ex - 3, eyeY + 2, 7, 2);
  } else {
    c.fillRect(cx - ex - 2, eyeY - 1, 5, 6);       // awake: pixel eyes
    c.fillRect(cx + ex - 2, eyeY - 1, 5, 6);
  }
  const mouthY = Math.round(px * 0.6);
  if ((macros?.energy ?? 0.6) > 0.62) {
    c.fillRect(cx - 5, mouthY, 10, 7);             // hype: mouth open
  } else if ((macros?.dark ?? 0.4) > 0.7) {
    c.fillRect(cx - 6, mouthY + 3, 12, 2);         // dark: flat line
  } else {
    c.fillRect(cx - 7, mouthY + 1, 3, 3);          // smile: pixel curve
    c.fillRect(cx - 4, mouthY + 3, 8, 3);
    c.fillRect(cx + 4, mouthY + 1, 3, 3);
  }
}
