# Deluxe Map Support Research

## Scope

This note investigates whether SHAG currently supports Warsow-style deluxe and normal map workflows for BSP maps, and what would be required to reach closer parity.

This research is based on local source and docs only. No external Warsow/QFusion sources were consulted for this pass.

## Working Definition

For this document, "deluxe support" means more than just loading `_norm` textures:

- Warsow/QFusion shader conditionals like `if ! deluxe` / `if deluxe`
- The `material` directive used in deluxe paths
- Shader-driven use of diffuse, normal, gloss, and glow companions
- Lighting that does more than classic `base * lightmap`

## Corpus Audit Findings

This section is based on the actual local Warsow asset set under:

- `public/data/`
- `public/data/pk3_manifest.json`

### Asset Availability

The local workspace does contain the real PK3 corpus needed for implementation research.

Notable findings:

- shader-bearing PK3s are present locally
- the heaviest shader package in the local set is `data0_21pure.pk3`
- texture packs like `tex_boqu.pk3`, `tex_blx.pk3`, `tex_factory.pk3`, `tex_lights.pk3`, and others contain additional `.shader` files

### Real Deluxe/Material Usage Exists

A corpus scan across local `.shader` files found:

- 13 files with both `if deluxe` and `if ! deluxe`
- 2 files with `if deluxe` only
- 31 files with `material` usage but no deluxe conditionals
- 15 files where conditionals and `material` appear together

This confirms that deluxe support is not hypothetical in this project's local asset set.

### `material` Arity Is Variable

Real `material` directives in the local corpus use variable argument counts:

- 1 arg: 187 occurrences
- 2 args: 123 occurrences
- 3 args: 203 occurrences
- 4 args: 86 occurrences
- 5 args: 6 occurrences

Implication:

- we should not model `material` as a rigid 4-slot structure only
- we need both normalized known slots and raw token preservation

### Placeholder and Special Tokens Are Common

Observed special tokens in real `material` directives:

- `-` appears 26 times
- `$blankbumpimage` appears 85 times
- `$whiteImage` appears 10 times

Implication:

- placeholder tokens are part of the real authoring style
- parser and resolver logic must preserve and interpret placeholders rather than dropping them

### `material` Is Not Just For BSP Deluxe Lights

Real local uses include:

- classic deluxe branches on BSP textures
- model/material definitions in files like `scripts/mapobjects.shader`
- item/model shaders like `scripts/ammobox.shader`
- world/water-style shaders in `scripts/world.shader`

Implication:

- whatever we implement should avoid being BSP-only at the parser/type level
- BSP map rendering may be the first consumer, but the syntax itself is broader

### Concrete Local Examples

Examples found in the local corpus:

- `public/data/tex_boqu.pk3` → `scripts/boqu.shader`
  - includes `textures/boqu/lightstripe_blue_800`
  - has real `if ! deluxe` and `if deluxe` branches
  - deluxe branch uses:
    - `material textures/boqu/lightstripe_blue.tga textures/boqu/lightstripe_norm.tga textures/boqu/lightstripe_gloss.tga textures/boqu/lightstripe_blue_glow.tga`

- `public/data/data0_21pure.pk3` → `scripts/ammobox.shader`
  - uses both deluxe conditionals and `material`
  - includes a stage like:
    - `material models/objects/misc/ammobox.tga models/objects/misc/ammobox_norm.tga`
  - stage also carries `rgbGen` and `blendFunc`

- `public/data/data0_21pure.pk3` → `scripts/mapobjects.shader`
  - contains `material` usages outside deluxe conditionals
  - includes 1-arg, 2-arg, 3-arg, and 4-arg forms
  - includes cases where `material` is combined with `rgbGen`, `tcMod`, or `blendFunc`

- `public/data/data0_21pure.pk3` → `scripts/world.shader`
  - includes examples like:
    - `material $whiteimage textures/world/water/norm textures/world/water/wat_gloss`
    - `material $whiteimage $blankBumpImage textures/world/water/wat_gloss`

- `public/data/tex_boqu.pk3` → `scripts/boqu.shader`
  - also contains incomplete or shorthand-looking deluxe forms such as:
    - `material textures/boqu/biglightfloor`
    - `material`

Implication:

- some material directives are fully populated
- some are partial
- some appear intentionally placeholder-based
- some may rely on engine or qfusion conventions rather than explicit full paths

## Executive Summary

SHAG has partial support for Warsow-style material companions, but not full deluxe-map support.

What works today:

- FBSP/Warsow BSP loading is implemented.
- Classic baked lightmaps are implemented.
- BSP surfaces can auto-load companion normal maps (`_norm`, `_normal`, `_bump`).
- Generic texture loading can auto-load `_norm` and `_gloss`.
- Runtime controls exist for `r_normalmap`, `r_glossmap`, and `r_lightmap`.
- BSP lighting mode intentionally keeps a directional sun active so normal maps have visible relief.

What does not work today:

