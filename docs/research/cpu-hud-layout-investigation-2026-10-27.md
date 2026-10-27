# CPU investigation: HUD invalidation and browser layout

Date: October 27, 2026. Follow-up to C4 in the
[CPU optimization study](cpu-optimization-study-2026-10-27.md).
Status: source audit and isolated browser experiments complete. Ammo/air cache
fixes and transform-based ammo/armor fills are implemented; follow-up validation
is recorded below.

## Decision

Keep the existing 20 Hz HUD polling and per-widget caches. The useful next change
is to animate frequently changing fills with transforms rather than width.
Complete two widget cache keys at the same time: weapon identity affects ammo
fill, and drowning/low-air flags affect the air meter independently of its step.

This work benefits the DOM overlay used with either WebGL2 or WebGPU. It requires
no Babylon, Wasm, worker or compute-shader changes. Do not replace the HUD with a
new reactive framework or move it onto the render loop on this evidence.

## What runs in the game

The live game uses `src/games/fps/client/FPSHud.ts`, which imports and injects
`client/hud/styles/WashikiTheme.css`. The engine's generic `HUDManager` is a
different system; its binding comparisons are not the live FPS update path.

`FPSHud.start()` polls every 50 ms. Each visible widget reads `HUDState` and, where
needed, `MatchStateManager` or local client presentation state. Widgets already
cache their rendered values. Hidden HUDs skip the widget loop; chat team context,
an open scoreboard and the held weapon's ammo counter remain synchronized.
`show()` catches up the widgets immediately.

| Path | Existing invalidation behavior | Assessment |
| --- | --- | --- |
| Vitals | Rounded health/armor; writes only when the number changes | Good polling behavior; armor fill width transitions still cause layout between ticks |
| Ammo | Clip/reserve display key plus a separate weapon label cache | Good idle behavior; incomplete key when a weapon changes but the counts match |
| Weapon slots | Weapon-list key and selected weapon | Good idle behavior; small 20 Hz string allocation is not a demonstrated bottleneck |
| Timer | Formatted-time cache | Writes on displayed seconds, not every poll |
| Phase/ready messages | Cached markup and guarded classes | Unchanged polls preserve nodes and entrance animations |
| Powerup timer | Active powerups and rounded-up displayed seconds | Already quantized; no reason to rebuild per frame |
| Air | Twenty fill steps | Useful quantization, but warning/drowning changes can be lost inside a step |
| Bomb | Composite display signature, including rounded progress | Already guarded; width transitions are a further candidate needing S&D measurement |
| Scoreboard | Input identity, content signature, in-place changed pings | Identical snapshots do not rebuild the board |
| Weapon rack | Registration is commented out in `FPSHud` | Excluded from active-HUD cost claims |

Most remaining DOM writes during combat communicate real changes. Counting
setter calls alone would confuse those with redundant invalidation. Conversely,
zero DOM mutations does not mean zero browser work: CSS animations keep running.

## Browser experiment

The fixture initializes the real `FPSHud` with `watchOnly: true`, its real widgets,
theme and local fonts, then stops its timer and calls its update method at 20 Hz.
It uses controlled HUD/match state and ten scoreboard players. There is no map,
Babylon scene, network connection or game server. Phase changes go through
`MatchStateManager.processEvent`; entrance animations settle before measurement.

Each case lasts three seconds and makes 60 HUD calls. Headless Edge 156 runs at
1920 by 1080 CSS pixels with device scale 1. Measurements combine a body
`MutationObserver`, CDP `Performance` counters, a browser timeline trace, and
diagnostic wrappers counting `offsetWidth` reads and animation queries.

The local raw capture is:
`public/data/benchmarks/results/2026-10-27T19-06-31-334Z-hud-layout/`.
It contains `results.json`, `trace.json`, `hud.png`, `hud-browser.mjs` and
`hud-layout-check.mjs`. Scratch driver/harness files are under
`.cache/cpu-study/`; they are not a supported benchmark command.
The retained [evidence summary](cpu-evidence/hud-layout-2026-10-27.json) includes
the source hashes, browser identity, counters, mutations and trace summaries.

