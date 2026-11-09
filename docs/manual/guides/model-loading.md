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
with the embedded GLBs in `public/data/washoi_player_model.pk3`. Its default
body is selected by `config/player-model.json`: `models/players/police/police.glb`.
Shared animation clips use `models/players/animations/`. These are PK3 entry
prefixes, not loose HTTP directories. The archive is fetched lazily through the regular mirror-aware PK3
loader, once for concurrent imports, and the GLB bytes are passed to Babylon.
Each manager owns its containers, skeletons and animation groups. Clips are
retargeted once at load time to account for different joint orientations; position
tracks are excluded from playback. The compact bodies omit finger and terminal
toe tracks. A normalized hand frame preserves attachment scale and orientation.
The Draco mesh decoder is served with the application.

Bodies using a separate animation package are fitted once from the first
standing idle pose: the default actor scale gives 70.4 units from feet to head
(10% visual oversize relative to the 64-unit standing hull).
The per-body scale and foot offset stay with pooled instances. Held weapons
compensate for that body scale, preserving their own world size. Physics and
projectile origins keep their existing gameplay values.

Split normals are averaged only for the outline, at coincident vertices with
matching skin influences. The lit body retains its authored normals. Cached outline templates stay outside the source hierarchy so subsequent
instances contain only the authored body parts. One
outline geometry is shared per source mesh; the ordinary outline passes use
it with the body's live skeleton. Snapshot replay refreshes these off-scene
outline draw uniforms from the visible body. Outline effect readiness is part
of the recorded draw signature, so a cold shader compilation cannot leave an
outline absent from later replayed frames. No extra render pass or per-frame
normal calculation is added.

Remote running uses the body's embedded `Running` clip as `run_relaxed` when
available, unless sights are held or a shot arrived within 0.6 seconds. Fire
readiness uses recorded time in demos and clears on a playback discontinuity.
Other locomotion and missing embedded clips retain the shared animation path.
Walking or running backwards plays the shared `run_back` clip
(`backwards_run.glb`), speed-matched like the forward run; other clips moving
backwards play reversed. Running clips play their hips and legs at
`cl_player_run_legs` (default 0.75) and their spine, arms and head at
`cl_player_run_upper` (default 0.5) of the rate that matches the player's
speed, including at the reduced pose rate. The halves drift apart in phase; an
upper-body blade swing ends with the upper body back on the legs' phase.
Weapon-ready poses distribute interpolated view pitch across the three spine
joints, clamped to 1.4 radians in either direction. Hips, anchor and gameplay
collision remain upright. Swimming, climbing, walljump and slide poses keep
their authored orientation. The additive rotation is restored before animation
evaluation and reapplied afterward, including paused/stepped clips; unlinked
ragdoll bones do not receive it. Hand attachments follow the posed skeleton.

A held gun rests on the supporting hand and points along the body's front. When
a body loads, `measureGunSupport` (`src/engine/animation/PlayerModelFit.ts`)
poses it in the first frame of its standing idle and records the other palm and
the body's front in the weapon hand's frame. Each gun records its muzzle tag
and rear end when its grip is built. On pickup, `gunHold`
(`src/games/fps/client/AttachedGun.ts`) turns the gun so its bore line passes
4.3 model units above the palm, which rests the barrel's underside there
without letting a magazine or grip below it tip the gun. It then swings the gun
about its own up axis, around its rear end, until the barrel points along the
body's front. A gun with no muzzle tag aims its barrel axis at the palm.

While a player holds the blade, `setUpperBodyStance` loops the shared
`blade_idle` clip on the spine, arms and head, and the movement clip keeps the
hips and legs. In the stance the blade stands up, leaning 35° toward the body's
front, with an edge leading and the gun hand's fist on the handle just below the
guard. `measureBladeStance` takes the direction, the body's sideways axis and
the fist from the clip's first frame; each blade measures its thin axis and its
guard when it is attached. A blade swing plays over the stance with the blade
along the fingers, and hands the joints back when it ends. The stance steps with
the legs at a reduced pose rate. Swimming, climbing, walljump and slide keep
their own arms.

Player style materials declare dynamic snapshot uniforms so tint, brightness
and powerup changes remain visible during replay. World materials retain their
existing snapshot policy.