- `if deluxe` / `if ! deluxe` branches are not modeled or selected at runtime.
- The Warsow `material` directive is only partially recognized and its extra payload is not carried into rendering.
- BSP surface assignment does not currently load gloss companions the same way the generic texture path does.
- No explicit deluxe-lighting data path exists in the BSP loader; the loader only parses RGB lightmaps from the lightmap lump.

## Outcome Update

After implementation and live in-game validation on `wdm2` and `wdm15`, the practical outcome is better than the earlier research summary suggested.

What ended up working:

- `r_deluxe 1` as the default BSP branch-selection mode
- generated BSP `PBRMaterial` path behind `r_bsp_pbr 1`
- structured and implicit Warsow material resolution flowing into BSP material creation
- correct handling of `lightmapIndex = 0`
- `_gloss` treated more like glossiness/spec-gloss data than pseudo-metalness

The key material-model adjustment was:

- keep `metallic = 0`
- use `_gloss` primarily through Babylon's `microSurfaceTexture` path
- keep the surface in a spec/gloss-like response rather than pretending `_gloss` is a metallic/roughness map

This produced the first visually successful result on both:

- `wdm2`
- `wdm15`

Important dead end:

- a custom rich BSP shader experiment over-brightened real scenes and was reverted

Current practical assessment:

- companion-map support: good
- deluxe/material parsing and resolution: good
- BSP PBR/spec-gloss translation for Warsow materials: good enough to keep as the default path
- true Warsow deluxe-light parity: still not proven or claimed

## Key Conclusion

We should not treat "normal map support" and "deluxe support" as the same thing.

Current SHAG behavior is closer to:

- classic BSP lightmaps
- plus optional companion normal maps
- plus a fixed directional sun

Inference from the renderer and lighting code:

- This can produce believable normal-mapped relief on some surfaces.
- It is not the same as a Warsow deluxe path that selects deluxe-aware shader branches and uses structured material metadata.

## Evidence From Source

### 1. BSP lightmaps are implemented

`BspLoader` parses Quake 3 / FBSP lightmaps as raw RGB data:

- `src/engine/loader/bsp/BspLoader.ts`
- `lightmaps: Uint8Array[]`
- `parseLightmaps(lightmapSize)`
- `LIGHTMAP_BYTES = lightmapSize * lightmapSize * 3`

`BspMeshBuilder` applies those lightmaps through Babylon's lightmap path:

- `src/engine/loader/bsp/BspMeshBuilder.ts`
- `mat.lightmapTexture = lightmapTex`
- `mat.useLightmapAsShadowmap = true`

This is solid support for classic baked lightmaps.

### 2. BSP surfaces can auto-load companion normal maps

`BspMeshBuilder` looks for normal companions when assigning BSP textures:

- `src/engine/loader/bsp/BspMeshBuilder.ts`
- suffixes: `_norm`, `_normal`, `_bump`
- result: `mat.bumpTexture = normalTex`

This means BSP surfaces can get normal-mapped detail without any deluxe-aware shader parsing.

### 3. Generic texture loading supports normal and gloss companions

`TextureManager` has explicit companion-map loading:

- `src/engine/loader/texture/TextureManager.ts`
- `_norm` loads into `material.bumpTexture`
- `_gloss` loads into `material.specularTexture`

`PK3TextureLoader` also groups diffuse textures with `_norm` and `_gloss` companions:

- `src/engine/loader/pk3/PK3TextureLoader.ts`

This is real support, but it is generic companion-map support, not proof of deluxe-path support.

### 4. Render variables expose normal, gloss, and lightmap controls

`RenderVars` defines:

- `r_normalmap`
- `r_glossmap`
- `r_lightmap`

and applies those multipliers to:

- `bumpTexture.level`
- `reflectivityTexture.level`
- `lightmapTexture.level`

Files:

- `src/engine/rendering/RenderVars.ts`
- `docs/manual/guides/render-variables.md`
- `docs/manual/tutorials/beginner/render-variables.md`

### 5. BSP mode intentionally uses a fixed directional light for normal maps

`MapLoader` and `SkyLightSystem` explicitly describe BSP mode as:

- directional sun for normal maps
- neutral ambient for lightmaps

Files:

- `src/engine/loader/map/MapLoader.ts`
- `src/engine/lighting/SkyLightSystem.ts`

Inference:

- The current engine expects normal maps on BSP surfaces to react to a global directional light.
- That is different from a richer deluxe path where shader data may select different materials or lighting behavior.

### 6. The parser does not currently model deluxe branches

There is no actual `deluxe` branch-handling logic in `Q3ShaderParser`.

What the parser does have:

- template expansion
- stage parsing
- a partial `material` case

What it does not have:

- `if deluxe`
- `if ! deluxe`
- `endif`
- any runtime feature selection for deluxe vs non-deluxe stage sets

Files:

- `src/engine/loader/shader/Q3ShaderParser.ts`
- `docs/changelog/v0.8.5.md`
- `docs/research/NODEMATERIAL_GLOW_OVERLAY_PLAN.md`

