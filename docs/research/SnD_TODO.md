# S&D follow-ups

Recorded: 2026-10-18. Release map: `washoi_snd1` (Concrete Strike; upstream
`wfbomb1`), using Jal's compiled BSP.
This is an investigation and implementation backlog. The first implementation
batch below covers announcement timing, stable site assignments and mandatory
objective execution; live full-map behavior still needs verification.

## Announcer messages

- [x] Correct the swapped “bomb is in place” and “bomb planted” voice messages.
  Check the event-to-sound mapping and listen to the actual clips before swapping
  references, so each announcement matches the bomb's state.
- Acceptance: a complete pickup/plant/defuse/explosion cycle announces the correct
  event once, including after teams switch sides.

## Bot teamwork and site coverage

- [ ] Investigate the observed concentration of defenders at B, leaving A empty.
- [ ] Assign defenders across A, B and useful mid positions, adapting the split
  to team size. Coordinate rotations instead of sending the whole team to one
  site before a plant.
- Acceptance: with enough defenders, both sites have coverage; mid holders can
  support either site. Verify multiple rounds and both team assignments.

## Bot response to a planted bomb

- [ ] Investigate why defenders do not rotate to the planted bomb and attempt a
  defuse. Check directive delivery, goal arbitration, route reachability and the
  final defuse interaction.
- Source evidence: `src/games/fps/server/gametypes/SearchAndDestroy.ts`,
  `getAgentDirectives()`, already issues an `snd_defuse` movement directive to
  defenders when the bomb is armed. This is an observed behavior failure, not
  evidence that defuse orders are absent.
- Acceptance: planting at either A or B causes surviving defenders to retake;
  an uncontested bot reaches the bomb and completes the defuse. Attackers defend
  the planted bomb rather than attempting to defuse it.

## Destructible bomb-site structures

- [x] Render the intact site structures at round start, then remove them when
  their site explodes, revealing the broken layout already baked into the map.
- [x] Trigger the site's linked explosion effects and spawn its configured debris.
- [x] Restore intact structures for the next round; verify collision follows the
  intact/destroyed state and all clients see the same transition.

Inspection of the packaged BSP entity lump confirms these are `func_explosive`
inline BSP submodels, rather than separate MD3 structure models:

| Entity target name | BSP model | Delay | Debris models |
| --- | --- | --- | --- |
| `smallexplosions_a` | `*5` | 0.6 | `models/objects/debris/debris4.md3`, `models/objects/debris/debris5.md3` |
| `smallexplosions_b` | `*6` | 0.6 | Same as above |
| `smallexplosions_b` | `*7` | 0.62 | Same as above |

Each `trigger_capture_area` targets a `misc_capture_area_indicator`, which in
turn targets `smallexplosions_a` or `smallexplosions_b`. The BSP also contains
32 `target_explosion` entities. No `func_static` entities were found in this BSP.
The debris is MD3 media; verify those models and their material dependencies are
present in the served packages.

Investigate the original Warsow/Warfork entity activation rules before wiring
this chain into S&D. In particular, verify target fan-out, delay handling and
round reset semantics. The legacy behavior described by the user is the intended
reference; it has not yet been checked against the legacy game source.

## Suspected inverted skylight

- [ ] Investigate the dark exterior surfaces in the reported screenshot. The
  user expects the skylight-facing region to be bright and reports a similar
  appearance previously seen on DM11.
- Compare the affected face's baked lightmap and deluxe direction data with its
  rendered material. Check page selection, coordinate/normal conventions and
  directional-lightmap interpretation before changing brightness or recompiling.
- Acceptance: skylight and shadow placement agree with the baked data, with no
  regression to DM2, DM5 or DM11.
- Unverified: whether this is inverted lighting, an issue in the compiled map,
  or another material/rendering problem. The screenshot alone does not establish
  the cause.

## Implementation investigation

Source inspection: 2026-10-18. No gameplay or renderer implementation changes
were made during this investigation.

### Findings and proposed approach

