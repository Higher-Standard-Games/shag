# AGENTS.md - AI Assistant Instructions for SHAG Engine

> Goal: provide enough concrete, verified guidance for an agent to build and validate gameplay features from a single prompt.
> Priority: information accuracy over speed. If unsure, inspect code/docs before acting.

## Strict Mode Checklist (Read First)

1. Verify facts in source before coding:
   - APIs and imports in actual `.ts` files
   - command/script names in `package.json`
   - behavior/usage in `docs/manual/guides/*`
2. Choose architecture correctly:
   - default to `src/games/fps` extensions
   - do not create a separate game module unless explicitly required
3. For renderer or networking edits, treat as high-risk:
   - edit cautiously
   - run required regression commands (see Critical Systems section)
   - include test results in final report
4. Headless-first validation is required before browser/manual testing.
5. Handoff must include:
   - exact files changed
   - exact validation commands run
   - explicit assumptions
   - explicit unverified items

## Quick Reference

| I want to... | Do this |
|--------------|---------|
| Launch a gameplay map | `await ConsoleSystem.getInstance().execute('developer 1; map wdm2 duel')` |
| Inspect a BSP map | `await ConsoleSystem.getInstance().execute('bsp load wdm2; bsp info')` |
| Change camera mode | `CameraSystem.getInstance().setMode('fps')` |
| Play a sound | `AudioManager.getInstance().playSound('weapons/rocket/fire')` |
| Spawn pickups/entities | `EntityManager.getInstance().spawn(...)` or console `spawnpickup ...` |
| Add a console command | `CommandRegistry.getInstance().register(...)` |
| Read keyboard input | `InputSystem.getInstance().isKeyDown('w')` |
| Connect to a server | `await ConsoleSystem.getInstance().execute('connect localhost:7777')` |

## Agent Workflow (Do This First)

1. Confirm scope from prompt: game mode, win condition, map, single-player vs networked.
2. Choose implementation strategy:
   - Preferred: extend `src/games/fps` with a new mode/system.
   - Full new game module only when prompt explicitly requires a separate game package.
3. Implement iteratively in small patches (commands, systems, HUD/events).
4. Validate in headless mode first (required before asking for browser testing).
5. Summarize what was built, how to run it, and known limitations.

## Accuracy and Context Protocol (Mandatory)

Before coding:

1. Verify API names and file locations from source (not memory).
2. Open the relevant guide in `docs/manual/guides/` for the subsystem being edited.
3. Check for existing implementations in `src/games/fps` and reuse patterns before creating new abstractions.
4. Confirm script names in `package.json` before running or documenting commands.

When handing off or reporting:

1. List exact files changed.
2. List exact commands run for validation.
3. State assumptions explicitly (map name, gametype, single-player/network).
4. Call out anything unverified.

## Architecture Reality Check (Important)

The codebase is currently FPS-centric:

- `@game/*` path alias in `tsconfig.json` points to `src/games/fps/*`.
- `src/main.ts` directly wires `FPSPlayer` and FPS-focused flow.
- Multiple engine/console/ui paths import from `src/games/fps` directly.

Implication:

- For most requests, implement inside `src/games/fps` (new gametype, command, subsystem, HUD widget).
- Creating a truly separate game under `src/games/<newgame>` is possible, but requires additional wiring/refactor work.

## Critical Systems: Renderer and Networking

Renderer and networking are high-value and high-risk systems. Edit with extra caution.

- Renderer-sensitive areas include: `src/engine/loader`, `src/engine/rendering`, `src/engine/lighting`, map/material/shader paths.
- Networking-sensitive areas include: `src/engine/network`, `src/engine/server`, `src/games/fps/server`, prediction/replication code.

If either area is edited, always run targeted regressions after changes:

```bash
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
```

Do not ship renderer/networking edits without test results in the final report.

## Project Overview

SHAG Engine is a Babylon.js engine for Quake 3 / Warsow-style gameplay:

- BSP map loading (Q3, FBSP/Warsow)
- PK3 virtual filesystem
- Quake shader workflows
- Server-authoritative multiplayer
- High-skill FPS movement (strafe jump, bunny hop, wall jump)

Full manual: `docs/manual/`

## Directory Structure

```text
src/
|- engine/           # Game-agnostic engine code
|  |- core/          # GamePaths, EventBus, GameTimer
|  |- camera/        # Camera controllers
|  |- console/       # Commands, cvars
|  |- loader/        # BSP, PK3, textures, models
|  |- network/       # Client networking
|  |- server/        # Headless server, ECS
|  |- physics/       # BSP collision, Havok
|  |- movement/      # Character controllers
|  `- ui/            # HUD, menus
|- games/
|  |- fps/           # Main active gameplay module
|  `- tower/         # Secondary module
`- cli/              # Headless tools

public/
|- engine/           # Engine assets
|- data/             # Game data (gitignored)
`- wasm/             # Havok wasm (auto-copied)
```

## Creating a New Game Module (When Explicitly Needed)

### Minimal template

```typescript
// src/games/mygame/MyGame.ts
import { Scene } from "@babylonjs/core/scene";
import { CameraSystem } from "@/engine/camera";
import { ConsoleSystem } from "@/engine/console";
import { CommandRegistry } from "@/engine/console/CommandRegistry";

export class MyGame {
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  async init(): Promise<void> {
    CameraSystem.getInstance().setMode("freefly");
    await ConsoleSystem.getInstance().execute("developer 1; map wdm2 duel");
    this.registerCommands();
  }

  private registerCommands(): void {
    CommandRegistry.getInstance().register(
      "hello",
      async () => "Hello from MyGame!",
      { description: "Say hello", category: "game" },
    );
  }
}
```

```typescript
// src/games/mygame/index.ts
export { MyGame } from "./MyGame";
```

```json
// src/games/mygame/game.json
{
  "name": "mygame",
  "title": "My Awesome Game",
  "version": "0.1.0"
}
```

### Additional wiring usually required

- Update aliasing/entry wiring if `@game/*` should target the new module.
- Update app bootstrap where FPS-specific classes are imported.
- Verify CLI/server scripts if the new mode requires them.

Guide: `docs/manual/guides/configuration.md`

## Core Systems

### Camera

Modes: `fps`, `freefly`, `isometric`, `sidescroll`, `follow`

```typescript
const cam = CameraSystem.getInstance();
cam.setMode("fps");
cam.setFOV(90);
const camera = cam.getCamera();
```

Guide: `docs/manual/guides/camera-system.md`

### Input

```typescript
const input = InputSystem.getInstance();
if (input.isKeyDown("w")) {
  // move forward
}
if (input.wasKeyPressed("space")) {
  // jump
}
const delta = input.getMouseDelta();
```

Keys: `w`, `a`, `s`, `d`, `space`, `shift`, `control`, `escape`, `tab`, `enter`, `1`-`9`

### Console Commands

```typescript
import { CommandRegistry } from "@/engine/console/CommandRegistry";

CommandRegistry.getInstance().register(
  "mycommand",
  async (args) => {
    const sub = args[0];
    if (sub === "start") return "Game started!";
    if (sub === "stop") return "Game stopped!";
    return "Usage: mycommand <start|stop>";
  },
  {
    description: "My custom command",
    usage: "mycommand <start|stop>",
    category: "game",
  },
);
```

```typescript
await ConsoleSystem.getInstance().execute("developer 1; map wdm2 duel");
await ConsoleSystem.getInstance().execute("noclip");
```

Guide: `docs/manual/guides/command-reference.md`

### Assets and BSP

```typescript
import { PK3Loader } from "@/engine/loader/pk3";
import { MapRenderer } from "@/engine/MapRenderer";

const texture = await PK3Loader.getInstance().loadTexture("textures/base/floor");
const collision = MapRenderer.getInstance().getCollisionWorld();
```