Ragdolls use a dedicated transform with matching local/world export scale for
bone rotation updates. It follows the actor anchor and is disposed with the
corpse; the live model hierarchy remains intact.

Some ragdoll deaths first play a shared death clip once, chosen in
`src/games/fps/client/ragdoll/DeathClip.ts` from the death event and the
victim's facing. Gib deaths never do.

| Death | Clip |
| --- | --- |
| Pushed from within 60° of straight behind, any weapon | `death_from_back` |
| Headshot from the front or side | `death_headshot` |
| Riotgun or explosion from the front or side | `death_flying_back` |
| Anything else, or a push with no horizontal direction | none: limp at once |

The body turns to face the shot (away from it for `death_from_back`), and one
Havok sphere at the hips, as wide as the body reaches from them, flies the same
launch arc the ragdoll would. The clip is posed from the ragdoll clock, with root
motion cancelled. When the sphere touches any surface after its first 0.1
seconds, or the clip ends, the per-bone ragdoll takes over from the clip's pose
at the sphere's velocity, less any part of it into the surface touched. The
sphere meets a floor or wall before a limb can, so the ragdoll never starts
inside the world. The death camera and the speed trail follow the sphere, then
the hips.

Washoi's relative ally/enemy choices use `cl_team_ally_model` and
`cl_team_enemy_model`: `police`, `female` (Female Police), `cartel`, `riotkitty`
and `robot`. Police and Cartel use male sounds; Female Police and RiotKitty use
female sounds; Robot uses Bobot sounds. The renderer keeps a source container
and instance pool per body. Changes replace visible bodies and their held
weapons without changing collision or network/demo formats.

Gameplay settings show Your team and Enemy team cards with an animated model
above each model selector and colour row. Both camera viewports share one lazy
WebGL canvas and source cache, capped at 30 scene updates per second. Hidden
previews and background tabs stop the render loop; disposal disconnects the
observers and releases the scene, models and engine. Model, colour, outline and
brightness changes use the same style path as gameplay. Replaced preview bodies
return to the manager pool, and failed variant imports can retry on a subsequent
refresh rather than retaining a rejected load. Static images or a
model-name placeholder remain available while live rendering loads or if it
cannot start.

The five body GLBs are supplied in `public/data/washoi_player_model.pk3`.
Shared clips are packaged separately in `washoi_player_animations.pk3`, under
`models/players/animations/`. The package index resolves each asset's owner. The
clip list, archive and source directory come from `config/player-animations.json`,
and the default body and its archive from `config/player-model.json`. The clip
authoring files live in the ignored `assets-source/players/vanguard/`.
Both runtime archives must be copied alongside a clean checkout.

To add a clip, put its Mixamo FBX in the source directory, convert it, and list
the GLB under a clip name in `config/player-animations.json`:

```bash
# FBX to self-contained GLB beside the source (FBX2glTF, downloaded on first use).
npm run tools:convert -- "assets-source/players/vanguard/backwards_run.fbx"
# Build shared clips without rewriting the supplied body archive.
npm run tools:player-animations
# Publish archive discovery after changing packages (also runs before build).
npm run tools:pk3-index
```

The animation builder validates embedded GLB dependencies and all required
clips, skips missing optional dances, and writes fixed ZIP timestamps and
`models/players/animations/animations-manifest.json` with content hashes. Standard
builds consume the existing archives and do not require authoring sources.
The body archive is supplied as is; no tool rebuilds it.

Headless `anim inspect [file|all]` lists each shared clip's channels and flags
root-motion position tracks; `anim bones` lists the default body's skin joints.
Browser `developer 1; animtest load <police|female|cartel|riotkitty|robot>` uses the selected body and the same
manager as player rendering. Use `animtest list`, `animtest play run`,
`animtest play slide`, and `animtest dispose` to inspect and clean up. Explicit custom URL
or data-source arguments to `PlayerModelManager.loadModel()` remain available.
The optional outline proxy stays a separate loose pair. Its build recipe names
the vanguard reference body, which no supplied archive contains, so the proxy
cannot be rebuilt from the supplied data.

## Packaged weapon models

Washoi prepares its first-person weapon models, barrels and material variants
while the match loading screen is still visible. Joining consumes that prepared
view instead of rebuilding its model cache. The pickup-model cache is separate
from this held-weapon cache.