Existing repo notes already call this out:

- `if ! deluxe` / `if deluxe` blocks are merged incorrectly
- the `material` directive used in deluxe lighting paths is not supported

### 7. The `material` directive is only partially recognized

Current parser behavior:

- `case "material"` sets `stage.map` from the first parameter
- it then skips an optional additional token
- comment says "store but don't use yet"

Files:

- `src/engine/loader/shader/Q3ShaderParser.ts`

Important limitation:

- `Q3ShaderStage` does not currently have structured fields for deluxe material payload such as normal, gloss, or glow texture references.
- `ResolvedMaterialProps` similarly centers on diffuse, lightmap, alpha, culling, and animation metadata, not deluxe material sets.

File:

- `src/engine/loader/shader/Q3ShaderTypes.ts`

### 8. Material routing is pattern-based, not deluxe-aware

`Q3ShaderMaterialFactory` detects patterns like:

- `base_only`
- `base_lightmap`
- `glow_overlay`
- `nolightmap_emissive`
- `complex`

It does not model:

- deluxe branches
- a structured material payload from `material`
- a deluxe-specific material strategy

File:

- `src/engine/loader/shader/Q3ShaderMaterialFactory.ts`

### 9. BSP-specific assignment currently stops at normals

In the BSP path, `BspMeshBuilder` loads normal companions, but there is no comparable `_gloss` load in that same surface-texture assignment path.

By contrast, the generic texture path does handle `_gloss`.

Practical effect:

- map surfaces may get some normal-map relief
- gloss/specular parity is weaker on BSP geometry than in the generic material pipeline

## What This Means In Practice

Right now SHAG can likely make some Warsow surfaces look better than plain Quake 3 rendering by combining:

- diffuse texture
- baked lightmap
- optional normal companion
- a fixed directional sun

That is useful, and likely explains why some maps already look "close enough" in casual testing.

But it is still not strong evidence of true deluxe support, because the current system:

- does not parse deluxe conditionals
- does not preserve deluxe material metadata
- does not route BSP materials through a deluxe-aware shader model

## Tension In Existing Docs

Older repo research already says:

- `Normal/gloss maps | Complete | Auto-loads _norm, _gloss`

Source:

- `docs/research/BSP_SUPPORT_INVESTIGATION.md`

That statement is directionally true for the engine as a whole, but it overstates the current BSP-deluxe story.

More precise wording would be:

- companion normal/gloss map support exists in parts of the engine
- BSP map rendering does not yet implement full Warsow deluxe shader behavior

## Gaps To Close

### Gap 0. We do not yet have a local asset corpus for this feature

This gap is now partially closed.

We do have a local shader corpus and confirmed real deluxe/material usage in `public/data`.

Remaining corpus gap:

- we still need a curated acceptance set of the most important affected shaders/maps for implementation validation
- we should capture a short fixture list rather than relying on ad hoc examples

### Gap 1. No conditional shader AST

Today the parser flattens stages into one list. That makes it impossible to cleanly represent:

- `if ! deluxe`
- `if deluxe`

We need either:

- a small AST for conditionals, or
- a preprocessing step that resolves conditionals before stage parsing

### Gap 2. No structured `material` payload

The parser should preserve more than just the first texture token from:

```shader
material textures/foo.tga textures/foo_norm.tga textures/foo_gloss.tga textures/foo_glow.tga
```

We likely need a dedicated structure such as:

```ts
interface Q3MaterialDirective {
  diffuse?: string;
  normal?: string;
  gloss?: string;
  glow?: string;
}
```

But there is an important caveat:

- we should not assume up front that every `material` directive always provides exactly four payload textures in a fixed order

The parser and types should allow partial payloads and preserve raw tokens for safety, for example:

```ts
interface Q3MaterialDirective {
  rawTokens: string[];
  diffuse?: string;
  normal?: string;
  gloss?: string;
  glow?: string;
  extras?: string[];
}
```

and a place for it in either:

- `Q3ShaderStage`
- `Q3Shader`
- or both, depending on actual syntax usage

### Gap 3. No deluxe-aware resolved material props

`ResolvedMaterialProps` currently lacks fields for:

- normal texture path
- gloss texture path
- glow texture path
- deluxe enabled/disabled branch choice

Without those, later stages of the pipeline are forced back into filename guessing.

There is also a cache-design issue here:

- `Q3ShaderRegistry.resolveMaterialProps()` currently caches by `textureName` only

If deluxe branch selection affects resolved output, we cannot keep treating it as an unkeyed global runtime toggle. We will need one of:

- cache keys that include deluxe mode
- separate pre-resolved shader variants
- or load-time branch resolution with no hot switching

### Gap 4. BSP assignment is incomplete for gloss

The BSP surface path should be brought up to parity with the generic companion-map path:

- load `_gloss` / `_spec` when present
- apply consistent material property setup

But this needs one more decision first:

- what material model should BSP surfaces use when gloss is present?

