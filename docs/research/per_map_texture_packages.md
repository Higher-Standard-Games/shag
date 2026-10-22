# Per-map texture packages

Date: 2026-10-22. Scope: local package generation, publication policy, index and
client map-bank routing. The later authorized production pre-upload is recorded
at the end of this document.

## Layout and policy

`public/data/washoi_textures.pk3` remains the unchanged editable master bank.
`config/pk3-packages.json` contains:

```json
{
  "ignoredPackages": ["washoi_textures.pk3"],
  "sharedTexturePackages": {
    "tex_billboard.pk3": {
      "prefixes": ["textures/billboard/"],
      "dynamic": true
    }
  }
}
```

This tracked build policy excludes exact, case-insensitive basenames from both
generated metadata files, KTX2 source selection and Vite release output. Paths,
globs, duplicate names and misspelled policy fields are rejected. The master
remains available on the development server and to explicitly selected source
tools. Low-level Node archive scans and explicit loads are not access-controlled
by a build publication policy. Generated metadata must not be edited manually.

Published layout: five map PK3s, five `tex_<map>.pk3` dependency banks, one shared
`tex_billboard.pk3` and the six
shared gameplay/music/effects packages. Each bank includes its map's collected
textures, shader definitions, animation frames, sky/cubemap assets, companion
maps and map-specific media. Shared paths may be duplicated intentionally.
Original virtual paths, source bytes, attribution and dependency ledgers survive.

## Initial measured banks (before shared billboard extraction)

Master: 122,191,156 bytes. Sizes below include provenance metadata; percentages
compare texture-bank download only, not BSP/gameplay/audio downloads.

| Bank | Bytes | Decimal MB | Reduction vs master |
| --- | ---: | ---: | ---: |
| `tex_washoi_dm2.pk3` | 8,202,521 | 8.20 | 93.3% |
| `tex_washoi_dm5.pk3` | 60,151,457 | 60.15 | 50.8% |
| `tex_washoi_dm11.pk3` | 50,441,799 | 50.44 | 58.7% |
| `tex_washoi_amphi1.pk3` | 10,025,976 | 10.03 | 91.8% |
| `tex_washoi_snd1.pk3` | 58,567,674 | 58.57 | 52.1% |

The extraction audit reports existing `noshader` and common clip-material names
as unresolved. It does not prove every dynamic gameplay texture dependency.
The five master texture files not collected by any of these maps are under
`textures/wsw_cave1/` (`ball_glowb_alpha.tga`, `ball_glowb_sphere_cyan.tga`,
`ball_glowb.tga`, `ball_mask.ktx`, `ball_noise.tga`). They remain in the master.
The uncollected master shader `textures/baxandall/teleglow_02` remains there too.

## Rebuild and local install

```powershell
node scripts/package-map-media.mjs --maps washoi_dm2,washoi_dm5,washoi_dm11,washoi_amphi1,washoi_snd1 --master-package washoi_textures.pk3 --output-dir .cache/per-map-texture-install/packages
npm.cmd run tools:pk3-index
npm.cmd run tools:textures:audit
```

`--master-package` prepares an in-memory source index from the published
non-`tex_` packages plus the explicitly named master. That source index is never
published. It makes subsequent rebuilds use edited master artwork rather than
previously generated map banks. Retain the staging report with asset and shader
hashes. The command generates map packages too; compare BSP/content hashes before
replacing any existing map package. Install only the reviewed five texture banks,
then regenerate metadata. KTX2 audit does not re-encode or change existing caches.

Back up the previous manifest/index and hash the master before installation.
Stage packages under unique temporary filenames and rename each completed file
into place. To roll back, restore the previous package policy and regenerate the
matched metadata from the previous package set. Do not restore an old index over
a different package set. Local backups and validation artifacts are under
`.cache/per-map-texture-install/`; binary PK3s/metadata are ignored deployment
assets and are not carried by a source commit.

## Initial download measurement, before client routing

The published index still has one global winner per path and shader. In the
isolated five-bank index, DM2 has 35 collected asset paths and 17 shaders owned
by DM5/S&D banks. This follows the existing alphabetical override rule. Regeneration
alone therefore cannot promise DM2's 8.20 MB bank is its only texture download.

The required client change was explicit companion-bank loading and consistent preference
for the active map's copy, preserving intentional overrides and working across
map switches. Gameplay assets remain separate. Validate cold HTTP traces and
visuals for all five maps before claiming the intended first-map savings or
activating this layout on production. The implementation and follow-up results
are recorded below. Uploading unadvertised archives ahead of
release is possible; switch live client/manifest/index together after acceptance.

