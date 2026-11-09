# Player model tuning

Branch: `feature/player-model-tuning` in engine and FPS, based on beta.8.

| Finding | Change / status |
| --- | --- |
| Police is embedded at `models/players/police/police.glb` (485,596 bytes). | Test body selected in `config/player-model.json`; Vanguard remains packaged. |
| Police has 24 joints; shared clips use the larger Mixamo rig. | Reuse all 17 available shared clips. Retarget rotations once at load time; omit absent finger and terminal toe tracks. Unknown missing targets remain errors. |
| Joint rest orientations and export units differ. | Babylon avatar retargeting handles clip orientation. A normalized hand frame handles attachment units and bind orientation. No extra retargeting loop during play. |
| Mesh uses Draco compression. | Bundle decoder URLs with the application instead of fetching a runtime CDN dependency. |
| Female has 44,300 vertices, Police 19,383, versus Vanguard body plus visor 6,749. | Fewer joints does not prove lower rendering cost; performance must be measured before final replacement. |
| Existing package builder owns only the Vanguard source directory. | Do not regenerate the supplied testing archive with that builder. Integrate Police authoring sources and packaging before release. |
| `animtest` had its own import/playback path. | Reuse `PlayerModelManager` so the command tests the selected body and every shared clip. |

## Reproduce

Use the supplied `public/data/washoi_player_model.pk3`, run
`npm run tools:pk3-index`, then start development normally. In a practice map:
`developer 1; animtest load police; animtest list` (or `animtest load female`), then `animtest play run`,
`animtest play crouch_walk`, `animtest play slide`, `animtest play reload`,
`animtest play blade_slash`. Finish with `animtest dispose`.

Assumptions: visual-only model tuning; game physics, gametype rules and recorded
animation state remain unchanged. No production upload or removal of Vanguard.

## Verification

Headless actual-archive audit loaded 24 joints on both Police and Female and all 17 available shared clips
plus the embedded clip. Focused player loading/package/attachment tests passed
(14 tests). Native GPU pose captures and final gates are recorded under
`.agent/player-model-tuning/`.

Native WebGPU checked idle, run, jump, slide, reload, blade slash, crouch walk,
walljump, swim and climb on each body, with a held Riotgun. The initial Havok check verified spawning and finite movement, but did not
measure corpse dimensions. The size regression and its fix are documented
below. A dedicated bone rotation frame now carries export scale into death physics; weapon
frames attach to bones so unlinked ragdoll joints still drive their weapons.
The gun importer emits its existing common-root warning; no failed requests or
browser exceptions were reported in this verification.

Gameplay / Who's who now selects Police (Male) or Female (Female) per side.
Both default to Police. Preferences are client-local and apply relative to the
local/followed player, including FFA enemies. Model selection drives voice
selection. New cvars are `cl_team_ally_model` and `cl_team_enemy_model`.
Previews are actual rendered bodies (240x320 transparent WebP), together
11,610 bytes; the settings page has zero extra canvases. Keyboard choice,
saving, reset and preview source updates have focused test coverage.

Full replacement approval remains separate: outline proxy compatibility,
representative multiplayer performance and grip appearance need review before
removing the packaged reference body. Neither rig has finger joints; fingers
keep their authored shape, which matters especially for Female's open hands.
No physics bounds, server state or demo format were changed.

## Final validation (2026-11-08)

| Command / check | Result |
| --- | --- |
| `npm run typecheck` | Pass after final lifecycle review. |
| `npm run test:run` | 811 files passed; 6,308 tests passed, 1 skipped (302.40 s). |
| `npm run build` | Pass, including the final lifecycle change; local Draco JS/WASM emitted. |
| `npm run gate:biome` | Pass: 0 errors / 47 baseline warnings. |
| `npm run docs:build` | Pass. |
| `npm --prefix src/games/fps run docs:build` | Pass. |
| `npm --prefix src/games/fps run test:simulation` | Pass. |
| `npm --prefix src/games/fps run test:physics` | Pass. |
| `npm --prefix src/games/fps run server:tick` | Pass. |
| `npm --prefix src/games/fps run server:fuzz -- --ticks 1000` | Pass. |
| `npm --prefix src/games/fps run cli:game -- --exec "developer 1; bsp load washoi_dm2; bsp info; quit"` | Pass. |
| `npm --prefix src/games/fps run cli:game -- --exec 'developer 1; bsp load washoi_dm1; bsp info; bsp load washoi_dm3; bsp info; bsp load washoi_dm5; bsp info; bsp load washoi_dm7; bsp info; sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'` | Pass. |
| `npm --prefix src/games/fps run deps:babylon` | Refreshed engine and game declarations; related tests passed. |
| `npm run test:run -- src/engine/__tests__/PlayerModelDisposal.test.ts src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts src/games/fps/client/__tests__/AttachedGun.test.ts src/games/fps/client/__tests__/AttachedBlade.test.ts` | 14 passed after the final disposal-order fix. |

The first full suite found six failures in dependency declarations and fixtures
that assumed the reference body or bypassed constructor initialization. Those
were corrected; the next full suite passed. A later lifecycle review caught
parent disposal preceding the weapon pool callback. The weapon is now returned
before disposing its hand frame; the dedicated regression test and final build,
typecheck, lint and 14 focused lifecycle tests passed afterward. The full suite
was not repeated for that final, focused lifecycle fix.

Actual-archive headless command: `npx tsx .agent/player-model-tuning/manager.ts`.
Native browser probes: `node .agent/player-model-tuning/verify.mjs` and
`node .agent/player-model-tuning/renderer.mjs`, using the private browser-probe
Vite server. Reports/screenshots are in `.agent/player-model-tuning/`; command
logs are in its `gates/` directory. The private server and owned browsers were
closed after verification.

The real remote renderer on WebGPU selected Police/Female for ally/enemy,
replaced an existing enemy body when changed to Police, flipped the choices and
voices relative to a followed player, selected Female for the local water body,
and emptied its hitbox collection on disposal. No failed HTTP requests or
browser exceptions occurred in that check.

Unverified: full multiplayer performance, subjective voice audition and all weapon
grips. Fingers retain the authored hand shape. The supplied PK3 remains external
to Git and is being updated directly by the owner; do not regenerate it with the
Vanguard-only package recipe. No commit, push, merge or production upload was
performed. Current outline, fitting and corpse measurements follow below.

## Exact changed files

