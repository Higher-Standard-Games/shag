# Highlight export feasibility probe

Standalone research fixture for [the export plan](../highlight_video_export.md).
It does not load or modify Washoi. Synthetic WebGL graphics and offline audio
exercise the browser export pipeline independently of game integration.

## Run from the repository root

Requirements: the repository's Node environment, Windows `tar`, network access
for setup, and Microsoft Edge available to the existing repository CDP driver.
No game server or Vite server is needed. The runner starts its own ephemeral
loopback server and temporary headless browser profile, then closes both.

```powershell
node docs/research/highlight-video-export-poc/setup.mjs
node --test docs/research/highlight-video-export-poc/timeline.test.mjs
node docs/research/highlight-video-export-poc/run.mjs
```

Setup downloads **Mediabunny 1.62.1**, verifies its pinned SHA-512 and extracts
it under ignored `.cache/highlight-video-export-poc/`. It does not install an
npm dependency or change a lockfile. The downloaded package includes MPL-2.0
license/notices; integrating it into the shipped game requires reviewing those.

The browser driver is imported from
`.claude/skills/browser-probe/scripts/cdp.mjs`. It requires permission to spawn
Edge and reach local CDP. Each browser evaluation has a 60-second timeout; a
slow machine may require splitting the probe calls. The Node timeline tests
should pass before running browser checks.

## What is checked

- Six seconds, 360 distinct 1920×1080 frames, explicit integer microsecond
  timestamps; H.264/AAC MP4 at configured 20 Mbps/192 kbps.
- Immediate WebGL2 copy without a persistent drawing buffer; canvas HUD/title/
  fade composition with a separate 640×360 CSS preview.
- Demux/decode of every frame and its binary ID, animated world pixels, flash
  timestamps and dimensions; independent native `<video>` metadata and seeks.
- Offline stereo cue panning and native AAC decode, with measured flash/cue sync.
- A deliberately slower-than-realtime render loop with no missing output frames.
- Incremental regular MP4 output to a slow positional writable; frame/seek/audio
  verification of the resulting bytes.
- Cancel after 40 frames, then complete a new export.
- Pure timeline inversion and native offline audio rate automation through
  constant slow motion and a linear speed ramp.
- Small SVG/HTML rasterization and WebGPU colour-copy experiments.

The stream case uses a fixed 8 MiB in-memory store to emulate file writes and
enable verification. It is not a real file picker/disk test or proof of bounded
memory over long jobs. No microphone, screen-capture grant, FFmpeg installation
or YouTube upload is used. Audio is rendered offline, not sent to speakers.

## Files and local output

| File | Purpose |
| --- | --- |
| `setup.mjs` | Pinned research dependency download/integrity check |
| `timeline.mjs`, `timeline.test.mjs` | Output timestamps and speed integration/inversion |
| `index.html`, `probe.mjs` | Isolated browser fixture, exporter cases and decoders |
| `server.mjs` | Fixed-route loopback server, bounded local artifact writes |
| `run.mjs` | Headless Edge orchestration, cleanup and JSON report |

Outputs are under `.cache/highlight-video-export-poc/results/`:

- `report.json`: complete measurements/capabilities and browser diagnostics.
- `baseline.mp4`, `stalled.mp4`, `streamed.mp4`, `after-cancel.mp4`.
- `*-composed.png`: final composition before encoding.
- `*-decoded.png`: native player picture after the final flash seek.
- `page-with-excluded-controls.png`: page screenshot including the DOM controls
  that are deliberately absent from the MP4.
- `foreign-object.png`: small inline-style HTML rasterization experiment.

Cancellation deliberately does not create a finished MP4. Each run overwrites
its named local artifacts; the cache is not a distributable package. Measured
results, limitations and the proposed Washoi implementation are in the linked
research plan. Actual game HUD, audio, effects, clocks and restoration still
need game-level proofs.
