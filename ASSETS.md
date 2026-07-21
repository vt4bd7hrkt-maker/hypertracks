# HyperTracks — Sound Asset Library

The shipped hybrid library: **177 audio one-shots/textures (18 MB)** +
**186 wavetable spectra** (embedded as harmonics in `js/assets/manifest.js`).
Rebuilt from sources with `python3 tools/build_assets.py <downloads-dir>`.

## Sources and licenses (all verified at import time)

| Source | Content used | License | Verification |
|---|---|---|---|
| [VCSL — Versilian Community Sample Library](https://github.com/sgossner/VCSL) | mallets/keys (glockenspiel, vibraphone, marimba, tubular bells, balafon, hand chimes, kalimba), acoustic percussion (claps, cowbells, claves, woodblock, shaker, tambourine, bongos, frame drum, darbuka, concert bass drum, snare), gongs, cymbals, ocean-drum textures | CC0-1.0 | GitHub license detection |
| [EwonRael/BushDrum](https://github.com/EwonRael/BushDrum) | LinnDrum LM-2-style modeled kit (kicks, snares, hats, congas, toms, perc) | CC0-1.0 | GitHub license detection |
| [EwonRael/BillieDrum](https://github.com/EwonRael/BillieDrum) | modeled electronic kit (kicks, snares, claps, hats, perc, crash/ride) | CC0-1.0 | GitHub license detection |
| [AKWF-FREE — Adventure Kid Waveforms](https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE) | 186 single-cycle waveforms from 16 families (human voice, e-piano, chip, FM, distorted, guitar, clavinet, flute, organ, strings, cello, granular, birds, piano, e-bass, bit-reduced), converted to Fourier harmonic tables | CC0-1.0 | GitHub license detection |
| [Stephen P. McGreevy — Auroral Chorus (VLF natural radio)](https://archive.org/details/lightning_elf_vlf_q-bursts) | field-recording textures: VLF whistlers/sferics, shortwave time-station mixture | Public Domain Mark 1.0 | archive.org `licenseurl` metadata |

Rules: only CC0 / public-domain material enters the repo; licenses are
verified from repository/archive metadata, not READMEs. Provenance per file
lives in the generated manifest (`s` field indexes `SOURCES`).

## Inventory (assets/ + manifest)

- kick 9 · snare 10 · clap 9 · hat 3 (+2 open) · percussion 71
- pitched keys/mallet notes 49 (7 instrument families, root-tagged)
- FX one-shots 16 (gongs, cymbals, machine crashes)
- textures 8 (ocean drum, VLF radio) as 96k M4A; one-shots as 16-bit WAV
  (AAC priming delay would smear transients)
- wavetables 186 (no audio fetch — shipped as harmonics in JS)

## How the engine uses it

1. `designSound()` consults per-persona **sample affinities** (drums /
   acoustic / keys / textures / fx): rage is nearly all synthesis, lofi and
   ambient reach for recorded sound constantly — different studio setups.
2. Selection is seeded (deterministic per track) with **anti-repetition**:
   core sounds of the last ~3 tracks keep 12–15% selection weight.
3. `AssetBank` lazy-loads only the current track's files (typically 8–16,
   well under 1 MB) and prefetches the next seed's set; instruments fall
   back to synthesis for any hit whose sample hasn't decoded yet; exports
   `await bank.ensure()` so rendered files always use the full palette.
