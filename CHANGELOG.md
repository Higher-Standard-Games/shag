# Changelog

## [0.8.17] - 2026-01-09

### Changed
- **Console System Refactor**: Migrated all engine commands to modular Command classes
  - 53 command classes in `src/engine/console/commands/`
  - Commands auto-discovered via Vite glob imports
  - Removed old `ConsoleCommandRegistry` and JSON command definitions
- **Game Commands**: Renamed to avoid conflicts with engine standard commands
  - `spawn` → `npc` (subcommands: spawn, dealer, customer, list)
  - `teleport` → `goto` (named locations: home, shop, dealer)
- **Documentation**: Updated console system guide and added command reference

### Fixed
- UI config path (`/game/` → `/games/default/`)
- Click handling for build zones and triggers (UI bounds detection)
- Scene initialization in `map` command

## [0.8.16] - Previous Release

See git history for previous changes.
