# SHAGGED reliability follow-up

Scope: priorities 1–3 from the Relay Yard experiment, on
`v0.9.31-shagged-amphi-experiment`. Existing FPS rules, renderer and network
protocols are unchanged. No merge or push is part of this task.

## Checkpoint 1: compile diagnostics

Changed files: `src/engine/editor/server/CompileDiagnostics.ts`,
`src/engine/editor/server/CompileJobs.ts`,
`src/engine/editor/server/AgentPipeline.ts`,
`src/engine/editor/server/__tests__/CompileJobs.test.ts`,
`src/cli/shagged-mcp.ts`, `docs/manual/guides/shagged-api.md`,
`docs/changelog/v0.9.31.md`, `docs/research/SHAGGED_NEEEDED_FEATURES.md`,
and this validation record.

Focused command:

```text
npx vitest run src/engine/editor/server/__tests__/CompileJobs.test.ts src/engine/editor/server/__tests__/PlaytestCompile.test.ts
```

Passed five tests, including a real MakeBSP/MakeLight room compile and indexed
PK3 load. The diagnostic fixture checks split pipe chunks, rolling-tail eviction,
publication refusal, durable job reads and bounded transcript pagination.

Gates and regressions, all passing on the confirmation run:

```text
npm run typecheck
npm run test:run
npm run gate:biome
npm run build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- --exec "sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit"
npm run docs:build
```

Full suite: 595 files, 4,995 tests passed, one skipped. Physics retains the
repository's documented passing-run position warning. The first full run had
one timing failure in `RemoteWeaponLeak.test.ts` (expected two model imports,
observed one before its wait expired). The isolated command
`npx vitest run src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts` passed
all three tests, followed by the passing full confirmation run. No remote-weapon
code was changed. Raw logs are in `.cache/collision-shagged-diagnostics-*` and
`.cache/collision-shagged-diagnostics-confirm-*`.

Limits: native output classification recognizes explicit error/asset-load/leak
patterns; it is not a complete grammar for future compiler versions. Durable
files survive process exit, but do not resume a terminated native compiler.
