#!/usr/bin/env python3
"""HyperTracks digital pack: the hyperpop half of the library, RENDERED.

Every sound here is synthesized offline by this script with heavy baked
processing (multi-stage saturation, hard clipping, bit/sample-rate crushing,
ring-mod, tape physics, formant voices) — resampled in-house exactly the way
the originals were made, so the pack is CC0-by-construction. Curated preset
lists, not random generation: every entry exists on purpose.

Also folds in cherry-picks from MckAudio/MckSamplePacks (CC0-verified
recordings of real drum machines: Behringer RD-6, Roland TR-8).

Usage: python3 tools/build_digital_pack.py [<assets_src dir with MckSamplePacks>]
Rewrites js/assets/manifest.js (appends to the existing SAMPLES list).
"""
import json, math, os, re, struct, subprocess, sys, wave, random

SR = 44100
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else None
rnd = random.Random(0xD16174)  # deterministic pack

entries = []

# ---------------------------------------------------------------------------
# DSP toolbox (offline; quality over speed)

def sine(f, n, phase=0.0):
    out = []
    ph = phase
    if callable(f):
        for i in range(n):
            ph += 2 * math.pi * f(i / SR) / SR
            out.append(math.sin(ph))
    else:
        for i in range(n):
            ph += 2 * math.pi * f / SR
            out.append(math.sin(ph))
    return out

def saw(f, n, detune=1.0):
    out, ph = [], 0.0
    for i in range(n):
        ph = (ph + f * detune / SR) % 1.0
        out.append(2 * ph - 1)
    return out

def square(f, n, pw=0.5):
    out, ph = [], 0.0
    if callable(f):
        for i in range(n):
            ph = (ph + f(i / SR) / SR) % 1.0
            out.append(1.0 if ph < pw else -1.0)
    else:
        for i in range(n):
            ph = (ph + f / SR) % 1.0
            out.append(1.0 if ph < pw else -1.0)
    return out

def noise(n):
    return [rnd.uniform(-1, 1) for _ in range(n)]

def env_exp(x, dec, hold=0):
    return [s * (1.0 if i < hold else math.exp(-(i - hold) / (dec * SR))) for i, s in enumerate(x)]

def mix(*layers):
    n = max(len(l) for l in layers)
    out = [0.0] * n
    for l in layers:
        for i, s in enumerate(l):
            out[i] += s
    return out

def gain(x, g):
    return [s * g for s in x]

def tanh_drive(x, amt):
    return [math.tanh(s * amt) for s in x]

def hardclip(x, ceil=0.7):
    return [max(-ceil, min(ceil, s)) / ceil for s in x]

def bitcrush(x, bits):
    q = 2 ** (bits - 1)
    return [round(s * q) / q for s in x]

def srcrush(x, factor):
    out, held = [], 0.0
    for i, s in enumerate(x):
        if i % factor == 0: held = s
        out.append(held)
    return out

def biquad(x, kind, f0, q):
    w = 2 * math.pi * f0 / SR
    alpha = math.sin(w) / (2 * q)
    cw = math.cos(w)
    if kind == 'lp': b0 = b2 = (1 - cw) / 2; b1 = 1 - cw
    elif kind == 'hp': b0 = b2 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
    else: b0 = alpha; b1 = 0.0; b2 = -alpha  # bp
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    y1 = y2 = x1 = x2 = 0.0
    out = []
    for s in x:
        y = b0 * s + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, s
        y2, y1 = y1, y
        out.append(y)
    return out

def ringmod(x, f):
    return [s * math.sin(2 * math.pi * f * i / SR) for i, s in enumerate(x)]

def reverse(x):
    return list(reversed(x))

def fade(x, ms_in=2, ms_out=30):
    ni, no = int(ms_in * SR / 1000), int(ms_out * SR / 1000)
    for i in range(min(ni, len(x))): x[i] *= i / ni
    for i in range(min(no, len(x))): x[len(x) - 1 - i] *= i / no
    return x

def normalize(x, peak=0.88):
    m = max((abs(s) for s in x), default=1) or 1
    return [s * peak / m for s in x]

def sec(t): return int(t * SR)