The engine HEAD was `6f1f9b0e2363816c1bec3e13b5f37fc15c1d6952`; FPS HEAD was
`f107c698fa465c677ca77672a2c518c34274f98d`. The working tree also contained
uncommitted PBR work and the plasma-shake papercut. Neither workload is active in
this fixture. HUD/widget/theme end-of-run hashes match the earlier capture.

### Results

Counts below are browser layout passes over the entire three-second window,
not forced synchronous layouts per HUD call.

| Workload | DOM mutations | Layout passes | Interpretation |
| --- | ---: | ---: | --- |
| Settled active HUD, clock advancing | 4 | 2 | Only two displayed timer changes |
| Warmup with no countdown | 0 | 0 | Existing invalidation guards work |
| Following a player, clock advancing | 4 | 2 | No extra spectating churn in this fixture |
| Hidden HUD | 0 | 0 | Widget updates correctly stop |
| Firing at ten ammo changes/second | 159 | 476, then 475 on repetition | Width interpolation keeps causing layout between polls |
| Same firing, width transitions disabled | 159 | 29 | Diagnostic isolation of fill interpolation; not a proposed visual downgrade |
| Same firing, transform-based fill experiment | 188 | 29 | Animated fill retained; about 94% fewer layout passes |
| Health and armor changing five times/second | 187 | 434 | Armor fill width transitions cause similar work |
| Same damage, transform-based fill experiment | 203 | 27 | About 94% fewer layout passes |
| Critical health, reload warning and low ammo | 4 | 2 | Little layout, but continuous animation still causes style work |
| Open board, freshly copied identical rows each poll | 4 | 2 | Board remains intact; only the timer changes |
| Open board, all ten pings changing every poll | 594 | 59 | Changed cells are written in place; a deliberately busy ping workload |

The transform experiment is a temporary stylesheet plus widget wrappers in the
fixture. Fills retain full layout width and use a left-origin `scaleX` with a
transform transition. The wrapper still lets the original code write width,
then translates that value to a CSS variable; this adds some mutations and JS
overhead. It is not the proposed production implementation.

In the trace, firing produced 955 paint records before the experiment and 64
with transform fills; damage produced 970 versus 169. These are paint records,
not rendered-frame counts or GPU timings. CDP accumulated layout duration was
46.7 ms for the first firing baseline, 38.5 ms for its repetition, and 4.7 ms for
the transform case. The damage comparison was 26.1 versus 3.1 ms. The variation
and diagnostic instrumentation make layout counts more useful here than a
precise claimed CPU speedup.

Critical-state animations produced 495 style recalculations, versus two when all
CSS animations/transitions were disabled diagnostically. Both cases had only
two layouts and four paint records. Running animations were `w-crit-flash`,
`fps-ammo-warning-pulse` and `fps-pulse-neon`. Treat this as a separate
style/animation question; it does not establish a large repaint problem or
justify removing visual warnings. The diagnostic disabled all animations, so
it does not attribute cost to an individual effect.

### Flash restart fallback

`client/hud/restartFlash.ts` rewinds CSS animations through `getAnimations()` and
the Web Animations API. It retains an `offsetWidth` fallback if a flash class is
already present but its animation cannot be found. Normal firing reached that
fallback three times in the three-second case; damage did not reach it.

There is a concrete source-level explanation to investigate: `.fps-value-low`
comes after `.fps-flash-loss` with equal specificity and sets the same `animation`
property. Once ammo is low, the pulse can replace the one-shot animation the
helper looks for. The browser capture confirms the fallback and the low-ammo
pulse, but does not yet isolate this cascade with a targeted A/B. Do that before
changing restart behavior. Removing the fallback outright could break replayed
flashes after the HUD has been hidden.

## Reproduced correctness issues

### Weapon change with identical ammo

`AmmoCounter.ts` caches `${primaryAmmo}:${reserveAmmo}`. Weapon changes update
the label, but do not invalidate the fill if that key is unchanged.