- `config/player-model.json`
- `docs/changelog/v1.0.0-beta.9.md`
- `docs/manual/guides/model-loading.md`
- `docs/research/player-model-tuning.md`
- `public/images/player-models/female.webp`
- `public/images/player-models/police.webp`
- `src/engine/__tests__/PlayerModelDisposal.test.ts`
- `src/engine/__tests__/PlayerModelLoading.test.ts`
- `src/engine/__tests__/PlayerOutlineProxyRuntime.test.ts`
- `src/engine/animation/PlayerModelAssets.ts`
- `src/engine/animation/PlayerModelDecoder.ts`
- `src/engine/animation/PlayerModelManager.ts`
- `src/engine/animation/__tests__/PlayerModelAssets.test.ts`
- `src/engine/console/commands/AnimTestCommand.ts`
- `src/games/fps/browser.json`
- `src/games/fps/client/AttachedBlade.ts`
- `src/games/fps/client/AttachedGun.ts`
- `src/games/fps/client/FPSPlayerAudio.ts`
- `src/games/fps/client/PlayerModelSelection.ts`
- `src/games/fps/client/RagdollSystem.ts`
- `src/games/fps/client/RemotePlayerRenderer.ts`
- `src/games/fps/client/__tests__/FPSCombatAudio.test.ts`
- `src/games/fps/client/__tests__/FPSMovementAudio.test.ts`
- `src/games/fps/client/__tests__/FPSPlayerAudio.test.ts`
- `src/games/fps/client/__tests__/RemotePlayerVisibility.test.ts`
- `src/games/fps/client/settings/FPSSettingsView.css`
- `src/games/fps/client/settings/GameplayPage.ts`
- `src/games/fps/client/settings/SettingsModel.ts`
- `src/games/fps/client/settings/__tests__/FPSSettingsView.test.ts`
- `src/games/fps/docs/manual/player/settings.md`
- `vite.config.ts`

## Robot and outline follow-up

- Added `models/players/robot/robot.glb` as the third per-side option, paired
  with Bobot audio. The model uses the same 24 named joints and loads all 17
  shared clips plus its embedded clip. It contains 23,196 vertices, is about
  1.80 m tall and is 550,340 bytes before archive compression.
- Model labels and voice mappings share one catalog, so previews, selectors
  and audio routing cover all three models. `animtest load robot` uses the
  same playback manager. The Robot WebP preview is 5,846 bytes.
- Thin already matched the registered defaults (`cl_player_outline 1` and
  `cl_player_outline_size 25`). A UI regression test now checks fresh/reset
  defaults. Explicit saved preferences remain intact.
- Assumptions remain client-local presentation in all gametypes; no server,
  collision or demo-format changes. Supplied PK3 discovery was regenerated.
- Follow-up files: `src/engine/animation/PlayerModelAssets.ts`,
  `src/engine/animation/__tests__/PlayerModelAssets.test.ts`,
  `src/engine/console/commands/AnimTestCommand.ts`,
  `src/games/fps/client/PlayerModelSelection.ts`,
  `src/games/fps/client/FPSPlayerAudio.ts`,
  `src/games/fps/client/RemotePlayerRenderer.ts`,
  `src/games/fps/client/settings/GameplayPage.ts`,
  `src/games/fps/client/__tests__/FPSPlayerAudio.test.ts`,
  `src/games/fps/client/settings/__tests__/FPSSettingsView.test.ts`,
  `public/images/player-models/robot.webp`, both affected manual pages,
  this research note and the beta.9 changelog.

### Robot follow-up verification

- Actual package audit: Robot has 24 joints and all 17 shared clips load.
  Focused package/audio/settings tests: 30 passed, including Robot/Bobot
  selection, preview updates, keyboard selection and Thin fresh/reset defaults.
- Native WebGL2 rendered the Robot preview; native WebGPU exercised idle,
  running, jumping, sliding, reloading, blade slash, crouch walk, walljump,
  swimming and climbing, with the held Riotgun, then spawned a ragdoll.
- The real remote renderer selected Police/Robot, replaced Robot with Police
  on a live setting change, flipped models/voices for a followed player
  (`bobot` / `male`), and selected Robot for the local water body. Settings
  reported Thin, loaded Robot previews and zero additional canvases. No failed
  HTTP requests or browser exceptions were reported. The gun importer emitted
  its common-root warning.
- Final Robot round: build, typecheck, Biome (0 errors / 47 baseline warnings),
  engine and FPS docs, simulation, physics, server tick, 1,000-tick fuzz, and
  headless DM2 load/info plus movement replay all passed. Exact commands are
  the validation commands above; this round's BSP batch additionally included
  `sim replay "W+CROUCH 60; JUMP 1; W 30"` before `quit`.
- Full suite: 810 files passed; one file failed (6,309 tests passed,
  2 failed, 1 skipped; 315.91 s). Both failures were in the unchanged
  `src/engine/loader/model/__tests__/TagsLoader.test.ts`: mocked indexed
  attachment readers were not observed in the combined run. Running
  `npx vitest run src/engine/loader/model/__tests__/TagsLoader.test.ts` alone
  passed all 4 tests. This is evidence of an order-sensitive test issue, not a
  confirmed root cause. No tag-loading production code or tests were changed
  to mask the failure; the full Robot suite is not reported as green.
- Logs are in `.agent/player-model-tuning/robot-gates/`, and native reports
  are `robot-verification.json`, `robot-renderer-report.json` and
  `robot-preview-report.json` in the parent artifact directory. The private
  server and owned browsers were closed. Full-match performance and subjective
  audio audition remain outside these controlled checks.


## Outline, standing fit and corpse scale follow-up

The owner updates Police, Female and Robot directly inside
`public/data/washoi_player_model.pk3`. This round only regenerated its discovery
index and read the GLBs; it did not rebuild or overwrite the archive. Settings
previews were rendered again from the supplied archive.

| Finding | Fix / evidence |
| --- | --- |
| Split vertex normals made an expanded outline separate into strips. Culling and depth bias changes did not fix it. | Average unique normal directions at coincident positions with matching bone weights, on outline-only geometry. The original body normals and lighting stay intact. |
| Babylon world-rotation setters received a mesh whose local scale was 1 and world scale was approximately 0.36. | Give the ragdoll a dedicated frame with equal local/world scale. Before the fix, Robot bone scale jumped from 1 to 2.7778 and its height from about 60 to 167 units. Afterward bone scale stays 1. |
| Different authored heights and foot origins made the bodies inconsistent against the gameplay bounds. | Measure the first idle pose once per source, fit it to 64 units at actor scale 36, and put the feet at zero. Preserve this calibration when updating and reusing instances. |
| A larger body must not enlarge its weapon. | Divide the grip scale by the actual calibrated body scale. Outline width compensates for the same factor. |
| Off-scene outline meshes keep their own recorded uniform slots. | Snapshot slot discovery includes those draws, using the visible body's world matrix during replay. No snapshot feature is disabled. |

