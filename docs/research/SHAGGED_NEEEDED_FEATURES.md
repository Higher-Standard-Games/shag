# SHAGGED needed features: Amphi mapping experiment

Started 2026-10-16. This is a running record of limitations encountered while using SHAGGED and its MCP API to plan and build an Amphi arena at `wamphi1` scale, with `wfdm5` materials and the supplied industrial arena references.

Record each obstacle when encountered: reproduction or source evidence, impact, workaround, and proposed improvement. Distinguish observed tool failures from capabilities missing from the exposed API. Do not treat an untested idea as a confirmed editor bug.

## Initial findings

### 1. Inspect an existing compiled map and obtain its material palette

**Status:** confirmed MCP capability gap during reference investigation. **Priority:** useful for reference-driven mapping.

`shagged_map_info` reads managed editor documents; the exposed MCP tools do not inspect an arbitrary installed BSP. Calling `shagged_textures` with `search: "wfdm5"` returned zero entries because texture search matches the catalog, not map usage.

**Impact:** matching the scale and materials of an existing map requires a separate inspection step. A zero-result map-name search can misleadingly suggest that its assets are unavailable.

**Workaround used:** load `wamphi1` and `wfdm5` through `resolveMapBspViaIndex` and `BspLoader`, then collect face `textureIndex` references. The world envelope of `wamphi1` is 2304 x 2304 units; its full vertical bounds include space that must not be assumed to be playable. MCP subsequently resolved `concrete/concretebunker0068` as a 512 x 512 material successfully.

**Proposed improvement:** a read-only installed-map inspection tool returning bounds, spawns, entity classes and used shaders with face counts. Keep it on the game's indexed package resolution path. A map-palette filter could reuse that result.

### 2. Author non-axis-aligned geometry through typed operations

**Status:** confirmed API capability gap during layout planning; no attempted build has failed. **Priority:** needed for a faithful version of the reference layout.

The `EditOp` union exposes axis-aligned boxes, room/corridor/stair generators and box carving. It has no brush rotation, arbitrary convex-brush creation or patch-creation operation. Existing patches can be moved, duplicated and deleted. The editor guide documents patch authoring in the UI, so patch creation is specifically an API gap; arbitrary convex brushes require broader geometry support.

**Impact:** the reference's octagonal reactor platform, diagonal bridges and curved reactor cannot all be authored faithfully with the current MCP operations.

**Workaround:** use rectangular proxies for the first movement greybox, or author supported curves in the UI. Record any manual intervention. Do not silently bypass the typed API by injecting custom document data.

**Proposed improvement:** expose validated patch creation and suitable shape generators first; evaluate convex brushes and rotation separately against the document/export representation. Keep decorative curves separate from simple gameplay collision.

### 3. Discover prop models through MCP

**Status:** confirmed MCP discovery gap during planning of the dressing pass. **Priority:** needed before detailed prop placement.

The live MCP tool list includes texture and entity-class discovery but no model catalog. The editor has a model browser, as documented in the editor guide. Generic entity placement exists; absence of discovery does not imply that model placement is unsupported.

**Impact:** choosing actual packaged barrels, crates and pipes requires leaving MCP discovery or guessing asset paths and scale.

**Workaround:** inspect the editor model browser or package contents before placing model entities. Model placement, scale and compiler collision behavior have not yet been tested in this experiment.

**Proposed improvement:** expose searchable model paths and available bounds/dimensions, with supported placement keys and clear compiler collision guidance. Verify compiler behavior before promising any collision setting.

## Verified starting point and implementation order

- The local stdio MCP server connects successfully and lists its tools and existing maps. No existing map document was changed.
- `wamphi1` was loaded headlessly using the indexed BSP loader. Its outer square envelope supplies a scale reference; traversal distances and usable tiers still need measurement and playtesting.
- `wfdm5` uses materials including `concrete/concretebunker0068`, `tiles/concrete_tiles`, `bricks/redbricks_base_01`, `metal/metalrust_iron6` and `grates/fence01`. These are source-map usage findings, not a completed new-map palette review.
- Next: settle the greybox layout, create an isolated experiment map, apply typed MCP batches, compile and run the map report before visual testing. Then add materials, lighting and props, logging further obstacles here as they occur.
- Preserve a checkpoint at each playable stage. Validate collision and visibility costs before expanding decorative geometry.

## Evidence

- [SHAGGED API guide](../manual/guides/shagged-api.md)
- [SHAGGED editor guide](../manual/guides/shagged-editor.md)
- MCP tools and schemas: `src/cli/shagged-mcp.ts`
- Typed edit operations: `src/engine/editor/api/Operations.ts`
- Texture lookup: `src/engine/editor/server/TextureLookup.ts`
- BSP loading and face definitions: `src/engine/loader/bsp/BspLoader.ts`
- Indexed map resolution: `src/engine/loader/pk3/NodePk3.ts`

No gameplay, renderer or editor implementation changed during this initial investigation. Compilation and in-game quality of the proposed arena remain unverified.

## Experiment log: solamphi1

### Curved authoring: implemented

`patch.create` now exposes the existing validated patch representation through typed operations and MCP. Focused tests cover export, caller-data isolation, duplicate IDs and atomic rejection of malformed grids. Engine checkpoint: `d9c6bd9c`. Four reactor quarter-cylinder patches were successfully authored through MCP. Convex brushes and rotation remain separate open needs.

### Brush grouping and compiler chamfers: existing API works

