# Headless testing

Headless validation is split by responsibility rather than one all-purpose engine fixture.

## Map and command smoke test

```bash
npm --prefix src/games/fps run cli:game -- --exec 'bsp load washoi_dm2; bsp info; quit'
```

This uses the PK3 index and engine command registry with Babylon `NullEngine`.

## Direct BSP inspection

```bash
npm run cli:bsp -- info path/to/map.bsp
npm run cli:bsp -- liquids path/to/map.bsp
```

`cli:bsp` also takes `entities`, `textures`, `collision`, `clipbrushes`, `effects` and `build`.

This CLI takes an extracted filesystem BSP and calls the synchronous `BspLoader.load` API.

## Deterministic gameplay

```bash
npm --prefix src/games/fps run test:simulation
npm --prefix src/games/fps run test:physics
npm --prefix src/games/fps run cli:game -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'
```

Prefer deterministic assertions over snapshots of volatile log output.

## Server and protocol

```bash
npm --prefix src/games/fps run server:tick
npm --prefix src/games/fps run server:fuzz -- --ticks 1000
npm --prefix src/games/fps run net:server -- --map washoi_dm2 --port 7777
npm run net:client -- --connect ws://127.0.0.1:7777
```

Run server and client in separate processes for the connectivity smoke test.

## Unit and build gates

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```

## Test design

- construct only the subsystem needed by the test;
- use existing PK3/index helpers rather than filesystem guessing;
- dispose scenes, engines, observers, and singletons owned by the fixture;
- check batch exit status;
- keep browser rendering assertions in a separate manual or visual test.

The authoritative required set for renderer/networking edits is maintained in `AGENTS.md`.