The standing player collider is 64 units high and the flat-fire eye origin is
58 units above the feet. Neither server collision nor projectile spawn rules
were changed. The supplied archive at verification gave:

| Body | Actor scale | Standing feet / head | Rocket muzzle height | Corpse height after physics takes over |
| --- | ---: | ---: | ---: | ---: |
| Police | 36.0947 | 0 / 64 | 57.23 | 63.99 |
| Female | 40.3824 | 0 / 64 | 60.27 | 63.98 |
| Robot | 38.4684 | 0 / 64 | 61.93 | 63.99 |

Heights are measured in world units from CPU-skinned vertices, with the idle
pose held still. The small corpse differences come from rotation during the
first physics step. Animated poses naturally differ from the standing bounds.
Weapon muzzle tags remain attached to the hands and lie below the standing
head top. Authoritative projectile origins still use the gameplay eye origin;
this work corrects the body fit rather than changing the projectile protocol.

Outline preparation is once per source mesh. Instances share that extra
geometry and the existing skeleton palette; no normals are calculated per
frame and no extra outline pass, shader variant or settings render loop is
added. Scene removal, corpse retirement and manager disposal release their
owned proxies, geometry and physics frames.

### Follow-up files

In addition to the earlier feature files:

- `src/engine/animation/PlayerModelFit.ts`
- `src/engine/animation/PlayerModelManager.ts`
- `src/engine/rendering/PlayerOutlineSmoothing.ts`
- `src/engine/rendering/PlayerOutlineProxy.ts`
- `src/engine/rendering/SnapshotFrames.ts`
- `src/engine/__tests__/PlayerModelFit.test.ts`
- `src/engine/__tests__/PlayerOutlineSmoothing.test.ts`
- `src/engine/__tests__/PlayerOutlineProxy.test.ts`
- `src/engine/__tests__/SnapshotFrames.test.ts`
- `src/games/fps/client/ragdoll/RagdollFrame.ts`
- `src/games/fps/client/ragdoll/__tests__/RagdollFrame.test.ts`
- `src/games/fps/client/RagdollSystem.ts`
- `src/games/fps/client/RemotePlayerRenderer.ts`
- `src/games/fps/client/AttachedGun.ts`
- `src/games/fps/client/AttachedBlade.ts`
- `public/images/player-models/police.webp`
- `public/images/player-models/female.webp`
- `public/images/player-models/robot.webp`
- `docs/manual/guides/model-loading.md`
- `src/games/fps/docs/manual/player/settings.md`
- `docs/changelog/v1.0.0-beta.9.md`
- this research note.

### Follow-up validation

Assumptions: client presentation for live players, bots and demo actors in the
existing gametypes; no server, collision, network or demo-format change.
Headless simulation, physics, server tick, 1,000-tick server fuzz and DM2
load/info plus movement replay passed before browser inspection. Exact commands
are those in the verification table and Robot follow-up above.

Focused model/outline/ragdoll/snapshot tests passed (20 tests), followed by the
new snapshot slot regression and outline lifecycle test (9 tests). The new
regression specifically finds an off-scene outline's uniform slot and ties it
to its visible body.

Native WebGPU read all three supplied GLBs, measured the standing body against
a 32 by 64 by 32 wireframe collider, attached the Rocket Launcher and measured
corpse bounds before/after Havok activation. All corpse bone scales stayed 1;
all three used batched pose sync with equal local/world reference scale. No
failed requests, browser exceptions or GPU validation errors occurred. The
weapon importer emits its existing common-root warning.

Native WebGPU snapshot replay reached 324 replay frames with one recording and
no restarts, while Robot moved and turned. The screenshot in replay and the
subsequent ordinary rendering were pixel-identical (zero differing channels).
Native WebGL2 rendered the refreshed previews for all three bodies. Probes and
images are in `.agent/player-model-outline/`, including `verification.json`,
`snapshot.json`, `snapshot-on.png` and `snapshot-off.png`.

| Exact final command | Result |
| --- | --- |
| `npm run typecheck` | Pass. |
| `npm run test:run` | Pass: 814 files, 6,317 tests passed, 1 skipped (311.48 s). The earlier tag-loader failures did not recur. |
| `npm run build` | Pass. |
| `npm run gate:biome` | Pass, 0 errors / 47 baseline warnings. |
| `npm run docs:build` | Pass. |
| `npm --prefix src/games/fps run docs:build` | Pass. |
| `npm --prefix src/games/fps run test:simulation` | Pass. |
| `npm --prefix src/games/fps run test:physics` | Pass. |
| `npm --prefix src/games/fps run server:tick` | Pass, deterministic checksum 2768943778. |
| `npm --prefix src/games/fps run server:fuzz -- --ticks 1000` | Pass. |
| `npm --prefix src/games/fps run cli:game -- --exec 'developer 1; bsp load washoi_dm2; bsp info; sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'` | Pass. |
| `npm run tools:pk3-index` | Pass; archive read, not overwritten. |

Logs and exit codes are in `.agent/player-model-outline/gates/`.
Full-match multiplayer performance and subjective grip appearance remain
unverified; use practice play to review these before removing the reference
model or releasing the new package.

The private preview server and owned browsers were closed after verification.
All final gate exit codes are zero. No commit, push or package overwrite was performed.


## Solid-colour subsequent spawns (2026-11-09)

| Finding | Fix / evidence |
| --- | --- |
| The first model rendered correctly, while later fresh instances could become solid outline-coloured silhouettes. | `Mesh.clone(name, null, true)` inherits the source parent. The cached outline template consequently joined the source hierarchy and was copied into later player instances as an ordinary mesh. Its outline covered the textured body. This affected both WebGPU and WebGL2. |
| The two earlier outline tests used unparented meshes and created both actors before building the template. | Added a parented source-hierarchy regression that creates the next actor after outline preparation. Before the fix it found `body/outlineNormals` alongside `body` in the source. |
| Removing a mesh from `scene.meshes` does not detach its parent. | Explicitly set `template.parent = null` before preparing its geometry. The source hierarchy stays intact, and subsequent actors inherit no outline-only mesh. |

Changed files this round:

- `src/engine/rendering/PlayerOutlineSmoothing.ts`
- `src/engine/__tests__/PlayerOutlineSmoothing.test.ts`
- `docs/manual/guides/model-loading.md`
- `docs/changelog/v1.0.0-beta.9.md`
- this research note.

