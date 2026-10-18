# Production developer-mode lock — v0.9.33

Verified 2026-10-19 (Europe/Helsinki).

## Scope and behavior

The production browser bundle (`import.meta.env.PROD` true and `SSR` false)
keeps `developer` at zero. Cvar registration discards a stored/current developer
value, marks it read-only and non-persistent, and storage loading ignores it.
Reads return zero and setters refuse changes. This covers the console command,
`dev` alias, `set`, `toggle`, settings imports and bindings that execute commands.
The developer command reports a checked failure when changing it is refused.

`EditorCommand` already declares `developer: true`; no additional command gate
was needed. Startup now also checks developer mode before reopening an editor
from the session-storage playtest-return marker. Development browser builds and
Node/headless tools retain developer mode. This is a player-facing guard against
accidental development-tool use, not an authorization boundary against modified
clients. Ungated inspection commands retain their existing availability.

## Files changed

- `src/engine/core/Cvar.ts`
- `src/engine/console/commands/DeveloperCommand.ts`
- `src/engine/console/__tests__/ProductionDeveloperMode.test.ts`
- `src/main.ts`
- `docs/manual/guides/console-system.md`
- `docs/manual/guides/shagged-editor.md`
- `docs/changelog/v0.9.33.md`
- This report. Release bookkeeping also updates `package.json`,
  `package-lock.json`, `src/engine/version.txt` and the next changelog stub.

## Validation

- `npm run test:run -- src/engine/console/__tests__/ProductionDeveloperMode.test.ts src/engine/__tests__/Cvar.test.ts src/engine/__tests__/CvarStorageValidation.test.ts src/engine/console/__tests__/CvarCommandLine.test.ts`:
  74 passed, including production, development and SSR policies.
- `npm run typecheck`: pass.
- `npm run gate:biome`: pass, zero errors, 319/339 warnings. An initial test-file
  formatting error was corrected before committing.
- `npm run docs:build`: pass.
- `npm run build`: pass.
- `npm run test:run`: 5,194 passed, one skipped, five failures in the existing
  ConvexCompile (two), NaturalCompile, PlaytestCompile and RoundPatchCompile
  tests. Their editor compilation fixtures reference archived materials such as
  `textures/blx/blx_grid`; the full suite is not green.
- `npm run test:simulation` and `npm run test:physics`: pass.
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts --exec 'developer 1; bsp load washoi_dm2; bsp info; sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'`:
  pass, including enabling developer mode headlessly and 91 movement ticks.
- `node .cache/production-console-browser.mjs`: headless Edge/WebGL2 against
  the actual production bundle served by Vite preview on private port 3180.
  Seeded saved `developer=1` plus the editor-return marker. The console refused
  `developer 1`, `dev on`, `set developer 1`, `toggle developer`, and
  `editor open`; querying developer before/after reported disabled. No browser
  errors or failed HTTP requests. Report `.cache/production-console-browser.json`.

No rendering, simulation or network protocol implementation changed. An actual
live match and every developer command were not individually exercised.

## First production media installation

Installed the current local `public/data` tree excluding its entire `demos/`
subtree into `/srv/washoi/assets/data`. The production `public/data` symlink
was preserved. Staged SHA-256 verification passed for 3,232 files totaling
455,081,984 bytes. The previous empty manifest tree was backed up separately.

`/srv/washoi/deploy.sh --force game` rebuilt and published the data because the
normal timer checks Git commits, not asset changes. Restarted the idle lobby:
it advertised Duel/FFA DM2/5/11, Amphi1 and S&D1. Headless BSP load/info passed
for all five maps. HTTPS hashes matched for all 12 packages, five JPEG previews
and the KTX manifest (18 checks). No local demos were in installed or published
data. Existing production state, credentials and certificates were not copied.

Updated `/srv/washoi.md` with the verified installation and future asset-update
procedure. Production match recording remains enabled. This verifies asset
delivery and map loading; it is not a complete public multiplayer acceptance run.