Right now:

- generic texture loading can create richer texture sets
- BSP surfaces mostly use `StandardMaterial`
- `RenderVars` treats gloss differently for `StandardMaterial` vs `PBRMaterial`

So "support gloss on BSP" is not just a loader task. It is also a material-semantics task.

### Gap 5. No explicit deluxe lighting strategy

Even after parser work, we still need to decide what "deluxe" means at runtime in SHAG.

Possible interpretations:

1. Shader-level deluxe compatibility only.
   This means selecting the right branch and honoring `material` metadata, while continuing to use the current lightmap plus global directional-light approach.

2. Stronger lighting parity.
   This would require some form of deluxe-aware directional lighting beyond the current fixed sun.

Important note:

- The local code inspected for this research does not show an explicit deluxe-lighting data path in `BspLoader`.
- So any full-parity plan should be treated as a second phase until we inspect real asset expectations more closely.

## Implementation Options

### Option A. Minimal Compatibility Fix

Goal:

- render more Warsow shaders correctly with minimal architecture change

Changes:

- add conditional handling for `if deluxe` / `if ! deluxe`
- add structured parsing for `material`
- add `_gloss` support in BSP surface assignment
- keep current global-sun normal-map lighting model

Pros:

- low to medium risk
- likely fixes real shader breakage quickly
- preserves the existing renderer architecture

Cons:

- still not true deluxe-lighting parity
- risks more special-case code in parser and builder

### Option B. Better Shader Model

Goal:

- make deluxe-style data first-class in the shader pipeline

Changes:

- extend `Q3ShaderTypes` with conditional and material metadata
- teach `Q3ShaderParser` to preserve that structure
- extend `ResolvedMaterialProps`
- update `Q3ShaderMaterialFactory` and `BspMeshBuilder` to consume structured normal/gloss/glow inputs

Pros:

- cleaner architecture
- less filename guessing
- better base for future shader features

Cons:

- more refactor work up front
- requires touching several rendering files

### Option C. Full Deluxe Parity Track

Goal:

- pursue Warsow-like deluxe behavior, not just asset compatibility

Changes:

- everything from Option B
- plus investigation into whether SHAG needs a richer directional-lighting source than the current fixed BSP sun

Pros:

- strongest long-term parity story

Cons:

- highest uncertainty
- highest renderer risk
- should not start until Options A or B produce a solid baseline

## Holes In The Current Plan

### Hole 1. "Runtime feature flag" is underspecified

The current recommendation mentions:

- a runtime feature flag or resolver input for deluxe branch selection

That is too loose for the current architecture.

Because resolved material props are cached by texture name only, a true runtime toggle would imply:

- cache invalidation
- possible material rebuilds
- possible scene reapplication for already-built BSP meshes

Safer improvement:

- treat deluxe selection as a load/build-time resolver input first
- defer live hot-switching until there is a real use case

More concrete proposal:

- introduce `r_deluxe` as a persisted render cvar
- read it when BSP materials are built during map load
- do not live-update already-built materials when it changes
- require map reload for the new value to take effect

This matches the current architecture better than a true hot toggle.

### Hole 2. The plan skips branch precedence rules

We need a deterministic precedence model for surface texture selection.

Recommended precedence:

1. Explicit structured `material` payload
2. Explicit `map` stage texture
3. Suffix-based companion guessing (`_norm`, `_gloss`, etc.)

Without this, the implementation may accidentally mix parsed metadata with guessed metadata in inconsistent ways.

Also, precedence must account for partial directives:

- placeholders like `-`
- placeholder textures like `$blankbumpimage`
- shorthand one-arg `material` forms

So the actual resolver rule should be:

- use parsed structured values when present and meaningful
- treat placeholders as explicit "missing/blank" signals
- fall back only for truly absent channels, not for channels explicitly set to placeholder tokens

### Hole 3. The plan assumes parser work alone will unlock rendering

Even with correct parsing, we still need to decide how downstream systems consume the new data:

- `Q3ShaderRegistry`
- `Q3ShaderMaterialFactory`
- `BspMeshBuilder`
- possibly `Q3NodeMaterialBuilder`

This is really a parser-plus-resolution-plus-material-routing change, not just a parser change.

### Hole 4. The plan does not call out template interaction

This parser already supports Warsow template expansion.

So deluxe support must be verified in combinations like:

- template expands into conditional blocks
- template parameters feed `material`
- conditional branches contain stage stacks with glow/lightmap combinations

This is a likely source of regressions if we only test raw non-template shaders.

### Hole 5. The plan does not define the first consumer of structured material data

Once we parse `material`, who uses it first?

Possible first consumers:

- `Q3ShaderRegistry.resolveMaterialProps()`
- `BspMeshBuilder` directly
- `Q3ShaderMaterialFactory`

Recommended approach:

- let `Q3ShaderRegistry.resolveMaterialProps()` become the first normalizing layer
- downstream systems should consume normalized props instead of re-decoding raw shader stages independently