Assumptions: client presentation in all existing gametypes, for live and demo
actors; no gameplay, collider, server or networking change. Snapshot signature
tracking additionally observes outline shader readiness.
The owner-supplied PK3 was indexed again and was not overwritten.

Reproduction used the actual Police GLB, an initial hidden actor and a second
actor from the same manager. The second actor reproduced the solid silhouette
on both backends; disabling its outline revealed the textured body. The new
source-hierarchy regression failed before the fix and passed afterward. The reported
alternation is consistent with the first correct actor and a later contaminated
actor taking turns through the corpse/player pool. That explains why a page
reload is needed to discard already-created contaminated instances.

After detaching the template, native headless WebGPU and WebGL2 each completed
six Havok death/retirement/respawn cycles with the same pooled actor. All 12
captures show texture detail and a continuous outline. Both backend runs
reported no failed HTTP requests or browser exceptions, only the existing gun
importer common-root warning. Artifacts: `.agent/player-model-outline/respawns.json`
and `respawn-{gpu,gl}-{0..5}.png`. A separate pre-fix inspection captured the
body with its outline disabled in `body-without-outline.png`.

Focused validation command:

`npx vitest run src/engine/__tests__/PlayerOutlineSmoothing.test.ts src/engine/__tests__/PlayerModelDisposal.test.ts src/engine/__tests__/PlayerOutlineProxy.test.ts src/engine/__tests__/SnapshotFrames.test.ts`

Result: 4 files / 16 tests passed. The regression test is included in this run.
The required final gates and renderer regression set use the exact commands in
the preceding final-command table; this round's logs and exit codes are in
`.agent/player-model-outline/respawn-gates/`.

A subsequent-spawn WebGPU snapshot probe also exposed an independent readiness
edge: the body shader can be ready while its outline shader is still compiling.
The snapshot signature now includes ready effects for outlined bodies and their
registered off-scene parts, so that transition invalidates an incomplete
recording. The existing snapshot regression checks the compiling-to-ready
signature change and the outline being switched off. The registered part list
is cached per actor rather than allocated each frame for these proxies.

Additional files: `src/engine/rendering/SnapshotFrames.ts`,
`src/engine/rendering/PlayerOutlineProxy.ts`, and
`src/engine/__tests__/SnapshotFrames.test.ts`. The initial gate attempt was
stopped to include this newly reproduced case; its partial run is not a final
validation result. Focused tests after this readiness change: 3 files / 12 passed.

A cold subsequent Robot spawn then reached 323 WebGPU snapshot replay frames;
the moved/turned textured body and outline matched ordinary rendering exactly
(identical screenshot hashes), with no failed requests or GPU validation errors.
Report: `.agent/player-model-outline/snapshot-respawn.json`; captures:
`snapshot-respawn-on.png` and `snapshot-respawn-off.png`.

Final gates all passed: typecheck, production build, Biome (0 errors / 47
baseline warnings), engine and FPS documentation builds, simulation, physics,
server tick, 1,000-tick fuzz, and DM2 load/info plus movement replay. The full
suite passed 814 files and 6,318 tests, with 1 skipped (297.40 s). Exact commands
are in the preceding final-command table; all exit codes in this round's
`respawn-gates/results.json` are zero.

The private preview servers and owned browsers were closed. No commit, push
or package overwrite was performed.


## Five models and live team cards (2026-11-09)

| Finding / request | Change / status |
| --- | --- |
| Add Cartel with male sounds. | Registered `cartel` in asset resolution, remote model loading, voice selection, settings and `animtest`. Actual archive audit loaded 24 joints and all 17 shared clips plus the embedded clip. |
| Rename the existing female model. | UI name is Female Police; its persisted identifier remains `female`. Police, Cartel and Robot also display without sound-pack suffixes. |
| Add the separate RiotKitty model with female sounds. | Registered `riotkitty`, rooted at `models/players/riotkitty/riotkitty.glb`, in the same paths. Its 24 joint names match Police. Runtime animation/rendering checks for this final addition remain pending. |
| Show live models beside each other with colours underneath. | Your team / Enemy team cards share one transparent WebGL canvas, two camera viewports and one manager/cache. Model selection and colour controls sit below each model. Narrow screens stack the cards. |
| Avoid continuous hidden preview work. | Lazy import starts only when a preview intersects the viewport. Scene updates are capped at 30 per second. Intersection and document visibility pause the loop; disposal disconnects observers and retires models, scene and engine. Pending loads check destruction/generation before applying. |
| The updated body PK3 contained only the model GLBs; its shared clip folder was gone. | The initial actual-archive audit failed on missing shared clips. Created `washoi_player_animations.pk3` from the 17 required local clip sources, using a new `tools:player-animations` command. The index resolves each asset's package. |
| Keep owner-supplied models intact. | The attempt to atomically augment the body archive was rejected. The separate clip package is the safe alternative. The model archive was not changed; its checksum matched the pre-attempt backup. The owner subsequently added RiotKitty themselves. |

Final displayed choices and fixed voice pairs:

| Model | Cvar value | Voice |
| --- | --- | --- |
| Police | `police` | Male |
| Female Police | `female` | Female |
| Cartel | `cartel` | Male |
| RiotKitty | `riotkitty` | Female |
| Robot | `robot` | Bobot |

The UI reuses gameplay's actual tint, brightness and outline styling. Static
fallbacks for Police, Female Police, Cartel and Robot were refreshed from the
supplied archive. RiotKitty uses a model-name placeholder until its live model
is ready; a static RiotKitty fallback image has not yet been rendered.

### Files changed in this round

- `src/engine/animation/PlayerModelAssets.ts`
- `src/engine/animation/__tests__/PlayerModelAssets.test.ts`
- `src/engine/console/commands/AnimTestCommand.ts`
- `src/games/fps/client/PlayerModelSelection.ts`
- `src/games/fps/client/RemotePlayerRenderer.ts`
- `src/games/fps/client/__tests__/FPSPlayerAudio.test.ts`
- `src/games/fps/client/settings/GameplayPage.ts`
- `src/games/fps/client/settings/PlayerTeamPreview.ts` (new)
- `src/games/fps/client/settings/FPSSettingsView.css`
- `src/games/fps/client/settings/__tests__/FPSSettingsView.test.ts`
- `src/games/fps/client/settings/__tests__/GameplayPreviewLifecycle.test.ts` (new)
- `scripts/package-player-animations.mjs` (new)
- `package.json`
- `public/images/player-models/police.webp`
- `public/images/player-models/female.webp`
- `public/images/player-models/cartel.webp` (new)
- `public/images/player-models/robot.webp`
- `docs/manual/guides/model-loading.md`
- `src/games/fps/docs/manual/player/settings.md`
- `docs/changelog/v1.0.0-beta.9.md`
- this research note.

