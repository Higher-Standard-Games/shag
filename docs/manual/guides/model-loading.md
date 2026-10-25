# Model loading

`ModelLoader` loads glTF/GLB and integrates PK3/MD3 paths used by the engine. Use `spawnmodel` for browser inspection.

## Held Arc Blade

The FPS renderer uses `src/games/fps/client/AttachedBlade.ts` for both remote
players and the winner showcase. It attaches the complete model hierarchy to
the right hand, preserving the GLB's export normalization and handedness
conversion. The attachment places the authored handle centre at the hand and
uses the first-person model scale (about 60 world units long). First-person
presentation has its own transform and is unaffected.

## Packaged player model

Live players, bots, demo playback and teleport ghosts use `PlayerModelManager`
with the embedded GLBs in `public/data/washoi_player_model.pk3`. Its virtual
root is `models/players/vanguard/`; that is a PK3 entry prefix, not a loose HTTP
directory. The archive is fetched lazily through the regular mirror-aware PK3
loader, once for concurrent imports, and the GLB bytes are passed to Babylon.
Each manager still owns its containers, skeletons and animation groups.

The shared recipe is `config/player-model-vanguard.json`. Original FBX files,
conversion intermediates and the exported GLBs live in the ignored, unserved
`assets-source/players/vanguard/` directory. The package and source media are
external assets and must be copied separately from a clean Git checkout.

```bash
# Optional: convert updated FBX sources first.
npm run tools:convert -- --all
# Package all exported GLBs, validating the required model/clips.
npm run tools:player-model
# Publish archive discovery after changing packages (also runs before build).
npm run tools:pk3-index
```

The builder accepts `--source-dir <directory>` for an alternate export folder,
validates that GLBs embed their image/buffer dependencies, and excludes FBX,
PNG/BIN export trees and other authoring files. Fixed ZIP timestamps and sorted
entries make unchanged inputs reproduce the same package. The package includes
`models/players/vanguard/manifest.json` with hashes and available clip metadata.
Missing optional victory dances are skipped; required clips must exist when
building the package. Standard builds consume an existing package and do not
require the authoring directory.

Headless `anim bones` and `anim inspect [file|all]` inspect the packaged GLBs.
Browser `developer 1; animtest load` uses the same package. Explicit custom URL
or data-source arguments to `PlayerModelManager.loadModel()` remain available.
The optional outline proxy stays a separate loose pair; its build recipe
extracts its model source from this package, and benchmark hashes cover the
packaged player inputs.

## Packaged weapon models

Washoi prepares its first-person weapon models, barrels and material variants
while the match loading screen is still visible. Joining consumes that prepared
view instead of rebuilding its model cache. The pickup-model cache is separate
from this held-weapon cache.

Held-weapon and projectile preparation use bounded material checks. A match
cancellation detaches its waits; late held-weapon imports cannot replace the
cancelled view. Required projectile-model failures are reported as preparation
failures. Simultaneous reads of the same mounted ZIP entry share extraction,
while pickup and held-view instances retain their separate scene ownership.

The map loading screen temporarily silences sound effects, including ambient
loops and announcer channels, through the end of its fade. Music continues.
Saved sound levels and enabled settings are preserved; muted one-shots are
dropped rather than played when loading finishes.

Weapon GLBs and their configs live inside `public/data/washoi_weapons.pk3`, with the
projectile and impact media. The package carries only what the game loads; the
original IQM/MD3 models and textures stay in the source bank. First-person weapons, loadout previews,
pickups, dropped weapons and remote weapons resolve indexed GLBs to embedded bytes; the ordinary
PK3 loader handles lazy downloads and mirrors. Unindexed custom URLs retain
normal file loading. Ammo counters read their packaged `.cfg` sidecars too.
Attachment rules read packaged `tags.txt`. Missing optional tags in an indexed
model directory use the GLB sockets or existing fallback without a loose HTTP
probe. Unindexed custom models may supply `tags.txt` beside the model URL.
Plasma's `tag_barrel2` rule is required to place its two barrels correctly.

