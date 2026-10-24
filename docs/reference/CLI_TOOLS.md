# CLI Tools

> Script names checked against the engine and game package manifests on 2026-10-24.

Prefer package scripts; they preserve the required <code>vite-node</code> setup and argument separators.

Examples start at the SHAG root. Game commands use
`npm --prefix src/games/fps run <script>`; inside the game directory use
`npm run <script>`. Both run at the assembled root. Install dependencies once
at the SHAG root. `cli:bsp` and `net:client` remain engine commands.

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

    npm --prefix src/games/fps run cli:game -- --exec "bsp load wdm2; bsp info; quit"
    npm --prefix src/games/fps run cli:game -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'
    npm --prefix src/games/fps run test:simulation
    npm --prefix src/games/fps run test:physics
    npm --prefix src/games/fps run server:tick
    npm --prefix src/games/fps run server:fuzz -- --ticks 1000

In PowerShell with `npm.cmd`, escape the replay's inner quotes as `\"`.

Asset tools are <code>debug:textures</code>, <code>debug:pickup</code>, <code>tools:convert</code>, <code>tools:textures*</code>, <code>tools:manifest</code>, and <code>tools:map</code>.

Platform/docs families are <code>docs:*</code>, <code>android:*</code>, and <code>electron:*</code>.
The game package selects Washoi for platform builds and its manual; root docs
commands build the engine manual. Consult the respective package manifest for
the exact expansion.

NullEngine validates parsing, simulation, lifecycle, and structure. It does not prove browser shaders, visuals, GPU particles, audio, input feel, WebGPU, or mobile WebView behavior.
