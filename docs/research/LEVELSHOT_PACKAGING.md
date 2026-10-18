# Production map levelshots

2026-10-18. Full-resolution PNG originals belong in the matching map PK3;
small JPGs in public/data/levelshots are generated deployment assets.

## Installed media

| Map | Original PNG bytes | Generated JPG bytes |
| --- | ---: | ---: |
| washoi_dm2 | 2019082 | 104035 |
| washoi_dm5 | 1856712 | 79214 |
| washoi_dm11 | 1783149 | 80654 |

The source PNGs total 5,658,943 bytes; the three JPG previews total 263,903
bytes (about 95.3% smaller). All three previews are 960 by 540 pixels.
Only these three production-ready images were installed. Deleted legacy
levelshots remain absent; the other installed maps retain the UI gradient.

`map_washoi_dm2.pk3`, `map_washoi_dm5.pk3`, and `map_washoi_dm11.pk3` now own
`levelshots/<map>.png`. Every PNG matches the user's file byte-for-byte. All
non-levelshot entries (including BSP, minimap and navigation) were compared with
the previous packages and remain byte-identical. CRCs also passed.
The original user PNGs are archived in `archive/media/levelshots/`; old map
packages are backed up in `archive/media/levelshots/map-backups/`.

`npm run tools:rename-maps -- --output-dir .cache/production-levelshots` stages
reproducible packages from the existing original-map backups plus the archived
production PNGs. `--levelshots-dir <directory>` overrides the PNG source.
The staging tool does not install its output automatically.

`npm run tools:pk3-index` extracts indexed PNGs from map_*.pk3, validates and
resizes them proportionally (no enlargement, at most 960x540), then encodes JPG
at quality 85. `npm run build` runs that generator automatically. It rejects
invalid images before publishing metadata. The generated.json inventory lets
it remove obsolete generated JPGs without deleting unrelated files. Map IDs
are constrained to simple safe filenames; stale names are validated too.

The lobby, loading screens and demos retain their small JPG URLs. Legacy demo
metadata resolves old IDs to production IDs; settings backgrounds use installed
production maps. Browsers do not load full map archives just to show a preview.
No WebSocket message schema or demo format changed.

## Changed files

- `scripts/rename-map-packages.mjs`
- `src/cli/pk3-index-build.ts`
- `src/cli/levelshot-previews.ts`
- `src/engine/loader/pk3/__tests__/PK3PublishedIndex.test.ts`
- `src/lobby/LobbyServer.ts`
- `src/lobby/__tests__/DemoOwnership.test.ts`
- `src/games/fps/client/settings/GameplayPage.ts`
- `docs/manual/guides/pk3-filesystem.md`
- `docs/changelog/v0.9.32.md`
- `docs/research/media/levelshots.json`
- `docs/research/media/levelshot_packages.json`
- `docs/research/LEVELSHOT_PACKAGING.md`
- `docs/research/media_packaging.md`

PK3s, generated JPGs, generated inventory and index/manifest are local media
artifacts outside Git. Deploy those outputs with the source changes. Editing
only a generated JPG will be overwritten by the next index/build generation.

## Validation

- `npm run tools:rename-maps -- --output-dir .cache/production-levelshots`: pass.
- `python .cache/verify-levelshot-packages.py`: all PNG hashes, ZIP CRCs and
  non-levelshot entry comparisons passed before installing packages.
- `npm run tools:pk3-index`: pass, 18 archives, six maps, three levelshots.
- `npm run test:run -- src/engine/loader/pk3/__tests__/PK3PublishedIndex.test.ts`:
  12 tests passed, including preview dimensions/colours, unchanged PK3 bytes,
  bad-PNG rejection before metadata replacement, and stale-preview cleanup.
- `npm run test:run -- src/lobby/__tests__/DemoOwnership.test.ts`: pass,
  including legacy wdm2 demo metadata pointing at washoi_dm2.jpg.
- `npm run typecheck`: pass. Node Buffer/Uint8Array type differences were
  resolved using explicit Uint8Array copies at library boundaries.
- `npm run gate:biome`: pass, zero errors, 319 warnings versus 339 baseline.
- `npm run build` and `npm run docs:build`: pass.
- `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`,
  `npm run server:fuzz -- --ticks 1000`: pass.
- `node .cache/run-map-bsp.mjs`: pass; direct argv invocation of the headless
  CLI with `bsp load washoi_dm2; bsp info; bsp load washoi_dm5; bsp info; bsp load washoi_dm11; bsp info; quit`.
- `node .cache/levelshot-browser.mjs`: pass. Real MatchLobbyView cards fetched
  and decoded all three 960x540 JPGs, with no HTTP failures or page errors.
  The rendered lobby cards were visually inspected. The first scratch fixture
  lacked its parent-height allocation; setting fixture height restored the
  normal card layout without changing production CSS.

Assumptions: PNG is the authoritative levelshot format for these production
maps; JPG is a disposable lobby preview. Only the three supplied PNGs are
production-ready. No new multiplayer match or deployment to origin has been
tested. Restarting a separately running lobby server is needed to pick up its
new legacy-demo thumbnail URL mapping. No services were stopped except the
agent's private preview server. Earlier uncommitted work remains untouched.

Full suite:
`npm run test:run -- --poolOptions.forks.singleFork=false --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`
passed: 5,146 tests passed and one skipped, in 369.44 seconds.
Log: `.cache/levelshot-all-tests.log`.

## Lobby pool follow-up

Both Duel and FFA now advertise exactly washoi_dm2, washoi_dm5, washoi_dm11.
DM5/DM11 already had both assignments; config/maps.json adds FFA to DM2.
Also updated src/games/fps/docs/manual/gametypes/maps.md and
 docs/changelog/v0.9.32.md. This research file records the validation.

- `npx vite-node .cache/check-production-map-pools.ts`: pass; invoked the real
  LobbyServer._loadMapsConfig against installed production packages and asserted
  both exact pools. Amphi/S&D remain wamphi1 and wbomb2/wbomb6 respectively.
- `npm run test:run -- src/lobby/__tests__/LobbyAmphiMaps.test.ts`: pass, one test.
- `npm run docs:fps:build`: pass.

The lobby reads its map pools at startup, so a running lobby server needs a
restart to advertise the revised FFA list. No running service was restarted.