| Area | Verified implementation | Recommended next change |
| --- | --- | --- |
| Announcements | `FPSBombAudio.ts` plays offense `planted.ogg` on `planted` and `inplace.ogg` on `armed`. Legacy Bomb does the reverse. | Correct the phase mapping; delay the defense planted announcement until armed. |
| Site coverage | `SearchAndDestroy.assignRoles()` already assigns living defenders alternately to sites. No mid role exists. | Diagnose assignment versus actual movement, then add stable site/mid assignments and useful reachable hold positions. |
| Retaking | Armed defenders receive `snd_defuse`, priority 0.95, radius 64, interrupt `never`. The brain can still enter combat/chase/retreat first. | Enforce generic directive interruption policy at the brain's state-selection boundary, then verify navigation end to end. |
| Structures | World mesh building uses model 0. Registered BSP handlers do not include `func_explosive`. | Add brush-entity rendering and authoritative enabled/disabled collision state, driven by the site's detonation and round reset. |
| Debris | Neither `debris4.md3` nor `debris5.md3` exists in any served PK3. | Package models and dependencies, then emit bounded cosmetic debris when the structure is destroyed. |
| Skylight | Deluxe decoding and shading already exist. The screenshot's affected face has not been identified. | Compare baked-only and deluxe lighting at the same camera position before choosing a renderer fix. |

### Announcement mapping

Local legacy reference:
`C:/Users/sundf/Desktop/warfork-qfusion/assets/data0_21pure/progs/gametypes/bomb/`.
`bomb.as` calls `ANNOUNCEMENT_INPLACE` when the carrier sets the bomb down;
`media.as` maps that to offense `inplace`, with no defense announcement.
The subsequent announcement entry maps to offense/defense `planted`.

Proposed mapping for SHAG's phase names:

| Phase transition | Attacker hears | Defender hears |
| --- | --- | --- |
| Into `planted` (arming begins) | `offense/inplace.ogg` | No planted announcement yet |
| Into `armed` (fuse begins) | `offense/planted.ogg` | `defense/planted.ogg` |

Keep the defense `defuse.ogg` last-call cue separate. Verify the actual shipped
audio by listening before landing the change; this investigation confirmed the
source mappings, not the spoken contents of the replacement recordings.

### Bot coverage and retake behavior

Relevant sources:

- `src/games/fps/server/gametypes/SearchAndDestroy.ts`: `assignRoles()` and
  `getAgentDirectives()`.
- `src/games/fps/server/gametypes/GametypeController.ts`:
  `collectAgentDirectives()` addresses each order by the player's client entity ID.
- `src/bot/goals/DirectiveGoalSource.ts`: validates directives and converts them
  to goal candidates.
- `src/bot/goals/ItemGoalPlanner.ts`: combines objective and item goals.
- `src/bot/StateMachineBrain.ts`: `_evaluateState()`, `_navigateTo()` and
  `_holdRadius()`.

The server's alternating assignment includes living human teammates as well as
bots, sorts by entity ID and recomputes every tick. Deaths can therefore change
survivors' assignments. A human allocated A does not guarantee that human is
actually covering A. Unassigned defenders fall back to the first site.

Two competing pre-plant directives also matter: holding the assigned site has
priority 0.5, while hunting the bomb carrier has priority 0.6. These are inputs to
weighted arbitration, not strict ranks, but the hunter order can pull defenders
away from their allocated sites. Site arrival uses a broad 384-unit radius;
that does not establish a useful angle, visibility or reachable floor position.
These are concrete design weaknesses, not yet a reproduced explanation for all
bots choosing B.

The brain selects fight, dodge, chase and low-health retreat before its normal
objective navigation. Inspection found no consumption of the directive's
`interrupt` field in the goal planner or state machine. The `never` value on
`snd_defuse` therefore does not enforce uninterrupted retaking. Retreat can also
explicitly ignore directives. Raising the defuse priority alone cannot fix that
state-selection bypass.

Defusing itself needs no use-button implementation: `BombModel.updateDefusing()`
advances progress automatically for a living defender within
`rules.armDefuseRadius`. The brain already stops within a directive's radius.
Use the same distance conventions and test the actual floor-level bomb position
against the bot's player origin.

Recommended diagnostic before tuning:

1. Run a deterministic team scenario on the actual indexed `wfbomb1`, with bots
   assigned to both sites. Capture assigned site, received directive, selected
   state/goal, route result and distance to target.
2. Plant and arm at A, then B; distinguish an order missing in transit from an
   order rejected by arbitration, overridden by combat, or blocked by navigation.
3. Repeat after a defender dies and after side switching.

