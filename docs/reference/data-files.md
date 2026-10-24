# Data and Definition Files

> Verified on 2026-08-06.

The old strains, progression, NPC, item, and quest JSON database is not in the runtime.

| Path | Purpose |
|---|---|
| <code>public/engine.json</code> | Game and engine roots |
| <code>src/games/fps/game.json</code> | FPS metadata |
| <code>config/maps.json</code> | Lobby map/mode metadata |
| <code>public/data</code> | PK3 media and generated manifests |
| <code>src/shared/entities/definitions</code> | Typed gameplay definitions |
| <code>src/shared/bsp</code> | Deterministic BSP tables |

Typed definitions let browser, server, prediction, replay, and tests share data.

Generated files include <code>public/data/pk3_manifest.json</code> and <code>public/data/ktx2cache/manifest.json</code>. Rebuild them with:

    npm run tools:manifest
    npm run tools:textures

<code>GamePaths</code> defines optional engine-settings, UI, HUD, and <code>config.json</code> paths. A helper does not prove a file exists. Missing <code>engine-settings.json</code> uses defaults.

<code>AssetLoader</code> still understands <code>/games/&lt;id&gt;/config.json</code> for the generic <code>EngineScene</code> raw-map path. The direct FPS bootstrap does not call <code>AssetLoader.loadAll()</code>, so this file is not an active FPS data source.

FPS media comes from PK3s. The selected id is <code>fps</code>; <code>public/games/default</code> contains animation assets.

Validate through the shared index:

    npm --prefix src/games/fps run cli:game -- --exec "bsp load wdm2; bsp info; quit"