Runtime media are external to Git: the supplied five-model
`public/data/washoi_player_model.pk3`, the new 619,510-byte
`public/data/washoi_player_animations.pk3`, and regenerated discovery files.
Both PK3s and refreshed discovery must accompany a future media deployment.
No production upload, commit, merge or push was performed.

### Verification and limits

Assumptions: client-local presentation for existing live/networked and demo
gametypes. No server, physics, protocol or demo-format changes.

- `npx vitest run src/engine/animation/__tests__/PlayerModelAssets.test.ts src/games/fps/client/__tests__/FPSPlayerAudio.test.ts src/games/fps/client/settings/__tests__/FPSSettingsView.test.ts`: 31 passed before RiotKitty was added.
- `npx vitest run src/games/fps/client/settings/__tests__/GameplayPreviewLifecycle.test.ts`: 2 passed, checking visibility-driven loading, pause/cleanup, and destruction during pending initialization.
- `npx tsx .agent/player-model-tuning/cartel-manager.ts`: initial failure exposed the missing clips; passed with the separate clip package (Cartel 24 joints / 18 clips).
- `node scripts/package-player-animations.mjs`: passed, 17 required clips, 619,510 bytes, without changing the body archive.
- `npm run tools:pk3-index`: passed for Cartel and the new clip package. Discovery still needs refreshing after the owner's subsequent RiotKitty addition.
- `npm --prefix src/games/fps run deps:babylon`: declarations remained current (171 engine modules, 10 additional application modules).
- `node node_modules/typescript/bin/tsc --noEmit`: passed after RiotKitty wiring.
- Targeted `npx biome check --write` and `git diff --check`: passed for the edited source. Final gate comparison remains pending.

The native desktop probe rendered Police, Female Police and Cartel with live
outlines and the expected female/male voice pairing. The UI offered all four
choices present at that time, including Robot. It used exactly one canvas;
hiding Gameplay produced zero active render loops, returning reused the same
canvas, and destroying the view left zero preview canvases and a disposed
engine. No failed requests or browser exceptions were reported. Evidence:
`.agent/player-model-tuning/team-ui.json` and `team-ui-desktop.png`.

The first narrow-screen probe used a fixture without the production viewport
meta tag and therefore kept a 980-pixel layout; this is not a valid mobile
result. The fixture was corrected for a final run, with production fonts, tab
visibility and colour-change checks, but that run did not execute. RiotKitty
was added after the successful four-choice desktop run and remains unverified
in the browser. The Cartel weapon/ragdoll follow-up also has not executed.

Automatic approval review first rejected replacing the user-owned body PK3;
that action was abandoned in favour of the separate animation archive. A later
attempt to start the final private browser server was blocked because the
approval service hit a usage limit, with retry advised after 02:14 local time.
This second block was an approval-service failure, not a safety determination.
No attempt was made to bypass it. Final native browser checks, discovery
refresh, full suite, build, Biome gate, both docs builds and renderer regression
set remain pending for this round. Earlier round results above do not certify
these newer edits.


## RiotKitty preview verification and completion (2026-11-09)

| Finding | Change / evidence |
| --- | --- |
| RiotKitty was wired in but had not been rendered during the approval-service outage. | Actual-archive headless loading now passes with 24 joints and all 17 shared clips plus the embedded clip. A fresh native browser renders it correctly. The owner also confirmed it works. No model file edit was needed. |
| RiotKitty had no static fallback entry, leaving only its name before live rendering was available. | Rendered `public/images/player-models/riotkitty.webp` (6,074 bytes) and registered it. The fallback map is now a complete `Record` over all choices, so omitting a new model is a type error. The UI regression failed before the entry existed and passes after it. |
| Discovery predated the newly added GLB. | Regenerated the index for the five-body archive and separate clip package. An already-mounted older archive still requires a page reload; the exact cause in the owner's prior session was not observed. |
| A rejected variant promise could remain cached, preventing another attempt. | Clear failed requests and allow the current choice to retry on a later refresh. A focused test rejects the first import and confirms the next succeeds. |
| Disposing replaced preview bodies during cold shader compilation caused native WebGL program warnings. | Return replaced bodies to their model manager pool instead. This also avoids repeated instance/material creation when revisiting choices. The same native sequence changed from 14 program warnings to none. Disposal still retires the manager and its parked instances. |

Additional changed files this round:

- `public/images/player-models/riotkitty.webp` (new)
- `src/games/fps/client/PlayerModelSelection.ts`
- `src/games/fps/client/settings/PlayerTeamPreview.ts`
- `src/games/fps/client/settings/__tests__/FPSSettingsView.test.ts`
- `src/games/fps/client/settings/__tests__/PlayerTeamPreview.test.ts` (new)
- `docs/manual/guides/model-loading.md`
- `docs/changelog/v1.0.0-beta.9.md`
- this note.

The current native report is `.agent/player-model-tuning/riotkitty-ui.json`.
It offers Police, Female Police, Cartel, RiotKitty and Robot, and verifies
RiotKitty/Cartel with female/male sounds, 24 bones and 18 clips each. At desktop
width the two cards align side by side; at a true 430-pixel viewport they stack.
A colour change updates the actual albedo. Hiding Gameplay or marking the tab
hidden stops the preview loop (zero active render loops); returning reuses one
canvas. Destroying the view leaves no preview canvas and a disposed engine.
No failed requests, browser exceptions or GPU validation warnings remained;
only the browser's lazy-image informational notice was recorded.

Exact targeted checks:

- `npx tsx .agent/player-model-tuning/riotkitty-manager.ts`: pass, actual RiotKitty rig and shared clips.
- `npm run tools:pk3-index`: pass, 2,184 indexed files / 34 packages.
- `node .agent/player-model-tuning/riotkitty-previews.mjs`: pass, native WebGL2 rendered the model.
- `node .agent/player-model-tuning/riotkitty-ui.mjs`: pass, live preview/layout/styles/lifecycle as above.
- `npx vitest run src/games/fps/client/settings/__tests__/PlayerTeamPreview.test.ts src/games/fps/client/settings/__tests__/FPSSettingsView.test.ts src/games/fps/client/settings/__tests__/GameplayPreviewLifecycle.test.ts src/games/fps/client/__tests__/FPSPlayerAudio.test.ts src/engine/animation/__tests__/PlayerModelAssets.test.ts`: 5 files / 36 passed.

