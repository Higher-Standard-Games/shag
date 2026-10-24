# Building a map browser

The current engine already owns map indexing and loading. A map browser should be a UI over those services, not a second PK3 scanner or a new `MapLoader` instance.

## List indexed maps

```ts
import { PK3Index } from '../../../../src/engine/loader/pk3/PK3Index';

const index = PK3Index.getInstance();
await index.ensureIndex();

const entries = index.findByPattern('maps/*.bsp');
const mapNames = entries.map(({ file, pk3 }) => ({
  name: file.replace(/^maps\//, '').replace(/\.bsp$/i, ''),
  pk3,
}));
```

Deduplicate map names before presenting them. Keep the archive name in diagnostic UI so override problems are visible.

## Launch a selection

For an in-browser FPS map browser, invoke the same gameplay command as the lobby:

```ts
import { CommandRegistry } from '../../../../src/engine/console/CommandRegistry';

await CommandRegistry.getInstance().executeChecked('map washoi_dm2 duel');
```

The selected game composition must have registered `GameplayMapLauncher`. If the browser is only an inspection tool, use `MapLoader.getInstance().loadMap(name, scene)` or the `bsp` command path deliberately.

## UI responsibilities

- show an empty-state explaining `public/data/` and the manifest;
- disable duplicate launches while loading;
- surface `executeChecked().output` on failure;
- subscribe to loading events and unsubscribe on disposal;
- avoid inventing map metadata not present in the BSP/manifest;
- keep a stable selected item while the index refreshes.

## Validate

```bash
npm --prefix src/games/fps run cli:game -- --exec 'bsp load washoi_dm2; bsp info; quit'
npm run typecheck
```

Then verify the UI and gameplay launcher in the browser.