Firefox WebGL shares read-only native PBR materials between remote held weapons
loaded from the same cached source. Hierarchies, skeletons, animation groups,
hand attachments and mesh outlines remain independent. Material/texture
animations, animation groups targeting objects other than transform nodes,
custom material classes and custom clone implementations retain independent
material clones. Chrome and WebGPU keep the independent-material path.
`ModelInstanceCache` exposes this as the opt-in `shareStaticMaterials` constructor
option; consumers using it must keep these materials read-only. Source and
instance cleanup retain a shared material until its last scene user is gone.

`config/weapon-models.json` defines the original source archive, export directory
and `files`, a map from each packaged path to its export. Voltaic's model and
config are packaged as `voltaic/voltaic.*` from the `lasergun` exports; the
`lasergun` weapon id remains an alias of Voltaic. The original bank is preserved at
`assets-source/weapons/z_weapons-source.pk3`; exports and authoring intermediates
live in `assets-source/weapons/exports/`. These ignored inputs must be supplied
separately to rebuild; a normal game build consumes the existing runtime PK3.

```bash
# Optional: regenerate IQM-derived GLBs and embed their textures.
# Requires Python 3 and Pillow; PYTHON can select the Python executable.
npm run convert:weapons
# Once: extract legacy projectiles from archive/data0_21pure.pk3.
npm run tools:projectile-media
# Package the listed exports with their surface maps, as WebP.
npm run tools:weapon-models
npm run tools:pk3-index
```

Conversion writes to the unserved export directory; it does not publish the
package. Custom FBX-derived exports, such as the Blade, need their own export
step and are preserved by the IQM conversion. Packaging accepts `--source-dir`,
`--base-package` and `--output` overrides, validates the listed GLBs and their
embedded image/buffer resources, and records each packaged file's export and
hash in `models/weapons/manifest.json`.

Packaging also finishes each GLB's materials. A material named after a texture
path (`models/weapons/<weapon>/<name>`) gets the source bank's `<name>_norm`
as its normal map, and `<name>_gloss` as a roughness map: black gloss is
roughness 0.85, white is 0.3. Every texture is then re-encoded as WebP
(`EXT_texture_webp`), at most 1024 px on a side; normal maps at quality 92, the
rest at 85. The source normal maps use glTF's green-up convention and are not
flipped. Solid-colour glow and emit textures stay textures, because the renderer
recognises glowing parts by them. The supplemental archive configured by
`projectilePackage` supplies rocket, grenade, plasma and blade-blast MD3s,
textures, impact models and their selected shaders. It is generated at
`assets-source/weapons/projectiles.pk3`, with source hashes in
`models/objects/projectile/manifest.json`. Exports not listed in `files`,
such as the retired gunblade, the old blade and authoring files, are not packaged. Reload the page after installing a rebuilt
package so the browser replaces any already-mounted old copy.

The Blade uses `models/weapons/blade/arc_blade.glb` (Arc Blade). To import its
original embedded GLB and normalize length/orientation against the retained
`exports/blade/blade.glb` reference before packaging:

```bash
node scripts/import-arc-blade.mjs /path/to/source.glb
npm run tools:weapon-models
npm run tools:pk3-index
```

The importer retains mesh/image bytes and material extensions, adding a parent
transform that matches the old blade's length and export-space centre. It
preserves an original copy under `assets-source/weapons/arc-blade/arc_blade.glb`.
First-person loading preserves the authored PBR metal, normal and emissive
channels. Its first-person metal receives a camera-relative specular light,
tinted by the BSP lightgrid with the weapon lighting visibility floor, plus a
small neutral reflection environment for the broad metallic face. Both apply
only to the Blade; the specular light is disabled for other weapons.
Charging uses a turquoise outline growing from 0.6 to 4.8 world units before
view-model scale normalization; swing trails are light grey with 22% peak
opacity and a smooth texture envelope fading their edges to transparent.

