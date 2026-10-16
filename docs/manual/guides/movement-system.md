# Movement system

SHAG combines an engine character/collision layer with an FPS movement profile and shared deterministic simulation.

## Layers

- `src/engine/movement/CharacterController.ts`: reusable character state and collision integration;
- `src/engine/movement/MovementVars.ts`: movement cvar registration and access;
- `src/games/fps/simulation/`: FPS profile and rules used by client/server paths;
- `src/engine/network/systems/movement/`: reusable movement interfaces and systems;
- `src/shared/collision/`: Babylon-free collision contracts.

Client prediction and the authoritative server should consume the same rule inputs. Do not implement a latency-sensitive movement rule only in the browser controller.

The shared collision world retains uphill support when a short downward hull
probe finds a walkable plane and resolved movement is tangent to or into that
plane. A fresh impact is not required each tick. Movement separating from the
plane remains airborne, including jumps and upward slide bumps.

Ledge grabbing derives its destination from the wall contact and the standing
hull's projected width, so diagonal and curved walls use the same clearance
rules as grid-aligned walls. Pull-up lifts the hull clear of the lip before
moving inward. Both route legs are validated at detection and swept during the
pull. An obstruction releases the grab with a short retry delay.

## Generic controller

```ts
import { CharacterController } from '../../../src/engine/movement/CharacterController';

const controller = new CharacterController(spawnPosition, {
  radius: 16,
  height: 56,
  crouchHeight: 32,
  eyeOffset: 48,
});
```

Use this generic class only when building an engine-level controller. Existing FPS work should extend the FPS simulation/profile and its shared state rather than creating a second player mover.

## Runtime tuning

Common movement variables include:

```text
sv_movementSpeed
sv_runSpeed
sv_topspeed
sv_jumpheight
sv_gravity
sv_aircontrol
sv_autohop
```

FPS ground speed is `sv_movementSpeed` (280 units per second) and sprinting
forward is `sv_runSpeed` (400); `sv_topspeed` and `sv_maxairspeed` cap
movement. `cl_speed` belongs to the generic `CharacterController`, not to the
FPS simulation. Fall damage, ledge grabs, wall jumps and the weapon-bob and ADS
groups are registered in `MovementVars.ts` too.

Run `cvarlist sv_` or inspect `MovementVars.ts` for the registered set and bounds. Profiles and gametypes may override the defaults, so check them before quoting a value in design documents.

## Features

The FPS path includes Quake/Warsow-style acceleration, air control, bunny hopping, steps, crouching/sliding, wall interactions, and fall/ground state. Individual features are gated/configured by the movement profile and cvars.

## Coordinate and time rules

- simulation positions/velocities must use the shared convention consistently;
- pass seconds or ticks according to the called API, not browser frame milliseconds by assumption;
- keep random or timing-dependent behavior deterministic on the server;
- apply view bob and camera smoothing as presentation, not simulated position.

## Validation

```bash
npm run cli:game -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'
npm run test:simulation
npm run test:physics
```

For networked movement changes, also run server tick/fuzz tests and verify prediction/reconciliation in a real client-server session.
