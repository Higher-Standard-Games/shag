# Extending the existing FPS game

SHAG already contains the active arena-FPS composition. New FPS features should extend it rather than creating a parallel skeleton.

## Main areas

```text
src/games/fps/
  Game.ts              client game orchestration
  FPSPlayer.ts         local player integration
  client/              input, presentation, HUD, demos, prediction helpers
  simulation/          FPS movement profile and shared-facing logic
  server/              authoritative game/server systems
  world/               pickups and inventory
  liquid/              liquid volumes
  console/commands/    FPS-specific commands
```

Deterministic contracts used by both sides live under `src/shared/`. Keep authoritative decisions on the server and make client prediction consume the same simulation rules where possible.

## Recommended feature slice

1. Define shared state/events or user commands.
2. Implement authoritative server behavior.
3. Add client prediction only for latency-sensitive local actions.
4. Add presentation and HUD reactions.
5. Expose a console/config path for testing.
6. Add deterministic and server regressions.

Avoid importing game modules into reusable engine code. Use the existing event, service-registry, and frame-hook boundaries.

## Map launch

```text
developer 1
map washoi_dm2 duel
```

The browser command uses the gameplay launcher. A direct headless inspection uses:

```bash
npm --prefix src/games/fps run cli:game -- --exec 'bsp load washoi_dm2; bsp info; quit'
```

## Baseline validation

```bash
npm run typecheck
npm --prefix src/games/fps run test:simulation
npm --prefix src/games/fps run test:physics
npm --prefix src/games/fps run server:tick
npm --prefix src/games/fps run server:fuzz -- --ticks 1000
```

Networking and renderer changes need all targeted regressions in `AGENTS.md`.

See [Movement](../../guides/movement-system.md), [Networking](../../guides/networking.md), and [Map launching](../../guides/map-launching.md).
