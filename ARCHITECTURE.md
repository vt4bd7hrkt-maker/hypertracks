# HyperTracks — Architecture

(Formerly "endless.") An infinite generator of hyperpop instrumentals. Every track is composed
algorithmically and synthesized in real time — no loops, no samples.

## Technology decision

**Chosen: Web Audio API + vanilla ES modules, delivered as a PWA.**

| Option | Verdict |
|---|---|
| AVAudioEngine / AudioKit / Core Audio | Best raw DSP on Apple platforms, but three UI targets, slow iteration, and export/sharing plumbing is all bespoke. Right choice *if* this becomes a native App Store product — see roadmap. |
| JUCE / SuperCollider / Csound | Pro-grade synthesis, wrong ergonomics for a consumer toy app; heavy toolchains. |
| Tone.js | Nice, but a ~150 kB dependency for what ~600 lines of direct Web Audio does here; owning the graph keeps live + offline rendering identical. |
| MusicGen / Riffusion / Lyria / diffusion audio | Kills the core UX: seconds–minutes latency per generation vs. instant NEXT, needs servers or huge on-device models, no continuous emotional control, licensing fog. |
| **Symbolic generation + real-time synthesis (chosen)** | Instant, infinite, deterministic, fully steerable by macros, runs offline on a phone. |

Why it wins for *this* product: one codebase covers iPhone/iPad/macOS (install
as PWA); `OfflineAudioContext` renders exports that are bit-comparable with
what was heard; the Web Share API provides the native iOS share sheet and
AirDrop; and generation latency is ~0 ms, which is what makes NEXT addictive.

**Hybrid path (future):** the composer emits a symbolic score, so an
AI model (e.g. a small transformer over motifs/progressions) can later
*propose* material that the same synthesis engine renders. AI assists
composition; the engine stays deterministic and instant.

## Layers

```
core/      seeded RNG, music theory, name generator          (pure)
composer/  personas + (seed, macros) -> symbolic score
           + resolved sound design                           (pure, tested in Node)
engine/    AudioGraph (buses/FX/master), instruments,
           live Player, offline Renderer                     (BaseAudioContext)
export/    WAV writer, MP3 (vendored lamejs), share/save
ui/        visualizer + main.js glue
```

## The persona layer (anti-convergence)

Flat randomness converges: independent uniform draws average out, so most
tracks land near the statistical mean and sound like one producer. The fix
is hierarchical sampling. Each track first commits to a hidden **persona**
(`composer/personas.js` — hyperpop, dreamcore, digicore, cloudrap, ambient,
glitchpop, emo, futurepop, lofi, rage, experimental) and every downstream
decision is conditioned on it:

- tempo range, swing/groove, humanize
- scale pool, progression pool (bright/dark/floaty/emo), harmonic rhythm
  (1 or 2 bars per chord), voicing style (close/open/shimmer)
- structure family: club / hook-first / evolving loop / ambient arc / collage
  — plus per-section intensity `level`s, so energy curves differ even
  within one family
- drum algorithm (four/trap/bounce/sparse/scatter) and kit variants
- synth types per role: 4 bass engines (sub/reese/square/FM), 5 leads
  (supersaw/chip/bell/pluck/air), 4 pads (sawstack/choir/shimmer/drone)
- melody behavior: motif walker / anthem / burst runs / minimal hook / none
- chop style: phrase / stutter / oneshot / none
- FX vocabulary (riser/impact/swell/crash/gate/cut/…) and mix profile
  (reverb size+damp, delay mode incl. slapback, lo-fi crush, vinyl/air noise
  beds, pump depth, drive)

`designSound()` then resolves every timbre to **jittered numbers** (kick
pitch/decay/click/grit, snare color, formant sets, FM ratios…), so even two
tracks with the same persona never share exact sounds — the "infinite kit".

Personas never appear in the UI. The sliders act twice: they steer *which*
persona is sampled (macro vector vs. persona affinity, exponential
weighting), and inside the persona they still scale density, brightness,
wets, pump. Verified by test: dreamy slider extremes land in dreamy
personas ≥ 60% of runs, hard extremes in hard personas ≥ 60%.

Two invariants hold everything together:

1. **Determinism.** `compose(seed, macros)` is pure; the reverb IR is seeded
   too. A track is fully described by `(seed, macros)`, so export re-renders
   exactly what played.
2. **One synthesis path.** `playEvent(graph, ev, when)` is the single
   dispatch used by both the live scheduler and the offline renderer.
   The graph is built against `BaseAudioContext`, so live `AudioContext`
   and `OfflineAudioContext` run identical code.

## Audio graph

```
drums ─────────────────────────────┐
bass ──┐                           ├─ sum ─ tone(dark) ─ drive ─ comp ─ limiter ─ out
music ─┼─ pump (sidechain duck) ───┘
fx ────┤
reverb/delay wet returns ──────────┘ (wet ducks too — the pumping wash is the genre)
```