Implement interruption handling generically in the bot brain, keeping S&D rules
in the FPS gametype. Add an explicit mid/support assignment only when the team
has enough players to cover both sites. Keep assignments stable across ordinary
ticks, and rotate support after a plant. Do not assume the midpoint between site
origins is walkable: use reachable navigation positions or authored tactical
anchors. The actual map's route connectivity remains unmeasured here.

### Structure lifecycle and collision

Legacy references verified locally:

- `source/game/g_misc.cpp`: `SP_func_explosive`, `func_explosive_use`,
  `func_explosive_explode`.
- `assets/data0_21pure/progs/gametypes/bomb/site.as`: `explode()` calls
  `indicator.useTargets(bombModel)` for authored target groups.

Without the trigger-spawn flag, a targeted explosive starts visible and solid.
Using it schedules its delay; explosion emits configured debris, fires targets,
then hides and unlinks collision for the reusable entity. The map's structures
have no trigger-spawn flag. Model `*5` contains 17 faces/11 brushes; `*6` has
48 faces/16 brushes; `*7` has 5 faces/13 brushes. A has 19 authored
`target_explosion` entities and B has 13, alongside these structures in the same
target groups.

SHAG's `BombSiteTable.ts` extracts `target_explosion` points only; it does not
extract the matching `func_explosive` structures. `SearchAndDestroy.buildExplosion()`
and `BombSiteMarkers.ts` already schedule blast damage and client effects. Extend
that flow rather than adding a second independent detonation timer.

Use `src/engine/loader/bsp/mesh/brushModelBuilder.ts` to build the intact brush
models with existing texture/lightmap handling. Put game-owned site activation
in the FPS layer; expose reusable brush rendering/collision support from the
engine without importing S&D into it.

`SweepCollisionBackend.ts` explicitly traces inline lift models, but has no
equivalent lifecycle for explosive structures. Add active inline-brush collision
for the authoritative server and client prediction, including trace/contents
queries. Visibility, collision and reset must share the same authoritative state.
Check other collision adapters before deciding the interface.

Replicate persistent destruction state and timing so late joiners, spectators and
demos reconstruct the correct layout. A transient visual explosion alone is not
sufficient. Review the protocol-change procedure before extending snapshots or
demo data. Preserve old-demo defaults, and avoid replaying historical debris when
a spectator joins after the destruction.

The legacy blast includes damage from the explosive structure itself. Decide
explicitly how that combines with the existing authored point-blast damage;
blindly adding another damaging explosion could double damage. Debris can remain
client cosmetic, with bounded count/lifetime and cleanup on map/round changes.
Audit the archived models' skins/shaders/textures and provenance when packaging
them; their transitive dependencies have not been inspected yet.

### Lighting investigation boundary

`BspLightingProfile.ts` detects paired FBSP light/direction pages.
`mesh/lightmaps.ts` swaps direction Y/Z at the loader boundary.
`BspBakedLightingPlugin.ts` decodes the direction, computes its dot product with
the rendered normal and blends baked light with map ambient. Normal mapping can
therefore affect the resulting brightness. Existing tests check byte conversion
and material/light ownership, not the screenshot's rendered lighting.

First identify the exact affected face/material and capture the camera position.
Compare the same view after loading with `r_deluxe 0` and `r_deluxe 1` (the setting
takes effect on the next map load). Then isolate normal-map influence and sample
the face's lightmap UV and paired direction page. Compare with the legacy renderer
before changing sign, coordinate conversion or gain. Do not use global brightness
or absolute dot products as a speculative fix. Final cause remains unverified.

### Suggested implementation order and validation

1. Correct announcer phase mapping and test both sides' transitions.
2. Add bot decision traces/reproductions; fix interruption and route failures,
   then add stable site/mid teamwork.
3. Implement structure lifecycle, authoritative collision, state replication and
   reset; package debris and add cosmetic emission.
4. Fix lighting only after the isolated comparison identifies the cause. This
   investigation can proceed independently of the gameplay work.

Baseline validation run (all passed):

```text
npm run test:run -- src/shared/bsp/__tests__/BombSiteTable.test.ts src/games/fps/server/gametypes/__tests__/SearchAndDestroy.test.ts src/shared/server/gametype/__tests__/BombModel.test.ts src/bot/__tests__/Directives.test.ts src/bot/__tests__/StateMachineBrain.test.ts src/engine/loader/bsp/__tests__/BspBakedLighting.test.ts src/engine/loader/bsp/__tests__/BspLightingProfile.test.ts --maxWorkers=2
```

