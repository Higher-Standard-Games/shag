# Cache, pickup preload and warmup investigation

2026-10-18. Production maps: `washoi_dm2`, `washoi_dm5`, `washoi_dm11`.

## Findings and changes

- The DM2 `textures/boqu/warsow_neon_gold2` shader has one additive image
  stage, using `textures/boqu/warsow_neon_gold2.png`; it does not overlay text.
  The installed PNG is 512 x 128, 310 bytes, entirely black. The old sidecar
  manifest instead referenced a 162,407-byte TGA from the removed `tex_boqu.pk3`.
  Extracting that sidecar with KTX tools confirmed the gold Warsow logo.
- Archived the complete old cache to
  `archive/media/ktx2cache-20261018-before-rebuild`, then ran
  `npm run tools:textures` with `KTX_TOOLS_PATH` pointing to the locally
  extracted KTX executable. All 3,197 textures were converted, zero skipped,
  zero errors. Their KTX2 headers and referenced files were checked. Compressed
  texture bytes total 118,604,037. The regenerated gold2 sidecar decodes to
  entirely black pixels, matching the source.
- Encoder: official Khronos KTX Software 4.4.2 Windows x64, extracted under
  `.cache/ktx-tools` without installation. Installer SHA256:
  `1f323b0fec19794f5e6c0425a61d4b1da396872a10be862d105f4f4b2d2957fe`.
  Source: https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Windows-x64.exe
- `AssetPreloader` scanned ammo model paths even when the actual pickup used
  procedural geometry. Its new game-supplied filter skips models with procedural
  recipes while `r_pickupProcedural` is enabled. Disabling that setting keeps the
  authored-model path; weapons and unknown recipes retain model preloading.
- `MatchState` previously allowed warmup timeout to bypass readiness's minimum
  player check. Warmup now keeps its full timer without opposition. FFA needs
  two active players; team modes need active players on udon and soba. Countdown
  returns to warmup if opposition disappears. Existing ready, bot grace and
  active-match rules remain in place.

## Source and test files changed

- `src/engine/loader/AssetPreloader.ts`
- `src/engine/loader/__tests__/AssetPreloaderReload.test.ts`
- `src/games/fps/Game.ts`
- `src/games/fps/server/gametypes/MatchState.ts`
- `src/games/fps/server/gametypes/__tests__/WarmupOpposition.test.ts`
- `src/games/fps/server/gametypes/__tests__/RoundLifecycle.test.ts`
- `src/games/fps/server/__tests__/MatchStartReset.test.ts`

Documentation: this note, `docs/changelog/v0.9.32.md`,
`docs/manual/guides/pk3-filesystem.md`, and
`src/games/fps/docs/manual/player/screens.md`.

The last two fixtures now provide opponents, so their original readiness/world
reset assertions exercise a valid competitive roster.

## Whitening report

The separate report of progressively whiter rendering after tabbing out is
not yet explained. Inspection found material revalidation only around map loads
that were backgrounded; its temporary light has a cleanup path. Post-processing
exposure assignment is not cumulative. Shared texture-level baselines deserve
further investigation if the problem reproduces, but no speculative lighting
change was made. A cache rebuild fixes demonstrated stale artwork; it is not
evidence that this separate focus-related issue is fixed.

A WebGL browser probe loaded DM2 and switched between two tabs ten times,
recording all ten hidden/visible pairs. The four scene lights, exposure of 1,
and all 119 lightmap material levels remained unchanged. This was an isolated
map view, not a live match with the highest graphics profile; that case remains
unverified. Browser loading of all three production maps also passed with no
failed HTTP requests or error-level console entries.

## Validation commands

Logs are in `.cache/cache-papercuts-*.log`. Initial full-suite validation exposed
the single-player `MatchStartReset` fixture; it was corrected to include an
opponent, rather than bypassing the new production rule.

```text
npm run test:run
npm run test:run -- src/games/fps/server/__tests__/MatchStartReset.test.ts src/games/fps/server/gametypes/__tests__ src/engine/loader/__tests__/AssetPreloaderReload.test.ts
npm run typecheck
npm run gate:biome
npm run build
npm run build:server
npm run docs:build
npm run docs:fps:build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
node .cache/run-map-bsp.mjs
```

The last command passes the complete headless `--exec` argument directly to
Vite Node, loading and inspecting all three production BSPs. It avoids Windows
shell splitting of semicolon command batches.

Final results: all 628 test files passed (5,153 tests passed, one skipped).
Focused pickup/warmup/server-reset checks passed 196 tests. Typecheck, Biome
(zero errors, 319 warnings against a 339 baseline), build, both documentation
builds, simulation, physics, tick, fuzz (1,000 ticks), and all three headless
BSP inspections passed. Server bundles were rebuilt successfully for newly
spawned matches. Physics retains its documented position warning.

Assumptions: bots count as players; spectators do not. No readiness bypass was
added for maps launched through the console. Runtime confirmation in the user's
original live match is still outstanding. The rebuilt cache is local generated
media and must accompany deployment; a page reload is needed for existing tabs.