def save(samples, kind, ident, root=None, m4a=False):
    samples = fade(normalize(samples))
    rel = f'assets/{kind}/{ident}.' + ('m4a' if m4a else 'wav')
    dst = os.path.join(REPO, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst if not m4a else os.path.join(REPO, 'assets', '_tmp.wav')
    w = wave.open(tmp, 'w')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(struct.pack('<%dh' % len(samples),
                              *[max(-32768, min(32767, int(s * 32767))) for s in samples]))
    w.close()
    if m4a:
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '96000', tmp, dst],
                       check=True, capture_output=True)
        os.remove(tmp)
    e = {'id': ident, 'p': rel, 'k': kind, 's': 5}
    if root is not None: e['root'] = root
    entries.append(e)

def midi_f(m): return 440 * 2 ** ((m - 69) / 12)

# ---------------------------------------------------------------------------
# 808s — pitched, root-tagged, three flavors (kind 'bass')

for root in (33, 36, 38, 41, 43, 45):
    f = midi_f(root)
    n = sec(1.4)
    body = sine(lambda t, f=f: f * (1 + 2.2 * math.exp(-t / 0.02)), n)
    x = env_exp(tanh_drive(body, 2.2), 0.55)
    save(x, 'bass', f'dg-808-{root}', root=root)
for root in (33, 38, 43):
    f = midi_f(root)
    n = sec(0.9)
    body = sine(lambda t, f=f: f * (1 + 3 * math.exp(-t / 0.015)), n)
    x = mix(tanh_drive(body, 6), gain(tanh_drive(body, 14), 0.4))
    x = bitcrush(env_exp(x, 0.3), 9)
    save(x, 'bass', f'dg-808dist-{root}', root=root)

# reese one-shots — detuned saw stacks, lowpassed, driven (kind 'bass')
for root in (36, 41, 46):
    f = midi_f(root)
    n = sec(1.2)
    x = mix(saw(f, n, 0.994), saw(f, n, 1.0), saw(f, n, 1.006), gain(saw(f * 0.5, n), 0.5))
    x = env_exp(tanh_drive(biquad(x, 'lp', 520, 0.9), 2.4), 0.7, hold=sec(0.25))
    save(x, 'bass', f'dg-reese-{root}', root=root)

# ---------------------------------------------------------------------------
# kicks: distorted / clipped / rumble (kind 'kick')

KICKS = [
    ('dg-kick-clip', 150, 46, 0.012, 0.22, 5, 10),
    ('dg-kick-gab', 210, 52, 0.008, 0.16, 12, 8),
    ('dg-kick-round', 120, 40, 0.02, 0.3, 2.2, 16),
    ('dg-kick-rumble', 95, 34, 0.03, 0.55, 3.5, 12),
    ('dg-kick-lofi', 170, 48, 0.01, 0.2, 4, 6),
    ('dg-kick-mid', 240, 60, 0.006, 0.14, 7, 10),
]
for name, f0, f1, pdec, dec, drive, bits in KICKS:
    n = sec(dec + 0.15)
    body = sine(lambda t, a=f0, b=f1, p=pdec: b + (a - b) * math.exp(-t / p), n)
    click = gain(biquad(noise(sec(0.006)), 'hp', 3500, 0.7), 0.5)
    x = env_exp(mix(body, click), dec)
    x = bitcrush(hardclip(tanh_drive(x, drive), 0.8), bits)
    save(x, 'kick', name)

# clipped snares (kind 'snare')
SNARES = [('dg-snare-clip', 1900, 0.16, 10), ('dg-snare-ring', 2600, 0.22, 12),
          ('dg-snare-lo', 1300, 0.19, 8), ('dg-snare-zap', 3400, 0.12, 6)]
for name, bp, dec, bits in SNARES:
    n = sec(dec + 0.1)
    x = mix(biquad(noise(n), 'bp', bp, 1.1),
            gain(env_exp(sine(lambda t: 195 * (1 - t * 2), n), 0.05), 0.8))
    x = bitcrush(hardclip(tanh_drive(env_exp(x, dec), 3), 0.75), bits)
    save(x, 'snare', name)

# crunchy claps (kind 'clap')
for i, (bp, bits) in enumerate([(1150, 9), (1500, 8), (900, 11)]):
    n = sec(0.35)
    x = [0.0] * n
    for j, off in enumerate((0, 0.011, 0.023, 0.031)):
        burst = env_exp(biquad(noise(sec(0.09)), 'bp', bp, 1.6), 0.012 if j < 3 else 0.12)
        for k, s in enumerate(burst):
            idx = sec(off) + k
            if idx < n: x[idx] += s
    save(bitcrush(tanh_drive(x, 2.5), bits), 'clap', f'dg-clap-{i+1}')