Guides:
- `docs/manual/guides/pk3-filesystem.md`
- `docs/manual/guides/bsp-system.md`

### Movement (Q3-style)

```typescript
import { FPSMovementProfile } from "@game/simulation/FPSMovementProfile";

const movement = new FPSMovementProfile();
movement.maxSpeed = 320;
movement.jumpVelocity = 270;
movement.gravity = 800;
movement.airControl = 150;
```

Common CVars: `sv_speed`, `sv_jumpheight`, `sv_gravity`, `sv_aircontrol`, `sv_autohop`

Guide: `docs/manual/guides/movement-system.md`

### Networking

```typescript
await ConsoleSystem.getInstance().execute("connect localhost:7777");
```

Server:

```bash
npm run net:server -- --map wdm2 --port 7777
```

Guide: `docs/manual/guides/networking.md`

### EventBus

```typescript
import { EventBus } from "@/engine/core/EventBus";

const unsub = EventBus.on("player:spawn", (data) => {
  console.log(data.position);
});

EventBus.emit("player:death", { playerId: 1 });
unsub(); // always cleanup subscriptions
```

## Headless-First Validation (Required)

Run these before asking for manual browser tests:

```bash
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
npm run test:simulation
npm run test:physics
```

Useful command groups:

- REPL: `npm run cli:game`, `npm run cli:bsp`
- Network: `npm run net:server`, `npm run net:client`, `npm run lobby:server`
- Server tests: `npm run server:tick`, `npm run server:fuzz -- --ticks 1000`
- Debug: `npm run debug:textures -- wdm2`, `npm run debug:spawn`
- Unit tests: `npm test`
- Demos: `npm run demo:record -- --map wdm12 --bots 2 --seconds 30` (one-shot: server + AI bots + record). See [headless-mode guide](docs/manual/guides/headless-mode.md#recording-demos).

Headless map loading goes through the pk3 index (`src/engine/loader/pk3/NodePk3.ts` — `resolveMapBspViaIndex`), the same database the game uses. Do NOT re-introduce ad-hoc BSP path searches.

## Definition of Done for Agent Tasks

A feature is done only when all are true:

1. Gameplay logic is implemented (not only scaffolding).
2. Console command(s) or config path exists to access the feature.
3. Headless validation was run, with command output checked for errors.
4. New EventBus listeners/timers are cleaned up (no obvious leak).
5. User-facing summary includes run instructions and caveats.
6. If renderer/networking was touched, required regression suite was run and reported.

## Common Gotchas

1. Babylon imports must be modular:
   - Correct: `@babylonjs/core/...`
   - Avoid: `babylonjs` UMD import
2. Some Babylon features need side-effect imports:
   - `@babylonjs/core/Animations/animatable`
   - `@babylonjs/core/Collisions/collisionCoordinator`
3. Do not forget unsubscribe handles for EventBus listeners.
4. Tag map-owned objects for cleanup when needed:

```typescript
mesh.metadata = { mapOwned: true };
```

## Documentation Pointers

- Commands: `docs/manual/guides/command-reference.md`
- BSP/PK3: `docs/manual/guides/bsp-system.md`
- Camera: `docs/manual/guides/camera-system.md`
- Movement: `docs/manual/guides/movement-system.md`
- Networking: `docs/manual/guides/networking.md`
- Headless: `docs/manual/guides/headless-mode.md`
- Configuration: `docs/manual/guides/configuration.md`
- Shader system: `docs/manual/guides/shader-system.md`
- Research notes: `docs/research/`
- Changelog: `docs/changelog/`

## Fast Game Ideas

1. Bunny Hop Racer: checkpoint routing + timer + PB ghosts
2. Gun Game: weapon progression per frag
3. Trick Arena: score chains for movement skill
4. Hide and Seek: seeker phase + spectator flow
5. Rocket Arena: rockets-only duel ruleset
