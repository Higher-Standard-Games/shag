# Engine Reference

> Verified against SHAG Engine 0.9.22 on 2026-08-06.

This directory is a source-oriented reference for the current engine. The maintained manual in [docs/manual](../manual/index.md) remains the best place for tutorials and end-to-end workflows; these pages focus on APIs, formats, commands, and integration status.

## Start Here

- [Architecture](./ARCHITECTURE.md) — runtime composition, dependency boundaries, and service lifetimes
- [Feature Matrix](./FEATURES.md) — implemented, experimental, extension-only, and unavailable features
- [CLI Tools](./CLI_TOOLS.md) — exact package scripts and headless validation commands
- [Debug Console](./DEBUG_CONSOLE.md) — console behavior and current command inventory
- [Data and Configuration](./data-files.md) — active JSON files, generated manifests, and TypeScript definition tables

## Maps and Gameplay

- [BSP Collision](./collision.md)
- [Raw .map Format](./MAP_FORMAT.md)
- [Entities](./entities.md)
- [BSP Triggers](./triggers.md)
- [Game Paths](./GAME_PATHS.md)
- [Configuration](./config.md)

## Rendering and Content Extensions

- [Render Variables](./RENDER_VARS.md)
- [Post-processing](./post-processing.md)
- [KTX2 Textures](./ktx2-textures.md)
- [Prefabs](./prefabs.md)
- [Sprites](./sprites.md)
- [Weather Effects](./weather-effects.md)
- [UI Scaling](./ui-scaling.md)
- [Buildable System](./buildable-system.md)

Some of these are engine extension APIs used by <code>EngineScene</code> or external SHAG games and are not wired into the current FPS bootstrap. Each page calls that out explicitly.

## Platforms

- [Capacitor Integration](./capacitor.md)
- [Android Build Guide](./ANDROID_BUILD_GUIDE.md)

## Sources of Truth

When reference text and code disagree, use these in order:

1. Current TypeScript source under <code>src/</code>.
2. Script definitions in <code>package.json</code>.
3. Maintained guides under <code>docs/manual/guides/</code>.
4. This reference directory.