- Sidechain pump is scheduled per kick with overlapping-safe `setTargetAtTime` pairs.
- Reverb is a generated stereo exponential-decay IR (no sample files).
- Delay is a tempo-synced dotted-8th ping-pong with a bandpass in the loop.
- Glitch "gates" hard-chop the pump bus rhythmically.

Every sound is synthesized: kick (pitch-swept sine + click), 808 bass with
glides, 3-voice detuned supersaw, pads, formant-filtered "vocal chops"
(the chipmunk register), noise risers/impacts/downlifters.

## Emotional macro mapping (excerpt)

| Macro | Composition time | Live |
|---|---|---|
| energy | tempo, drum style, hat grid/density, arp density | drive amount |
| dreaminess | chord extensions (add9/7th), pad presence, detune/width, bass sustain mode | reverb wet |
| chaos | motif mutation, rhythm irregularity, fills | — |
| glitch | note retrigger bursts, hat rolls, gate events | drive |
| darkness | scale choice (phrygian↔lydian), IR damping, synth brightness | master tone filter |
| bounce | kick/bass syncopation, octave pops, stabs, pump depth | — |
| space | riser/reverb sends, delay feedback | reverb + delay wet |
| weirdness | chord substitution, leaps, chromatic drift, chop usage | — |

Live-safe macros respond instantly; compositional ones land on the next
NEXT tap. Tracks loop seamlessly (origin-shift inside the lookahead
scheduler — no fade, reverb tails carry across the loop point); only the
NEXT button changes the track.

## The performance layer (instrument, not just generator)

A second control tab exposes real synth-style controls: **tempo, filter,
resonance, drive, bitcrush, reverb, delay, stereo width, texture, glide,
punch**. Every knob is BIPOLAR around 0.5 = "as the persona designed it" —
they sculpt relative to the track's mix identity instead of flattening all
personas into one setting, and they survive NEXT because they express user
taste, not track state. One function (`AudioGraph.applyLive(macros, perf)`)
computes all live node params from macros + knobs. Note-level controls
(glide/portamento) are read by instruments at schedule time (~120 ms
lookahead), so they behave like real-time synth parameters. (Watch the
naming: `graph.fx` is the effects *bus*; the knob state is `graph.perf` —
they collided once and produced a maddening NaN.)

- **Tempo** is a Player-level playback `rate` (comp-time → wall-time).
  Changing BPM rebases the time origin so the musical position is preserved,
  scales all relative timing, and re-syncs the tempo-locked delay.
- **Timeline scrubbing**: seek rebases the origin, binary-searches the event
  pointer, backfills sustained pads/bass straddling the seek point, and
  masks the jump with a 60 ms output dip.
- **History** (back/forward): a composition is a self-contained JSON-able
  object, so history stores `{comp, macros, fx, bpm}` snapshots — NEXT never
  loses anything, and restoring is exact.
- **Mutate**: `mutate(parent, macros, amount, seed)` builds a `locks` object
  from the parent's DNA (`comp.dna`: progression, motif, hook, chop phrase,
  roles, swing + sections/sound/persona) and calls
  `compose(newSeed, macros, locks)`. Low amount = same everything, one detail
  rerolled; medium = same key/chords/tempo, ONE axis rerolled
  (melody | drums | sound | arrangement); high = remix keeping persona +
  tonal center + either the motif or the (bent) chords. Children are named
  `<family> v2, v3…` and remain fully deterministic.
- **Export renders what you hear**: current macros, knob state and tempo are
  all captured; the offline renderer applies the same rate-scaling.

## Compose first, produce second (the hook pipeline)

The composer runs in stages (`composer/hooks.js` + `composer/composer.js`):

1. **Identity** — persona + effective macros + key/scale/tempo.
2. **Core idea** — `designHook()` composes a 2-bar phrase BEFORE any sound
   design exists: a curated rhythm cell (hand-picked onset patterns a
   producer would actually play), a contour (arch/descent/rise/wave), mostly
   stepwise motion with rare leaps, and a bar-2 answer whose tail resolves
   home. This hook is the track's DNA — it's what Mutate inherits.
3. **Development plan** — `makePhrasePlan()` assigns each 2-bar slot a
   transform of the hook: exact / answer (inverted, ends on the fifth) /
   thin / lift (octave) / ornament (grace notes) / fragment. The first drop
   always STATES the hook exactly; surprise slots are budgeted
   (~8% + chaos·35%) — decoration never replaces the idea. Verified by test:
   the phrase recurs recognizably in ≥60% of lead-bearing tracks.
4. **Shared DNA** — the vocal chops SING the hook (its longest notes, an
   octave up); stutter/oneshot chops use the hook's opening pitch.
5. **Production** — `designSound()` resolves synthesis, and the persona
   interprets the same idea (a dreamcore vs. digicore reading of one hook).

Structure templates are chosen per seed, then stretched/shrunk so total
duration lands in ~75–100 s (two full arcs — complete ideas, not sketches).
Exports are cut to exactly one loop with the reverb/delay tail folded onto
the head, so files loop seamlessly (background-music ready). Fold summation
is peak-normalized.

