# CLI Tools

> Script names verified from <code>package.json</code> on 2026-08-06.

Prefer package scripts; they preserve the required <code>vite-node</code> setup and argument separators.

| Script | Purpose |
|---|---|
| <code>cli:game</code> | Console-compatible NullEngine runtime |
| <code>cli:bsp</code> | Direct PK3/BSP inspector |
| <code>net:server</code> / <code>net:client</code> | Dedicated server and headless client |
| <code>lobby:server</code> | Match/server orchestration |
| <code>server:tick</code> / <code>server:fuzz</code> | Server regressions |
| <code>test:simulation</code> / <code>test:physics</code> | Deterministic and collision checks |
| <code>demo:record</code> / <code>demo:verify</code> | Demo capture and checksum reconciliation |
| <code>bot:server</code> / <code>bot:analyze</code> / <code>bot:train</code> | Bot workflows |

Core validation:

    npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"
    npm run cli:game -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
    npm run test:simulation
    npm run test:physics
    npm run server:tick
    npm run server:fuzz -- --ticks 1000

Asset tools are <code>debug:textures</code>, <code>debug:collision</code>, <code>debug:pickup</code>, <code>debug:spawn</code>, <code>tools:convert</code>, <code>tools:textures*</code>, <code>tools:manifest</code>, and <code>tools:map</code>.

Platform/docs families are <code>docs:*</code>, <code>android:*</code>, and <code>electron:*</code>. Consult <code>package.json</code> for exact expansion.

NullEngine validates parsing, simulation, lifecycle, and structure. It does not prove browser shaders, visuals, GPU particles, audio, input feel, WebGPU, or mobile WebView behavior.