The approval service is available again; the complete final gates and renderer
regression set are now running. Their commands match the preceding final-command
table, and logs/exit codes are in `.agent/player-model-tuning/team-gates/`.
Final results: typecheck, production build, Biome (0 errors / 47 baseline
warnings), engine and FPS docs, simulation, physics, server tick, 1,000-tick fuzz,
and DM2 load/info plus movement replay all passed. The final manual clarification
was followed by another passing `npm run docs:build`.

Full suite: 815 files passed / 1 failed; 6,323 tests passed / 1 failed / 1 skipped
(302.71 s). The failure is the unchanged
`src/games/fps/client/__tests__/LobbyPanelRecovery.test.ts:121`: the outage retry
case expected zero fake timers after recovery and observed one. Running that
file alone passed all 7 tests. Running it with the five new/affected preview,
settings, audio and asset test files passed all 43 tests. The source of the
extra timer in the complete run is unconfirmed. No lobby production code or
its test was changed to hide the failure, and the full suite is not reported
as green.

No body-archive rewrite, commit, merge, push or upload. The private preview
server and owned native browsers were closed after verification.


The previously pending native Cartel/RiotKitty physics and attachment check also
passed (`node .agent/player-model-tuning/additional-models-verify.mjs`). Both
standing silhouettes span feet 0 to head 64; Rocket Launcher muzzle heights are
60.11 and 59.20 respectively. After Havok takes over, corpse heights remain
63.94 / 63.97 and bone scales remain 1, with batched pose sync enabled. Report:
`.agent/player-model-tuning/additional-models-verification.json`. The weapon
importer emits its existing common-root warning. No GLB or gameplay changes.

Tuning discussion: RiotKitty's held-idle width is about 17.38 world units versus
Cartel's 27.62, while both keep the same 32-unit gameplay width. Review the
slimmer silhouette's readability during live play; model selection is local and
must not change the authoritative collider.

Separate cleanup remains after the owner's removal of the reference body:
headless animation diagnostics and `tools:player-model` still reference that
recipe's body asset. Normal gameplay, ghosts and the five-choice UI use the
selected bodies, but the old packaging command must not be run against the
supplied body archive. This was identified in source and was not changed as
part of the preview work.


## Relaxed running, aim pitch, untinted bodies and beam ownership (2026-11-09)

Scope: third-person presentation for the five supplied models, shared by live
network play and demos. The live transition check uses an isolated Amphi match
on `washoi_amphi1`; headless map checks use indexed `washoi_dm2`. First-person
weapon posing, authoritative movement/collision, projectile origins and wire/demo
formats are unchanged. The supplied body PK3 was not rewritten.

### Findings and implementation

- The shared rifle run holds the arms forward. Every supplied body embeds
  `Running` and `Walking`; retain `Running` as `run_relaxed` alongside the shared
  clips. Remote running chooses it when neither aiming nor recently firing.
  Fire events keep the shared weapon-ready pose for 0.6 seconds. Demo readiness
  uses recorded ticks, including pause/speed changes, and resets on a playback
  discontinuity. Bodies without this embedded clip retain the shared run.
- View pitch already exists in interpolated snapshots. Apply an additive,
  bounded bend across Spine/Spine1/Spine2 after animation evaluation; remove the
  previous offset before evaluation. The axis is transformed into each joint's
  parent frame, including mirrored exports. Hips/anchor remain upright and the
  hand weapon/muzzle follow the spine. Paused or manually sampled poses cannot
  accumulate rotation. Swimming/climbing/walljump/slide retain authored poses;
  unlinked ragdolls skip the additive layer. Manager observers and pose entries
  are removed on disposal/release.
- The former Brighter players Off applies team tint. Add `cl_player_tint`
  (persisted, default 1) and expose Off / Tint / Some / Lots. Off restores
  authored albedo and emissive colours; outlines retain relative team/FFA
  colours. Tint remains the default, preserving existing users' appearance.
- A native snapshot A/B reproduced stale body tint after switching to Off:
  110,439 colour channels differed from the non-replayed frame (maximum delta
  147). Declare cloned player style materials dynamic before their first draw.
  With the fix, the same two images differ in zero of 2,228,208 channels.
  No world-material policy or shader variant was added. Aim changes and actor
  movement in the isolated gallery retain one recording with active replay.
- Local beam state was only stopped along selected firing paths. Frozen round
  phases, disabled controls, switching, missing/non-beam inventory, disposal and
  viewmodel retirement now clear it. A beam without a valid camera/definition
  or muzzle also stops. Continuous pre-match countdowns that do not freeze
  movement retain their firing behaviour.

### Exact files in this follow-up

Engine:
`src/engine/animation/PlayerModelManager.ts`,
`src/engine/animation/PlayerAimPose.ts`,
`src/engine/weapon/WeaponViewManager.ts`,
`src/engine/__tests__/PlayerAimPose.test.ts`,
`src/engine/__tests__/PlayerModelTint.test.ts`.

FPS:
`src/games/fps/FPSPlayer.ts`,
`src/games/fps/__tests__/FPSPlayerBeamAmmo.test.ts`,
`src/games/fps/client/GameEvents.ts`,
`src/games/fps/client/RemotePlayerRenderer.ts`,
`src/games/fps/client/PlayerModelVisualSettings.ts`,
`src/games/fps/client/settings/SettingsModel.ts`,
`src/games/fps/client/settings/GameplayPage.ts`,
`src/games/fps/client/settings/__tests__/SettingsModel.test.ts`,
`src/games/fps/client/__tests__/RemotePlayerVisibility.test.ts`,
`src/games/fps/client/__tests__/WeaponViewManagerBeamRouting.test.ts`,
`src/games/fps/client/__tests__/__fixtures__/remote-render-parity.txt`.
The golden fixture receives only the new tint cache-key field; its 750 actor
pose/material records otherwise compare unchanged.

Documentation:
`docs/changelog/v1.0.0-beta.9.md`,
`docs/manual/guides/model-loading.md`,
`src/games/fps/docs/manual/player/settings.md`,
`docs/research/v1.0.0-beta6-papercuts.md` (PC-072 through PC-074),
this document.

### Verification

Before the beam/tint fixes, the focused ownership/colour regressions failed in
8 cases. Final focused run: 6 files / 47 tests passed (aim pose, authored tint,
brightness settings, remote visibility/readiness, FPS beam ammo/lifecycle and
viewmodel beam routing). Model loading/disposal and pose stepping also passed
in the earlier focused round. The 750-record remote-render parity test passes.

Native commands (ignored, reproducible QA fixtures):

