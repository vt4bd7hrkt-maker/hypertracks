#!/usr/bin/env python3
"""HyperTracks asset pipeline.

Turns raw downloads from license-verified sources into the shipped library:

  sources (see SOURCES below, all verified CC0 / Public Domain):
    BushDrum, BillieDrum  -> electronic drum-machine one-shots
    VCSL cherry-picks     -> acoustic percussion, mallets/keys, gongs, textures
    McGreevy VLF archive  -> natural-radio field-recording textures
    AKWF (pre-converted)  -> wavetable harmonics (akwf_waves.json)

  processing: decode via afconvert (handles 24-bit), downmix to mono 16-bit
  44.1 kHz, trim silence, cap length per category, 0.85 peak-normalize, short
  fade-out. One-shots stay WAV (AAC priming delay would smear transients);
  long textures become 96k M4A. Output: assets/ tree + generated ES module
  js/assets/manifest.js consumed statically by the composer.

Usage: python3 tools/build_assets.py <path-to-assets_src>
"""
import json, math, os, re, struct, subprocess, sys, wave

SRC = sys.argv[1] if len(sys.argv) > 1 else 'assets_src'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'assets')
TMP = os.path.join(SRC, '_tmp')
os.makedirs(TMP, exist_ok=True)

SOURCES = [
    {"name": "EwonRael/BushDrum (LinnDrum LM-2 modeled kit)", "license": "CC0-1.0",
     "url": "https://github.com/EwonRael/BushDrum"},
    {"name": "EwonRael/BillieDrum (modeled electronic kit)", "license": "CC0-1.0",
     "url": "https://github.com/EwonRael/BillieDrum"},
    {"name": "Versilian Community Sample Library (VCSL)", "license": "CC0-1.0",
     "url": "https://github.com/sgossner/VCSL"},
    {"name": "Stephen P. McGreevy — Auroral Chorus VLF natural radio", "license": "Public Domain Mark 1.0",
     "url": "https://archive.org/details/lightning_elf_vlf_q-bursts"},
    {"name": "AKWF — Adventure Kid Waveforms (AKWF-FREE)", "license": "CC0-1.0",
     "url": "https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE"},
]

CAPS = {'kick': 0.8, 'snare': 0.8, 'clap': 0.7, 'hat': 0.5, 'hato': 1.0,
        'perc': 0.9, 'keys': 2.3, 'bass': 1.6, 'fx': 5.0}
FADES = {'keys': 0.25, 'fx': 0.5, 'bass': 0.2}

manifest = []

def decode(src, dst):
    subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', src, dst],
                   check=True, capture_output=True)

def read_wav(path):
    w = wave.open(path)
    n = w.getnframes()
    data = struct.unpack('<%dh' % n, w.readframes(n))
    w.close()
    return [s / 32768 for s in data]

def write_wav(path, samples):
    w = wave.open(path, 'w')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
    w.writeframes(struct.pack('<%dh' % len(samples),
                              *[max(-32768, min(32767, int(s * 32767))) for s in samples]))
    w.close()

def trim(samples, cap, fade):
    sr = 44100
    # leading silence
    start = 0
    for i, s in enumerate(samples):
        if abs(s) > 0.003: start = max(0, i - 220); break
    # tail below -60 dB
    end = len(samples)
    for i in range(len(samples) - 1, start, -1):
        if abs(samples[i]) > 0.001: end = min(len(samples), i + 2200); break
    out = samples[start:min(end, start + int(cap * sr))]
    peak = max((abs(s) for s in out), default=1) or 1
    out = [s * 0.85 / peak for s in out]
    nf = int(fade * sr)
    for i in range(min(nf, len(out))):
        out[len(out) - 1 - i] *= i / nf
    return out

