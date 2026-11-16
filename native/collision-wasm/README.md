# Collision world trace in Rust, compiled to WebAssembly

The world part of `SweepCollisionBackend.trace`
(`src/engine/physics/SweepCollisionBackend.ts`) in Rust, statement for
statement: the BSP node walk, leaf brushes with their containment pruning, the
clip-brush fallback and patch facets, with the same answers bit for bit. The
movers (lifts, switchable brush models, buttons) stay in TypeScript. It reads
the TypeScript backend's own prepared tables (`CompiledWorldTrace.ts` copies
them into its memory), so it needs nothing of its own at load.

Bots use it: `createBotVision` makes its collision world with
`createHeadlessCollisionWorld(bsp, { compiled: true })`, and the backend's
`useCompiledWorldTrace` runs the world part here when the module is there.

## Building

The built module is committed as `src/engine/physics/WorldTrace.wasm`, so the
game, the servers and the bundles need no Rust. After changing anything here:

```bash
npm run build:collision-wasm
```

It needs Rust with the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`); no wasm-bindgen or wasm-pack.
It also writes `WorldTrace.wasm.source`, a hash of `Cargo.toml` and `src/`.
`src/engine/physics/__tests__/CompiledWorldTrace.test.ts` fails when the
source has changed without a rebuild, and compares the module with the
TypeScript walk on seeded traces on `washoi_dm2` when that map is installed.
`build-servers.mjs` copies the module beside the server bundles.

## Checking against recorded traces

```bash
# A bot match's traces: map, bots, seconds, output (up to 400,000, evenly sampled)
node node_modules/vite-node/vite-node.mjs native/collision-wasm/record.ts -- washoi_dm2 6 40 .cache/traces-washoi_dm2.f64

# Replayed through TypeScript and the module: exactness and time
node node_modules/vite-node/vite-node.mjs native/collision-wasm/compare.ts -- washoi_dm2 .cache/traces-washoi_dm2.f64
```

`compare.ts` checks every result field (fraction, end position, normal,
start/all solid, contents, hit brush, surface flags) with `Object.is`.

## Results (2026-11-16, Node 24, one core)

The world part alone:

| Map | Traces | Differ | TypeScript | WebAssembly | A call per trace | World tables |
| --- | --- | --- | --- | --- | --- | --- |
| washoi_dm2 | 400,000 | 0 | 2.47 µs | 1.25 µs (1.98×) | 1.28 µs (1.93×) | 5.2 MB |
| washoi_snd1 | 400,000 | 0 | 1.69 µs | 0.90 µs (1.87×) | 0.99 µs (1.71×) | 12.2 MB |

The whole `backend.trace`, movers included, with the world part compiled: the
same 400,000 traces each, every field and the hit texture's name identical;
washoi_snd1 2.20 → 1.42 µs, washoi_dm2 2.74 → 1.54 µs.
