# Feature status

This page describes current capability boundaries. Exact commands, defaults, and APIs remain in source and the focused guides.

## Core and content

| Area | Current support | Important boundary |
| --- | --- | --- |
| BSP | Q3 IBSP v46 and Warsow/qfusion FBSP v1, all four face types, lightmaps, lightgrid, PVS | Entity presence does not imply gameplay behavior |
| PK3 | Manifest discovery, runtime index, archive overrides, browser/headless lookup | External data is not committed |
| Q3 shaders | Stages, blending, alpha/depth/cull flags, tcMod, environment tcGen, wave color/alpha, animation, autosprites | Not full renderer parity; most non-sprite vertex deforms are skipped |
| Text maps | Parser, brush/patch handling, raw `MapRenderer`, custom entity registry | Active high-level `MapLoader` local-map branch is TODO |
| Models/textures | Babylon loader integration, PK3 assets, compressed-texture tooling | Availability depends on shipped media and target decoder support |

## Rendering

The active BSP path supports baked lightmaps, optional deluxe/PBR material branches, skyboxes, fog volumes, post-processing, area lights, god rays, SSR, render variables, and debug views.

Quality and compatibility vary by map and device. Renderer switches that change material construction may require a map reload. See [Render variables](../guides/render-variables.md) and [Shader system](../guides/shader-system.md).

## Gameplay

The FPS module includes Quake/Warsow-style movement, weapons, pickups, HUD state, gametypes, death/respawn presentation, demos, spectator paths, and bot integrations.

Movement and combat are designed around an authoritative server with shared deterministic rules. Features should be verified in the relevant client and server path rather than inferred from a Babylon visual object.

## Networking

Implemented systems include:

- authoritative server ticks and user commands;
- client prediction and reconciliation;
- snapshot encoding, buffering, and remote interpolation;
- clock synchronization and network diagnostics;
- server-side lag compensation for hit registration, within a fixed rewind budget;
- a lobby with accounts, rooms, match tickets and stored results;
- dedicated server, headless client, fuzz, and demo tools.

Rates and defaults are configuration, not permanent product claims. Inspect the server configuration and current [Networking guide](../guides/networking.md).

## Cameras and input

Built-in controllers:

- FPS;
- freefly;
- isometric;
- sidescroll;
- follow;
- spectator, which the FPS `spectator` command drives rather than `camera mode`.

The console syntax `camera mode <controller>` selects these built-ins. `CameraSystem` separately supports perspective, orthographic, and fake-orthographic projection modes through code.

Input is action-based. The FPS module registers the active default action map, including movement, weapons, UI, and console.

## Tooling

| Tool | Purpose |
| --- | --- |
| `cli:game` | Engine commands and indexed BSP inspection under NullEngine |
| `cli:bsp` | Direct filesystem BSP analysis |
| `net:server` / `net:client` | Dedicated-server protocol smoke tests |
| `test:simulation` / `test:physics` | Deterministic movement/collision checks |
| `server:tick` / `server:fuzz` | Server regression and fuzz runs |
| `demo:record` / `demo:verify` | Demo capture and deterministic reconciliation |
| `lobby:server` / `bot:server` | Lobby with accounts and rooms; the bot fleet it asks for players |
| `docs:api` / `docs:build` | TypeDoc and manual builds |

## Platform status

| Target | Status |
| --- | --- |
| Web | Primary Vite build |
| Headless Node | Active CLI/server/test tooling |
| Android | Capacitor project exists; its app identity is still another product's, and the splash screen is never hidden — both need a device |
| Electron | Shell exists; packaging config loads and names the selected game |
| iOS | No committed native project |

See [Deployment](../deployment/) for the verified workflow and known blockers.

## Known limits

- no built-in map editor;
- incomplete Q3 shader parity;
- raw text maps are not yet a first-class playable FPS load path;
- platform wrappers do not have equal release readiness;
- external media licensing and redistribution remain the game developer’s responsibility.
