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

## Coordinate convention

Babylon and Quake sky-face naming use different viewing conventions. Keep the mapping centralized in `SkyboxLoader`; use the debug skybox before changing face order or rotations.

## Source of truth

- `src/engine/loader/texture/SkyboxLoader.ts`
- `src/engine/console/commands/BspCommand.ts`
- `src/engine/console/commands/SkyboxCommand.ts`
