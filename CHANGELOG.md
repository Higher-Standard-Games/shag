# Changelog

## [0.8.18] - 2026-01-11

### Added
- **Q3-Style Authoritative Networking**: Complete multiplayer networking system
  - Server-authoritative architecture with client prediction
  - Smooth correction instead of snap correction for visual quality
  - Entity interpolation buffer for smooth remote player rendering
  - WebSocket transport with binary protocol

- **Binary Protocol**: Efficient network message encoding
  - MessageType prefixes (Server→Client: 0x01-0x08, Client→Server: 0x81-0x84)
  - Delta compression for entity components (position, velocity)
  - UTF-8 string encoding for bandwidth efficiency
  - Bounds checking in BinaryDecoder for robustness

- **Console Commands**: In-game networking controls
  - `connect <url>` - Connect to game server (e.g., `connect localhost:7777`)
  - `disconnect` - Disconnect from current server
  - `network status` - Show connection status
  - `network init [mode]` - Initialize networking (local|network|listen)
  - `net` alias for all network commands

- **CLI Tools**: Headless server and client for testing
  - `npm run net:server` - Start dedicated server
  - `npm run net:client` - Start test client
  - Command-line options: `--port`, `--name`, `--map`, `--max`, `--connect`

- **NetworkManager API**: Programmatic networking control
  - `connect(url)` / `disconnect()` methods
  - `onConnectionChange()` callback for connection state
  - `onStateUpdate()` for game state changes
  - `getMode()` returns 'local' | 'network' | null

- **Network Module Exports**: Clean public API via `./engine/network`
  - Core: Entity, GameState, Simulation, Command
  - Protocol: BinaryProtocol, MessageCodec, MessageType
  - Hosts: LocalGameHost, NetworkGameHost
  - Server: GameServer, Room

- **Documentation**: Comprehensive networking guides
  - `docs/manual/guides/networking.md` - Full networking guide
  - `docs/manual/tools/network-server.md` - Server CLI reference
  - `docs/manual/tools/network-client.md` - Client CLI reference
  - Updated command reference with networking commands

### Architecture
- **IGameHost Interface**: Abstraction for local vs networked games
  - `LocalGameHost` - Single-player, runs simulation in-process
  - `NetworkGameHost` - Multiplayer client with prediction
- **Room-based Server**: Game instances managed by Room class
  - 20 Hz tick rate (50ms per tick)
  - Automatic room cleanup when empty
- **Transport Layer**: WebSocket with WebTransport fallback ready

### Technical Details
- Connection handshake: Welcome → Join → JoinAccept → Snapshot stream
- Prediction reconciliation with configurable thresholds (0.5 smooth, 100 snap)
- Timestamp encoding uses 32-bit wrap (safe for ~49 days)
- Full state snapshots with delta-compressed component values

## [0.8.17] - 2026-01-10

### Added
- **Q3-Style Collision System**: New `SweepCollisionBackend` with proper movement physics
  - `clipVelocity()` - Removes velocity component going into surfaces
  - `slideMove()` - Up to 4 iterations with multi-plane handling for smooth wall sliding
  - `stepSlideMove()` - Stair stepping (STEPSIZE=18 units) for walking up stairs
  - Handles corners by sliding along crease (cross product of planes)
  - Stops cleanly when stuck in 3+ planes
- **Playerclip Detection**: Direct brush iteration for clip brushes (bypasses BSP tree)
  - Ensures fullclip/playerclip always block regardless of BSP leaf traversal

### Changed
- **FreeflyController**: Now uses `stepSlideMove` for smooth collision response
  - Camera slides along walls instead of teleporting/jumping
  - Stairs work in both directions (up and down)
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
