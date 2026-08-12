# Quake shader system

SHAG parses Quake 3 and Warsow shader scripts from loaded PK3 archives and resolves them into Babylon materials for BSP surfaces.

## Loading and inspection

```text
developer 1
shader load
shader count
shader list water
shader info textures/liquids/pool3d_3c
shader resolve textures/liquids/pool3d_3c
shader deps textures/liquids/pool3d_3c
```

In code:

```ts
import { Q3ShaderRegistry } from '../../../src/engine/loader/shader/Q3ShaderRegistry';

const registry = Q3ShaderRegistry.getInstance();
await registry.loadShaders();

const shader = registry.getShader('textures/liquids/pool3d_3c');
const props = registry.resolveMaterialProps('textures/liquids/pool3d_3c');
```

The current method is `loadShaders()`; there is no `loadFromPK3()`.

## Supported material behavior

The parser and BSP material path cover the compatibility features most maps depend on:

- stage maps, animated maps, blend and alpha functions;
- culling, depth-write, polygon offset, surface/content parameters;
- lightmap and base-texture stages;
- `tcMod` animation;
- `tcGen environment`;
- wave-driven `rgbGen` and `alphaGen`;
- `deformVertexes autosprite` and `autosprite2`.

Support is not a complete reimplementation of the original Q3 renderer. In particular, other vertex deforms such as `wave`, `bulge`, and `move` are currently skipped by the parser. Some uncommon multi-stage combinations are approximated by Babylon material paths.

## Debug workflow

When a material looks wrong:

1. Run `pk3 find <path>` to confirm which archive wins.
2. Run `shader deps <shader-name>`.
3. Inspect parsed stages with `shader info <shader-name>`.
4. Compare resolved flags with `shader resolve <shader-name>`.
5. In the browser, use `shader aim 1` to identify the surface under the crosshair.

Keep shader names normalized to forward-slash paths without file extensions.

## Extending materials

Compatibility parsing and enhanced rendering should remain separate:

- preserve shader semantics in `Q3ShaderParser` and `Q3ShaderRegistry`;
- translate resolved properties in the BSP material factory/builder;
- add specialized rendering systems, such as unified liquid surfaces, at the map-loading boundary;
- keep a fallback material path for unsupported hardware or disabled effects.

This separation lets old content continue to load while selected surface classes receive modern Babylon rendering.

## Source of truth

- `src/engine/loader/shader/Q3ShaderParser.ts`
- `src/engine/loader/shader/Q3ShaderRegistry.ts`
- `src/engine/loader/shader/Q3ShaderMaterialFactory.ts`
- `src/engine/loader/shader/ShaderAnimationSystem.ts`
- `src/engine/loader/bsp/BspMeshBuilder.ts`
