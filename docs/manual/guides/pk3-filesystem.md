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
```

`pk3 list` lists indexed packages. Use `pk3 find <exact-path>` for ownership or `PK3Index.findByPattern` in code for wildcard file listings.

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

## Source of truth

- `src/engine/loader/pk3/PK3Index.ts`
- `src/engine/loader/pk3/PK3Loader.ts`
- `src/engine/loader/pk3/NodePk3.ts`
- `scripts/generate-pk3-index.mjs`
