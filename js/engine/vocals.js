// Vocal takes: mic capture via MediaRecorder, decoded to an AudioBuffer and
// anchored to a position in the composition. The take plays on every loop
// pass and is mixed into exports.
//
// Browser notes: MediaRecorder produces webm/opus on Chrome/Firefox/Edge and
// mp4/aac on Safari (macOS + iOS 14.3+); decodeAudioData handles both and
// resamples to the live context rate. Feature-detect with recorderSupported()
// and hide the control when unavailable — recording is an extra, never a
// dependency.

export function recorderSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

/** Start a take. Returns { stop(): Promise<Blob> }. Throws if mic denied. */
export async function startTake() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start();
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.stop();
    }),
  };
}

/** Blob -> AudioBuffer at the context's sample rate. */
export async function decodeTake(ctx, blob) {
  const ab = await blob.arrayBuffer();
  return ctx.decodeAudioData(ab);
}

/**
 * Linear-resample an AudioBuffer's channels to a target rate (used to bring
 * a device-rate take, often 48 kHz, to the 44.1 kHz export rate). Linear
 * interpolation is fully adequate for voice.
 */
export function resampleTake(buffer, targetRate) {
  const ratio = buffer.sampleRate / targetRate;
  const outLen = Math.floor(buffer.length / ratio);
  const channels = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
    const src = buffer.getChannelData(c);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const x = i * ratio;
      const i0 = Math.floor(x);
      const frac = x - i0;
      out[i] = src[i0] * (1 - frac) + (src[i0 + 1] ?? src[i0]) * frac;
    }
    channels.push(out);
  }
  if (channels.length === 1) channels.push(channels[0]); // mono -> both sides
  return { channels, length: outLen };
}
