# Testing PK3 overrides

PK3 files are ZIP archives with Quake-style virtual paths.

## Add an archive

Place it under:

```text
public/data/
```

Then regenerate the browser discovery manifest:

```bash
npm run tools:manifest
```

In a developer console:

```text
developer 1
pk3 index
pk3 stats
pk3 list
```

Browser discovery starts from `pk3_manifest.json`, which `tools:manifest` writes.

## Override order

Indexed packages are processed alphabetically, and a later package wins when virtual paths collide. Use a clearly late filename for an override and verify it:

```text
pk3 find textures/example/wall.tga
shader deps textures/example/wall
```

Do not depend on undocumented filesystem enumeration order.

## Shader updates

Shader scripts normally live under `scripts/*.shader`. After loading/reindexing packages:

```text
shader load
shader info textures/example/wall
```

In code, the same step is `Q3ShaderRegistry.loadShaders()`.

## Packaging advice

- preserve lowercase, forward-slash virtual paths;
- include only owned or redistributable media;
- avoid duplicate files that are not intentional overrides;
- test both clean browser storage and an existing index;
- keep gameplay compatibility separate from enhanced material systems.
