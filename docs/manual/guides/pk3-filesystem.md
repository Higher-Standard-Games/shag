# PK3 filesystem

SHAG reads Quake 3 and Warsow assets from PK3 archives through a shared virtual filesystem. Browser and headless map loading both use the PK3 index.

## Data location and index

Game archives belong under `public/data/` and are intentionally excluded from Git.
The Vanguard player model and animation GLBs are shipped in
`washoi_player_model.pk3`; see [packaged player models](model-loading.md#packaged-player-model)
for rebuilding it from the unserved asset sources.
The generator scans that directory and publishes two matched files: discovery
in `pk3_manifest.json` and file/shader/map ownership in `pk3_index.json`.
`config/pk3-packages.json` supplies an `ignoredPackages` array of exact PK3
basenames (case-insensitive, no paths or globs). Ignored archives stay on disk
but are excluded from both generated files, KTX2 source selection and the Vite
release output. The policy is build-time input, not an editable generated
manifest field or a runtime access restriction. It also applies with `--data-dir`.
Its `sharedTexturePackages` rules route configured virtual-path prefixes out of
map banks and declare shared dependencies in each affected map's package manifest.

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

Shader indexing reads complete top-level definitions, including bare names such
as `halo`, `halo_large` and underscore-named map-model materials. These aliases
have the same ownership and dependency lookup behavior as `textures/...` names.
It fails without replacing published metadata if an archive is corrupt or
changes while indexing. An empty data directory is valid for source-only builds.

Editable billboard images and overlays ship in `tex_billboard.pk3`; see
[billboard updates](#billboard-updates). DM2's fixed neon/logo artwork remains in
its map bank. `npm run tools:branding` applies all tracked branding images to
the master after an upstream rebuild. Rebuild/install map banks after changing
their static source artwork, then regenerate metadata and applicable KTX2 sidecars.

At runtime, `PK3Index` first loads and validates the published searchable index.
This fetches the two small metadata files with HTTP revalidation and avoids
downloading every archive or sending a HEAD request per archive at boot.
Packages still download lazily for the selected map and its dependencies.

The startup and map-loading screens display active HTTP package transfers above
the overall loading bar. Each transfer shows its filename, received and total
size in decimal MB, a recent transfer rate in MB/s, and its own progress bar.
When the response has no usable uncompressed `Content-Length`, the screen shows
received MB and an indeterminate bar. Connecting, retrying and preparing the
archive are separate states. Up to three packages are listed together, with a
count of additional active transfers. The panel disappears when transfers finish;
the overall loading bar continues through map preparation. Packages already in
memory do not produce a transfer indicator.

```ts
import { PK3Index } from '../../../src/engine/loader/pk3/PK3Index';

const index = PK3Index.getInstance();
await index.ensureIndex();

const map = index.findMap('washoi_dm2');
const owner = index.findFile('scripts/common.shader');
const maps = index.findByPattern('maps/*.bsp');
```

`PK3Index` owns discovery and lookup.

Ordinary browser consumers mount archives with `PK3Loader.ensurePK3(filename)`
or `ensurePK3FromUrl(url)`. Concurrent ensures for the same resolved URL share
one request, ZIP parse and mount; mounted sources are reused. Different source
URLs and revision queries remain distinct. Failed requests can be retried.
Filename ensures also reuse explicitly ingested local archives. Unloading the
filesystem prevents late responses from remounting it.

`loadPK3` and `loadPK3FromUrl` explicitly reload an archive, including one already
mounted. Use these for intentional refreshes. A newer explicit load supersedes
an older pending response for the same package filename; alphabetical package
override order still decides file ownership.

Missing/stale/unsupported metadata and older files-only manifests retain the
archive-scan/cache-validation path. The manifest's `indexHash` is a consistency
fingerprint of the index payload, not a signature or PK3 integrity guarantee.
Package URLs from the snapshot are ignored and rebased to the configured search
paths. Blocked localStorage does not prevent using the in-memory index.
The generator filters the configured ignored packages but does not delete source
archives or infer which other packages belong in a release. Regenerate metadata
after changing packages or the policy.

### Curated map media

The shipped map IDs are `washoi_dm2`, `washoi_dm5` and `washoi_dm11`, in matching
`map_<name>.pk3` packages. BSP contents and texture/shader paths retain their
original bytes. `npm run tools:rename-maps` stages these package/entry renames
from the backups in `archive/media/map-renames/`; `-- --source-dir <directory>
--output-dir <directory>` selects another source/output. The tool verifies ZIP
CRCs and entry hashes. It does not edit BSP geometry or shader names.

### Map levelshots

Each production map package owns `levelshots/<map>.png`, the full-resolution
original. `tools:rename-maps` reads these production PNGs from
`archive/media/levelshots/` (override with `--levelshots-dir <directory>`).

`npm run tools:pk3-index` also creates JPG previews, at most 960 by 540 pixels,
in `public/data/levelshots/`. `npm run build` does this automatically. The lobby,
loading screens, settings previews and demo browser use these small JPG URLs,
so viewing thumbnails does not download the BSP packages. Old demo map names
resolve to the production thumbnail names.

Deploy the generated previews with the PK3 index and archives. Edit the PNG in
the map package when updating artwork; loose JPGs are generated outputs.
`levelshots/generated.json` tracks generated files so index generation removes
only stale generated previews. Maps without a packaged PNG keep their UI's
gradient fallback; generation does not restore deleted artwork from elsewhere.

Ammo-crate artwork ships in `washoi_gfx.pk3` at its existing virtual paths
`gfx/hud/icons/ammo/*.tga`. Both procedural and MD3 pickups load the indexed
owner before resolving the texture. Rebuild the eight used icons with
`npm run tools:gfx` from `archive/media/gfx/`, or pass
`-- --source-dir <directory> --output <file>`. The source directory mirrors
virtual paths. The unused gunblade icon stays archived. The packager checks TGA
headers, ZIP CRCs and unchanged byte hashes; regenerate the index after rebuilding.

Shared cartoon hit artwork ships in `effects.pk3`, with virtual paths
`effects/cartoonhit1.png` and `effects/cartoonhit2.png`. Rebuild it with
`npm run tools:effects` from the unserved originals in `archive/media/effects/`,
or pass `-- --source-dir <directory>`. Regenerate the PK3 index after rebuilding.
The packager verifies PNG signatures, ZIP CRCs and unchanged image hashes.

`washoi_textures.pk3` is the retained master source bank, listed in
`config/pk3-packages.json`'s `ignoredPackages`. The five shipped maps have
`tex_<map>.pk3` dependency banks. Shared textures are deliberately duplicated;
gameplay packages for weapons, player models, sound and effects remain separate.

```bash
npm run tools:map-media -- --maps washoi_dm2,washoi_dm5,washoi_dm11,washoi_amphi1,washoi_snd1 --master-package washoi_textures.pk3 --output-dir .cache/map-media
```

This builds `map_<name>.pk3` and `tex_<name>.pk3` in a staging directory.
`--master-package` builds a temporary source index including the explicit master
and excluding existing `tex_` banks, so an edited master wins over stale per-map
copies. It does not publish the master or replace the live metadata. Without
this flag the tool reads the published ownership index. It uses the runtime BSP/shader parsers, keeps source
bytes and shader conditionals/templates, and includes provenance manifests.
It refuses to overwrite indexed input packages. `--audit-only` writes only the
dependency report. Install reviewed packages into `public/data/` and regenerate
the index before testing them. Install the five `tex_` banks; do not replace the
master with them. Existing map packages need replacement only if their content
changed. `--combined` remains a development utility that deduplicates identical
files/shaders and rejects conflicting definitions; its output is not deployed
as the production texture bank.

When `tex_<map>.pk3` is indexed, the client loads it before resolving map assets.
Its `media-manifests/<map>.json` must identify that map. Other indexed maps' exact
`tex_<map>.pk3` banks are excluded from the active filesystem and ownership lookup,
so shared paths resolve to the active map's copy. Downloaded banks stay cached for
later map switches; their assets and shader definitions do not leak into the
next map. Shader lookup refreshes when the mounted filesystem changes.

Non-peer packages retain normal alphabetical override priority, including
deliberate user overrides. Maps without an indexed companion use the legacy
global dependency lookup. A companion that fails to load or has an invalid map
manifest fails the map load rather than downloading another map's bank. The
published index remains global; the active scope is local runtime state. See
`docs/research/per_map_texture_packages.md` in the repository for the local
installation, measurements, rollback and remaining work; the older
`docs/research/media_packaging.md` records the previous combined-bank deployment.

### Billboard updates

`config/pk3-packages.json` routes `textures/billboard/` to the shared
`tex_billboard.pk3` with `dynamic: true`. These paths are excluded from map banks;
affected map manifests declare the shared package. This is a texture-path rule,
not a list of game maps to ignore. The client loads shared dependencies explicitly
and keeps them visible across map scopes. Unaffected maps do not fetch the bank.

```bash
npm run tools:billboards
npm run tools:manifest
```

`tools:billboards` builds the shared bank from the master's billboard files,
applying the nine configured ad PNGs in `assets/billboards/`. It includes animation
frames, scanline/code overlays and source attribution, preserving virtual paths.
`--package <source-master>`, `--source-dir <artwork-directory>` and `--output <file>`
select alternate inputs/output. It verifies PNG dimensions, ZIP CRCs and output
hashes, refuses to overwrite its master input and archives an existing output
by content hash under `archive/media/billboard-bank/`.

The first split requires rebuilding/installing the map banks once. Later ad-image
updates need only the shared PK3 and regenerated manifest/index. Upload those
three files together on origin and mirror, preserving existing paths and image
dimensions. No BSP or per-map texture upload is required for an image replacement.
Billboard shader bindings/animation definitions remain in map banks; changing
those definitions still requires rebuilding the affected map bank.

Dynamic dependencies use a metadata-revision query in their download URL, so a
regenerated index also invalidates same-size package replacements. Their texture
prefixes bypass KTX2 sidecars, and the KTX2 generator excludes those paths. This
prevents an old sidecar from covering new ad artwork. Players receive changes
after a game-page reload; there is no automatic mid-match refresh or ad-management
service. A loaded bank is reused through ordinary map switches.

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
`data/map_washoi_dm2.pk3` is `<mirror>/map_washoi_dm2.pk3`. For every pk3 the index or
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
pk3 find maps/washoi_dm2.bsp
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
map washoi_dm2 duel
```

The headless/inspection flow uses:

```bash
npm --prefix src/games/fps run cli:game -- --exec 'bsp load washoi_dm2; bsp info; quit'
```

Headless loading resolves the BSP through the same PK3 index. Do not add ad-hoc filesystem searches for map files.

## KTX2 sidecar loading

Normal and scalar companion maps are encoded as linear data. The converter
assigns their input transfer function explicitly, preserving neutral normal
components near 128 instead of applying an sRGB color conversion. Generator v3
invalidates earlier cache manifests; rebuild and deploy the cache together with
its manifest after upgrading the converter.

Rebuild sidecars after replacing source artwork or repackaging media. Runtime
loading trusts the sidecar manifest and does not compare source signatures.
`npm run tools:textures` incrementally refreshes changed sources; for a complete
rebuild, archive the existing `public/data/ktx2cache` directory first, then run
that command. Set `KTX_TOOLS_PATH` to the KTX executable when it is not on PATH.
Reload the browser page after replacing a cache to release loaded GPU textures.

Pickup model preloading loads the `modelPath` of each weapon and ammo
definition placed in the map. The FPS game's ammo, health, armour and powerup
pickups are procedural and have no `modelPath`, so only weapon models load.

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
capabilities. ETC1 blocks are valid ETC2 RGB8 data, so where the device
supports ETC2 an ETC1 file is uploaded relabelled as ETC2 on both WebGL2 and
WebGPU; WebGL2 cannot fill an ETC1 mip chain (`compressedTexSubImage2D` does not
accept the format), so without ETC2 an ETC1 mip chain is decoded in software.
Compressed uploads
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

## FPS sound bank

Production effects and announcers are in `public/data/washoi_sounds.pk3`.
`npm run tools:sounds` builds it from hashed source files staged under
`assets-source/sounds`, using `config/sound-package.json`. Weapons use Warfork's
CC BY-SA 3.0 US recordings (strong variants); other effects and player voices
use CC0. The package includes both upstream notices and a per-file license/source
manifest. Existing supported `sounds/` paths
remain compatible. The extensionless UI keys `ui_click` and `button_press` resolve
to packaged WAV aliases; reload feedback uses `sounds/weapons/reload.ogg`.

`npm --prefix src/games/fps run tools:sounds:audit` writes the usage/status matrix under
`docs/research/media/`. It expands the real FPS preload banks, scans source string
literals, and reads the three production BSPs through the published PK3 index.
It distinguishes supported cues, preloads without playback, and retained
compatibility files. Rebuild discovery with `npm run tools:pk3-index` after
installing the package. The old legacy audio archive is outside `public/data`.
The soundtrack remains a separate package.

Gameplay settings select Male, Female or Bobot voices for each side through
the persisted `cl_team_ally_sounds` and `cl_team_enemy_sounds` cvars. Defaults
are `male` and `bobot`. Invalid values fall back to those defaults. Player
allegiance follows the same team aliases as colors, relative to the local or
followed POV. Padpork media is deliberately excluded from the recipe.

## Implementation files

- `src/engine/loader/pk3/PK3Index.ts`
- `src/engine/loader/pk3/PK3PublishedIndex.ts`
- `src/engine/loader/pk3/PK3Loader.ts`
- `src/engine/loader/pk3/Pk3Mirror.ts`
- `src/engine/loader/pk3/NodePk3.ts`
- `scripts/generate-pk3-index.mjs`
- `src/cli/generate-pk3-index.ts`
- `src/cli/pk3-index-build.ts`
