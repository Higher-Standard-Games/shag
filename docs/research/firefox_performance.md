# Firefox WebGL performance investigation

Date: 2026-10-19. Branch: `v0.9.35-firefox-player-performance` in both repositories.

## Status

The live-game slowdown is reproduced on Windows Firefox. The user reports
20–30 FPS while moving and encountering players; Linux players also report
performance problems. No native Linux run has been performed. WebGL is the
target, and Firefox-specific rendering defaults are authorized if measurements
support them. No gameplay rendering workaround has been accepted yet.

The separate held-button / choppy-aim reports are tracked in
[linux_mouse_hold.md](linux_mouse_hold.md) and
[v0.9.35-release-fixes.md](v0.9.35-release-fixes.md).
The parallel investigation records a low-FPS command-burst/rate-cap mechanism
in [netcode/input findings](v0.9.35-netcode-input-findings.md). That work can
explain additional movement disruption once frames are slow; the offline demo
reproduction here shows that live input/networking is not necessary for the
rendering slowdown. This document does not independently validate that agent's
network simulations.

**Root cause, second pass:** the Firefox main thread is saturated with
JavaScript (about 30 ms of frame-callback time against Chrome's 11 ms of scene
CPU). WebGL calls, resolution, GC and automation each account for little.
SpiderMonkey runs Babylon's render path 2.5–4× slower than V8. Per-function
timings, the runtime clone and material-freeze findings and the ordered
work-reduction plan are in
[netcode/input findings, section 2](v0.9.35-netcode-input-findings.md#2-firefox-frame-time).

## Environment and method

- Firefox 158.0 and Chrome 155, temporary profiles, native Firefox WebDriver
  BiDi and Chromium CDP, headless Windows, Babylon 9.17.0 / WebGL2.
- The machine has an RTX 4070 SUPER and an AMD integrated GPU. A separate
  diagnostic Firefox profile with renderer sanitization disabled confirmed the
  RTX 4070 SUPER / ANGLE D3D11 driver 32.0.16.1656. The default Firefox renderer
  string says GTX 980 “or similar”; that is privacy-limited identification,
  not evidence of a different graphics card.
- GPU benchmarks run sequentially. Existing user services and browser profiles
  are left alone. The private Vite server uses port 3100 without HMR.
- The crowd test fixes its render buffer at 1280×720. Live tests use a
  2250×1084 buffer, three locally owned bots, a private server on 17777 and
  the real FPS controller, prediction and player renderer on `washoi_dm2`.
- The scratch live server uses `--training-demo`, including its 125 Hz
  recording/snapshot path. This is not an exact production load comparison.
- Live movement is a held forward action plus programmatic yaw changes, with
  simulated pointer-lock document state. These tests do not verify native
  pointer lock or high-frequency physical mouse input. Reproducing slowness
  here shows it can happen without a stream of native mouse-movement events;
  it does not rule out additional input-related problems in ordinary play.
- Diagnostic method wrappers add overhead. Their timings locate work; they
  are not suitable for claiming a release FPS improvement. Firefox also
  coarsens CPU clocks, and fresh asynchronous GPU timer samples are unavailable.

## Findings so far

### The isolated animated model is insufficient to reproduce the problem

`/benchmarks/crowd/index.html?renderer=webgl2&repeats=2&counts=0,1,2,10`
completed 16/16 valid cases in each browser, with outlines on/off and no
gameplay, map, HUD, network or combat effects. Both remained refresh-paced at
roughly 6–7 ms per frame. With ten players, p95 CPU submission was about
2–3 ms in Firefox and 1.3–1.6 ms in Chrome. Firefox's clock precision limits
interpretation of small differences. This is not evidence that live play is fast.

The standalone entry initially requested its player PK3 relative to
`/benchmarks/crowd/`, received HTML and failed ZIP parsing. Configuring its
PK3 base as `/data/` repairs this diagnostic. It does not speed up gameplay.

### Live play reproduces the reported scale of slowdown

An initial run without the later per-method wrappers measured Firefox at
42.3 FPS stationary, 32.4 FPS moving, and 41.3 FPS moving with SSR/glow disabled.
Chrome samples on the same server measured 118.3 FPS stationary and 87.8 FPS
moving. These are reproduction observations, not a controlled browser speed
ratio: bot positions, deaths, weapons and camera paths differ between runs.

Later Firefox captures placed most measured scene time inside camera rendering
and active-mesh evaluation. Examples included about 14–18 ms/frame inclusive
camera rendering, 3 ms active-mesh evaluation, around 0.5 ms remote-player
rendering, and sub-millisecond physics/animation medians in the three-bot runs.
Inclusive timings overlap and must not be added together. Active bodies remained
GPU-skinned; no CPU-skinning fallback was observed.

Shader linking is a concrete source of hitches: one diagnostic window recorded
12 `getProgramParameter` calls totaling 850 ms, with a maximum of 225 ms. A
later window had two calls totaling 32 ms. This warrants investigating which
shader variants compile after entering play. It does not establish that shader
linking explains the whole sustained FPS loss.

### Rejected as proven fixes

Live A/B captures are too variable to accept these changes as fixes:

| Diagnostic | Observation |
| --- | --- |
| Disable uniform buffers before scene creation | About 35 FPS in both measured windows; no useful recovery |
| Smooth preset before map load | About 33 and 43 FPS; did not reliably solve the drop |
| Opaque, non-antialiased main context with high-performance preference | About 39–42 FPS; no demonstrated large recovery |
| Hide HUD | About 39 FPS after a 34 FPS baseline; a later unchanged baseline recovered to 97 FPS |
| Disable bloom | About 32 FPS in that run; insufficient to establish a cause |
| Experimental weapon-camera candidates | Baseline 33, enabled 43, baseline again 70 FPS; ordering/warmup confounded the result |
| Skip clustered-light gathering | No repeatable advantage over the following restored baseline; also produces incorrect lighting |

Do not ship the diagnostic shader/light/UA overrides, force lower quality, or
remove player outlines based on these observations. A WebGPU request fell back
to WebGL in this headless Firefox environment; that was not a WebGPU measurement.
Further work stays on WebGL as requested.

## Repeatable combat workload

Generated an immutable ten-bot FFA recording using the existing fixture tool,
on private port 17778 with locally owned bots. The generator stops its bots and
server before browser timing. This removes live AI/network scheduling from
rendering comparisons. The saved source recording is 60 seconds long.

- 45-second / 720p fixture: `wdm2-ffa10-v1-8c2e550fe162-fff7b969`.
- 20-second / 2250×1084 fixture: `wdm2-ffa10-v1-8c2e550fe162-e13755ef`.

Both alternate freefly and first-person bot views, with a saved seeded route.
Generated route clearance still needs visual acceptance. Inspect each run's
validity reasons, missing POV weapon frames and pending scene-data counters;
an exported report alone does not mean it is an accepted benchmark.

Scratch scripts and raw JSON/logs live under `.cache/` (gitignored):
`player-browser-bench.mjs`, `player-live-bench.mjs`, `firefox-timedemo.mjs`,
`firefox-crowd-baseline.json`, `chrome-crowd-baseline.json`, the live/per-method
profiles and `firefox-timedemo-*.json`. Binary fixtures are under the ignored
`public/data/benchmarks/`; they are local test assets, not release media.

### Fixed recording results

These runs use the same source recording and seeded camera route, without
native mouse input or live bots. Values are frame times, not average FPS.

| Browser / 2250×1084, 20 seconds | Repeat | Median / p95 wall ms | Valid |
| --- | --- | --- | --- |
| Firefox, outlines on | 1 | 36 / 111.7 | No: playback skipped after stalls |
| Firefox, outlines on | 2 | 36 / 81.1 | No: playback skipped after stalls |
| Firefox, outlines off | 1 | 32 / 125.1 | No: playback skipped after stalls |
| Firefox, outlines off | 2 | 32 / 73.75 | No: playback skipped after stalls |
| Chrome, outlines on | 1 | 9.8 / 17.8 | Yes |
| Chrome, outlines on | 2 | 9.1 / 17.2 | Yes |

The skipped Firefox playback means these are defect-reproduction captures,
not accepted benchmark scores or a precise browser speed ratio. They still
show the problem without physical mouse events. Disabling outlines provides
only a modest median change and does not resolve the stalls.

The longer 720p Firefox baseline had one valid second repetition: median
31 ms and p95 66.75 ms. Enabling `r_weapon_candidates 1` on that same fixture
produced an invalid first repetition and a valid second repetition at 23 ms
median and 58 ms p95. That is a promising candidate, but its second repetition
changed substantially between phases (41 ms median in the first gunplay
section, 21 ms in the last). Repeat fresh-session comparisons before attributing
the improvement to the setting or changing its existing default.
The later freefly section also improves (27 to 17 ms median), although that
setting filters only the weapon camera. Playback CPU also falls in that section
(4 to 2 ms median). These changes outside the intended optimization are another
reason to require repeated comparisons.

The high-resolution second repeats compiled five shaders in Firefox and four
in Chrome. Large steady frame costs persist after most compilation, so shader
prewarming alone is not yet a demonstrated solution.

## Next acceptance boundary

Compare the same immutable combat fixture with and without each candidate,
using a full warmup and fresh sessions. Keep resolution, renderer, route,
recording, pose rate and effects fixed. Check visuals and Chromium before
accepting a Firefox policy. Preserve existing user choices and avoid browser
settings that trade away functionality without a demonstrated benefit.

## Validation and handoff

The only engine source change from this investigation is the standalone PK3
base path repair in `src/engine/rendering/crowd-benchmark-page.ts`. Other files
owned by this investigation: this document, `linux_mouse_hold.md`,
`v0.9.35-release-fixes.md`, `docs/changelog/v0.9.35.md` and the standalone-page
note in `docs/manual/guides/timedemo.md`. The parallel netcode/input document
belongs to the other agent.

Local validation on 2026-10-19:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run test:run` | 5200 passed, 1 skipped, 6 failed; see below |
| `npm run gate:biome` | Pass: 0 errors, 319/339 warnings |
| `npm run build` | Pass |
| `npm run docs:build` | Pass |
| `npm run test:simulation` | Pass |
| `npm run test:physics` | Pass |
| `npm run server:tick` | Pass |
| `npm run server:fuzz -- --ticks 1000` | Pass, deterministic checksums match |
| `npm run cli:game -- --exec 'bsp load washoi_dm2; bsp info; sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'` | Pass (invoked through the CLI entry with a subprocess argument array to preserve quoting) |
| `npm run test:run -- src/engine/__tests__/CrowdBenchmark.test.ts src/engine/__tests__/PlayerModelPoseStepping.test.ts src/engine/__tests__/PlayerModelCloning.test.ts` | Pass: 14 tests, before browser measurements |
| `npm run test:run -- src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts` | Pass: 3 tests in isolation after full-suite failure |

Five full-suite failures are the existing editor compilation fixtures missing
`textures/blx/blx_grid`: two in `ConvexCompile.test.ts`, and one each in
`NaturalCompile.test.ts`, `PlaytestCompile.test.ts` and `RoundPatchCompile.test.ts`.
The sixth is `RemoteWeaponLeak.test.ts`'s A→B→A asynchronous load assertion:
one load observed instead of two. It passes in isolation; the full-suite
failure remains recorded and is not treated as a green full suite. No relevant
FPS code was changed here. Initial sandbox attempts failed to spawn esbuild;
the reported runs used approved execution outside the sandbox.

Assumptions: Windows WebGL2, the installed production assets and `washoi_dm2`
are the investigation target. Native Linux, physical pointer-lock input,
Brave-specific performance, production concurrency and final route visual
acceptance remain unverified. No gameplay performance fix is claimed. The
private Vite server and owned test servers/bots were stopped; user services
were left running. Nothing was committed or pushed.
