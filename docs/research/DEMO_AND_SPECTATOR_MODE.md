# Demo & Spectator Mode — Research & Implementation Plan

> **Branch:** `feature/demo-spectator`
> **Date:** 2026-03-26
> **Status:** Research Complete

## Executive Summary

Spectator mode is partially implemented (freefly camera only — no player-following chase-cam). Demo recording works server-side but there's no browser playback. The lobby WATCH button exists in the UI but has no click handler. This document details the current state and what needs to change for a complete spectator + demo experience.

---

## 1. Current State Audit

### 1.1 Spectator Mode

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| State machine | [Game.ts](file:///Users/sundflux/src/priva/new/wash/shag/src/games/fps/Game.ts#L142) | ✅ Works | `'spectator' \| 'playing'` state toggle |
| Freefly camera | [SpectatorCommand.ts](file:///Users/sundflux/src/priva/new/wash/shag/src/engine/console/commands/SpectatorCommand.ts) | ✅ Works | Toggles `FreeflyController` |
| Join overlay UI | [SpectatorOverlay.ts](file:///Users/sundflux/src/priva/new/wash/shag/src/games/fps/client/SpectatorOverlay.ts) | ✅ Works | JOIN GAME / SPECTATE buttons with team support |
| Freefly HUD cue | SpectatorOverlay.ts | ✅ Works | Key binding guide panel |
| First-person bar | SpectatorOverlay.ts L136-174 | 🔲 UI only | "SPECTATING: PlayerName" bar exists but is **never shown** |
| Next/prev player | SpectatorOverlay.ts L33-34 | 🔲 Stub | Callbacks declared, never wired |
| Server join/leave | [NetworkGameHost.ts](file:///Users/sundflux/src/priva/new/wash/shag/src/engine/network/client/hosts/NetworkGameHost.ts#L216) | ✅ Works | `sendJoinGame()` / `sendSpectate()` messages |
| Chase-cam camera | — | ❌ Missing | No controller follows another player's entity |
| Server player mirroring | — | ❌ Missing | Spectator receives full GameState but doesn't extract target player position |
| Prediction disable | [Game.ts L722](file:///Users/sundflux/src/priva/new/wash/shag/src/games/fps/Game.ts#L722) | ✅ Works | `sendInput()` already skips on `spectator` state |
| Pause menu integration | [PauseMenu.ts](file:///Users/sundflux/src/priva/new/wash/shag/src/games/fps/client/hud/widgets/PauseMenu.ts) | ✅ Works | "Go Spectator" / "Join Game" buttons toggle |
| Scoreboard spectators | [Scoreboard.ts L134](file:///Users/sundflux/src/priva/new/wash/shag/src/games/fps/client/hud/widgets/Scoreboard.ts#L134) | 🔲 Partial | Collects spectator list but display untested |
| FPS actions context | [FPSActions.ts](file:///Users/sundflux/src/priva/new/wash/shag/src/games/fps/client/FPSActions.ts#L125) | ✅ Works | `fps_spectator` input context defined |

### 1.2 Demo Recording

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| Server recorder | [DemoRecorder.ts](file:///Users/sundflux/src/priva/new/wash/shag/src/games/fps/server/DemoRecorder.ts) | ✅ Works | Records full BinaryProtocol snapshots to gzipped `.shagdemo` |
| File format | DemoRecorder.ts | ✅ Works | Header + frames + index table + footer; random-access via index |
| Demo reader | [DemoReader.ts](file:///Users/sundflux/src/priva/new/wash/shag/src/shared/demo/DemoReader.ts) | ✅ Works | Parses header, index, frames. Binary search seek. |
| Browser gzip | DemoReader.ts L16-23 | ❌ Missing | Falls back to `zlib` (Node-only). Comment says "use DecompressionStream" |
| Demo archive list | LobbyServer.ts | ✅ Works | `demos:list_response` event scans demo directory |
| Lobby demo cards | LobbyPanel.ts L787-965 | ✅ Works | Full demo grid UI with card design |
| VIEW DEMO button | LobbyPanel.ts L727-736 | ⚠️ Downloads only | Triggers file download instead of in-browser playback |
| Client demo viewer | — | ❌ Missing | No demo playback UI or controller |

### 1.3 Lobby "Watch" Button

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| WATCH button UI | [LobbyPanel.ts L664](file:///Users/sundflux/src/priva/new/wash/shag/src/engine/ui/panels/LobbyPanel.ts#L664) | ⚠️ No handler | Button rendered for live matches but **no click handler** attached |
| JOIN button | LobbyPanel.ts L669-675 | ✅ Works | Calls `lobbyClient.joinLobby(m.id)` |
| Spectator join flow | — | ❌ Missing | No `connectAsSpectator()` path in Game or LobbyClient |

---

## 2. Feature Matrix

### Target Features (Priority Order)

| # | Feature | Difficulty | Dependencies |
|---|---------|-----------|-------------|
| 1 | **Chase-cam spectator** — follow a player's entity position/rotation with camera | Medium | Server already sends all entity data in GameState |
| 2 | **Player cycling** — left/right mouse buttons or keys to switch spectate target | Easy | Depends on #1 |
| 3 | **Spectator HUD** — "SPECTATING: PlayerName" bar + target player HP/weapon | Easy | Depends on #1, existing SpectatorOverlay `first-person` mode |
| 4 | **WATCH button → spectator join** in lobby | Easy | Wire click handler → `Game.initializeNetwork(url, { autoJoin: false })` |
| 5 | **Browser demo decompression** — use `DecompressionStream` for gzip in browser | Easy | Standalone change to DemoReader |
| 6 | **In-browser demo viewer** — load `.shagdemo`, play back frames at snapshot rate | Medium | Depends on #5, needs new DemoViewer controller |
| 7 | **Demo viewer spectator controls** — chase-cam + player cycling in demo playback | Easy | Depends on #1, #2, #6 (reuses same chase logic) |

---

## 3. Implementation Plan

### Phase 1: Chase-Cam Spectator (Core)

#### Server Side
**No changes needed.** The server already broadcasts full `GameState` with all entity positions to all connected clients (including spectators). Spectators receive snapshots but don't send input — this already works via `Game.ts L722`.

#### Client Side

##### [NEW] `src/games/fps/client/SpectatorController.ts`
Chase-cam controller that:
- Tracks a target entity ID 
- Each frame: reads target entity position/rotation from latest `GameState`
- Sets camera position = entity position (+ eye offset)
- Sets camera rotation = entity yaw/pitch
- No prediction, no input — purely following server state
- Methods: `setTarget(entityId)`, `nextTarget()`, `prevTarget()`, `getTargetEntityId()`

##### [MODIFY] `src/games/fps/Game.ts`
- Add `spectateTarget: string | null` field
- Add `spectatePlayer(entityId)` / `nextSpectateTarget()` / `prevSpectateTarget()` methods
- In `onServerStateUpdate()`: if spectating a player, update chase-cam position from entity data
- In `goSpectator()`: default to freefly, allow switching to chase-cam
- Wire mouse1/mouse2 (or left/right arrow) to cycle targets

##### [MODIFY] `src/games/fps/client/SpectatorOverlay.ts`
- Wire `_onNextPlayerCallback` / `_onPrevPlayerCallback` (currently stubs)
- Show `first-person` mode bar with target player name when chase-cam active
- Add "← PREV" / "NEXT →" key hints to the spectating bar

### Phase 2: Lobby Watch + HUD

##### [MODIFY] `src/engine/ui/panels/LobbyPanel.ts`
- Add click handler to WATCH button: connect to match server as spectator (`autoJoin: false`)

##### [MODIFY] `src/games/fps/client/SpectatorOverlay.ts`
- In `first-person` mode: show target player's HP, armor, weapon on the spectating bar
- Read from latest `GameState.entities.get(targetEntityId)` components

### Phase 3: Demo Viewer

##### [MODIFY] `src/shared/demo/DemoReader.ts`
- Add browser gzip support via `DecompressionStream` API (progressive or full-buffer)

##### [NEW] `src/games/fps/client/DemoViewer.ts`
- Loads `.shagdemo` file (from URL or File input)
- Plays back frames at recorded snapshot rate
- Uses `InterpolationBuffer` between frames for smooth playback
- Transport controls: play/pause, speed (0.5x, 1x, 2x), seek via timeline scrubber
- Reuses `SpectatorController` for chase-cam
- Shows demo-specific HUD: timeline, player list, play/pause controls

##### [MODIFY] `src/engine/ui/panels/LobbyPanel.ts`
- Change VIEW DEMO button from file download to in-browser playback

---

## 4. Architecture Notes

### Why Server Changes Aren't Needed for Chase-Cam

The server already sends **all** entity data in each `GameState` snapshot — every player's position, rotation, velocity, health, weapon, etc. Spectators receive these like any other client. The only difference is they don't have their own entity (no input, no prediction).

Chase-cam is purely client-side: read the target player's `transform.position` and `transform.rotation` from the incoming `GameState`, and set the local camera accordingly.

### Demo Viewer = Offline Spectator

The demo viewer is architecturally identical to spectator mode, except:
- Frame source = `.shagdemo` file instead of network socket
- Playback is controlled (play/pause/seek) instead of real-time
- Same chase-cam + player cycling logic applies

This means `SpectatorController` should be designed to work with any `GameState` source (live network OR demo reader).

### Key Design Decision: Camera Controller vs Position Override

**Option A**: New `SpectatorCameraController` implements `ICameraController`
- Pro: clean integration with CameraSystem
- Con: CameraSystem's controller interface expects per-frame update(dt) with input

**Option B**: Position override in Game.ts render loop
- Pro: simpler, just set camera.position each frame
- Con: bypasses controller system

**Recommended: Option A** with a lightweight controller that ignores input and just reads from a `targetPosition`/`targetRotation` that Game.ts updates from GameState.
