# Extending shader rendering

There are two different extension tasks:

1. improve compatibility with a Quake shader directive;
2. replace a recognized surface class with a modern Babylon material/system.

Keep them separate so compatibility fallbacks stay testable.

## Compatibility work

For a new Q3 directive:

1. add or refine its type in `Q3ShaderTypes.ts`;
2. parse it in `Q3ShaderParser.ts`;
3. expose resolved behavior through `Q3ShaderRegistry.ts`;
4. translate it in the material factory or `BspMeshBuilder`;
5. add parser, resolver, and rendering-focused tests.

Use real shader text from a redistributable map fixture. Preserve the original shader name and stage order in diagnostics.

## Specialized material work

For enhanced water, portals, or other surface classes:

- detect the surface from parsed shader/content semantics first;
- allow a small override list for media whose shaders are known to be wrong;
- adapt the existing BSP mesh instead of reparsing the map;
- own all materials, render targets, observers, and emitters in one disposable per-map system;
- fall back to the ordinary resolved Q3 material when disabled or unsupported;
- expose quality through render variables and apply expensive changes at map reload boundaries when appropriate.

The map loader is the correct lifecycle boundary because it already owns the current BSP mesh result and cleanup.

## Debugging

```text
developer 1
pk3 find scripts/example.shader
shader load
shader info textures/example/surface
shader resolve textures/example/surface
shader deps textures/example/surface
```

For visuals, compare a known map and surface with the enhancement on and off. For renderer changes, run the renderer regression commands in `AGENTS.md` before browser comparison.

## Current limits

Do not claim full Q3 shader parity. `tcMod`, environment tcGen, wave color/alpha generation, and autosprites have active paths; other vertex deforms such as wave, bulge, and move are skipped.
