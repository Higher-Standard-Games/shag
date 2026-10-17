# PK3 filesystem

SHAG reads Quake 3 and Warsow assets from PK3 archives through a shared virtual filesystem. Browser and headless map loading both use the PK3 index.

## Data location and index

Game archives belong under `public/data/` and are intentionally excluded from Git.
The Vanguard player model and animation GLBs are shipped in
`player_model_vanguard.pk3`; see [packaged player models](model-loading.md#packaged-player-model)
for rebuilding it from the unserved asset sources.
The generator scans that directory and publishes two matched files: discovery
in `pk3_manifest.json` and file/shader/map ownership in `pk3_index.json`.

```bash
npm run tools:manifest
# Equivalent explicit command:
npm run tools:pk3-index
# Generate from the curated directory you intend to deploy:
npm run tools:pk3-index -- --data-dir ./release-data
```

`npm run build` generates both files automatically before Vite copies the public
assets. Deploy the JSON files with the same archives they describe; direct
`vite build` users must generate them first. The generator uses the runtime
indexer, preserving alphabetical overrides and shader/map lookup behavior.
It fails without replacing published metadata if an archive is corrupt or
changes while indexing. An empty data directory is valid for source-only builds.

At runtime, `PK3Index` first loads and validates the published searchable index.
This fetches the two small metadata files with HTTP revalidation and avoids
downloading every archive or sending a HEAD request per archive at boot.
Packages still download lazily for the selected map and its dependencies:

```ts
import { PK3Index } from '../../../src/engine/loader/pk3/PK3Index';

const index = PK3Index.getInstance();
await index.ensureIndex();

const map = index.findMap('wdm2');
const owner = index.findFile('scripts/common.shader');
const maps = index.findByPattern('maps/*.bsp');
```

`PK3Index` owns discovery and lookup.

Missing/stale/unsupported metadata and older files-only manifests retain the
archive-scan/cache-validation path. The manifest's `indexHash` is a consistency
fingerprint of the index payload, not a signature or PK3 integrity guarantee.
Package URLs from the snapshot are ignored and rebased to the configured search
paths. Blocked localStorage does not prevent using the in-memory index.
The generator does not curate or remove packages: prepare the desired release
directory first. Regenerate metadata after changing its contents.

### Curated map media

Shared cartoon hit artwork ships in `effects.pk3`, with virtual paths
`effects/cartoonhit1.png` and `effects/cartoonhit2.png`. Rebuild it with
`npm run tools:effects` from the unserved originals in `archive/media/effects/`,
or pass `-- --source-dir <directory>`. Regenerate the PK3 index after rebuilding.
The packager verifies PNG signatures, ZIP CRCs and unchanged image hashes.

`npm run tools:map-media -- --maps wdm2,wfdm5,wfdm11 --combined --output-dir .cache/map-media`
builds `map_<name>.pk3`, intermediate `tex_<name>.pk3` banks and a combined
`textures.pk3` in a staging directory from the
current ownership index. It uses the runtime BSP/shader parsers, keeps source
bytes and shader conditionals/templates, and includes provenance manifests.
It refuses to overwrite indexed input packages. `--audit-only` writes only the
dependency report. Install reviewed packages into `public/data/` and regenerate
the index before testing them. For the three-map deployment, install the map
packages and `textures.pk3`; archive the intermediate texture banks. Combining
deduplicates identical files and shaders and rejects conflicting definitions.

Shared paths still obey the global alphabetical override rule. The combined bank
trades a larger first-map download for one shared cache across these three maps.
See `docs/research/media_packaging.md` in the repository for measured loading,
archive/rollback steps, remaining shared dependencies and the audio replacement list.

Asset requests have a 15-second header deadline. Archive bodies have a 60-second
idle deadline, renewed by incoming chunks, and a generous 15-minute total limit.
Metadata bodies use 15 seconds idle / 60 seconds total. Timed-out mirror requests
release origin fallback; unavailable optional KTX2 metadata releases the ordinary
texture path. These are application deadlines in addition to browser networking.

Downloaded archives are structurally parsed inside the retry operation. Corrupt
or interrupted downloads retry up to twice, using origin after the first attempt;
ordinary permanent HTTP errors such as 404 do not incur retries. The parsed ZIP
is reused on success. Final errors retain the loading/corruption cause instead of
reporting every failure as a missing package.

## HTTP mirror

The pk3 packages are most of what a browser downloads, so they can come from
an HTTP mirror instead of the server that serves the game. Build the client
with the mirror's address:

```bash
VITE_PK3_MIRROR_URL=https://mirror.example.net/washoi/ npm run build
```

The mirror holds a copy of `public/data/`'s pk3 files at the same paths:
`data/map_wdm2.pk3` is `<mirror>/map_wdm2.pk3`. For every pk3 the index or
the loader downloads, the client asks the mirror for it and, at the same time,
sends a HEAD request to the game's own server. It takes the mirror's copy
when the mirror has the file and its size matches the server's. Otherwise,
when the mirror lacks the file, holds another size (stale, or half
uploaded), answers with a web page or can't be reached, the file comes from
the game's server, with a `[Pk3Mirror]` warning in the console. A
file the game's server doesn't have is never taken from the mirror.

What the mirror has to do:

- **Allow the game's origin:** `Access-Control-Allow-Origin` with the game's
  address, or `*`.
- **Send `Content-Length`, and don't compress pk3s:** the size check compares
  the two servers' `Content-Length`. pk3s are zip files and gain nothing from
  compression.
- **Redirect to spread load, if it wants:** one mirror is configured, and the
  client follows redirects, so the mirror can send requests on to others.

Keep it in step by copying `public/data/*.pk3` after every change, for example
with `rsync`. A file missing on the mirror only costs the game's server that
one download.

Only pk3 packages are mirrored. Loose files under `data/` (levelshots, KTX2
sidecars, demos) still come from the game's server.

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

`loadPK3(filename)` takes a filename only. When multiple indexed packages contain the same path, packages are processed alphabetically and a later package wins. Name override packages accordingly and verify the winning archive with `pk3 find`.

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
Sidecars whose base width or height is not divisible by four decode to RGBA
so the authored dimensions and UVs remain valid on both renderers. Aligned
images retain the normal compressed-format selection.
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
- `src/engine/loader/pk3/PK3PublishedIndex.ts`
- `src/engine/loader/pk3/PK3Loader.ts`
- `src/engine/loader/pk3/Pk3Mirror.ts`
- `src/engine/loader/pk3/NodePk3.ts`
- `scripts/generate-pk3-index.mjs`
- `src/cli/generate-pk3-index.ts`
- `src/cli/pk3-index-build.ts`
