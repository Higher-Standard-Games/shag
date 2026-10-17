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

## Checkpoint 2: build coordination and input identity

Changed files: `src/engine/editor/server/FileLock.ts`,
`src/engine/editor/server/BuildFingerprint.ts`,
`src/engine/editor/server/CompileJobs.ts`,
`src/engine/editor/server/CompilerConfig.ts`,
`src/engine/editor/server/MapStore.ts`,
`src/engine/editor/server/PublishedBuild.ts`,
`src/engine/editor/server/AgentPipeline.ts`,
`src/engine/editor/server/ShaggedHttpServer.ts`,
`src/engine/editor/ShaggedApi.ts`, `src/cli/shagged.ts`,
`src/cli/shagged-compile.ts`, `src/cli/shagged-mcp.ts`,
`src/engine/editor/server/__tests__/BuildReliability.test.ts`,
`src/engine/editor/server/__tests__/CompileJobs.test.ts`,
`src/engine/editor/server/__tests__/MapStore.test.ts`,
`docs/manual/guides/shagged-api.md`, `docs/changelog/v0.9.31.md`,
`docs/research/SHAGGED_NEEEDED_FEATURES.md`,
`experiments/shagged/solamphi1/README.md`, and this record.

Focused validation:

```text
npx vitest run src/engine/editor/server/__tests__/BuildReliability.test.ts src/engine/editor/server/__tests__/CompileJobs.test.ts src/engine/editor/server/__tests__/MapStore.test.ts src/engine/editor/server/__tests__/PublishedBuild.test.ts src/engine/editor/server/__tests__/PlaytestCompile.test.ts src/engine/editor/server/__tests__/ShaggedHttpServer.test.ts
npx vitest run src/engine/editor/server/__tests__/BuildReliability.test.ts src/engine/editor/server/__tests__/CompileJobs.test.ts src/engine/editor/server/__tests__/CompilerConfig.test.ts src/engine/editor/server/__tests__/PlaytestCompile.test.ts
```

Integration checks cover one compile/two independent queues, reuse with retained
warnings, forced rebuilds, changed dependencies, mutation during compilation,
independent source-store instances and native room publication. The lease test
uses separate real processes: after killing the lease holder, acquisition stays
blocked until the recorded compiler PID exits. A separate compiler fixture is
controlled by the test harness to avoid platform-dependent process-tree killing.

Fingerprinting excludes generated source/job storage even when nested inside a
media root. Profile deployment is atomic and avoids rewriting identical bytes.
Old build pointers remain readable but require a first fingerprinted rebuild.

Limits: coordination is local-machine only. A confirmed dead PID can be
recovered; ownerless/corrupt registration requires inspection. PID reuse can
conservatively keep a lease occupied. Input hashing caches content digests using
size, modification/change timestamps and inode within a process. No GUI
interaction or distributed-filesystem validation is claimed.

Validation results: the first full run passed 596 files and 5,000 tests (one
skipped), then exposed two formatting errors at the Biome gate, which were
fixed. The subsequent full confirmation again hit the documented unrelated
remote-weapon timing test: 4,999 passed, one failed, one skipped. All compiler
tests passed. Latest focused lease/native checks and typecheck passed; the
remaining gate/regression commands listed in checkpoint 1 were run separately
and all passed. Logs: `.cache/collision-shagged-reliability-*`,
`.cache/collision-shagged-reliability-confirm-*` and
`.cache/collision-shagged-reliability-remaining-*`. This checkpoint does not label
the timing-failed full run as passing.

`node .cache/shagged-mcp-smoke.mjs` also passed against the real stdio server:
create an isolated QA room, compile, reuse, force a second publication, reopen
the MCP session, then read the original job and its 22,896-byte transcript.
Published QA packages and server storage were isolated beneath `.cache/`;
no Relay Yard source was changed. The script/result stay under `.cache/`.