Arc Blade is adapted from **Neo-Arc Blade – Sci-Fi Energy Sword** by
[SURVIVED](https://sketchfab.com/survivedua),
[source model](https://sketchfab.com/3d-models/neo-arc-blade-sci-fi-energy-sword-54e0845b1054497698093a72110ba73e),
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Changes: runtime name, export-space rotation, uniform scale and positioning.
Attribution is retained in the GLB and the packaged weapon manifest.

## Developer command

```text
developer 1
spawnmodel <model> [scale] [x y z] [angle]
spawnmodel list
spawnmodel info <index>
spawnmodel rotate <index> <degrees>
spawnmodel move <index> <x> <y> <z>
spawnmodel scale <index> <scale>
spawnmodel anim <index> <name> [once]
spawnmodel lighting <index>
spawnmodel remove <index>
spawnmodel clear
```

When position is omitted, the command places the model in front of the camera. It resolves loose names through `GamePaths.game()`, so those direct assets live under the optional `public/games/<id>/` tree. That is separate from PK3 media under `public/data/`.

## API

```ts
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ModelLoader } from '../../../src/engine/loader/model/ModelLoader';

const loader = ModelLoader.getInstance();
loader.init(scene);

const result = await loader.loadModel(modelPath, {
  position: new Vector3(0, 0, 0),
  scale: 100,
  angle: 45,
  hasCollision: false,
  receiveShadows: true,
  castShadows: false,
  applyLighting: true,
});
```

`ModelLoadResult` contains a root node, meshes, animation groups, skeletons, optional created lights, attachment points, and texture-load promises.

## Animation

```ts
loader.playAnimation(result, 'Idle', { loop: true, speed: 1 });
loader.stopAnimation(result, 'Idle');
const names = loader.getAnimationNames(result);
```

Check the source signatures for optional frame ranges and animation information.

## Units and coordinates

Loose glTF scale is asset-dependent; the developer command defaults to 100 for BSP-scale inspection. Treat that as a preview default, not a universal meters-to-Quake conversion.

`ModelLoadOptions.position` is Babylon world space with Y up. BSP entity origins must pass through the loader’s existing coordinate conversion.

## Lifecycle

- initialize the singleton once per active scene;
- reuse loader/cache results rather than loading one copy per frame;
- dispose the returned root and any game-owned lights/effects;
- refresh lightgrid lighting after large manual moves;
- verify material/texture completion before taking screenshots;
- optimize source models with the repository tooling and inspect visual loss.

See `src/engine/loader/model/ModelLoader.ts` and `SpawnModelCommand.ts` for the current option and command contracts.

The remote-player weapon path uses `ModelInstanceCache` around `ModelLoader`.
Concurrent requests for the same path/scale share an import; each result clones
the authored hierarchy, skeletons, animation targets and materials. Mesh geometry
and texture GPU storage remain shareable. The cache is owned by the remote
renderer and releases its hidden sources on disposal. Invalidated mesh/material/
texture sources reload after map cleanup. Dropped weapons keep using the BSP
preloader for available main models, with their own `ModelInstanceCache` for
missing main models and barrel GLBs. Barrel instances retain their authored glTF
root transforms and receive the existing tag/per-barrel offsets. Both dropped
caches retire with the dropped-weapon renderer.

Each `WeaponViewManager` also owns prepared GLB sources for its first-person
weapons and barrels. Main sources are keyed by weapon ID/model path so appearance
and orientation variants remain distinct. Material conversion and light/layer
setup happen during the cold import; subsequent switches clone the prepared
hierarchy, rig and materials. Dual chambers share one barrel import but keep
independent spin state and material instances. Live and demo view managers own
separate caches. Clearing a weapon cancels outstanding attachment requests and
retires active clones; disposing/re-initializing the view retires sources too.
Sources invalidated by map cleanup reload. This retains source resources for
weapons encountered during the view's lifetime; it does not prewarm every weapon
or change the MD3 import/animation path. Routine view/barrel diagnostics use
`developer 1`; warnings/errors remain visible.
WebGPU clones receive their own light-cap guards, preserving deliberately lower
view budgets, and disable shader hot swapping. Those safeguards are not copied
by Babylon's material cloning.

Routine cached pickup/drop clone and player-instance disposal/team-colour
diagnostics and successful tag-load messages also require `developer 1`. Keep
`developer 0` for normal-play profiling; map-loading summaries and warnings/errors
remain visible.
