# Skybox System

How SHAG Engine loads and renders skyboxes.

## Overview

SHAG Engine supports two types of sky rendering:

1. **Cubemap Skybox** - 6-face texture cube (from `skyparms`)
2. **Textured Sky Sphere** - Single texture on sphere (fallback)

## Cubemap Skyboxes

Used when shader has `skyparms` directive:

```
textures/wdm11/sky
{
    surfaceparm sky
    surfaceparm noimpact
    skyparms env/stormydays/stormydays - -
}
```

This loads 6 textures:
- `env/stormydays/stormydays_rt.tga` (right)
- `env/stormydays/stormydays_lf.tga` (left)
- `env/stormydays/stormydays_ft.tga` (front)
- `env/stormydays/stormydays_bk.tga` (back)
- `env/stormydays/stormydays_up.tga` (up)
- `env/stormydays/stormydays_dn.tga` (down)

## Textured Sky Sphere

Used when shader has `surfaceparm sky` but no `skyparms`:

```
textures/wdm7/sky
{
    surfaceparm sky
    {
        map textures/Factory/blx_wt3_sky_orange.tga
    }
}
```

Creates a large sphere with the texture wrapped around it.

## Using SkyboxLoader

```typescript
import { SkyboxLoader } from './engine/loader/texture/SkyboxLoader';

const skyboxLoader = SkyboxLoader.getInstance();
skyboxLoader.init(scene);

// Load cubemap skybox
const result = await skyboxLoader.loadSkybox('env/stormydays/stormydays');

// Or load textured sky sphere
const result = await skyboxLoader.loadSkyboxFromTexture(
  'textures/Factory/blx_wt3_sky_orange.tga'
);

if (result.success) {
  console.log('Skybox created:', result.skybox);
}
```

## Automatic Skybox Loading

When loading a map, skybox is created automatically from BSP sky shaders:

```typescript
const result = await mapLoader.load('wdm11');
// Skybox is created from detected sky shaders
```

## Changing Skybox

```typescript
// Dispose existing
skyboxLoader.disposeSkybox();

// Load new
await skyboxLoader.loadSkybox('env/newsky/newsky');
```

Console command:
```
bsp skybox env/stormydays/stormydays
```

## Coordinate System

Q3 and Babylon.js use different coordinate systems:

| Q3 | Babylon.js |
|----|------------|
| +X right | +X right |
| +Y forward | +Z forward |
| +Z up | +Y up |

SkyboxLoader handles the conversion automatically.

## Face Mapping

Q3 face suffixes map to Babylon.js cube faces:

| Q3 Suffix | Q3 Direction | Babylon Face |
|-----------|--------------|--------------|
| `_rt` | +X (right) | px |
| `_lf` | -X (left) | nx |
| `_ft` | +Y (front) | pz |
| `_bk` | -Y (back) | nz |
| `_up` | +Z (up) | py |
| `_dn` | -Z (down) | ny |

## Texture Formats

Supported formats for skybox faces:
- `.tga` - TGA (parsed manually)
- `.jpg` / `.jpeg` - JPEG
- `.png` - PNG

## Skybox Properties

```typescript
// Access skybox mesh
const skybox = scene.getMeshByName('skybox');

// Skybox properties
skybox.infiniteDistance = true;  // Always at infinity
skybox.renderingGroupId = 0;     // Render first
```

## Debugging

```
bsp info                    # Shows sky shader info
shader info textures/*/sky  # Shader details
```

## Related

- [Guide: Shader System](./shader-system.md)
- [Tutorial: Change Skybox](../tutorials/recipes/change-skybox.md)
