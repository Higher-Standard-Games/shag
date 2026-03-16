# Networking Feature Matrix — v1 vs v2

## Architecture Summary

The game uses a **hybrid** of both stacks:

- **v1** for protocol/serialization and client networking
- **v2** for server-side simulation, ECS, and subsystems
- **v2 protocol** (`InputProtocol`/`SnapshotProtocol`) is **NOT in game path** — only CLI test tools

---

## v1: `engine/network/` — Client & Protocol Layer

| Area | Key Files | Used By | Status |
|------|-----------|---------|--------|
| **Protocol** | `MessageCodec.ts`, `BinaryProtocol.ts` | `GameServer.ts`, `NetworkGameHost.ts`, `FPSGameManager.ts` | ✅ Active — ALL game traffic |
| **Components** | `TransformComponent.ts`, `VelocityComponent.ts`, `InputComponent.ts`, `MovementStateComponent.ts`, `ProjectileComponent.ts` | Client simulation, `FPSSimulation.ts`, movement code | ✅ Active |
| **Core** | `GameState.ts`, `Entity.ts`, `Simulation.ts`, `Command.ts`, `IGameHost.ts` | `GameServer.ts`, `FPSGameManager.ts`, `NetworkGameHost.ts` | ✅ Active |
| **Client** | `NetworkGameHost.ts`, `LocalGameHost.ts`, `ClockSync.ts`, `Transport.ts` | `FPSGameManager.ts` | ✅ Active |
| **Systems** | `MovementSystem.ts`, `CollisionWorld.ts` | `FPSSimulation.ts`, all server subsystems | ✅ Active |
| **NetworkManager** | `NetworkManager.ts` | Unclear — may be vestigial | ⚠️ Check |

## v2: `engine/server/` — Server Simulation Layer

| Area | Key Files | Used By | Status |
|------|-----------|---------|--------|
| **Core** | `Simulation.ts`, `WorldState.ts`, `Subsystem.ts` | `GameServer.ts`, all subsystems | ✅ Active |
| **ECS** | `Entity.ts`, `types.ts` (EntityType, PlayerId, etc.) | `GameServer.ts`, all subsystems, gametypes | ✅ Active |
| **Tick** | `TickLoop.ts`, etc. | `GameServer.ts` | ✅ Active |
| **Lag Comp** | `lagcomp/` | Server-side hit detection | ✅ Active |
| **PVS** | `ServerPVS.ts` | `GameServer.ts` | ✅ Active |
| **Replay** | `replay/Replay.ts` | CLI replay tool | ⚠️ CLI only |
| **Protocol** | `InputProtocol.ts`, `SnapshotProtocol.ts`, `BinaryEncoder.ts` | `ClientManager.ts`, CLI bench/test tools | ❌ **Not in game path** |
| **Transport** | `transport/` | `ClientManager.ts` | ❌ **Not in game path** |
| **ClientManager** | `ClientManager.ts` | Nothing in `src/games/` | ❌ **Not in game path** |

## Data Flow (Actual Game)

```
CLIENT                              SERVER
──────                              ──────
FPSGameManager                      GameServer
  └─ NetworkGameHost                  ├─ v2 Simulation (WorldState, Subsystems)
      ├─ MessageCodec.encodeCommand → MessageCodec.decodeCommand
      ├─ MessageCodec.encodeAck     → MessageCodec.decodeAck
      ├─ MessageCodec.encodePing    → MessageCodec.decodePing
      ├─ MessageCodec.decodeSnapshot ← MessageCodec.encodeSnapshot
      ├─ MessageCodec.decodeWelcome  ← MessageCodec.encodeWelcome
      └─ MessageCodec.decodePong     ← MessageCodec.encodePong
```

> [!NOTE]
> The v2 `ClientManager.ts` + `InputProtocol` + `SnapshotProtocol` appear to be a **planned replacement** for the v1 `MessageCodec` path in `GameServer.ts`, but this migration hasn't happened yet. The v2 protocol has better binary encoding (quantized positions, varint IDs, packed buttons) but isn't wired into the game.
