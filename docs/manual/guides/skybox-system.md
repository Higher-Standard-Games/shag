# Skybox system

BSP worldspawn shaders are the normal source of sky information. The map pipeline resolves the six sky faces from PK3 assets and creates the Babylon skybox.

## Console workflow

```text
developer 1
bsp load wdm2
bsp render
bsp sky info
bsp sky apply
bsp sky toggle
bsp sky remove
bsp sky debug
```

`bsp sky debug` creates labeled colored faces for checking axis orientation.

The standalone `skybox` command currently supports inspection and clearing. Its `skybox load <name>` branch only directs the user to map loading; it is not a general arbitrary-sky loader.

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

## Coordinate convention

Babylon and Quake sky-face naming use different viewing conventions. Keep the mapping centralized in `SkyboxLoader`; use the debug skybox before changing face order or rotations.

## Source of truth

- `src/engine/loader/texture/SkyboxLoader.ts`
- `src/engine/loader/bsp/mesh/skyClouds.ts` (shader stages to cloud layers)
- `src/engine/console/commands/BspCommand.ts`
- `src/engine/console/commands/SkyboxCommand.ts`
