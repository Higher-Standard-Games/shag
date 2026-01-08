# Q3 Shader System

How SHAG Engine parses and applies Quake 3/Warsow shaders.

## Overview

Q3 shaders are text files that define material properties, texture effects, and rendering behavior. SHAG Engine parses these and translates them to Babylon.js materials.

## Shader File Format

Shaders are defined in `.shader` files inside PK3 archives:

```
textures/base_wall/concrete
{
    surfaceparm nomarks
    {
        map textures/base_wall/concrete.tga
    }
    {
        map $lightmap
        blendFunc GL_DST_COLOR GL_ZERO
    }
}
```

## Supported Directives

### Surface Parameters

```
surfaceparm sky        // Sky surface
surfaceparm trans      // Transparent
surfaceparm noimpact   // No bullet marks
surfaceparm nolightmap // No lightmap
surfaceparm alphashadow // Transparent shadow
```

### Culling

```
cull front             // Cull front faces
cull back              // Cull back faces (default)
cull disable           // No culling (two-sided)
cull none              // Same as disable
```

### Sorting

```
sort portal            // Render order
sort sky
sort opaque
sort banner
sort underwater
sort additive
sort nearest
```

### Sky Parameters

```
skyparms env/stormydays/stormydays - -
// Loads 6 cubemap faces: _rt, _lf, _ft, _bk, _up, _dn
```

## Stage Directives

Each `{ }` block inside a shader is a rendering stage.

### Map

```
map textures/base/texture.tga    // Texture path
map $lightmap                    // Use lightmap
map $whiteimage                  // White texture
```

### Blend Functions

```
blendFunc add                    // Additive
blendFunc blend                  // Alpha blend
blendFunc filter                 // Multiply
blendFunc GL_ONE GL_ONE          // Custom blend
blendFunc GL_SRC_ALPHA GL_ONE_MINUS_SRC_ALPHA
```

### Texture Coordinate Modifiers

```
tcMod scroll 0.5 0               // Scroll texture
tcMod scale 2 2                  // Scale texture
tcMod rotate 45                  // Rotate texture
tcMod turb 0 0.1 0 0.5           // Turbulence
tcMod stretch sin 1 0.5 0 1      // Stretch wave
```

### Vertex Deformations

```
deformVertexes wave sin 0 5 0 0.5   // Wave vertices
deformVertexes move 0 0 10 sin 0 1 0 0.5
deformVertexes autosprite           // Billboard
deformVertexes autosprite2          // Axial billboard
```

### Animation

```
animMap 8 textures/anim/frame1.tga textures/anim/frame2.tga
// 8 FPS animation between frames
```

## Using Q3ShaderRegistry

```typescript
import { Q3ShaderRegistry } from './engine/loader/shader/Q3ShaderRegistry';

const registry = Q3ShaderRegistry.getInstance();

// Load shaders from PK3s
await registry.loadFromPK3();

// Get shader definition
const shader = registry.getShader('textures/base_wall/concrete');

// Check shader count
console.log(registry.getShaderCount()); // 1741

// Resolve material properties
const props = registry.resolveMaterialProps('textures/base_wall/concrete');
// props.diffuseMap, props.alphaMode, props.isSky, etc.
```

## Material Resolution

When BspMeshBuilder needs a material, it:

1. Looks up shader by texture name
2. Extracts material properties (blend mode, textures, etc.)
3. Creates Babylon.js StandardMaterial or custom material
4. Applies textures and blend settings

## Debugging Shaders

```
shader count                    // Total loaded
shader list                     // List all shaders
shader list base_wall           // Filter by name
shader info textures/path/name  // Show shader details
shader info                     // Inspect aimed surface
shader aim 1                    // Highlight aimed surface
```

## Limitations

Not all Q3 shader features are supported:

- ❌ `tcGen environment` (environment mapping)
- ❌ `rgbGen` (vertex color generation)
- ❌ `alphaGen` (alpha generation)
- ❌ Complex multi-pass effects

## Related

- [BSP System](./bsp-system.md) - How shaders are applied to geometry
- [Skybox System](./skybox-system.md) - Sky shader handling
