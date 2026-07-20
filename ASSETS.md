# HyperTracks — Sound Asset Pipeline

The engine currently synthesizes everything (rendered per-track one-shots,
seeded wavetables, KS strings, generated IRs). To push sonic diversity
further, the next growth axis is a curated library of legally-clean audio
assets that the sound-designer stage can pick from and layer with synthesis.

## Vetted CC0 / public-domain sources (verified 2026-07)

| Source | Content | License |
|---|---|---|
| [VCSL — Versilian Community Sample Library](https://github.com/sgossner/VCSL) | multi-GB general-purpose instrument library (keys, mallets, winds, percussion) | CC0 |
| [Boochi44/free-drum-samples](https://github.com/Boochi44/free-drum-samples) | 3 curated hip-hop/trap kits: kicks, 808s, snares, claps, hats, perc, FX | CC0 |
| [Signature Sounds](https://signaturesounds.org/) | 80 GB+ field recordings, foley, percussion, one-shots, textures | CC0 |
| [awesome-cc0 list](https://github.com/madjin/awesome-cc0) | meta-list of public-domain asset collections (audio section) | CC0 (varies per entry — verify each) |
| [bratpeki/sample-packs](https://github.com/bratpeki/sample-packs) | link list of royalty-free packs | mixed — verify per pack |
| [Freesound (CC0 filter)](https://freesound.org/) | one-shots/textures/foley; filter search to CC0 only | CC0 when filtered |

Rules: only CC0 / public-domain enters the repo. No "royalty-free but
non-redistributable" packs (they can be *used* but not shipped in a repo).
Record provenance per file in `assets/manifest.json`.

## Integration design (next iteration)

1. `assets/manifest.json` — `{ id, path, kind: kick|snare|hat|perc|chop|texture|ir, tags, source, license }`.
2. `AssetBank` — fetched + decoded at app boot (live ctx), Float32 data
   copied into OfflineAudioContext buffers at export (decode once, reuse).
3. `designSound()` gains sampled kit variants: a kit is then a *blend* —
   e.g. sampled kick layered under the rendered transient, sampled textures
   under the generated beds. Personas weight sampled vs. synthesized.
4. Fallback: if assets fail to load (offline first run), the rendered
   pipeline covers everything — samples are an enhancement, never a
   dependency.

## The open product decision

This is a PWA that runs on an iPhone. Asset weight is a real trade-off:

- **Slim tier (~10–20 MB)**: one curated drum-kit set + a handful of
  textures/IRs. Feasible to vendor directly into the repo.
- **Rich tier (100 MB+)**: VCSL/Signature-scale variety, needs lazy
  loading + cache management (service worker) and probably hosting outside
  GitHub Pages limits.

Decide tier before bulk-importing. Recommendation: start slim (kicks,
snares, hats, claps ×3 kits + ~10 textures), measure the audible win, then
grow.