### Hole 6. Gloss support is underspecified for `StandardMaterial`

Adding `_gloss` discovery to BSP is not enough by itself.

Current behavior:

- `TextureManager` can assign `specularTexture`
- `RenderVars` for `StandardMaterial` mainly scales `specularPower`

So we need to explicitly define:

- whether gloss on BSP means `specularTexture`
- whether `r_glossmap` should affect `specularTexture.level`
- or whether deluxe-enabled BSP surfaces should move toward a PBR-backed path

Corpus finding that increases the importance of this hole:

- many real local `material` directives use 3-arg and 4-arg forms that appear to map naturally to diffuse + normal + gloss (+ glow)
- if we parse those correctly but do not define gloss semantics on the actual material type, we will only solve half the problem

### Hole 8. Path normalization is under-specified

Real local `material` lines include path forms with:

- no extension
- `.tga` / `.jpg`
- backslashes in some entries
- placeholders and engine tokens

So the implementation plan should explicitly normalize:

- slash direction
- extension stripping and probing
- placeholder token handling

before later resolution stages try to load textures

### Hole 7. Validation should include cache and fallback behavior

The existing validation plan covers parser and visual behavior, but not:

- cache correctness when deluxe mode differs
- fallback behavior when `material` is partial
- behavior when parsed metadata and suffix-discovery disagree

Those cases are likely bug sources.

## Recommendation

Recommend a phased approach:

### Phase 0. Audit actual affected assets

- collect real local shader examples from PK3 data or manifests
- classify usage patterns:
  - conditional only
  - `material` only
  - conditional plus `material`
  - glow/lightmap combinations
- use that corpus to confirm `material` arity and common payload order

Status after this research pass:

- partially complete
- confirmed real local usage and measured material arity
- still should produce a small named acceptance set before implementation

### Phase 1. Define resolution and caching strategy

- decide that deluxe selection is build-time, not live runtime, for the first implementation
- update cache strategy accordingly
- define precedence:
- explicit `material`
- explicit stage textures
- suffix-based discovery

### Phase 1.5. Define `r_deluxe` behavior explicitly

- add `r_deluxe` as a persisted `r_*` cvar
- initial semantics:
  - `0` = resolve non-deluxe branches
  - `1` = resolve deluxe branches
- first implementation behavior:
  - value is read at map/material build time
  - changing it after a map is loaded does not rebuild existing materials
  - user must reload the map for the change to apply
- recommended UX:
  - if changed while a BSP map is active, print a message that it applies on next map reload

### Phase 2. Make deluxe branches parseable

- add conditional support for `if deluxe` / `if ! deluxe`
- preserve branch structure long enough to resolve it intentionally
- support template-expanded conditional content in tests

### Phase 3. Make `material` first-class

- add structured material metadata to shader types
- preserve raw tokens as well as normalized fields
- propagate diffuse, normal, gloss, and glow paths through shader resolution
- preserve extras for 5-arg and future unknown forms
- normalize placeholder tokens explicitly

### Phase 4. Normalize through `ResolvedMaterialProps`

- make `Q3ShaderRegistry.resolveMaterialProps()` the main normalizing layer
- ensure downstream systems do not each invent separate deluxe heuristics
- add cache-aware tests for deluxe-resolved variants

### Phase 5. Bring BSP texture assignment to parity

- use parsed material metadata when available
- fall back to suffix-based `_norm` / `_gloss` discovery only when metadata is absent
- explicitly define gloss behavior for the material types BSP currently uses

### Phase 6. Re-evaluate lighting parity

- after Phases 0 to 5, compare visuals on known problem shaders and maps
- only then decide whether the current fixed directional sun is sufficient

## Suggested Validation Plan

If we implement this later, validate in this order:

1. Corpus-level verification
   - confirm the implementation covers the real local shader patterns we audited

2. Parser-level tests
   - verify `if deluxe` and `if ! deluxe` blocks resolve correctly
   - verify `material` captures all expected texture references
   - verify template-expanded deluxe content resolves correctly
   - verify variable `material` arity:
     - 1 arg
     - 2 args
     - 3 args
     - 4 args
     - 5 args
   - verify placeholder tokens like `-` and `$blankbumpimage`

3. Material-resolution tests
   - verify resolved props include diffuse, normal, gloss, and glow when provided
   - verify precedence rules
   - verify cache keys or cache invalidation behave correctly across deluxe variants
   - verify `r_deluxe` affects newly built materials but does not mutate already-built materials
   - verify path normalization for slash direction and extensionless paths

4. Headless engine regression
   - `npm run cli:game -- --exec "map wdm2; bsp info; quit"`
   - `npm run test:simulation`
   - `npm run test:physics`

5. Shader-focused visual checks
   - compare a known affected shader like `textures/boqu/lightstripe_blue_800`
   - compare maps already mentioned in repo notes such as `wdm1` and `wdm11`
   - compare partial-material and fallback cases if we can identify examples in local assets

