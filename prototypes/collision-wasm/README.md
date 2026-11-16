# Collision core in Rust, compiled to WebAssembly (prototype)

The world part of `SweepCollisionBackend.trace`
(`src/engine/physics/SweepCollisionBackend.ts`) ported to Rust statement for
statement: the BSP node walk, leaf brushes with their containment pruning, the
clip-brush fallback and patch facets. Movers (lifts, switchable brush models,
buttons) are left out. It reads the TypeScript backend's own prepared tables,
so it needs nothing of its own at load.

This is an investigation for `docs/research/BOT_ARCHITECTURE.md` (plan step 9);
nothing in the game uses it.

## Run it

Needs Rust with the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`); no wasm-bindgen or wasm-pack.
From the SHAG root:

```bash
# Build the kernel (31 KB)
cargo build --release --target wasm32-unknown-unknown --manifest-path prototypes/collision-wasm/Cargo.toml

# Record a bot match's traces: map, bots, seconds, output (up to 400,000, evenly sampled)
node node_modules/vite-node/vite-node.mjs prototypes/collision-wasm/record.ts -- washoi_dm2 6 40 .cache/traces-washoi_dm2.f64

# Replay them through TypeScript and WebAssembly: exactness and time
node node_modules/vite-node/vite-node.mjs prototypes/collision-wasm/compare.ts -- washoi_dm2 .cache/traces-washoi_dm2.f64
```

`compare.ts` checks every result field (fraction, end position, normal,
start/all solid, contents, hit brush, surface flags) with `Object.is`, so a
difference of one bit counts.

## Results (2026-11-16, Node 24, one core)

| Map | Traces | Differ | TypeScript | WebAssembly, batch | A call per trace | World tables |
| --- | --- | --- | --- | --- | --- | --- |
| washoi_dm2 | 400,000 | 0 | 2.47 µs | 1.25 µs (1.98×) | 1.28 µs (1.93×) | 5.2 MB |
| washoi_snd1 | 400,000 | 0 | 1.69 µs | 0.90 µs (1.87×) | 0.99 µs (1.71×) | 12.2 MB |

The traces are a 40 s match with six bots, the game server's and the bots'
alike (about a million on dm2), sampled evenly.