# electronic hats + clicks (kind 'hat'/'hato'/'perc')
for i, (hp, dec) in enumerate([(8200, 0.05), (9800, 0.03), (7000, 0.07)]):
    parts = mix(*[gain(square(hp / 8 * r, sec(dec + 0.03)), 1 / 6)
                  for r in (2.0, 3.0, 4.16, 5.43, 6.79, 8.21)])
    x = env_exp(biquad(mix(parts, gain(noise(sec(dec + 0.03)), 0.5)), 'hp', hp, 0.7), dec)
    save(x, 'hat', f'dg-hat-{i+1}')
save(env_exp(biquad(noise(sec(0.4)), 'hp', 6800, 0.7), 0.3), 'hato', 'dg-hato-1')
for i, f in enumerate((2600, 4400)):
    x = env_exp(biquad(mix(noise(sec(0.03)), [1.0] + [0.0] * (sec(0.03) - 1)), 'bp', f, 8), 0.01)
    save(x, 'perc', f'dg-click-{i+1}')

# ---------------------------------------------------------------------------
# glitch percussion (kind 'perc') — ring-mod, stutter-gated, crushed

for i, (carrier, slices, bits) in enumerate([(700, 5, 8), (1800, 7, 6), (450, 4, 10), (2900, 6, 7)]):
    n = sec(0.5)
    x = ringmod(noise(n), carrier)
    sl = n // slices
    for s_i in range(slices):
        g = 1.0 if s_i % 2 == 0 else 0.15
        crush = rnd.choice((2, 4, 6))
        seg = srcrush(x[s_i * sl:(s_i + 1) * sl], crush)
        for k, v in enumerate(seg): x[s_i * sl + k] = v * g
    save(bitcrush(env_exp(x, 0.35), bits), 'perc', f'dg-glitch-{i+1}')

# chip / console bleeps (kind 'perc') — square language of the Y2K web
save(env_exp(mix(square(988, sec(0.08)), [0] * sec(0.08) + square(1319, sec(0.25))), 0.18), 'perc', 'dg-coin')
save(env_exp(square(lambda t: 2200 * math.exp(-t * 9), sec(0.3)), 0.22), 'perc', 'dg-zap')
arp = []
for f in (523, 659, 784, 1047):
    arp += square(f, sec(0.045))
save(env_exp(arp, 0.3, hold=sec(0.14)), 'perc', 'dg-arpup')
save(bitcrush(env_exp(square(lambda t: 300 + 90 * math.sin(t * 55), sec(0.25)), 0.2), 6), 'perc', 'dg-buzzer')
save(env_exp(srcrush(noise(sec(0.18)), 10), 0.1), 'perc', 'dg-chipnoise')

# UI / phone / camera (kind 'perc')
DTMF = {'1': (697, 1209), '5': (770, 1336), '9': (852, 1477), '#': (941, 1477)}
for key, (a, b) in DTMF.items():
    x = env_exp(mix(sine(a, sec(0.09)), sine(b, sec(0.09))), 0.4, hold=sec(0.08))
    save(tanh_drive(x, 1.3), 'perc', f'dg-dtmf-{key if key != "#" else "hash"}')
shutter = mix(env_exp(biquad(mix([1.0] + [0.0] * (sec(0.05) - 1), gain(noise(sec(0.05)), 0.4)), 'bp', 2100, 5), 0.008),
              [0.0] * sec(0.035) + env_exp(biquad(noise(sec(0.05)), 'bp', 1400, 3), 0.01))
save(shutter, 'perc', 'dg-shutter')
save(env_exp(mix(sine(1000, sec(0.06)), sine(2000, sec(0.06))), 0.5, hold=sec(0.05)), 'perc', 'dg-beep')

# ---------------------------------------------------------------------------
# FX: risers, reverses, sweeps, impacts, tape stops (kind 'fx')