## Validation record

The investigation generated all five candidates and verified ZIP CRCs, copied
asset hashes, selected shader hashes and unchanged BSP hashes. Five existing
extraction tests passed. This task adds policy/index filtering and master-source
rebuild coverage. Installed locally: all five banks, with the master SHA-256
unchanged (`7d0cde57553b3b6ebeaab26eadc66456fe0f7685563317c4d0e438a53c4af57f`).
The live manifest/index validate with 16 packages, five maps, 1,669 file entries
and 302 shader entries; no owner points to the master. The release build contains
the five banks and omits the master. The previous metadata backup is
`.cache/per-map-texture-install/backups/1792698974682/`; the install receipt is
`.cache/per-map-texture-install/install.json`.

Commands and results:

```text
npm.cmd run test:run -- src/cli/__tests__/pk3-package-policy.test.ts src/cli/__tests__/map-media.test.ts src/engine/loader/pk3/__tests__/PK3PublishedIndex.test.ts
  PASS: 20 tests before adding the master-source integration test.
npm.cmd run test:run
  FAIL: 688 files passed, one failed; 5502 tests passed, one failed, one skipped.
  RemoteWeaponLeak.test.ts timed out in the first mocked weapon attachment's
  vi.waitFor. That fixture mocks ModelLoader; it does not read the PK3 packages.
  The full suite ran concurrently with packaging/build work. Timing contention
  is a possible cause, not established proof; the full suite is not called green.
npm.cmd run test:run -- src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts src/cli/__tests__/pk3-package-policy.test.ts
  PASS: all nine tests in isolation, including all three package-policy tests.
npm.cmd run typecheck
  PASS after correcting test binary-write types.
npm.cmd run gate:biome
  PASS: zero errors, 47 warnings (at baseline).
npm.cmd run build
  PASS: regenerates local metadata; ignored master absent from dist/data.
npm.cmd run tools:textures:audit
  PASS: 16 packages, 901 unique source textures; no cache re-encoding.
npm.cmd run docs:build
  PASS.
npm.cmd run test:simulation
  PASS.
npm.cmd run test:physics
  PASS.
npm.cmd run server:tick
  PASS, determinism checksum 2768943778.
npm.cmd run server:fuzz -- --ticks 1000
  PASS, determinism checksum 3298197053.
npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; bsp load washoi_dm5; bsp info; bsp load washoi_dm11; bsp info; bsp load washoi_amphi1; bsp info; bsp load washoi_snd1; bsp info; quit"
  PASS: all five BSPs resolved through the index.
git diff --check
  PASS.
```

Logs: `.cache/per-map-texture-install/` and the initial full-suite log at
`.cache/per-map-texture-investigation/full-tests.log`. The first typecheck found
the test fixture's Buffer/ArrayBufferView mismatch; tests now write Uint8Array.
The packaging-only phase did not edit runtime code or FPS submodule files.

Headless Edge/WebGL2 cold background renders passed for all five maps, using a
fresh browser profile per map and the repository's GPU-enabled CDP driver:

| Map | Texture banks actually loaded |
| --- | --- |
| DM2 | DM2, DM5, S&D1 |
| DM5 | DM5, S&D1 |
| DM11 | DM11, DM5, S&D1 |
| Amphi1 | All five |
| S&D1 | S&D1 |

None downloaded the master; all had zero HTTP failures and no logged errors or
exceptions. Two DM5 warnings and one Amphi warning remain in the saved raw report.
This confirms rendering with the installed banks, and also confirms that
regenerating metadata alone does not achieve one-bank-per-map downloads. The
probe runs background rendering without gameplay entities, not a full match or
a map-switch test. No WebGPU or production-mirror acceptance was performed.

Browser command: `node .cache/per-map-texture-install/browser-probe.mjs`.
The probe reuses the existing `.cache/media-fixture.ts` and
`.cache/cartoon-probe.html` fixtures. Measurements, browser diagnostics and
screenshots are `.cache/per-map-texture-install/browser.json`, `browser.log`
and `washoi_<map>.png` in that directory. Three screenshots (DM2, Amphi1, S&D1)
were inspected visually after the automated checks.

Changed source/documentation files:

- `config/pk3-packages.json`
- `src/cli/pk3-package-policy.ts`
- `src/cli/__tests__/pk3-package-policy.test.ts`
- `src/cli/pk3-index-build.ts`
- `src/cli/generate-pk3-index.ts`
- `src/cli/map-media.ts`
- `scripts/convert-ktx2.js`
- `vite.config.ts`
- `docs/manual/guides/pk3-filesystem.md`
- `docs/changelog/v1.0.0-alpha.md`
- `docs/research/per_map_texture_packages.md`