Result: 7 files, 164 tests passed. These validate existing units; they do not
reproduce the reported full-map behavior. Future implementation needs actual-map
headless scenarios, multiplayer/late-join/reset checks and the required
renderer/network regression suite before browser verification.

## First implementation batch: 2026-10-18

Implemented:

- `FPSBombAudio.ts`: offense `inplace` when arming begins, offense/defense
  `planted` when the fuse begins. Defense receives no premature planted cue.
  Tests exercise actual audio-controller phase transitions, repeated snapshots
  and joining an already armed round.
- `SearchAndDestroy.ts`: preserve site assignments across ticks, remove departed
  or dead defenders, assign new defenders to the least-covered site and transfer
  only surplus defenders when the split becomes uneven. Reset at round start.
  Removed the competing carrier-hunt directive. Tests cover carrier pickup,
  stable assignments after a casualty and rotation when a site loses coverage.
- `StateMachineBrain.ts`: live, valid `never` directives in objective-enabled
  profiles reach navigation before combat/chase/retreat/item shopping. Highest
  priority wins between mandatory orders. Objective changes cancel stale paths
  and movement sequences; expired orders release the bot back to normal behavior.
  Existing legacy-mode behavior is retained. Tests cover a visible enemy and
  damage at low health during a retake, holding on arrival, expiry and ordinary
  interruptible defense.

Actual-map graph probe:
`npx vite-node .cache/snd-map-routes.ts` built the generated `wfbomb1` navigation
graph (308 nodes). `findPath()` returned a path to A from 15/15 deathmatch spawn
points and to B from 9/15. These are graph queries, not proof that the bot can
execute every returned route. They do not measure the team spawn sets. Log:
`.cache/snd-map-routes.log`.

Still open: explicit mid/support assignments, human-aware coverage, chasing after
ordinary defense loses sight of an enemy, remaining navigation failures, actual
bot defuses on both sites, intact/destructible site geometry and collision,
debris packaging/emission, late-join/reset lifecycle and the lighting diagnosis.
No structure or lighting changes are included in this batch.

Files changed for this batch:

- `src/bot/StateMachineBrain.ts`
- `src/bot/__tests__/StateMachineBrain.test.ts`
- `src/games/fps/client/FPSBombAudio.ts`
- `src/games/fps/client/__tests__/FPSBombAudio.test.ts`
- `src/games/fps/server/gametypes/SearchAndDestroy.ts`
- `src/games/fps/server/gametypes/__tests__/SearchAndDestroy.test.ts`
- `src/games/fps/docs/manual/gametypes/search-and-destroy.md`
- `docs/changelog/v0.9.32.md`
- `docs/research/SnD_TODO.md`

Validation:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run test:run -- --maxWorkers=2` | 5,173 passed, 1 skipped; the same five pre-existing editor compile failures in ConvexCompile (two), NaturalCompile, PlaytestCompile and RoundPatchCompile |
| `npm run test:run -- src/bot/__tests__/StateMachineBrain.test.ts src/games/fps/server/gametypes/__tests__/SearchAndDestroy.test.ts src/games/fps/client/__tests__/FPSBombAudio.test.ts --maxWorkers=2` | 91 passed |
| `npm run build` | Passed |
| `npm run gate:biome` | Passed; 0 errors, 319/339 warnings |
| `npm run test:simulation` | Passed |
| `npm run test:physics` | Passed |
| `npm run server:tick` | Passed |
| `npm run server:fuzz -- --ticks 1000` | Passed |
| `npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"` | Passed |
| `npm run docs:build` | Passed |
| `npm run docs:fps:build` | Passed |
| `git diff --check` and `git -C src/games/fps diff --check` | Passed |

Assumption: shipped S&D rules retain automatic proximity-based arming/defusing.
No wire or demo format changed. Live multiplayer bot behavior and listening to
the replacement voice clips remain unverified; no user servers were restarted.

## Structure implementation and release rename: 2026-10-18

Implemented a shared `BrushModelState` for `func_explosive` inline geometry.
The Q3 collision backend excludes these brushes from static world queries and
traces enabled models separately; point contents follows the same state. The
entity handler builds their existing BSP geometry/materials and follows the
collision state's enabled flag. Disposal removes its render observer.