n = sec(2.2)
x = biquad(noise(n), 'bp', 400, 1.4)
x = [s * math.sin(math.pi / 2 * min(1, i / n)) ** 2 for i, s in enumerate(x)]
x = [x[i] + 0.4 * x[i] * math.sin(2 * math.pi * (200 + 2800 * (i / n) ** 2) * i / SR) for i in range(n)]
save(x, 'fx', 'dg-riser-noise')

ticks = [0.0] * sec(2.0)
t_acc = 0.0; gap = 0.24
while t_acc < 1.9:
    at = sec(t_acc)
    for k, s in enumerate(env_exp(biquad(noise(sec(0.02)), 'hp', 3000, 1), 0.006)):
        if at + k < len(ticks): ticks[at + k] += s * (0.3 + 0.7 * t_acc / 2)
    t_acc += gap; gap = max(0.03, gap * 0.82)
save(ticks, 'fx', 'dg-riser-ticks')

crash_src = env_exp(biquad(noise(sec(1.6)), 'hp', 4200, 0.7), 1.1)
save(reverse(crash_src), 'fx', 'dg-reverse-crash')
save(env_exp(mix(sine(lambda t: 52 * (1 - t * 0.4), sec(0.9)), gain(biquad(noise(sec(0.9)), 'lp', 380, 0.8), 0.7)), 0.5), 'fx', 'dg-impact-sub')

n = sec(0.8)
chord = mix(saw(220, n), saw(277, n), saw(330, n), square(110, n))
stop = []
pos = 0.0; speed = 1.0
while pos < n - 1 and speed > 0.02:
    stop.append(chord[int(pos)])
    pos += speed; speed *= 0.99992 if len(stop) < sec(0.25) else 0.99965
save(tanh_drive(stop, 1.8), 'fx', 'dg-tapestop')

sweep = biquad(noise(sec(1.4)), 'bp', 3000, 1.2)
save([s * math.exp(-i / sec(0.5)) for i, s in enumerate(sweep)], 'fx', 'dg-downsweep')

# ---------------------------------------------------------------------------
# textures: VHS, cassette, modem (kind 'tex', m4a)

n = sec(12)
hiss = gain(biquad(noise(n), 'lp', 9000, 0.7), 0.5)
hum = gain(sine(59.4, n), 0.12)
vhs = [hiss[i] * (0.8 + 0.2 * math.sin(2 * math.pi * 0.6 * i / SR)) + hum[i] for i in range(n)]
for at in (sec(3.1), sec(7.4), sec(9.8)):  # dropouts
    for k in range(sec(0.06)):
        if at + k < n: vhs[at + k] *= 0.15
save(vhs, 'tex', 'dg-vhs-bed', m4a=True)

n = sec(12)
tape = biquad(noise(n), 'lp', 6500, 0.7)
tape = [tape[i] * (0.55 + 0.1 * math.sin(2 * math.pi * 0.31 * i / SR) + 0.05 * math.sin(2 * math.pi * 4.3 * i / SR)) for i in range(n)]
save(bitcrush(tape, 11), 'tex', 'dg-cassette-bed', m4a=True)

seq = []
seq += mix(sine(350, sec(0.8)), sine(440, sec(0.8)))
for d in '1595':
    a, b = DTMF.get(d, (697, 1209))
    seq += gain(mix(sine(a, sec(0.09)), sine(b, sec(0.09))), 0.8) + [0.0] * sec(0.04)
seq += gain(sine(2100, sec(0.7)), 0.7)
seq += gain(sine(lambda t: 1200 + 900 * math.sin(t * 22), sec(1.1)), 0.6)
seq += gain(biquad(noise(sec(2.4)), 'bp', 1700, 0.8), 0.75)
seq += gain(mix(biquad(noise(sec(2.2)), 'bp', 1100, 1.2), sine(1650, sec(2.2))), 0.5)
save(seq, 'tex', 'dg-modem', m4a=True)

# ---------------------------------------------------------------------------
# vocal chops / textures — formant-synthesized voices (kind 'vox', root-tagged)

VOWELS = {'a': (800, 1150, 2900), 'e': (400, 2000, 2800), 'i': (300, 2250, 3000),
          'o': (450, 800, 2830), 'u': (325, 700, 2700)}