## Client routing follow-up

`MapLoader` explicitly ensures the indexed `tex_<map>.pk3`, validates its map
manifest, and builds a temporary ownership scope from that bank's actual files
and parsed shader names. Only exact companion names for other indexed maps are
excluded. This preserves unrelated shared packages and user override packages,
including overrides that shadow the filename of an earlier shader file.

`PK3Index` resolves assets/shaders through the scope without modifying or
serializing it into the published snapshot. `PK3Loader` hides inactive peer banks
from its file view while retaining downloaded archives for reuse. Its filesystem
revision invalidates the shader registry; shaders load in owning-package order.
Clearing/leaving a map and failed loads clear the scope. Missing companions use
the legacy path; malformed or failed advertised companions fail the map load.

The existing global KTX2 cache assumes same-path copies share artwork; all five
banks were generated from the same master and duplicate bytes are unchanged.
Rebuild sidecars when source artwork changes. This change does not introduce
independent per-map variants of the same canonical KTX2 path.

Headless scope tests cover file/shader A→B→A switching, hidden peer-only assets,
unchanged published ownership, user override priority, exact companion HTTP
requests, legacy fallback and rejection of a wrongly labelled bank. The initial
new tests needed fixture corrections for the snapshot export timestamp and URL
fetch setup; the final focused set passed all 34 tests across six files.

Additional runtime files:

- `src/engine/loader/map/MapLoader.ts`
- `src/engine/loader/pk3/PK3PackageScope.ts`
- `src/engine/loader/pk3/PK3Index.ts`
- `src/engine/loader/pk3/PK3Loader.ts`
- `src/engine/loader/shader/Q3ShaderRegistry.ts`
- `src/engine/loader/pk3/__tests__/MapTextureScope.test.ts`

Before the billboard extension, the full suite passed 5,507 tests with one
skipped. Cold WebGL2 probes loaded exactly the selected map bank for all five
maps; warm DM2 → S&D1 → Amphi1 → DM2 reused cached banks. Logs and browser
captures are in `.cache/map-texture-scope/`.

## Shared billboard exception: implemented locally

Use texture prefixes rather than ignored map names: any map using an ad gets
the shared dependency, including future maps. All 20 master files under
`textures/billboard/` are in `tex_billboard.pk3` and absent from map archives.
Shader definitions stay in each map bank so animations and material bindings
keep working. DM2's permanent gold logo/neon assets outside this folder stay in
its own bank. DM5, DM11, Amphi1 and S&D1 declare the shared dependency; DM2 does
not. Dependency discovery follows actual collected assets, not the recipe's
informational map list.

| Final local texture bank | Bytes |
| --- | ---: |
| `tex_billboard.pk3` | 2,965,918 |
| `tex_washoi_dm2.pk3` | 8,202,540 |
| `tex_washoi_dm5.pk3` | 59,010,301 |
| `tex_washoi_dm11.pk3` | 48,548,353 |
| `tex_washoi_amphi1.pk3` | 8,097,986 |
| `tex_washoi_snd1.pk3` | 57,523,272 |

The shared builder applies nine configured PNG replacements from
`assets/billboards/`, preserves the other master frames/overlays and includes
attribution and a checksum ledger. It validates dimensions, ZIP CRCs, each
output entry and the unchanged master; previous output is archived by SHA256.
The master remains 122,191,156 bytes with SHA256
`7d0cde57553b3b6ebeaab26eadc66456fe0f7685563317c4d0e438a53c4af57f`.
The installed billboard archive's SHA256 is
`93485ded18d2abd22472ea8b3489124a1cdba582d24d6d86a7b1fa6e07fbfe78`.
Installation receipts/backups are in `.cache/billboard-split/`. All five BSP
hashes stayed unchanged. Regenerated metadata publishes 17 packages, 1,670 files,
302 shaders and five maps.

For an artwork update, keep the existing paths and dimensions, edit the source
PNGs, then run:

```powershell
npm.cmd run tools:billboards
npm.cmd run tools:manifest
```

Upload `tex_billboard.pk3`, `pk3_manifest.json` and `pk3_index.json` consistently
to the production origin and mirror. Reload the game. No map bank rebuild is
needed for these image-only updates. Shader/animation changes still require
rebuilding affected map banks. `tools:branding` retains the legacy workflow for
patching all configured branding into the master, including DM2's static art.
This is a packaging workflow, not an in-game upload backend or live ad swap.