Pickup GLB sources with constant transform clips settle their authored pose once
and stop those clips before caching. Their clones keep that pose without running
the hidden source's animation every frame. Sources with changing curves, cubic
tangents, animation events or blending retain playback, as their shared skeletons
can still animate pickup clones. This policy applies only to pickup preloading;
held weapons and barrels retain their own animation ownership.

Held-weapon and projectile preparation use bounded material checks. A match
cancellation detaches its waits; late held-weapon imports cannot replace the
cancelled view. Required projectile-model failures are reported as preparation
failures. Simultaneous reads of the same mounted ZIP entry share extraction,
while pickup and held-view instances retain their separate scene ownership.
Pickup imports have their own scene/generation ownership and bounded waits too.
Clearing the map invalidates pending sources and disposes late results. Live
matches and demo startup prepare player bodies and the same held/projectile
media before their final presentation check. Required preparation failure
reports an error rather than exposing an incomplete scene. The same step
compiles the shaders of combat effects (the slash trail, shotgun pellets,
damage numbers and teleport afterimage) through the code that draws them. These
are optional: one that fails is reported in the console and compiles on first
use instead of failing the load. While it runs, the loading screen shows
"Compiling shaders" with a percentage; any loading-screen hold can report its
progress this way once the map itself has loaded.

Loading-screen holds are operation-owned leases. Releasing or cancelling an
older match/demo cannot release a newer operation's hold. GPU readiness waits
count visible active time, suspend while hidden/frozen and remain cancellable.
Actual rendering context/device loss fails preparation with a retry message.
Optional audio preparation has a deadline and can continue without pending
sounds; a live join starts it concurrently with world loading.

The map loading screen temporarily silences sound effects, including ambient
loops and announcer channels, through the end of its fade. A live match silences
them earlier, from the server's greeting: the server streams the match from
then on, before the map load has started. Music continues.
Saved sound levels and enabled settings are preserved; muted one-shots are
dropped rather than played when loading finishes.

An isolated offline renderer can own `PresentationTime.ownPresentationClock`
until disposal. Shader animation and sky-portal rotation then read the supplied
time instead of encoding or storage wall time. This clock is local to the
document; the renderer must also supply its own frame delta.

`AudioManager.ownSfxSink` redirects SFX requests to a document-owned collector
before speaker mute filtering. It returns a release handle and rejects a second
simultaneous owner. `readSfxBytes` resolves encoded sounds through the same
package path as playback; copy its buffer before passing it to a decoder that
detaches input. These hooks preserve the normal speaker path when released.

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

A browser scene skips a skeleton's skin-matrix rebuild and matrix upload while
its pose holds still: between the steps of a player clip stepped at
`cl_player_pose_hz`, or while a weapon or pickup keeps a fixed pose. While every
bone is linked to a glTF node, the gate in
`src/engine/animation/SkinPreparationGate.ts` compares the nodes' position,
rotation and scale with the last build and calls Babylon's `prepare()` only when
one changed. Write a pose through the linked nodes; a rig with an unlinked bone
(a ragdoll) prepares every frame as Babylon does.

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

Hand-held guns retain their imported glTF hierarchy, skin joints and muzzle
nodes under a separate grip. The grip replaces the loader's catalog scale with
the holder's visual scale and aligns the authored +X barrel with the right
hand's finger direction, including the scene's handedness conversion. Barrel
sub-models attach in the same imported model space. The winner showcase uses
the same grip. Blade swings own the spine and its descendants only; hips and
legs continue their locomotion clip, including airborne poses. A cached target
mask prevents both clips writing the same joints. Manual/reduced-rate posing
also respects the mask. Ending or cancelling the swing restores upper-body
locomotion at the current stride phase. Full-body one-shots keep exclusive
ownership and suspend locomotion. Visibility/LOD updates preserve that distinction.

The hitscan effect manager validates its persistent mesh resources during
initialization. Map clearing can dispose those meshes while retaining the
scene; initialization then rebuilds the procedural effect controllers and
prewarms their resources. Repeated initialization on an intact scene reuses
them.

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


A first-person beam belongs to an active beam weapon. Frozen round phases,
disabled controls, death, reload, weapon switching or losing that weapon clear
its local presentation. Parking or clearing a viewmodel also clears the beam.
Continuous modes retain firing during their non-frozen pre-match countdown.