def add(src_path, kind, ident, source_idx, root=None):
    tmp = os.path.join(TMP, 'd.wav')
    decode(src_path, tmp)
    samples = trim(read_wav(tmp), CAPS[kind], FADES.get(kind, 0.04))
    if len(samples) < 441: return
    rel = f'assets/{kind}/{ident}.wav'
    dst = os.path.join(REPO, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    write_wav(dst, samples)
    e = {'id': ident, 'p': rel, 'k': kind, 's': source_idx}
    if root is not None: e['root'] = root
    manifest.append(e)

def add_tex(src_path, ident, source_idx, offset_s, dur_s=14):
    wav_all = os.path.join(TMP, 'tex_all.wav')
    decode(src_path, wav_all)
    samples = read_wav(wav_all)
    sr = 44100
    seg = samples[int(offset_s * sr): int((offset_s + dur_s) * sr)]
    if len(seg) < sr * 4: return
    peak = max(abs(s) for s in seg) or 1
    seg = [s * 0.7 / peak for s in seg]
    nf = sr // 2  # half-second loop-friendly fades both ends
    for i in range(nf):
        seg[i] *= i / nf
        seg[len(seg) - 1 - i] *= i / nf
    cut = os.path.join(TMP, 'tex_cut.wav')
    write_wav(cut, seg)
    rel = f'assets/tex/{ident}.m4a'
    dst = os.path.join(REPO, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '96000', cut, dst],
                   check=True, capture_output=True)
    manifest.append({'id': ident, 'p': rel, 'k': 'tex', 's': source_idx})

NOTE_RE = re.compile(r'(?:^|[_ \-])([A-G]#?)(-?\d)(?:[_ \-.])')
PCLS = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}

def note_of(name):
    m = NOTE_RE.search(name.replace('b', '#') if 'b' in name[:0] else name)
    if not m: return None
    return 12 * (int(m.group(2)) + 1) + PCLS[m.group(1)]

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

# ---------------------------------------------------------------------------
# 1. electronic kits
KIT_MAP = [
    (r'kick|bd\b', 'kick'), (r'snare', 'snare'), (r'clap', 'clap'),
    (r'hihat.?open|open.?hat|\boh\b', 'hato'), (r'hihat|hat|\bch\b', 'hat'),
    (r'crash|ride|cym', 'fx'),
    (r'bongo|conga|cowbell|caba|stick|tom|tamb|shaker|clave|block|guiro|rim|perc|casta|maraca|tri\b', 'perc'),
]
for kit, sidx in (('BushDrum', 0), ('BillieDrum', 1)):
    d = os.path.join(SRC, kit)
    if not os.path.isdir(d): continue
    for f in sorted(os.listdir(d)):
        if not f.endswith('.wav') or f == 'preview.wav': continue
        low = f.lower()
        kind = next((k for pat, k in KIT_MAP if re.search(pat, low)), None)
        if not kind: continue
        add(os.path.join(d, f), kind, f'{slug(kit)}-{slug(f[:-4])}', sidx)
    print(kit, 'done')

# ---------------------------------------------------------------------------
# 2. VCSL cherry-picks
V = os.path.join(SRC, 'VCSL')
VCSL_PITCHED = [
    ('Idiophones/Struck Idiophones/Glockenspiel', 'glock'),
    ('Idiophones/Struck Idiophones/Vibraphone', 'vibes'),
    ('Idiophones/Struck Idiophones/Marimba', 'marimba'),
    ('Idiophones/Struck Idiophones/Tubular Bells 1', 'tubular'),
    ('Idiophones/Struck Idiophones/Balafon', 'balafon'),
    ('Idiophones/Struck Idiophones/Hand Chimes', 'chimes'),
    ('Idiophones/Plucked Idiophones/Kalimba, Tanzania', 'kalimba'),
]
VCSL_UNPITCHED = [
    ('Idiophones/Struck Idiophones/Claps', 'clap', 'vclap'),
    ('Idiophones/Struck Idiophones/Cowbells', 'perc', 'cowbell'),
    ('Idiophones/Struck Idiophones/Claves', 'perc', 'claves'),
    ('Idiophones/Struck Idiophones/Woodblock', 'perc', 'woodblock'),
    ('Idiophones/Struck Idiophones/Shaker, Large', 'perc', 'shaker'),
    ('Idiophones/Struck Idiophones/Tambourine 1', 'perc', 'tambo'),
    ('Membranophones/Struck Membranophones/Bongos', 'perc', 'bongo'),
    ('Membranophones/Struck Membranophones/Frame Drum', 'perc', 'frame'),
    ('Membranophones/Struck Membranophones/Darbuka', 'perc', 'darbuka'),
    ('Membranophones/Struck Membranophones/Bass Drum 1', 'kick', 'concert-bd'),
    ('Membranophones/Struck Membranophones/Snare Drum, Modern 1', 'snare', 'acsnare'),
    ('Idiophones/Struck Idiophones/Gong 1', 'fx', 'gong'),
    ('Idiophones/Struck Idiophones/Suspended Cymbal 1', 'fx', 'suscym'),
]

