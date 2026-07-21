# HyperTracks — Sound Asset Library

The shipped hybrid library: **278 audio one-shots/textures (25 MB)** +
**186 wavetable spectra** (embedded as harmonics in `js/assets/manifest.js`).
Two build scripts: `tools/build_assets.py` (external CC0/PD sources) and
`tools/build_digital_pack.py` (the hyperpop digital pack — 101 curated
sounds RENDERED in-repo with heavy baked processing: 808s, distorted kicks,
clipped snares, glitch percussion, chip/console bleeps, DTMF/UI sounds,
formant vocal chops, FM keys, VHS/cassette/modem textures, risers,
tape-stops, reverses — CC0-by-construction, plus cherry-picks of real
Behringer RD-6 / Roland TR-8 machine recordings).

## Sources and licenses (all verified at import time)

| Source | Content used | License | Verification |
|---|---|---|---|
| [VCSL — Versilian Community Sample Library](https://github.com/sgossner/VCSL) | mallets/keys (glockenspiel, vibraphone, marimba, tubular bells, balafon, hand chimes, kalimba), acoustic percussion (claps, cowbells, claves, woodblock, shaker, tambourine, bongos, frame drum, darbuka, concert bass drum, snare), gongs, cymbals, ocean-drum textures | CC0-1.0 | GitHub license detection |
| [EwonRael/BushDrum](https://github.com/EwonRael/BushDrum) | LinnDrum LM-2-style modeled kit (kicks, snares, hats, congas, toms, perc) | CC0-1.0 | GitHub license detection |
| [EwonRael/BillieDrum](https://github.com/EwonRael/BillieDrum) | modeled electronic kit (kicks, snares, claps, hats, perc, crash/ride) | CC0-1.0 | GitHub license detection |
| [AKWF-FREE — Adventure Kid Waveforms](https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE) | 186 single-cycle waveforms from 16 families (human voice, e-piano, chip, FM, distorted, guitar, clavinet, flute, organ, strings, cello, granular, birds, piano, e-bass, bit-reduced), converted to Fourier harmonic tables | CC0-1.0 | GitHub license detection |
| [Stephen P. McGreevy — Auroral Chorus (VLF natural radio)](https://archive.org/details/lightning_elf_vlf_q-bursts) | field-recording textures: VLF whistlers/sferics, shortwave time-station mixture | Public Domain Mark 1.0 | archive.org `licenseurl` metadata |
| HyperTracks digital pack (`tools/build_digital_pack.py`) | 808s (clean/distorted), reeses, clipped kicks/snares, crunchy claps, electronic hats, clicks, glitch perc, chip bleeps, DTMF/UI/camera sounds, formant vocal chops, FM keys, VHS/cassette/modem textures, risers, tape-stops, reverses | CC0-1.0 (original rendered work) | rendered in-repo |
| [MckAudio/MckSamplePacks](https://github.com/MckAudio/MckSamplePacks) | real drum-machine one-shots: Behringer RD-6 (808 clone), Roland TR-8 (808/909) | CC0-1.0 | GitHub license detection |

Rules: only CC0 / public-domain material enters the repo; licenses are
verified from repository/archive metadata, not READMEs. Provenance per file
lives in the generated manifest (`s` field indexes `SOURCES`).

## Inventory (assets/ + manifest)

- kicks 23 · snares 20 · claps 16 · hats 12 (+5 open) · percussion 95
  (incl. glitch perc, chip bleeps, DTMF/UI/camera, machine toms/rims)
- bass one-shots 12 (808 clean ×6, 808 distorted ×3, reese ×3 — root-tagged,
  repitched per note with glides)
- vocal chops 8 (formant-synthesized, root-tagged, repitched to the topline)
- pitched keys 54 (7 mallet/pluck families + FM digital keys family)
- FX one-shots 22 (risers, tape-stop, reverse-crash, sub impacts,
  downsweeps, gongs, cymbals)
- textures 11 (VHS bed, cassette bed, modem handshake, VLF radio, ocean
  drum) as 96k M4A; one-shots as 16-bit WAV (AAC priming would smear
  transients)
- wavetables 186 (no audio fetch — shipped as harmonics in JS)

Identity note: acoustic/VCSL material is now RESERVED for the personas where
it is a creative choice (lofi, ambient, dreamcore, experimental, cloudrap);
the electronic personas (hyperpop, digicore, rage, glitchpop, y2k, chopcore,
futurepop) draw from the digital pack and machine recordings.

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
