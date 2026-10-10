# Model loading

`ModelLoader` loads glTF/GLB and integrates PK3/MD3 paths used by the engine. Use `spawnmodel` for browser inspection.

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