S&D resolves structures through the site's authored target group, schedules their
removal at the entity's delay (0.6/0.62 seconds here), and restores them at round
start. It publishes `objective.disabledModels?: number[]` in the existing
`match_state` JSON event. The client applies the persistent state to collision
and rendering, so joining after a blast does not require an old explosion event.
No additional damage was added on top of the existing authored site blast chain.

`BombSiteDebris` preloads the configured MD3 chunks, emits only newly observed
destruction and caps fragments at 36, with a four-second simulation lifetime.
Initial state emits nothing; repeated snapshots do not duplicate fragments;
round changes and disposal clear them. Packaging now discovers `debris1` and
`debris2` references and their dependencies. The shared texture bank includes
the models, textures and shaders; KTX conversion added three textures with zero
conversion errors.

New recordings use demo format v6 for the optional persistent brush state.
Existing reader support remains, but the user explicitly waived compatibility
work for this release map rename: no `wfbomb1` alias was added.

The served package is `public/data/map_washoi_snd1.pk3`, with
`maps/washoi_snd1.bsp`, `levelshots/washoi_snd1.png`,
`minimaps/washoi_snd1.ktx` and `navigation/washoi_snd1.nav`. Entry contents were
hash-verified during rename; the BSP remains Jal's exact compiled bytes.
The old package is archived outside the served directory. The texture-bank
media ledger and generated PK3 metadata use the new map/package names.

Reproducible package rename (preserves an existing packaged levelshot):

```text
node scripts/rename-map-packages.mjs --rename wfbomb1:washoi_snd1 --source-dir <source-directory> --output-dir <output-directory> --keep-packaged-levelshot
```

Bot follow-up: defenders now receive `snd_contest_plant` immediately when the
bomb is placed, before arming completes. Actual automatic defusing remains
restricted to the armed state. The user's screenshot shows warmup; S&D objective
orders are computed during live rounds. Mid/support roles and reliable execution
of routes still need work; training demos improve traversal, not team decisions.

### Checks and findings

- Unit coverage: switchable exact brush traces/contents, translated brush models,
  delayed site-specific removal, round reset, persistent state wire round trip,
  rendering observer cleanup, debris deduplication/late-join/reset/lifetime and
  new demo recording/readback.
- Actual indexed `washoi_snd1` BSP: all three model indices (5, 6, 7) have trace
  witnesses that hit while enabled and pass through when disabled. The initial
  coarse grid missed model 6's thin geometry; surface-normal probes found it.
  Log: `.cache/snd-structures-map-check-final.log`.
- Headless WebGL2 on the real GPU: all three structures built, with 1/3/4 material
  children and 40/552/199 vertices respectively in the low-level probe. Hiding
  model 5 produced `[false, true, true]`; reset restored all three. All structure
  textures were ready, with zero failed HTTP requests or browser errors.
  Captures: `.cache/snd-intact.png`, `.cache/snd-destroyed.png`.
- A fresh four-bot live S&D run on the renamed map saved a 30-second v6 recording
  with 1,880 frames. This confirms map loading and recording; the bots picked up
  the bomb but did not complete a plant in that run, so it is not evidence of a
  successful live retake/defuse.
- Lighting orientation audit sampled 176,809 lightmapped vertices. Existing V
  coordinates gave 92.7% positive normal/light-direction dots and 0.490 correlation
  between sampled lightmap brightness and baked vertex brightness. Flipped V
  gave 50.7% and 0.00055 respectively. This argues against a global vertical
  lightmap flip; it does not establish the screenshot material's final GPU result.
  The exact face/material and normal-map contribution remain to be isolated.
  Log: `.cache/snd-lightmap-audit.log`.

Remaining validation boundaries: a complete live planted-bomb retake/defuse,
late joining a real detonated round, visual debris appearance under live play,
historical lag-compensated shots across a structure's destruction, and the
reported face-specific lighting issue. The shared tests and state restore cover
the lifecycle, but these full multiplayer scenarios have not all been exercised.

### Live bot trace and final validation

A second isolated four-bot, 20-second run captured client-side orders, brain state
and navigation debug (`.cache/snd-bot-qa.log`). The defenders initially received
different assignments, `snd_defend_site_0` and `snd_defend_site_1`. When the attack
placed at A, both received `snd_contest_plant` and used the navigation executor.
Route execution still stalled; a successful defuse was not observed. This
separates a remaining navigation problem from missing server orders. The old
arbiter explanation could remain in debug output during a mandatory order;
navigation debug now names that mandatory order explicitly.

