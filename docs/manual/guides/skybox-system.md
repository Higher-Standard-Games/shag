# Skybox system

BSP worldspawn shaders are the normal source of sky information. The map pipeline resolves the six sky faces from PK3 assets and creates the Babylon skybox.

## Console workflow

```text
developer 1
bsp load washoi_dm2
bsp render
bsp sky info
bsp sky apply
bsp sky toggle
bsp sky remove
bsp sky debug
```

`bsp sky debug` creates labeled colored faces for checking axis orientation.

The standalone `skybox` command inspects (`skybox info`) and clears (`skybox clear`) the current sky. Skies load with their map; `skybox load <name>` does not load an arbitrary sky.

## API

```ts
import { SkyboxLoader } from '../../../src/engine/loader/texture/SkyboxLoader';

const skybox = SkyboxLoader.getInstance();
skybox.init(scene);

const result = await skybox.loadSkybox(basePath);
// or:
const textureResult = await skybox.loadSkyboxFromTexture(texturePath);

skybox.disposeSkybox();
```

Use the actual loader result to handle missing faces. Avoid creating a second skybox without disposing the previous map-owned one.

## Cloud layers

A sky shader's texture stages are drawn as Quake 3 cloud layers, one dome per
stage: over the far box when `skyParms` names one, and as the whole sky when it
does not (`skyParms - 2048 -`).

- Texture coordinates follow Quake 3's cloud dome: each sky direction meets a
  sphere `cloudHeight` above a world of radius 4096, giving two angles in
  radians that `tcMod scale` then tiles.
- `tcMod scale` and `tcMod scroll` tile and move each layer; `rgbGen const`
  tints it; `blendFunc` picks how it combines (none or `GL_ONE GL_ZERO` opaque,
  `GL_ONE GL_ONE` add, a filter multiplies, `GL_SRC_ALPHA GL_ONE_MINUS_SRC_ALPHA`
  blends by alpha; anything else adds).
- The extension a stage names is a hint, as in Quake: `foo.tga` is also found as
  `foo.ktx`, `foo.jpg` or `foo.png`.

The layers are meshes named `skybox_cloud_<n>`; `disposeSkybox()` removes them
with the far box.

## Sky height

A sky shader's height is the cloud dome's height and, for world fog, how far
away the sky is: Warfork draws the sky as a box scaled to it, so a sky at 512
stays clear inside a 700-unit fog start while one at 1500 hazes. A shader
without a height (`-` or 0) is at **2048**, Warfork's default. `skyparmssides`
reads Warfork's six sides, each an image or the name of an earlier side, then
the height: `skyparmssides env/36sky rt rt rt rt rt 1500 -` is `env/36sky` on
every side at height 1500.

With a sky portal in the map, the sky meshes draw only in the portal's view;
see the BSP guide.

## Coordinate convention

Babylon and Quake sky-face naming use different viewing conventions. Keep the mapping centralized in `SkyboxLoader`; use the debug skybox before changing face order or rotations.

## Source of truth

- `src/engine/loader/texture/SkyboxLoader.ts`
- `src/engine/loader/bsp/mesh/skyClouds.ts` (shader stages to cloud layers)
- `src/engine/console/commands/BspCommand.ts`
- `src/engine/console/commands/SkyboxCommand.ts`
