# HyperTracks

Endless hyperpop instrumentals, generated in the browser. Tap to start,
shape the sound with the MOOD and SOUND panels, press NEXT for a new track,
MUTATE to evolve it, REC to sing over it, and download the result as a
seamless WAV/MP3 loop.

Everything — composition, synthesis, rendering, export — runs client-side.
No backend, no accounts, no API costs. Static files only.

## Run locally

Any static server works (ES modules need http, not file://):

```
python3 -m http.server 8000
# open http://localhost:8000/
```

## Deploy (GitHub Pages)

The app is a 100% static site with relative paths — it deploys as-is.

```
gh repo create hypertracks --public --source . --push
gh api repos/{owner}/hypertracks/pages -X POST \
  -f 'source[branch]=main' -f 'source[path]=/'
```

Public URL: `https://<your-username>.github.io/hypertracks/`
(HTTPS is automatic, which also enables microphone access for REC.)

To update later: commit and `git push` — Pages redeploys automatically.

## Test

```
node test/composer.test.mjs
```

## iPhone / iPad

Open the URL in Safari, Share → Add to Home Screen for the fullscreen app.
Downloads use the native share sheet (Files, AirDrop); on desktop browsers
they save as normal file downloads.

See [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions.