**Chunked rendering.** A ~90 s dense track is ~16,000 audio nodes, and Web
Audio never releases a voice's gain/filter/panner nodes when its oscillators
stop — so a single-context offline render ends up traversing all 16k nodes
every quantum and becomes slower than realtime (it hangs; reads to the user
as "downloads don't work"). The renderer instead works in 18 s chunks with a
6 s pre-roll each (replays preceding events to warm reverb/delay and
re-render notes that cross the boundary), keeps only each chunk's own window,
equal-power crossfades the seams, and stitches the PCM. Node count per
context stays a few thousand — where offline rendering is many× faster than
realtime. Result: ~12 s typical, ~36 s worst (long-reverb dreamy tracks),
all completing with a `% progress` callback surfaced in the UI. Determinism
holds — each chunk builds the graph from the same seed.

## Commitment: loops, not dice (the producer-grammar layer)

The deepest "machine tell" was that patterns were re-randomized every bar —
hats re-rolled per step, bass steps re-picked per bar, arps and stabs
re-diced constantly. No human plays that way; this music is built on
committed loops. `composer/groove.js` fixes it:

- **Authored groove vocabulary**: curated kick/snare/hat patterns per drum
  style (things a producer would program), picked once per track and then
  repeated verbatim. Variation only at authored points: an every-4th-bar
  kick variation, a roll at a fixed slot, a fill into the next drop. Even
  the chaotic 'scatter' style is generated once and FROZEN — a weird loop
  sounds intentional; one that never repeats sounds broken.
- **Bass riffs**: one figure per track (kick-locked / offbeat / authored
  walking riffs), transposed with the harmony. The octave pop happens at
  the same spot every bar.
- **Frozen arp figure, stab placement and chop delivery** (retrigger flags,
  stutter beat, one-shot slot — decided once).
- **Voice-led chords**: after the progression is voiced, each chord is
  re-placed in the octave closest to the previous chord — "played," not
  "typed," harmony.

Verified by test: consecutive drop bars share the identical kick pattern
and bass rhythm in 18/18 sampled tracks.

## Sonic fingerprint killers

- **Seeded oscillator spectra**: `makeWaveSpec()` ships per-track harmonic
  tables (saw/hollow/bright/soft/organ laws + jitter) that instruments turn
  into `PeriodicWave`s — leads, pads and arps play waveforms no other track
  shares (a procedural wavetable).
- **Karplus-Strong string lead**: physically-modeled plucks rendered to
  cached buffers in JS (a delay-node feedback loop can't exceed ~344 Hz, so
  KS is computed sample-by-sample; excitation noise is seeded from
  track-seed + pitch, so export matches playback).
- **Per-track master color**: seeded EQ tilt (±3 dB peaking, 300 Hz–4 kHz),
  one of three saturation flavors (tanh / soft-knee / asymmetric with even
  harmonics), and a chorus stage on the melodic bus for dreamy personas.
- **Rendered drum one-shots**: kick/snare/clap/hats are rendered per track
  into buffers with per-sample layering, transient shaping and baked-in
  tanh saturation — internal resampling. They punch like processed samples,
  the kit stays consistent hit-to-hit, and every track still gets its own
  kit (parameters + seeded excitation). Offline render rebuilds the same
  buffers (seeded), so exports match playback.

## Known trade-offs & roadmap

- **Tap-to-begin overlay**: browsers (especially iOS) require a user gesture
  before audio. The overlay *is* the gesture. Unavoidable on the web.
- **True bitcrush/tape-stop** need an AudioWorklet (sample-rate reduction);
  deferred because Safari's OfflineAudioContext+Worklet support is the risk
  surface for export. Current glitch palette: retriggers, gates, hat rolls, drive.
- **Live section-aware macro morphing** (regenerate remaining sections when a
  slider moves): composer is pure, so this is a straightforward extension.
- **Service worker** for full offline PWA; PNG apple-touch-icon.
- **Native wrapper** (Capacitor/WKWebView) if App Store distribution is wanted;
  composer/theory port unchanged, engine maps ~1:1 onto AVAudioEngine nodes.
- **AI-assisted motifs** as described above.

## Testing

`node test/composer.test.mjs` — 240 compositions across extreme macro
corners; asserts duration window, event sanity, sortedness, pitch ranges,
byte-identical determinism, **and diversity**: ≥5 personas / ≥3 lead types /
≥3 drum styles / ≥3 structures / ≥4 scales across 40 neutral-slider tracks,
kick-fundamental spread ≥40 Hz, slider→persona steering ≥60%, and the
energy density/tempo contrast floor. **Mutation** is covered across 12
parents × 3 amounts: inheritance per amount tier, child validity,
determinism, and v2/v3 lineage naming.

The engine (Web Audio) is NOT covered by Node tests — always smoke-test in
the browser via `window.__endless` (play, NEXT, MUTATE, back/fwd, setBpm,
seek, export render) after engine changes.
