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