Dynamic dependencies use the published index timestamp as a URL query revision,
including same-size replacements. The client loads the shared bank explicitly
and reuses it across map switches. Dynamic prefixes bypass KTX2 sidecars, and
the converter omits them, so old globally cached compressed images cannot cover
new ad artwork. Other texture paths retain their existing sidecar behavior.

Additional changed files for this exception:

- `config/billboard-package.json`
- `scripts/package-billboard-bank.mjs`
- `src/cli/__tests__/billboard-bank.test.ts`
- `src/engine/loader/pk3/PK3TextureLoader.ts`
- `package.json`
- `assets/billboards/README.md`

### Final validation

The final shared-layout pass ran `npm.cmd run typecheck`, `npm.cmd run build`,
`npm.cmd run docs:build` and `npm.cmd run gate:biome` successfully (Biome: zero
errors, 47 existing warnings). `npm.cmd run tools:textures:audit` reports 17
packages and 881 unique source textures, excluding the 20 dynamic billboard
textures. No compressed texture regeneration was needed for the exception.

Required loader regressions passed:

```powershell
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; bsp load washoi_dm5; bsp info; bsp load washoi_dm11; bsp info; bsp load washoi_amphi1; bsp info; bsp load washoi_snd1; bsp info; quit"
```

The first shared-layout full run had 5,510 passes, one skip and two failures:
the intermittently slow mocked weapon test and a new same-size-update fixture
that had not exported regenerated metadata. The fixture now publishes its
updated timestamp; a focused rerun passed all 14 scope/builder/weapon tests:

```powershell
npm.cmd run test:run -- src/engine/loader/pk3/__tests__/MapTextureScope.test.ts src/cli/__tests__/billboard-bank.test.ts src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts
```

The final `npm.cmd run test:run` passed all 691 files: 5,512 tests passed and one
skipped (241.63 seconds). This supersedes the failing run above after the fixture
correction; the earlier intermittent mocked-weapon failure remains recorded.
The PowerShell `*>` logging wrapper returned 1 after treating native stderr as
`NativeCommandError`; Vitest itself reports no failed files/tests or unhandled
error summary. The saved log preserves both the wrapper diagnostic and totals.
`git diff --check` also passed. Release output contains the shared billboard
bank and omits the retained development master.

Final-layout browser command: `node .cache/billboard-split/probe.mjs`, using a
private Vite server and fresh headless Edge/WebGL2 profile per cold load. Warm
DM2 → S&D1 requested only the new map/bank and versioned billboard bank;
S&D1 → Amphi1 reused the billboard archive; returning to DM2 made no archive
requests. Dynamic ad paths produced no KTX2 sidecar requests. Cold loads of all
five maps passed, each with only its own bank plus its declared shared
dependency, no master/foreign bank and no HTTP failures. These are background
map-render probes rather than complete gameplay sessions.

Logs are in `.cache/billboard-split/`; the final full-suite log is
`final-tests.log`, and the request/diagnostic receipt is `browser.json`.
Production CDN cache headers, WebGPU and full multiplayer playtesting remain
unverified by the local validation above.

## Production pre-upload — 2026-10-22

At the user's request, the six final texture banks were uploaded over SCP to
`root@washoi.net`, staged under
`/srv/washoi/assets/staging-texture-banks-20261022/`, and SHA-256 verified before
installation. They were added with `washoi:washoi` ownership and mode 0644 to
both `/srv/washoi/assets/data/` (persistent source) and
`/srv/washoi/releases/game/data/` (currently served). No existing package was
replaced. The public source symlink was preserved.

All six `https://eu.washoi.net/data/<filename>` responses returned HTTP 200 and
matched the local sizes and SHA-256 hashes. The before/after checksums of
`pk3_manifest.json` and `pk3_index.json` in both directories are unchanged.
No client build, service restart or forced deployment was performed. The live
client therefore continues using its existing published package ownership.
No separate PK3 mirror was configured in the inspected host runbook/serving
setup; the verified upload is to the EU origin.

Release still needs the updated client/package-policy code and regenerated
`pk3_manifest.json` plus `pk3_index.json`, generated from the production asset
directory. Keep the master available during the older-client transition.
The server runbook `/srv/washoi.md` records this pre-upload. Local HTTPS receipt:
`.cache/billboard-split/production-upload.json`; remote checksum receipt:
`/srv/washoi/assets/staging-texture-banks-20261022/upload.sha256`.