def wavs_under(path):
    hits = []
    for root, _, files in os.walk(path):
        for f in files:
            if f.lower().endswith('.wav'): hits.append(os.path.join(root, f))
    return sorted(hits)

for rel, name in VCSL_PITCHED:
    files = wavs_under(os.path.join(V, rel))
    by_note = {}
    for f in files:
        n = note_of(os.path.basename(f))
        if n and 40 <= n <= 100: by_note.setdefault(n, []).append(f)
    picked, last = [], -99
    for n in sorted(by_note):
        if n - last >= 3:
            picked.append((n, sorted(by_note[n])[-1])); last = n
    for n, f in picked[:8]:
        add(f, 'keys', f'{name}-{n}', 2, root=n)
    print('VCSL', name, len(picked[:8]))

for rel, kind, name in VCSL_UNPITCHED:
    files = wavs_under(os.path.join(V, rel))
    step = max(1, len(files) // 6)
    for i, f in enumerate(files[::step][:6]):
        add(f, kind, f'{name}-{i+1}', 2)
    print('VCSL', name, min(6, len(files)))

# Ocean drum -> long texture beds
ocean = wavs_under(os.path.join(V, 'Membranophones/Other Membranophones/Ocean Drum'))
for i, f in enumerate(ocean[:3]):
    add_tex(f, f'ocean-{i+1}', 2, 0)

# ---------------------------------------------------------------------------
# 3. VLF natural-radio textures (two excerpts per recording)
for name, fname in (('vlf-skilak', 'vlf1.mp3'), ('vlf-puna', 'vlf2.mp3'), ('vlf-timestation', 'vlf3.mp3')):
    p = os.path.join(SRC, fname)
    if not os.path.exists(p): continue
    for j, off in enumerate((20, 70)):
        add_tex(p, f'{name}-{j+1}', 3, off)
    print('VLF', name)

# ---------------------------------------------------------------------------
# 4. wavetables + manifest module
waves = json.load(open(os.path.join(SRC, 'akwf_waves.json')))

mod = ['// GENERATED by tools/build_assets.py — do not edit by hand.',
       '// Sources and licenses: see SOURCES below and ASSETS.md.', '']
mod.append('export const SOURCES = ' + json.dumps(SOURCES, indent=1) + ';\n')
mod.append('export const SAMPLES = ' + json.dumps(manifest) + ';\n')
mod.append('export const WAVES = ' + json.dumps(waves) + ';\n')
open(os.path.join(REPO, 'js', 'assets', 'manifest.js'), 'w').write('\n'.join(mod))
os.makedirs(os.path.join(REPO, 'js', 'assets'), exist_ok=True)

from collections import Counter
counts = Counter(e['k'] for e in manifest)
print('SAMPLES:', len(manifest), dict(counts))
print('WAVES:', len(waves))
total = sum(os.path.getsize(os.path.join(REPO, e['p'])) for e in manifest)
print('library size: %.1f MB' % (total / 1048576))
EOF_MARKER = None
