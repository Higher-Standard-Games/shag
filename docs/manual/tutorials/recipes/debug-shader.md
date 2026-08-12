# Recipe: debug a map shader

```text
developer 1
shader load
shader count
shader info textures/example/surface
shader resolve textures/example/surface
shader deps textures/example/surface
```

In a browser scene, identify the aimed surface:

```text
shader aim 1
shader info
```

If a texture or definition is wrong, confirm archive ownership:

```text
pk3 find scripts/example.shader
pk3 find textures/example/surface.tga
```

Check path normalization, package override order, parsed stage count, blend/depth flags, and whether the feature is supported. Other `deformVertexes` modes beyond autosprite/autosprite2 are a known compatibility gap.