Reproduction: machinegun with 15 in the clip and zero reserve shows 50% of its
30-round clip. Switch to plasmagun with 15 and zero reserve: the fill stays at
50%, although the 50-round clip should show 30%. The browser fixture reproduced
this directly. It also applies when following a different player with matching
counts and a different weapon.

Fix the dependency, rather than disabling the cache: invalidate on weapon
identity as well as ammo. Decide explicitly whether changing weapon should
trigger an ammo-loss flash; comparing two different weapons' counts should not
accidentally decide that behavior.

### Air warning changes inside one fill step

`AirMeter.ts` returns early when `Math.round(air * 20)` is unchanged. Its low-air
class, drowning class and label are below that return.

Reproduction: update at air fraction 0.02 while not drowning, then at zero while
drowning. Both round to step zero. The label stays `AIR` and the drowning class
is absent. `LocalAirTracker` makes drowning true when its air reaches zero, so
this boundary exists in the normal local-air path. Whether a particular run
crosses it between two HUD polls determines whether it reproduces in play.

The same incomplete dependency applies at the low-air boundary: 0.31 and 0.29
both round to step six, but only the latter is below the 0.3 warning threshold.
Cache the fill step, low flag and drowning flag together. Retain `localDead` as
the hide condition, so following a living teammate does not revive our own air
meter after death.

## Implementation order and acceptance checks

| Order | Change | Files | Acceptance |
| --- | --- | --- | --- |
| 1 | Complete ammo and air invalidation | FPS `client/hud/widgets/AmmoCounter.ts`, `AirMeter.ts`, focused widget tests | Same-count weapon switch updates fill; empty-air transition changes label/class; unchanged ticks remain mutation-free |
| 2 | Transform ammo and armor fills | FPS `AmmoCounter.ts`, `VitalsBlock.ts`, `client/hud/styles/WashikiTheme.css`, relevant tests | Preserve zero/full/clamped values, refill/depletion direction, easing and theme; repeat browser A/B with production code |
| 3 | Resolve low-ammo pulse/flash interaction | FPS `client/hud/restartFlash.ts` and/or the theme; targeted real-CSS probe | Repeated shots, low-ammo entry/exit and hidden/shown HUD keep feedback working without needless synchronous geometry reads |
| 4 | Extend transforms where worthwhile | FPS `AirMeter.ts`, `BombStatus.ts` and their styles | Measure underwater and S&D progress; preserve drain/advance semantics and labels |
| 5 | Investigate remaining critical-state style work | Specific warning selectors only | Isolate each animation and compare unchanged visuals; retain warnings |

The first implementation should use the existing widgets and local caches. A
small fill helper is reasonable only if it removes actual repeated rendering
logic; a global dirty-state/event framework is not a prerequisite.

Before shipping, cover zero/full/over-cap fills, weapon changes, reloads, rapid
damage, first show, hidden/show catch-up, spectated subjects, low-air/drowning and
death transitions. Test theme presentation at multiple viewport/UI scales and
with both game backends. No networking, authoritative air, weapon rules or
Babylon renderer behavior needs to change for these HUD fixes.

## Validation and limits

Headless checks preceded the browser captures:

```powershell
npm.cmd run test:run -- src/games/fps/client/__tests__/HudIdleTick.test.ts src/games/fps/client/__tests__/HudRedundantWrites.test.ts src/games/fps/client/__tests__/HudCurrentClip.test.ts src/games/fps/client/__tests__/SpectatedWeaponHUD.test.ts src/engine/ui/hud/__tests__/DamageOverlayIdle.test.ts
```

Result: five files, 26 tests passed. The browser captures reported no console
warnings/errors or failed HTTP responses. The final screenshot was inspected;
it also displays the stale ammo fill and air label described above. The two
scratch capture commands were `node .cache/cpu-study/hud-layout-check.mjs`;
separate output directories/logs retain each run.