Suggested local acceptance candidates from the corpus:

- `textures/boqu/lightstripe_blue_800`
- `scripts/ammobox.shader` deluxe path
- `scripts/mapobjects.shader` material-only cases
- `scripts/world.shader` placeholder-token cases

Strong BSP candidate from local map scan:

- `wdm2`
  - its BSP references:
    - `textures/boqu/lightstripe_blue_800`
    - `textures/boqu/lightstripe_blue`
    - `textures/boqu/lamppanel3`
    - `textures/boqu/rect_lamp_yellow`

This makes `wdm2` the best first deluxe-path map target in the currently configured map set.

Script names above were verified in `package.json`.

## Acceptance Matrix

This matrix defines the first fixtures we should satisfy before calling the first deluxe/material implementation good enough to iterate on.

### Implementation Progress

- Phase 1. Parser/types for conditional branches and variable-arity `material`: completed
  - `Q3ShaderTypes` now preserves structured `material` payloads and conditional branch metadata
  - `Q3ShaderParser` now captures `if deluxe` / `if ! deluxe` blocks and variable-arity `material` tokens
  - targeted parser validation passed: `npm run test:run -- src/engine/__tests__/Q3ShaderParser.test.ts`
- Phase 2. Resolver normalization in `Q3ShaderRegistry`: completed
  - `Q3Shader` now preserves unconditional stages separately from conditional branches
  - `ResolvedMaterialProps` now carries normalized `normalTexture`, `glossTexture`, `glowTexture`, material-token metadata, explicit blank-channel flags, and the selected branch
  - `Q3ShaderRegistry.resolveMaterialProps()` now:
    - resolves unconditional stages plus the selected deluxe branch
    - normalizes `material` payloads before falling back to stage `map`
    - keeps classic lightmap-pair shaders opaque instead of misclassifying them as multiply-transparent decals
    - keys its cache by texture name and deluxe mode
  - targeted resolver validation passed: `npm run test:run -- src/engine/__tests__/Q3ShaderParser.test.ts src/engine/__tests__/Q3ShaderRegistry.test.ts`
- Phase 3. BSP consumption path in `BspMeshBuilder`: completed
  - diffuse loading now prefers normalized resolved metadata before falling back to BSP texture-name heuristics
  - normal, gloss, and glow channels now consume resolved metadata first, then fall back to suffix guessing only when the channel is truly absent
  - explicit blank channels from `material` now suppress suffix guessing
  - deluxe/material-aware BSP surfaces now skip the older glow-overlay shortcut path that only understands flattened legacy stages
  - glow/emissive metadata now survives the lightmap pass instead of being cleared unconditionally
- Phase 4. `r_deluxe` build-time integration and user messaging: completed
  - `RenderVars` now exposes persisted `r_deluxe` with reload-only semantics
  - `r_deluxe` no longer triggers live `applyToScene()` updates, avoiding false hot-switch expectations
  - `MapLoader` captures the deluxe flag once per BSP load and passes it through BSP mesh build and texture application
  - `BspManager` follows the same `r_deluxe` build-time behavior for its direct render/apply path
  - changing `r_deluxe` while a BSP map is already loaded now logs that the change applies on the next map reload
- Phase 5. Implicit Warsow-style material synthesis in `Q3ShaderRegistry`: completed
  - filename-only textures without authored shaders now synthesize `material`-style metadata from companion assets in loaded PK3s
  - implicit material synthesis currently probes:
    - normal: `_norm`, `_normal`, `_bump`
    - gloss: `_gloss`, `_spec`
    - glow: `_glow`, `_add`
  - implicit results now flow through the same `ResolvedMaterialProps` normalization path as authored `material` directives
  - this gives us one central layer to tune authored and implicit Warsow material behavior
- Phase 6. Experimental generated BSP PBR path: in progress
  - `RenderVars` now exposes build-time `r_bsp_pbr`
  - defaults now favor the richer Warsow path:
    - `r_deluxe 1`
    - `r_bsp_pbr 1`
  - `MapLoader` and `BspManager` now capture `r_bsp_pbr` at BSP load/material-build time and log reload-only behavior
  - `BspMeshBuilder` now has an experimental generated `PBRMaterial` branch for opaque BSP surfaces that resolve to diffuse + normal + gloss
  - `BspMeshBuilder.applyLightmaps()` now handles `PBRMaterial` lightmap assignment in addition to `StandardMaterial`
  - visual acceptance on `wdm15` remains unverified and is still the main open item

### New Working Conclusion From `wdm15`

After the parser, resolver, BSP-consumption, build-time `r_deluxe`, and implicit-material-synthesis work, `wdm15` still reads flatter than Warsow.

That narrows the likely problem significantly:

- companion-map discovery is no longer the main blocker
- many key `blx_wtest3` surfaces in `wdm15` already resolve to diffuse + normal + gloss through implicit filename synthesis
- the remaining visual gap is more likely in the runtime shading model than in asset lookup

Current best hypothesis:

