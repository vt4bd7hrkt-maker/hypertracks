// Encoders + share/save plumbing.
// WAV: hand-rolled 16-bit PCM RIFF writer (no dependency needed).
// MP3: vendored lamejs (@breezystack fork — the maintained one), loaded as a
// plain script so the encoder also works offline once cached.

/** AudioBuffer -> Blob('audio/wav'), 16-bit stereo PCM. */
export function encodeWav(buffer) {
  const numCh = Math.min(2, buffer.numberOfChannels);
  const len = buffer.length;
  const rate = buffer.sampleRate;
  const bytesPerFrame = numCh * 2;
  const dataSize = len * bytesPerFrame;
  const ab = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(ab);

  const str = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);              // PCM
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * bytesPerFrame, true);
  dv.setUint16(32, bytesPerFrame, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, dataSize, true);

  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

/** AudioBuffer -> Blob('audio/mpeg') at 192 kbps via lamejs (global). */
export function encodeMp3(buffer) {
  if (typeof lamejs === 'undefined') {
    throw new Error('MP3 encoder not loaded');
  }
  const rate = buffer.sampleRate;
  const enc = new lamejs.Mp3Encoder(2, rate, 192);
  const l = buffer.getChannelData(0);
  const r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l;
  const block = 1152;
  const li = new Int16Array(block);
  const ri = new Int16Array(block);
  const chunks = [];
  for (let i = 0; i < buffer.length; i += block) {
    const n = Math.min(block, buffer.length - i);
    for (let j = 0; j < n; j++) {
      li[j] = clamp16(l[i + j]);
      ri[j] = clamp16(r[i + j]);
    }
    const out = enc.encodeBuffer(li.subarray(0, n), ri.subarray(0, n));
    if (out.length) chunks.push(out);
  }
  const end = enc.flush();
  if (end.length) chunks.push(end);
  return new Blob(chunks, { type: 'audio/mpeg' });
}

function clamp16(x) {
  const s = Math.max(-1, Math.min(1, x));
  return s < 0 ? s * 0x8000 : s * 0x7FFF;
}

/**
 * Deliver a file to the user: iOS/iPadOS get the native share sheet
 * (Files, AirDrop, Messages...); everywhere else falls back to a download.
 */
export async function deliverFile(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      // fall through to download on any other share failure
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

export function safeFilename(name, ext) {
  return `${name.replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'endless'}.${ext}`;
}