Inspected `Desktop/warfork-maps/maps/wfdm5.map`: entity 505 is a `func_group` with `chamfer_concavewidth "5"`, `chamfer_convexwidth "2.2"` and `targetname "func_group1"`. The file also uses `smooth` on model entities; this is a different setting. The bundled compiler README documents both group chamfer keys and model smoothing.

`brushEntity.assign` already exports `func_group` and its arbitrary keys, so a second grouping operation is unnecessary. The experiment assigns decorative trim to a compiler group. Map Health reports `func_group` as an informational unknown class because it is absent from the entity catalog: expose this compile-only class and its keys in discovery/inspector documentation when extending that catalog.

**Workflow finding:** the compiler's `fast` recipe explicitly disables edge chamfering. Use `default` or `release` to review softened edges. Fast builds remain useful for movement iteration.

### Tool shader names: inspect mounted media

The detail health check rejected `common/clip`, which is absent from this media catalog. Available choices include `common/fullclip`, `common/playerclip` and `common/nowalljumpclip`. The reactor and prop proxies use `common/fullclip`. This was an authoring assumption caught by validation, not evidence of a broken shader catalog.

### Decorations must pass reachability again

The greybox passed player and bot reachability: four spawns, four items, no disconnected spawns or unreachable items. The first detailed revision placed continuous gallery railings across stair landings; the report correctly marked upper armor unreachable from every spawn. Openings were added at those landings. Every decorative pass must rerun movement checks, even when the structural layout is unchanged.

### ASE model compatibility: open

The wfdm5 source references many `.ase` props. `ModelReference.ts` accepts MD3, GLB, glTF and OBJ paths but excludes ASE. Existing OBJ industrial barrels and crates were selected for this pass. Before widening the accepted extensions, verify compiler support, editor preview expectations and asset dependency handling; do not claim ASE is usable merely because the external source map uses it.

### Worldspawn authoring: open

The reference map sets worldspawn lighting, fog and color-correction keys. `EditorDocumentData` has no worldspawn key map, and `MapWriter` emits only its classname. Generic point-entity placement explicitly rejects worldspawn. The experiment can place colored lights, but cannot reproduce those global settings through MCP. Proposed addition: validated worldspawn key editing, preserved through document save/export and displayed in map inspection. Do not inject a second worldspawn entity as a workaround.

### Native compiler profile lookup: fixed

The initial GPU review showed no expected prop geometry. Capturing the complete native MakeBSP output revealed a missing `tools/makebsp/makebspdata/washoi.json`; setting cwd to the tracked profile directory did not affect lookup. The compiler silently used QFusion defaults, searched `public/data/basewf`, parsed zero shader files and could not open any of the 16 model instances. Preflight had correctly found those assets in the media root, but its search path differed from the fallback compiler path.

`resolveCompilerConfig` now deploys the tracked profile beside repository-local binaries and checks adjacent profiles for external tools without writing to external installations. Tests cover profile deployment, refreshing its contents and rejecting an external configuration where only cwd contains the profile. Engine checkpoint: `7f0bc404`.

After rebuilding, indexed BSP inspection found 12 barrel surfaces and four crate surfaces using their actual model materials. Player and bot reachability both passed. **Remaining improvement:** compile reports should expose native warning counts and durable full logs; missing-profile/model-load warnings should prevent a misleading successful publication.

### Material scale is easy to overlook

`box.create` and generators use the legacy matrix: one repeat per 32 world units, regardless of image dimensions. The first GPU overview showed excessively fine-grained brick and floor detail. Applying `face.material` with catalog image sizes uses natural alignment and restored the intended visual scale. This works through the existing API, but should be easier to discover or select when generating textured geometry.

### Build cache does not identify compiler/media changes

Published-build reuse checks document source bytes and quality, not compiler/profile/media contents. After installing the correct profile or updating a prop archive, unchanged source can still reuse an obsolete build. This experiment changed authored source and/or quality before rebuilding. A compiler/media fingerprint or explicit force-rebuild option is needed for reliable iteration on assets and toolchain configuration.

### Open-sky city pass: validated

Used wfdm5's `sky/stars` material on a larger sealed scenery shell, removed the arena ceiling and shortened its enclosing facades. Player-clip brushes preserve the arena boundary above those facades. Sixteen exterior buildings create a skyline beyond the fighting footprint. They are authored geometry, not an enlargement of the intended arena routes.

Final normal-quality build: `map_solamphi1_00008.pk3`, BSP SHA-256 `1faee40a9da731bc8c0b6ebaab098b6c75098850b0bfdcdb4227698bfcc6298c`. No leak; all four spawns and four items connected in player reachability, with bot navigation also passing. The document has 382 brushes, 28 patches and 20 prop-model instances. This demonstrates a working end-to-end MCP authoring loop; it does not establish combat balance or exhaustive collision quality. Reproduction, exact changed files and validation commands are in `experiments/shagged/solamphi1/`.

### Lobby discovery of compiled maps: fixed, 2026-10-17

Adding the arena to the Amphi pool exposed an integration gap: the lobby's installed-package filter treated `map_solamphi1_00008.pk3` as map `solamphi1_00008`, while SHAGGED publishes a BSP named `solamphi1`. The disk filter now recognizes the base name of numbered packages as well as ordinary package names. The Amphi advertisement test covers an installed numbered build and missing maps. Pool membership remains explicit in `config/maps.json`, read at lobby startup; publication does not choose a gametype or automatically edit the pool.