```text
node .claude/skills/browser-probe/scripts/private-vite.mjs 3107
node .agent/player-model-tuning/aim-gpu.mjs
node .agent/player-model-tuning/aim-snapshot.mjs
node node_modules/vite-node/vite-node.mjs .agent/startup-bugs/serve-amphi.ts
node .agent/player-model-tuning/beam-live.mjs
```

All five actual models on both WebGL2 and WebGPU load 19 clips, including
`run_relaxed`. Positive/negative pitch moves the hand and actual held Riotgun
muzzle downward/upward. Twenty paused frames retain identical hand/muzzle
positions; anchor position stays fixed. Results: `aim-gpu.json`.
The snapshot comparison uses the same paused pitched Police pose, switches Tint
to Off during replay, then compares replay on/off images. Results:
`aim-snapshot.json`, `off-snapshot-on.png`, `off-snapshot-off.png`.
The native importer emits its existing common-root warning; no failed requests
or GPU validation errors were observed.

The final live WebGPU probe establishes a loaded, firing Voltaic in warmup
(player/view beam flags true; player alive, controls enabled, 120 loaded ammo).
Holding fire through countdown round 1 and Active resets selection to Blade;
all 30 later samples have both flags false. Snapshot replay remains active
(2,559 replay frames, 17 recordings over the full join/match sequence). Report:
`beam-live.json`. Earlier attempts failed to establish a beam after waiting
through bot combat and were rejected as invalid reproductions; the final probe
checks this prerequisite explicitly.

Required checks run from the assembled root:

```text
npm --prefix src/games/fps run test:simulation
npm --prefix src/games/fps run test:physics
npm --prefix src/games/fps run server:tick
npm --prefix src/games/fps run server:fuzz -- --ticks 1000
npm --prefix src/games/fps run cli:game -- --exec "developer 1; bsp load washoi_dm2; bsp info; sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit"
npm run test:run
npm run build
npm run typecheck
npm run gate:biome
npm run docs:build
npm --prefix src/games/fps run docs:build
```

The headless regression set and production build passed. Full gates are recorded
in `.agent/player-model-tuning/current-gates/`; final results follow below.

Live tuning remains subjective: review the relaxed-to-ready transition and the
maximum spine bend in a match. This is a spine pose layer, not hand/weapon IK.
Try Gameplay > Brighter players > Off to inspect original skins; aim up/down
while observing another player, and run without aiming/fire to inspect relaxed
arms. No developer mode is needed for these behaviours.


Final gates for this follow-up all passed:

| Command | Result |
| --- | --- |
| `npm run test:run` | 818 files passed; 6,338 tests passed, 1 skipped; 386.44 s. The previously reported lobby timer failure did not recur in this complete run. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed. |
| `npm run gate:biome` | Passed at baseline: 0 errors, 47 warnings. |
| `npm run docs:build` | Passed. |
| `npm --prefix src/games/fps run docs:build` | Passed. |
| `npm --prefix src/games/fps run test:simulation` | Passed. |
| `npm --prefix src/games/fps run test:physics` | Passed. |
| `npm --prefix src/games/fps run server:tick` | Passed. |
| `npm --prefix src/games/fps run server:fuzz -- --ticks 1000` | Passed. |
| Indexed BSP load/info plus movement replay above | Passed. |
| `git diff --check` in both repositories | Passed. |

The isolated QA server, private Vite server and owned probe browsers were
closed. No commit, merge, push, release or media upload was performed.


## Visual size tuning (2026-11-09)

The owner reported valid hits above the visible helmet. Increase the calibrated
body fit by 10%: standing idle silhouette height is now 70.4 world units, with
feet anchored at zero. This is visual tuning for the five supplied bodies in
live play, demos and previews; the standing movement hull remains 64 high and
32 wide. Weapon dimensions, gameplay eye/projectile origins and hit rules remain
unchanged. No animation or body PK3 rewrite is required.

Exact production edit: `src/engine/animation/PlayerModelManager.ts` passes
`PLAYER_HEIGHT * 1.1 / 36` to the existing load-time fit. The existing fit and
attachment compensation paths preserve foot placement and gun size. No new
per-frame work, draw pass, shader variant, network field or setting was added.
Updated documentation: this report, `docs/manual/guides/model-loading.md`,
`src/games/fps/docs/manual/player/settings.md`,
`docs/changelog/v1.0.0-beta.9.md`, and PC-075 in the papercut matrix.

Native verification (`node .agent/player-model-tuning/size-verify.mjs`) uses
all five actual GLBs on WebGL2 and WebGPU. It CPU-skins every body part, compares
the previous 64-unit fit with the new 70.4-unit fit, measures held Riotgun bounds
at both scales, and starts each model's actual Havok ragdoll on WebGPU. All ten
model/backend combinations and all five ragdolls pass. The headless regression
set ran before native probing. Gallery screenshots include the unchanged
32-by-64 movement box. No failed requests or GPU errors were observed; imported
weapons emit the existing common-root warning.

| Body | Idle height | Feet | Top when aiming down 0.8 rad | Ragdoll height |
| --- | --- | --- | --- | --- |
| Police | 70.4 | 0 | 64.050 | 70.393 |
| Female Police | 70.4 | 0 | 62.621 | 70.389 |
| Cartel | 70.4 | 0 | 64.145 | 70.390 |
| RiotKitty | 70.4 | 0 | 62.297 | 70.379 |
| Robot | 70.4 | 0 | 64.331 | 70.389 |

All measured gun dimensions remain unchanged (tolerance 0.01 unit). Ragdoll bone
scale remains 1. Native artifacts: `.agent/player-model-tuning/size-verify.json`
and `size-<model>.png`; gate logs: `.agent/player-model-tuning/size-gates/`.

Worth separate discussion: `ProjectileSystem.ts` currently tests direct player
contact using a sphere of radius 50 around the tracked origin. The ordinary
hitscan path in `WeaponSystem.ts` uses a radius-32 sphere; neither is a pixel
silhouette test. A projectile can therefore legitimately hit above the visual
helmet. This adjustment improves readability but does not change those rules.
Any tighter hit-region policy should be evaluated as a separate gameplay change,
with live/network regression coverage rather than bundled into model tuning.

Validation commands are the same complete set listed in the preceding section,
run again for this size change; final outcomes follow below.


Final size-tuning gates: all passed. Full suite: 818 files, 6,338 tests passed,
1 skipped (342.65 s). Typecheck, production build, Biome (0 errors / 47 baseline
warnings), both manual builds, simulation, physics, tick, 1,000-tick fuzz, indexed
DM2 BSP/movement replay and both repository whitespace checks passed. This is
gametype-independent presentation; no server, prediction or hit-detection code
was edited. The private probe server and owned browsers were closed. No commit,
merge, push or media upload. Reload the page to apply the new load-time fit.