The user's warmup screenshot cannot establish live objective behavior: objective
assignment runs in a live round. This does not dismiss the reported routing
problem, which remains reproducible in the live trace.

New v6 recording playback was verified in headless WebGL2 after waiting for the
full map load: round 1 and the carried bomb appeared in match state, all three
structures were enabled and collision matched. Zero browser errors and failed
requests. Log: `.cache/snd-final-demo-browser.log`. No old-map compatibility
alias or old-demo browser test was added, per the user's release scope.

Final full suite: 5,182 passed, 1 skipped and the five known editor compilation
failures in four files. An earlier new demo readback assertion incorrectly read
`DemoFrame.events` rather than `DemoFrame.state.events`; it was corrected and the
full suite rerun. Subsequent debug-label test: 25 passed. Final build (including
TypeScript), Biome, both documentation builds and the required simulation,
physics, server tick, 1,000-tick fuzz and indexed BSP checks pass. Validation logs
are under `.cache/snd-final-*` and `.cache/snd-structures-*`.

Additional implementation files in this batch (besides earlier listed files):

```text
config/maps.json
scripts/rename-map-packages.mjs
src/cli/map-media.ts
src/shared/bsp/BrushModelState.ts
src/shared/bsp/__tests__/BrushModelState.test.ts
src/shared/bsp/BombSiteTable.ts
src/shared/collision/CollisionWorld.ts
src/shared/collision/SharedCollisionWorld.ts
src/shared/server/gametype/GametypeTypes.ts
src/shared/demo/DemoReader.ts
src/engine/physics/SweepBackendAdapter.ts
src/engine/physics/SweepCollisionBackend.ts
src/engine/loader/bsp/BspEntityHandlers.ts
src/engine/loader/bsp/mesh/brushModelBuilder.ts
src/engine/loader/bsp/__tests__/BrushModelLightmaps.test.ts
src/engine/__tests__/BrushModelCollision.test.ts
src/engine/__tests__/BrushModelRendering.test.ts
src/games/fps/client/MatchStateManager.ts
src/games/fps/client/BombSiteMarkers.ts
src/games/fps/client/BombSiteDebris.ts
src/games/fps/client/__tests__/BombBrushState.test.ts
src/games/fps/client/__tests__/BombSiteDebris.test.ts
src/games/fps/server/DemoRecorder.ts
src/games/fps/server/__tests__/DemoRecorder.test.ts
src/bot/__tests__/DemoPipelineEndToEnd.test.ts
src/lobby/integration/RoomToRanking.test.ts
docs/manual/guides/bsp-system.md
docs/manual/guides/headless-mode.md
docs/manual/guides/lobby-server.md
docs/manual/guides/networking.md
docs/research/WFBOMB1_COMPILATION.md
```

Generated PK3s, manifests, KTX2 cache, demos, probes and backups are ignored by
Git. Running user lobby/bot/game processes were not restarted. Restart those
services when adopting the release map ID and server/bot code; new training
recordings should use `training_demo washoi_snd1 <name> snd`.

Inline lightmap ownership was also corrected: all inline models sharing a BSP
and scene reuse the same pages, including direction pages. Reference counts keep
them alive while any inline owner remains, and dispose the bank when its final
owner is removed. The handlers no longer dispose a borrowed lightmap separately.
The real-GPU probe measured four shared 2048² pages, four after one model's
disposal, and zero after all three were disposed. Both MD3 templates loaded and
emitted 12 fragments with all textures ready. Log: `.cache/snd-memory-browser.log`.
Tests cover shared identity and survival until the last owner is disposed.

## release_snd1 follow-up: curved structures and patrols

The installed release BSP contains three `func_explosive` inline models and no
external `model2` attachment on them. A's `*5` contains 16 curved patch faces
and one mesh face. The inline builder admitted only polygon/mesh faces, so it
rendered just 40 vertices of wood. B's `*6` likewise omitted 24 patches.
No archive asset copy or BSP recompilation is needed for this missing reactor.

`brushModelBuilder` now reuses `buildPatchFace`/`buildPolygonFace`, preserving
world-space coordinate conversion, winding, UV and lightmap interpolation, with
indices offset when multiple faces share a material group. A NullEngine test
checks curved geometry mixed with a mesh triangle and interpolated UV2.

