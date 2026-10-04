# PK3 filesystem

SHAG reads Quake 3 and Warsow assets from PK3 archives through a shared virtual filesystem. Browser and headless map loading both use the PK3 index.

## Data location and index

Game archives belong under `public/data/` and are intentionally excluded from Git. The manifest script scans that directory so the browser can discover the archives.

```bash
npm run tools:manifest
```

At runtime, `PK3Index` builds or restores the searchable file index:

```ts
import { PK3Index } from '../../../src/engine/loader/pk3/PK3Index';

const index = PK3Index.getInstance();
await index.ensureIndex();

const map = index.findMap('wdm2');
const owner = index.findFile('scripts/common.shader');
const maps = index.findByPattern('maps/*.bsp');
```

`PK3Index` owns discovery and lookup. There is no `indexDirectory` runtime API.

## Loading file contents

```ts
import { PK3Loader } from '../../../src/engine/loader/pk3/PK3Loader';

const loader = PK3Loader.getInstance();
await loader.init();
await loader.loadPK3('basewsw.pk3');

if (loader.hasFile('scripts/common.shader')) {
  const bytes = await loader.getFile('scripts/common.shader');
}
```

`loadPK3(filename)` accepts a filename; it does not take a numeric priority argument. When multiple indexed packages contain the same path, packages are processed alphabetically and a later package wins. Name override packages accordingly and verify the winning archive with `pk3 find`.

## Console diagnostics

```text
developer 1
pk3 stats
pk3 list
pk3 find maps/wdm2.bsp
pk3 index
pk3 refresh map_mymap.pk3
```

`pk3 list` lists indexed packages. Use `pk3 find <exact-path>` for ownership or `PK3Index.findByPattern` in code for wildcard file listings.
`pk3 refresh <family.pk3>` reads the manifest and reindexes only matching
`family*.pk3` packages, such as `map_mymap_00001.pk3`. It keeps the other
indexed packages and avoids a full archive scan. The editor's Playtest handoff
uses `PK3Index.refreshPackage(filename)` for its exact new build. Refreshing
the index does not itself replace an already rendered map; launch `map <name>`
to load the new BSP.
If a package was deleted or files were removed from an existing archive, run
`pk3 index` to rebuild ownership for paths that may fall back to other packages.

## Map loading

The normal browser flow uses:

```text
map wdm2 duel
```

The headless/inspection flow uses:

```bash
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
```

Headless loading resolves the BSP through the same PK3 index. Do not add ad-hoc filesystem searches for map files.

## KTX2 sidecar loading

Generated `ktx2cache` sidecars use top-to-bottom rows, matching the TGA parser.
The dedicated sidecar loader preserves that order for compressed and raw
decoded textures on both WebGL and WebGPU. It retains base dimensions after
uploading all mip levels, and device restoration selects the same loader.
Decoder resources, including worker-side ZSTD, are served from bundled local
assets. Failed sidecar loads fall back to the source image in the PK3.

For visual diagnosis, `shader surface` reports the aimed texture's dimensions,
source and orientation. Changing `r_ktx2` requires a fresh map/texture load to
compare paths; it does not replace textures already held by materials.

## KTX1 texture loading

The 2D texture loader uses Babylon's negotiated DXT/S3TC, ETC and ASTC
capabilities, including WebGPU's ETC2 support for ETC1 blocks. Compressed uploads
go through Babylon's KTX loader, which retains the original bytes for context
recovery. The public Texture wrapper applies compressed orientation before
the texture is returned to material code.

Complete compressed mip chains are preserved. Partial chains use their base
level without mip filtering. Big-endian compressed containers, non-power-of-two
mip chains, and WebGPU base dimensions that are not aligned to compression
blocks use software decoding when available. DXT1/3/5 and ETC1 can decode to
RGBA; that path regenerates mips from the base image. Other unsupported formats
try the existing JPG/PNG/TGA alternative, then a placeholder.

Compressed files with truncated blocks or mip data are rejected before native
upload. Legacy uncompressed files may keep a valid base image when trailing
mips are incomplete. Cube/array/volume containers are not accepted by this 2D
loader. `createTextureFromKTX1` is asynchronous; callers must await it.

## Implementation files

- `src/engine/loader/pk3/PK3Index.ts`
- `src/engine/loader/pk3/PK3Loader.ts`
- `src/engine/loader/pk3/NodePk3.ts`
- `scripts/generate-pk3-index.mjs`