def voxchop(f0, vowel, dur, glide=0, vib=18, crush=None):
    n = sec(dur)
    src = []
    ph = 0.0
    for i in range(n):
        t = i / SR
        f = f0 * (2 ** (glide * (1 - min(1, t / 0.08)) / 12)) * (1 + 0.006 * math.sin(2 * math.pi * 5.4 * t) * min(1, t / 0.15) * vib / 18)
        ph = (ph + f / SR) % 1.0
        src.append((2 * ph - 1) * (1 - ph) * 2 - 0.5)  # bright glottal-ish saw shape
    f1, f2, f3 = VOWELS[vowel]
    x = mix(gain(biquad(src, 'bp', f1, 7), 1.0), gain(biquad(src, 'bp', f2, 9), 0.65),
            gain(biquad(src, 'bp', f3, 11), 0.3))
    x = env_exp(x, dur * 0.7, hold=sec(dur * 0.5))
    if crush: x = bitcrush(x, crush)
    return x

VOX = [  # (name, midi, vowel, dur, glide-semis, crush-bits)
    ('dg-vox-ah72', 72, 'a', 0.5, -3, None), ('dg-vox-eh76', 76, 'e', 0.4, 2, None),
    ('dg-vox-oh67', 67, 'o', 0.6, -5, None), ('dg-vox-ih79', 79, 'i', 0.35, 4, None),
    ('dg-vox-uh64', 64, 'u', 0.55, -2, None), ('dg-vox-ah84', 84, 'a', 0.4, 5, 8),
    ('dg-vox-eh88', 88, 'e', 0.3, 7, 8), ('dg-vox-oh60', 60, 'o', 0.7, -7, 10),
]
for name, m, vowel, dur, gl, crush in VOX:
    save(voxchop(midi_f(m), vowel, dur, glide=gl, crush=crush), 'vox', name, root=m)

# FM digital keys family (kind 'keys', root-tagged)
for root in (48, 55, 60, 67, 72):
    f = midi_f(root)
    n = sec(1.1)
    x = []
    ph = 0.0
    for i in range(n):
        t = i / SR
        idx = 3.2 * math.exp(-t / 0.18)
        ph += 2 * math.pi * f / SR
        x.append(math.sin(ph + idx * math.sin(ph * 2.01)))
    save(env_exp(x, 0.5, hold=sec(0.05)), 'keys', f'fmkeys-{root}', root=root)

# round 2 additions: more glitch, phone ring, punchier kicks, tonal riser, vox
for i, (carrier, slices, bits) in enumerate([(1250, 8, 5), (3600, 3, 9)]):
    n = sec(0.45)
    x = ringmod(noise(n), carrier)
    sl = n // slices
    for s_i in range(slices):
        seg = srcrush(x[s_i * sl:(s_i + 1) * sl], rnd.choice((3, 5, 8)))
        for k, v in enumerate(seg): x[s_i * sl + k] = v * (1.0 if s_i % 2 == 0 else 0.1)
    save(bitcrush(env_exp(x, 0.3), bits), 'perc', f'dg-glitch-{i+5}')

ring = []
for _ in range(2):
    ring += env_exp(mix(sine(440, sec(0.35)), sine(480, sec(0.35))), 0.6, hold=sec(0.3)) + [0.0] * sec(0.18)
save(tanh_drive(ring, 1.4), 'fx', 'dg-ring')

n = sec(0.7)
mixsrc = mix(gain(biquad(noise(n), 'lp', 5000, 0.7), 0.7), sine(330, n), gain(square(165, n), 0.4))
stop2 = []
pos = 0.0; speed = 1.0
while pos < n - 1 and speed > 0.02:
    stop2.append(mixsrc[int(pos)])
    pos += speed; speed *= 0.9996
save(tanh_drive(stop2, 2), 'fx', 'dg-vinylstop')

for name, f0, f1, dec, drive, bits in (('dg-kick-punch', 130, 55, 0.16, 6, 12), ('dg-kick-break', 160, 80, 0.1, 8, 5)):
    n2 = sec(dec + 0.1)
    body = sine(lambda t, a=f0, b=f1: b + (a - b) * math.exp(-t / 0.009), n2)
    save(bitcrush(hardclip(tanh_drive(env_exp(body, dec), drive), 0.8), bits), 'kick', name)

n = sec(2.0)
tone = sine(lambda t: 200 * (1600 / 200) ** (t / 2.0), n)
x = mix(gain(tone, 0.6), gain(biquad(noise(n), 'bp', 900, 1.2), 0.5))
save([s * (i / n) ** 1.5 for i, s in enumerate(x)], 'fx', 'dg-riser-tonal')