Headless Edge/WebGL2 on the real GPU measured:

| Structure | Before vertices | After vertices | After material groups |
| --- | ---: | ---: | ---: |
| A `*5` | 40 | 5,656 | 7 |
| B `*6` | 552 | 6,816 | 11 |
| B `*7` | 199 | 199 | 4 |

The reactor is visible in `.cache/snd-intact.png`. Model disable/reset worked;
all textures were ready, two debris templates emitted 12 fragments, and all
six shared lightmap/direction pages were released after disposing all owners.
Browser log/HTTP failure lists are empty. Probe: `.cache/snd-browser-probe.mjs`,
result `.cache/snd-patrol-browser.log`. This checks the actual Jal BSP published
under `washoi_snd1`, rather than an external model or the rejected local compile.

Defend/hold-area goals now patrol sampled floor/spawn positions within their
assigned radius. The standing hull must have a clear walk and supported floor;
points must be at least 96 units away and within 40 units vertically. Bots walk
without sprinting, jumping or traversal automation, pause one second within 48
units, then choose another point. Targets expire after eight seconds. Missing
safe candidates cause a hold. New objectives/death clear patrol state; move-to
plant/arm/defuse goals keep their stationary arrival behavior. Ordinary combat
still interrupts ordinary site defense.

The actual map graph has eligible patrol segments from five of seven nearby A
nodes and five of eight B nodes. Independent 1,250-tick movement simulations at
each site confirmed movement, pauses, multiple targets and positions remaining
inside the 384-unit site radius. This probe rotates view-relative brain input
into world space exactly as `BotClient._sendInput` does. Its first draft omitted
that conversion and produced invalid movement; corrected results are in
`.cache/snd-patrol-physics-sites.log`. Probe: `.cache/snd-patrol-physics.ts`.
Live multiplayer patrols and complete retakes/defuses remain unverified; movement
training does not establish team tactical behavior. New user recording results
are in `BOT_RELEASE_TRAINING.md` (28 separately replayed routes).

Files changed in this follow-up:

- `config/bot-routes/washoi_snd1.json`
- `src/bot/StateMachineBrain.ts`
- `src/bot/__tests__/StateMachineBrain.test.ts`
- `src/engine/loader/bsp/mesh/brushModelBuilder.ts`
- `src/engine/loader/bsp/__tests__/BrushModelLightmaps.test.ts`
- `docs/changelog/v0.9.32.md`
- `docs/manual/guides/bsp-system.md`
- `src/games/fps/docs/manual/gametypes/search-and-destroy.md`
- `docs/research/BOT_RELEASE_TRAINING.md`
- `docs/research/SnD_TODO.md`

Validation commands (logs `.cache/snd-patrol-*` unless noted):

- `npm run bot:learn -- washoi_snd1_release_snd1`: 28 accepted of 34 candidates.
- `npx vite-node .cache/verify-release-snd1.ts`: all 28 saved scripts pass.
- `npx vite-node .cache/snd-patrol-physics.ts`: patrol movement at A and B.
- `npm run test:run -- src/bot/__tests__/StateMachineBrain.test.ts src/engine/loader/bsp/__tests__/BrushModelLightmaps.test.ts`: 31 pass.
- `npm run test:run -- --maxWorkers=2`: 5,186 pass, one skipped, five known editor
  compilation failures in four files caused by archived test materials.
- `npm run typecheck`, `npm run build`, `npm run gate:biome`.
- `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`.
- `npm run server:fuzz -- --ticks 1000`.
- `npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"`.
- `npm run cli:game -- --exec "bsp load washoi_snd1; bsp info; quit"`.
- `npm run docs:build`, `npm run docs:fps:build`.
- `node .cache/snd-browser-probe.mjs` (private Vite :3100; closed afterward).
- `git diff --check`; `git -C src/games/fps diff --check`.

The initial typecheck/build caught a test fixture using the wrong graph
constructor and mutating its readonly node view; it now uses `loadStaticData`.
Biome formatting/import diagnostics were fixed without changing its baseline.
User services were not restarted. Restart the bot service to load the routes
and behavior; refresh the game client for the inline renderer change.

Follow-up checks finished: typecheck, build, Biome (0 errors, 319/339 warnings),
both manual builds and all required regression commands passed. The final
focused run passed 31 tests. Full-suite result remains 5,186 passed, one skipped
and the five known editor-material compilation failures described above.