- `StandardMaterial + lightmapTexture` is not expressive enough for the BLX spec/gloss/normal look
- `wdm2` still benefits from the existing path because its `boqu` fixtures are stronger and more forgiving
- `wdm15` exposes the need for a richer generated material path, not more filename or parser work

### Phase 6. Generated PBR Path For Rich Warsow Materials

Instead of replacing the current BSP material path wholesale, add a separate generated `PBRMaterial` branch for surfaces that resolve to a meaningful Warsow-style material set.

Implemented scope:

- keep `StandardMaterial` available as a fallback BSP path
- introduce a generated `PBRMaterial` path for resolved materials that have at least diffuse + normal + gloss
- choose the path centrally in `BspMeshBuilder`, using `ResolvedMaterialProps`
- keep the generated-material decision separate from shader parsing and companion discovery
- keep `r_bsp_pbr` as a build-time/reload-time BSP cvar

Why this phase exists:

- it preserves the current stable path for classic/lightmapped Q3 surfaces
- it gives BLX and other metal-heavy Warsow assets a stronger shading model
- it keeps authored `material` directives and implicit filename-generated materials on the same input side
- it gives us a single central place to tune how Warsow-style materials are rendered

### Phase 6 Result Matrix

1. Add a gated switch
   - done: `r_bsp_pbr 0/1` exists
   - current default is `1`
   - remains reload-safe / build-time for BSP maps

2. Define material selection rules
   - done: use `StandardMaterial` for classic/lightmap-first surfaces
   - done: use generated `PBRMaterial` for richer diffuse + normal + gloss surfaces

3. Define texture mapping rules
   - diffuse -> `PBRMaterial.albedoTexture`
   - normal -> `PBRMaterial.bumpTexture`
   - gloss/spec -> `PBRMaterial.microSurfaceTexture` with spec/gloss-oriented semantics
   - glow/add -> `PBRMaterial.emissiveTexture`
   - lightmap -> `PBRMaterial.lightmapTexture` with existing BSP UV2/lightmap flow
   - note: keeping `metallic = 0` worked better than treating inverse gloss as metalness

4. Preserve existing BSP expectations
   - done: baked lightmaps preserved
   - done: emissive/fullbright preserved
   - done: `r_normalmap`, `r_glossmap`, `r_lightmap`, and `r_emissive` remain effective

5. Start with a narrow acceptance slice
   - done: `wdm15` used as the hard acceptance target
   - done: `wdm2` used as the regression map

6. Decide rollout shape before widening scope
   - result: keep generated `PBRMaterial` path as the default
   - result: custom rich shader path was tried and reverted

### Phase 6 Acceptance Checklist

- achieved: `wdm15` wall, pillar, and ceiling surfaces look materially correct enough to keep the path
- achieved: `wdm2` still looks good on the `boqu` fixtures
- achieved: generated `PBRMaterial` surfaces respect BSP lightmaps and UV2 lightmap coordinates
- achieved: resolved implicit materials and authored `material` directives both use the same generated-PBR branch
- partially achieved: headless renderer/server validation commands remain clean where local assets/setup allow them

### 1. BSP Deluxe Light Fixture

- Asset source:
  - `public/data/tex_boqu.pk3` → `scripts/boqu.shader`
- Map target:
  - `wdm2`
- Shader names:
  - `textures/boqu/lightstripe_blue_800`
  - `textures/boqu/lamppanel3`
  - `textures/boqu/rect_lamp_yellow`
- Why this fixture matters:
  - uses real `if ! deluxe` and `if deluxe` branches
  - uses 4-arg `material` with diffuse + normal + gloss + glow
  - represents the exact BSP deluxe-light case we originally set out to support
- Expected parser behavior:
  - preserve both conditional branches
  - capture full `material` payload in the deluxe branch
- Expected resolver behavior:
  - `r_deluxe 0` selects the non-deluxe stage stack
  - `r_deluxe 1` selects the deluxe material payload
- Expected first-version runtime behavior:
  - after setting `r_deluxe`, reload `wdm2`
  - the selected branch remains fixed for that map load

### 2. Deluxe Conditional With Nontrivial Stage Metadata

- Asset source:
  - `public/data/data0_21pure.pk3` → `scripts/ammobox.shader`
- Why this fixture matters:
  - uses both `if deluxe` and `if ! deluxe`
  - deluxe branch contains a 2-arg `material`
  - stage also carries `rgbGen identityLighting` and `blendFunc filter`
- Expected parser behavior:
  - `material` does not erase neighboring stage directives
  - branch structure remains selectable
- Expected resolver behavior:
  - 2-arg `material` normalizes without assuming gloss/glow are present
  - stage metadata still survives

### 3. Material-Only Model Fixture

- Asset source:
  - `public/data/data0_21pure.pk3` → `scripts/mapobjects.shader`