for name, m_, vowel, dur, gl, crush in (('dg-vox-ih91', 91, 'i', 0.25, 9, 7), ('dg-vox-oh55', 55, 'o', 0.8, -4, 12)):
    save(voxchop(midi_f(m_), vowel, dur, glide=gl, crush=crush), 'vox', name, root=m_)

# ---------------------------------------------------------------------------
# MckAudio machine cherry-picks (RD-6 808-clone, TR-8) if the clone is present

def mck_add(folder, pat, kind, name, count, sidx=6):
    base = os.path.join(SRC, 'MckSamplePacks', folder)
    if not SRC or not os.path.isdir(base): return
    hits = []
    for root_d, _, files in os.walk(base):
        for fl in sorted(files):
            full = os.path.join(root_d, fl)
            if fl.lower().endswith('.wav') and re.search(pat, os.path.relpath(full, base).lower()):
                hits.append(full)
    step = max(1, len(hits) // count)
    for i, fpath in enumerate(hits[::step][:count]):
        tmp = os.path.join(REPO, 'assets', '_mck.wav')
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', fpath, tmp],
                       check=True, capture_output=True)
        w = wave.open(tmp)
        raw = w.readframes(w.getnframes()); w.close()
        x = [s / 32768 for s in struct.unpack('<%dh' % (len(raw) // 2), raw)][:sec(1.2)]
        os.remove(tmp)
        e_id = f'mck-{name}-{i+1}'
        save(x, kind, e_id)
        entries[-1]['s'] = sidx

for args in (('RD6', r'bd|kick', 'kick', 'rd6-kick', 4), ('RD6', r'sd|snare', 'snare', 'rd6-snare', 3),
             ('RD6', r'cp|clap', 'clap', 'rd6-clap', 2), ('RD6', r'ch|hat', 'hat', 'rd6-hat', 3),
             ('RD6', r'oh|open', 'hato', 'rd6-hato', 2), ('RD6', r'tom|lt|ht', 'perc', 'rd6-tom', 3),
             ('TR8', r'bd|kick', 'kick', 'tr8-kick', 4), ('TR8', r'sd|snare', 'snare', 'tr8-snare', 3),
             ('TR8', r'cp|clap', 'clap', 'tr8-clap', 2), ('TR8', r'ch\b|chh|closed', 'hat', 'tr8-hat', 3),
             ('TR8', r'oh|open', 'hato', 'tr8-hato', 2), ('TR8', r'rs|rim|cb|cow', 'perc', 'tr8-perc', 4)):
    mck_add(*args)

# ---------------------------------------------------------------------------
# merge into js/assets/manifest.js

man_path = os.path.join(REPO, 'js', 'assets', 'manifest.js')
src_js = open(man_path).read()
samples = json.loads(re.search(r'export const SAMPLES = (\[.*?\]);', src_js, re.S).group(1))
sources = json.loads(re.search(r'export const SOURCES = (\[.*?\]);', src_js, re.S).group(1))
while len(sources) < 5:
    sources.append({})
if len(sources) == 5:
    sources.append({"name": "HyperTracks digital pack (rendered in-repo by tools/build_digital_pack.py)",
                    "license": "CC0-1.0 (original work)", "url": "tools/build_digital_pack.py"})
if len(sources) == 6:
    sources.append({"name": "MckAudio/MckSamplePacks (RD-6, TR-8 drum machines)",
                    "license": "CC0-1.0", "url": "https://github.com/MckAudio/MckSamplePacks"})
old_ids = {e['id'] for e in samples}
samples += [e for e in entries if e['id'] not in old_ids]
src_js = re.sub(r'export const SOURCES = \[.*?\];',
                lambda _m: 'export const SOURCES = ' + json.dumps(sources, indent=1) + ';', src_js, flags=re.S)
src_js = re.sub(r'export const SAMPLES = \[.*?\];',
                lambda _m: 'export const SAMPLES = ' + json.dumps(samples) + ';', src_js, flags=re.S)
open(man_path, 'w').write(src_js)

from collections import Counter
print('new entries:', len(entries), dict(Counter(e['k'] for e in entries)))
print('total samples now:', len(samples))
