---
name: browser-probe
description: Drive the SHAG game in a headless browser on the real GPU to verify rendering, cameras, demos, HUD or lobby behaviour, measure frames, or capture screenshots - without asking the user to test by hand. Includes a private no-HMR Vite server, a CDP driver for headless Edge and a demo-playback probe template. Use this whenever a change needs checking in the actual browser (WebGL2 or WebGPU), when the user asks you to "check it in the browser", "probe", "measure", "take a screenshot", or verify something visual or live, and for two-browser lobby QA.
---

# Browser probes

Headless checks come first (see `regression-check`), but cameras, materials,
HUD, demos and lobby flows only show their real behaviour in a browser. Headless
Edge on the development machine reaches the real GPU for WebGL2 and WebGPU, so
an agent can verify these itself.

## 1. Start a private server

The shared `npm run dev` server on :3000 reloads the page whenever any agent
edits a file, which wrecks a measurement mid-run. Use a private one with HMR and
watching off:

```bash
node .claude/skills/browser-probe/scripts/private-vite.mjs 3100   # run in the background
```

It serves the code as it was when it started: restart it after editing source.
Its cache lives in `node_modules/.vite-probe`; a cache outside the repository
breaks Babylon's lazy shader imports.

## 2. Drive the page

`scripts/cdp.mjs` opens headless Edge with GPU flags and returns helpers:
`ev(expr)` evaluates in the page (awaiting promises), `command(cmd)` runs a
console command through `CommandRegistry.executeChecked`, `click`, `key`,
`shot(file)`, plus collected `logs` (warnings, errors, exceptions), `failed`
(HTTP 4xx/5xx) and optional WebSocket `frames`. `bootGame(b)` gets past the
start screen and welcome step; `waitForMap(b)` waits for BSP geometry.

Start from `scripts/demo-probe.mjs`: copy it to a scratch directory, keep the
boot and teardown, and replace the measurement.

```bash
node .claude/skills/browser-probe/scripts/demo-probe.mjs <file>.shagdemo 10
```

To import from the copy, point its import at
`.claude/skills/browser-probe/scripts/cdp.mjs` (or copy `cdp.mjs` alongside).

## Things that go wrong

- **The start screen waits for a click.** Without it the engine never boots and
  `window.scene` never appears. `bootGame` clicks `.boot__start`, falling back to
  `LoadingScreen.forceDismiss()`.
- **`map <name>` needs a lobby server.** For offline gameplay play a demo:
  `demo <file>.shagdemo` then `demoplay`. Demo names need the `.shagdemo`
  extension; files are in `public/data/demos`. Don't await `demoplay`: its
  promise can stay pending while playback runs.
- **One `ev` call lasts at most 60 seconds.** The driver gives up on a CDP call
  after that and returns `undefined`. Keep a measurement window to about 50
  seconds, or split it into several calls.
- **Every probe must close its Edge.** Each headless Edge holds about 500 MB
  across its processes, and leftovers add up until the machine runs out of
  memory. `cdp.mjs` kills every process of its browser on `close()`, on
  `process.exit`, on an uncaught error and on Ctrl+C. It finds them by the
  probe's profile directory: the launched `msedge.exe` hands over to another
  process and exits, so its PID leads nowhere. Nothing runs when the node
  process is terminated from outside (a shell `timeout`, the tool's own time
  limit). Bound a probe from inside instead:
  `setTimeout(() => process.exit(3), 240_000).unref()`. After a run, check
  that none are left: `Get-Process msedge` in PowerShell, or
  `tasklist | grep -c msedge`.
- **Start the server with an absolute path** when running it in the background
  (`node C:/.../.claude/skills/browser-probe/scripts/private-vite.mjs`): the
  shell's working directory may have drifted into `src/games/fps`.
- **Prove a fix by reverting it once.** Measure with the fix, revert it, restart
  the server (watching is off), measure again, restore it. A count that drops
  from "every frame" to zero is evidence; a zero alone may mean the case never
  came up.
- **Read the camera that renders.** When `scene.activeCameras` is set, the frame
  comes from `activeCameras[0]`, not `scene.activeCamera`.
- **Import engine modules by source path** inside `ev`, for example
  `await import('/src/engine/console/CommandRegistry.ts')`. Vite serves them; the
  module instances are the ones the game uses.
- **Renderer selection:** append `?renderer=webgl2` or `?renderer=webgpu`.
  `?rendererqa=1&renderer=webgpu` runs an isolated material smoke test and
  publishes `window.rendererQAReport`; see
  `docs/manual/guides/render-variables.md`.

## Live lobby QA

For flows that need the lobby (rooms, matches, ratings), start the lobby, and
the bot server if bots are involved, as `docs/manual/guides/lobby-server.md`
describes. Point the probe server at that lobby with `VITE_LOBBY_URL` set in its
environment before starting it. Then:

- **Budget seconds per lobby round trip.** One takes 1–3 seconds on a loaded
  machine; a check that waits 600 ms reports a failure while the server log
  shows the event fired.
- **Prove arrival with frames.** Call `b.setCaptureFrames(true)` and inspect
  `b.frames`: received WebSocket messages show what really arrived when a DOM
  assertion is ambiguous. Confirm against the server log before believing a
  negative.
- **Clear stale game servers first.** A leftover game server from an earlier
  run keeps ticking at 125 Hz and starves the machine. Kill whatever listens on
  ports 7770–7790 before a run.
- Two browsers are two `openBrowser()` calls; each gets its own profile, so
  each is a separate account.

## Report

Give the numbers you measured, the screenshot paths, and the `logs` / `failed`
entries that matter. Say which backend you ran (WebGL2 or WebGPU) and that it
was headless: some visual judgements, like whether an effect looks right,
still need the user's eyes.