## Blade upper-body layering (2026-11-09)

Reported behaviour: swinging the blade in the air replaces airborne legs with a
grounded swing stance. Source review confirms `blade_slash` used all animation
channels and stopped the locomotion group. Other ordinary weapon shots do not
start this full-body one-shot; they already leave running/jumping intact.

The blade one-shot now owns only the Spine node and its descendants. A cached
Babylon animation mask excludes those targets from the existing locomotion
group. Hips and all leg joints keep evaluating at the same phase, speed and LOD;
the locomotion group is never replaced or restarted for the swing. Ending or
cancelling the overlay unmasks upper joints at the current lower-body phase.
Changing locomotion during a swing carries the mask to the cached destination
clip. Full-body one-shots retain exclusive ownership and still suspend movement
posing. Rigs without a usable spine retain the full-body fallback.

Babylon's `AnimationGroup.goToFrame` writes masked targets too. The manager's
manual/stepped pose path therefore samples only retained animatables while a
mask is active. This prevents a distant/stepped actor's movement clip from
overwriting its swing arms. Live and demo update paths keep applying locomotion
speed/airborne direction during upper-body swings; demo overlay speed still uses
its recorded clock. No server, wire format, first-person animation, hit timing,
media archive, draw pass or shader variant changed. Target sets and masks are
cached per instance; existing groups/overlay disposal handle cleanup.

Exact files changed in this follow-up:

- `src/engine/animation/PlayerModelManager.ts`
- `src/engine/__tests__/PlayerModelBladeLayer.test.ts`
- `src/games/fps/client/RemotePlayerRenderer.ts`
- `src/games/fps/client/__tests__/RemotePlayerVisibility.test.ts`
- `vite.config.ts` (declare the Babylon mask import for pre-bundling)
- `docs/manual/guides/model-loading.md`
- `src/games/fps/docs/manual/player/settings.md`
- `docs/changelog/v1.0.0-beta.9.md`
- `docs/research/v1.0.0-beta6-papercuts.md` (PC-076)
- this report

Scope: gametype-independent third-person presentation in live network play and
demos, on all five supplied models. Headless movement checks use indexed DM2;
native checks use isolated real-model galleries. Collision and weapon damage
rules remain untouched.

Focused verification command:

```text
node node_modules/vitest/vitest.mjs run src/engine/__tests__/PlayerModelBladeLayer.test.ts src/engine/__tests__/PlayerModelClipGroups.test.ts src/engine/__tests__/PlayerModelPoseStepping.test.ts src/games/fps/client/__tests__/RemotePlayerRenderParity.test.ts src/games/fps/client/__tests__/RemotePlayerVisibility.test.ts
```

All 5 files / 21 tests pass. Coverage compares a swinging actor with an unswung
control frame by frame, verifies exact hip/leg phase while upper joints swing,
jump/run transitions, repeated swings, reverse/frozen/stepped playback, natural
completion, unchanged cached group counts and cleanup. Existing full-body
one-shot exclusivity and 750-record render parity also pass. A discarded approach
that replaced locomotion groups lost a frame at the boundary; the final mask
approach retains the original group and passes phase comparisons.

Native commands:

```text
node .claude/skills/browser-probe/scripts/private-vite.mjs 3107
node .agent/player-model-tuning/blade-native.mjs
node .agent/player-model-tuning/blade-snapshot.mjs
```

All five models on WebGL2 and WebGPU pass nine-joint lower-body comparisons
against unswung controls during jump, run, relaxed run, crouch walk, slide and
swim, plus natural swing completion. Maximum quaternion dot error is
0.000000479. Overlay completion clears the mask and keeps the original master
group. Results: `.agent/player-model-tuning/blade-native.json`.
An initial probe hit a stale Vite optimized chunk after importing the mask API;
restarting the isolated development server resolved it. The successful run has
no failed requests or GPU errors; imported weapons retain the common-root warning.

A frozen airborne swing with a manually stepped leg pose renders pixel-identically
with WebGPU snapshot replay enabled/disabled (0 differing channels out of
2,228,208). Replay statistics advance from 210 to 296 frames with no additional
recording during the pose change (2 existing recordings). Results:
`blade-snapshot.json`, `blade-snapshot-on.png`, `blade-snapshot-off.png`.
The private Vite server and owned browsers were closed after these probes.

The required headless regression set passed before browser probing. Final gates
use the same complete commands listed above, with logs under
`.agent/player-model-tuning/blade-gates/`; final outcomes follow below.

Separate question: remote muzzle flashes are feasible using the existing pooled
`MuzzleFlashRenderer` and the held weapon's `tag_flash`. The current spawn path
is first-person only. Recommendation: reuse weapon shot events and per-weapon
flash definitions, attach a short pooled flash to the remote muzzle, and omit
new dynamic lights initially. No new replication field is needed. This was
investigated and answered, not added to the blade animation patch.

The final render decision also excludes blade fire from the brief rifle-ready
run switch, so triggering a swing does not replace relaxed-running legs. The
existing remote-pose test now checks this event/readiness boundary explicitly.


Final validation for blade layering:

| Check | Result |
| --- | --- |
| Complete `npm run test:run` | 818 files passed / 1 failed; 6,340 tests passed / 1 failed / 1 skipped (350.75 s). Sole failure: `ViteBabylonDeps.test.ts`, the new mask import was missing from explicit pre-bundling. |
| Dependency correction | Added `@babylonjs/core/Animations/animationGroupMask` to `vite.config.ts`; the two dependency tests passed on focused rerun. |
| Final focused command above, plus `src/__tests__/ViteBabylonDeps.test.ts` | 6 files / 23 tests passed after the final blade-fire readiness correction (5.58 s). The full suite was not repeated for these scoped corrections. |
| Final `npm run build` | Passed after the final source/dependency changes. |
| Final `npm run typecheck` | Passed. |
| Final `npm run gate:biome` | Passed at baseline (0 errors / 47 warnings). |
| `npm run docs:build` | Passed. |
| `npm --prefix src/games/fps run docs:build` | Passed. |
| Simulation / physics / server tick / 1,000-tick fuzz / indexed DM2 BSP and movement replay | All passed before native checks. |

The original complete-run failure is retained in `blade-gates/results.json`;
scoped recheck logs are `dependency-recheck.log` and `final-focused.log`.
Final build/typecheck/Biome results are under `blade-gates/final-checks/`.
This is not represented as a fresh all-green complete-suite run. All observed
failures have a verified correction. No commit, merge, push, release or media
upload was performed. The private native probe server/browsers are closed.