The first capture used a smaller viewport and imperfect phase setup: warmup's
clock advanced and phase callbacks were skipped. It supplied leads, not the
comparison table above. The second capture corrects those issues, settles phase
entrances, adds the transform and width-only counterfactuals, and repeats the
firing baseline after the transform case.

These are instrumented synthetic HUD cases while another agent has renderer
work in progress. They establish remaining invalidation/layout mechanisms, not
clean end-to-end game CPU or FPS gains. The fixture omits network-fed state
churn, game-canvas composition, live input/menu wiring, chat traffic, powerup
expiry, S&D objectives, resize, death countdowns and other browsers. It uses the
watch-only initialization option to exclude those input/menu handlers, but
retains the same core widgets and update loop. This initial capture preceded the
implementation below.

## Implemented follow-up

The first three findings are addressed in the existing game widgets:

- `AmmoCounter.ts` invalidates its fill when the weapon changes, even when clip
  and reserve counts match. Only a decrease in the same weapon triggers the
  ammo-spent flash; switching weapons does not manufacture a shot.
- `AirMeter.ts` caches the quantized fill step, low-air flag and drowning flag.
  Warnings and labels can change within the same fill step. The meter still
  uses our own death flag and invalidates its hidden state before returning.
- `AmmoCounter.ts` and `VitalsBlock.ts` write clamped `scaleX` fractions. The
  theme holds their layout widths at 100%, anchors transforms at the left, and
  retains the ammo 0.15-second and armor 0.18-second ease-out transitions.
  Generic `ValueBar` styles are left alone by scoping the ammo override to
  `.fps-ammo-counter`.

No worker, global invalidation framework, HUD tick-rate change or Babylon change
is involved. The air/bomb width-transition experiments and low-ammo flash/pulse
interaction remain separate follow-ups.

Regression coverage is in FPS `client/__tests__/HudFillInvalidation.test.ts` and
the extended `client/__tests__/AirMeterOwnDeath.test.ts`. The new checks failed
before implementation (seven failed, three passed) and passed afterward. They
cover the two cache boundaries, reverse transitions, clip capacity, empty/full/
over-cap fills, pooled/unlimited ammo, shot-versus-switch feedback, armor plate
fractions, local death/return and unchanged-tick mutations.

The focused post-change command passed eight files and 40 tests:

```powershell
npm.cmd run test:run -- src/games/fps/client/__tests__/HudFillInvalidation.test.ts src/games/fps/client/__tests__/AirMeterOwnDeath.test.ts src/games/fps/client/__tests__/HudIdleTick.test.ts src/games/fps/client/__tests__/HudRedundantWrites.test.ts src/games/fps/client/__tests__/HudCurrentClip.test.ts src/games/fps/client/__tests__/SpectatedWeaponHUD.test.ts src/games/fps/client/__tests__/RestartFlash.test.ts src/engine/ui/hud/__tests__/DamageOverlayIdle.test.ts
```

Implementation files, relative to the assembled root:

| Purpose | Files |
| --- | --- |
| Runtime widgets | `src/games/fps/client/hud/widgets/AmmoCounter.ts`, `AirMeter.ts`, `VitalsBlock.ts` in that same directory |
| Scoped fill styles | `src/games/fps/client/hud/styles/WashikiTheme.css` |
| Regression coverage | `src/games/fps/client/__tests__/HudFillInvalidation.test.ts`, `AirMeterOwnDeath.test.ts` in that same directory |
| Player documentation | `src/games/fps/docs/manual/player/hud.md` |
| Change tracking | `docs/changelog/v1.0.0-alpha.7.md`, this report and `docs/research/cpu-optimization-study-2026-10-27.md` |

A browser check during dm5 demo playback (WebGL2) read the live widgets: the
ammo fill measured its full track width at a full clip, and with armor and ammo
set to partial fractions the third armor plate and the ammo bar filled from the
left to the expected share. Committed as FPS `76e0115`.

The surrounding PBR changes and the separately prepared plasma-feedback change
are outside this HUD implementation. Validation uses the assembled working tree,
not an isolated release candidate.