- Why this fixture matters:
  - confirms `material` is broader than BSP deluxe branches
  - contains several real forms:
    - 3-arg: `material models/mapobjects/lamp/lamp_yellow.tga models/mapobjects/lamp/lamp_norm.tga models/mapobjects/lamp/lamp_gloss.tga`
    - placeholder form: `material models/mapobjects/decor_misc/hammer.tga $blankbumpimage models/mapobjects/decor_misc/hammer_gloss.tga`
    - deluxe-conditional model form: `material models/mapobjects/jumppad/jumppad1_diffuse.tga ...`
- Expected parser behavior:
  - support `material` both inside and outside deluxe branches
  - preserve placeholder tokens like `$blankbumpimage`
- Expected resolver behavior:
  - treat placeholder channels as explicitly blank, not guessed missing channels

### 4. Placeholder Token / World Material Fixture

- Asset source:
  - `public/data/data0_21pure.pk3` → `scripts/world.shader`
- Why this fixture matters:
  - uses engine tokens inside `material`
  - examples include:
    - `material $whiteimage textures/world/water/norm textures/world/water/wat_gloss`
    - `material $whiteimage $blankBumpImage textures/world/water/wat_gloss`
- Expected parser behavior:
  - preserve tokens exactly
  - normalize case consistently without losing meaning
- Expected resolver behavior:
  - identify placeholder or special engine textures
  - avoid treating `$blankbumpimage` as a normal asset path to probe

### 5. Partial / Shorthand Material Fixture

- Asset source:
  - `public/data/tex_boqu.pk3` → `scripts/boqu.shader`
- Why this fixture matters:
  - contains shorthand or incomplete-looking material forms such as:
    - `material textures/boqu/biglightfloor`
    - bare `material`
- Expected parser behavior:
  - do not crash or mis-shift following directives
  - preserve raw tokens even when normalized channels are sparse or empty
- Expected resolver behavior:
  - degrade safely to partial data or fallback logic
  - never assume every `material` line provides a full deluxe tuple

## Likely Integration Points

Based on the current code, the most likely first integration points are:

- `src/engine/rendering/RenderVars.ts`
  - natural place to register a persisted `r_deluxe` cvar
- `src/engine/loader/map/MapLoader.ts`
  - this is where BSP build, texture application, and lightmap application are orchestrated during map load
- `src/engine/loader/shader/Q3ShaderRegistry.ts`
  - this is the best place to normalize deluxe-vs-non-deluxe resolved material data
- `src/engine/loader/bsp/BspMeshBuilder.ts`
  - this is where shader props are currently consumed during texture/material assignment

Important distinction:

- most current `r_*` vars are designed to be live-applied through `RenderVars.applyToScene()`
- `r_deluxe` should not behave that way in the first implementation
- it should behave more like a persisted build setting than a live material tweak

## Immediate Next Step

The next highest-value work is no longer "get PBR working" but rather:

1. keep the current BSP PBR/spec-gloss path covered by renderer tests
2. document the working material semantics clearly
3. investigate remaining visual tuning only if a concrete map/material still looks wrong

Current validation status after Phase 4:

- Passed:
  - `npm run test:run -- src/engine/__tests__/Q3ShaderRegistry.test.ts src/engine/__tests__/RenderVars.test.ts`
  - `npm run test:run -- src/engine/__tests__/RenderVars.test.ts src/engine/__tests__/Q3ShaderParser.test.ts src/engine/__tests__/Q3ShaderRegistry.test.ts`
  - `npm run test:simulation`
  - `npm run server:tick`
  - `npm run server:fuzz -- --ticks 1000`
- Environment-blocked / unrelated local setup issues:
  - `npm run test:physics`
    - fails locally because `wdm7` BSP is not available in this workspace
  - `npx vite-node src/cli/headless-game.ts --exec "map wdm2; bsp info; quit"`
    - CLI path works, but map loading fails locally because `wdm2` is not indexed/available and the workspace is also missing `public/engine.json`
  - `npx tsc -p tsconfig.json --noEmit --pretty false`
    - touched-file scan surfaced an unrelated existing error in `src/tools/test-collision-spawn.ts` because it tries to call the private `MapLoader` constructor directly

## Open Questions

These remain unverified in this research pass:

- Which exact Warsow shaders in our available asset set depend on deluxe branches most heavily?
- Whether those shaders expect only richer material metadata, or also a distinct directional-lighting data source
- Whether Babylon `PBRMaterial.lightmapTexture` behaves well enough for BSP lightmap use, or whether a custom shader material will still be needed
- How best to translate Warsow spec/gloss assets into Babylon `PBRMaterial` inputs without over-brightening non-metal surfaces

## Final Assessment

Current status:

- companion-map support: good
- BSP normal-map support: present
- BSP gloss/spec support: good
- classic lightmap support: strong
- authored and implicit Warsow material resolution: present
- generated BSP PBR/spec-gloss path: present and visually successful on the main validation maps

That means SHAG is now much closer to the intended Warsow deluxe/spec-gloss look in practice, even if true engine-level deluxe-light parity is still a separate question.
