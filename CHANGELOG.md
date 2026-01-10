# Changelog

## [0.8.17] - 2026-01-10

### Changed
- **Console System Refactor**: Migrated all engine commands to modular Command classes
  - 53 command classes in `src/engine/console/commands/`
  - Commands auto-discovered via Vite glob imports
  - Removed old `ConsoleCommandRegistry` and JSON command definitions
- **Game Commands**: Renamed to avoid conflicts with engine standard commands
  - `spawn` → `npc` (subcommands: spawn, dealer, customer, list)
  - `teleport` → `goto` (named locations: home, shop, dealer)
- **Documentation**: Updated console system guide and added command reference
- **BSP Collision Optimization**: Improved collision detection accuracy and performance
  - HINT brushes now non-solid (filtered in all collision backends)
  - Detail brushes excluded from Babylon native collision
  - Caulk brushes generate collision meshes to prevent camera leaks
  - Enhanced PLAYERCLIP/fullclip texture detection in `MapLoader`
  - Added debug logging for detail brush classification in `BspMeshBuilder`

### Fixed
- UI config path (`/game/` → `/games/default/`)
- Click handling for build zones and triggers (UI bounds detection)
- Scene initialization in `map` command
- `freefly_collision clipviz` command now properly visualizes fullclip/playerclip brushes
  - Fixed broken convex hull generation (removed incorrect flipInside logic)
  - Added robust texture lookup (checks both brush and brush side shader indices)
  - Verified working in headless mode (135 meshes in wdm2)

## [0.8.16] - Previous Release

See git history for previous changes.
