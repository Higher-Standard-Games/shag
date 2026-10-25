# Alpha 4 startup errors: EU and US

Investigated 2026-10-25. These fixes are local and have not been deployed.

## Asset requests

Production weapon GLBs are present inside `washoi_weapons.pk3`. The loadout
preview bypassed that package and requested loose GLBs. It now uses
`resolveModelAsset`, like the held, remote, dropped and pickup weapon paths.
The 3D menu logo now uses that resolver too. Unindexed models retain direct
file loading.

Optional `tags.txt` files absent from indexed model directories no longer
cause loose HTTP probes. Indexed sidecars still load from their owning package;
unindexed custom directories retain their direct-file lookup. The plasma
weapon's packaged barrel overrides remain available.

This was an audit of runtime model import calls, not a complete audit of every
asset type. The optional benchmark outline proxy still has explicit loose-file
fetches, and custom player-model entry points have their own resolver. These
should be checked against the same index-first rule in a broader asset audit.

## Graphics follow-up

Headless Edge with WebGL2 reproduced one framebuffer feedback-loop error while
booting and playing `washoi_dm2_deathmatch_20261022_201548.shagdemo`. A draw-call
instrumentation probe traced it to Babylon's `PostProcessManager._finalizeFrame`,
the `imageProcessing` effect on `fpsCamera`. The camera had one post-process at
that instant. No reflection probes were reported in that scene. The underlying
target-binding cause is not yet established; no graphics fix is claimed.

EU's `glGetProgramiv: Program object expected` was not reproduced. Babylon's
`/skins/0: Failed to find common root` warnings remain, as does a projectile
model-loading warning. Neither was fixed in this patch.

The WebTransport warning is a separate transport-selection issue: the factory
passes a WebSocket URL to WebTransport, whose URL conversion only handles
`http`. WebSocket fallback succeeds. WebTransport support remains intact; this
patch does not change transport selection.

## Validation

Assumption: packaged production weapon assets and the local published PK3 index
represent the same virtual weapon paths. US archive inspection confirmed the
launcher GLBs exist. EU's archive was not independently inspected in this round.

Commands run from the engine checkout:

```text
npx vitest run src/games/fps/client/__tests__/WeaponPreview.test.ts src/engine/loader/model/__tests__/TagsLoader.test.ts src/engine/loader/model/__tests__/ModelAsset.test.ts
npm run typecheck
npm run test:run
npm run gate:biome
npm run build
npm --prefix src/games/fps run test:simulation
npm --prefix src/games/fps run test:physics
npm --prefix src/games/fps run server:tick
npm --prefix src/games/fps run server:fuzz -- --ticks 1000
npm --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
npm run docs:build
npm --prefix src/games/fps run docs:build
```

All passed. The full unit run reported 727 files passed, 5,674 tests passed,
one skipped. An initial sandboxed full-suite launch failed before tests began
with esbuild `spawn EPERM`; the permitted child-process run passed.

Browser procedure: `.claude/skills/browser-probe/SKILL.md`, private Vite on
port 3105 and the ignored `.cache/alpha4-errors-probe.mjs` driver. The rocket
launcher preview loaded six meshes, and the preview plus demo session recorded
zero HTTP failures. The instrumented run captured the graphics error described
above. Evidence is in `.cache/alpha4-errors-probe.json` and the matching PNG.

The browser run used local files and a demo. Live production matchmaking,
throttled downloads and a production rollout were not tested.

## Changed files

Engine:

- `src/engine/loader/model/ModelAsset.ts`
- `src/engine/loader/model/TagsLoader.ts`
- `src/engine/loader/model/__tests__/ModelAsset.test.ts`
- `src/engine/loader/model/__tests__/TagsLoader.test.ts`
- `src/engine/ui/components/LogoCanvas.ts`
- `docs/manual/guides/model-loading.md`
- `docs/changelog/v1.0.0-alpha.5.md`
- `docs/research/alpha4-startup-errors.md`

FPS:

- `client/hud/widgets/WeaponPreview.ts`
- `client/__tests__/WeaponPreview.test.ts`
