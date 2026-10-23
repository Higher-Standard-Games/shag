---
name: regression-check
description: Run and report SHAG's required validation - the gates (typecheck, tests, Biome, build) and the renderer/networking regression set (test:simulation, test:physics, server:tick, server:fuzz, headless bsp load). Use this after editing anything under src/engine/loader, rendering, lighting, network or server, src/shared/net, src/games/fps/server, prediction or replication code, before committing or merging, and whenever the user asks to "run the tests", "check it", "validate" or "make sure nothing broke".
---

# Regression check

Renderer and networking code is where a quiet mistake costs the most: a
protocol byte out of place or a material path change can pass unit tests and
still break play. So edits there carry a fixed regression set, and the final
report must include its results.

## Which checks to run

| Change | Run |
| --- | --- |
| Any code change | The gates |
| `src/engine/loader`, `rendering`, `lighting`, map/material/shader paths | Gates + regression set |
| `src/engine/network`, `src/engine/server`, `src/shared/net`, `src/games/fps/server`, prediction/replication | Gates + regression set |
| Docs only (`docs/manual`) | `npm run docs:build` |

## The gates

```bash
npm run typecheck
npm run test:run
npm run gate:biome
npm run build
```

`gate:biome` compares against a baseline and is also the pre-commit hook: a
commit that raises the warning count is refused. Fix the warnings rather than
bypassing the hook.

## The regression set

From the repository root:

```bash
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
```

These need the game data under `public/data/`. If a map-dependent check says
the map is missing, check `public/data/` before reporting it as blocked: on the
main development machine the data is present.

## Reading the results

- `test:physics` prints a position warning even on a passing run. Read its
  pass/fail summary, not the warning.
- The headless runners print `localStorage is not defined` from preference
  loading; it is harmless in Node.
- `cli:game` should print the map's header counts (for washoi_dm2, `Faces: 7475`)
  and exit 0. An exit code of 1 means a command in the batch failed.
- A failure is a finding. Report it with the relevant output; do not rerun
  until it passes and call it green, and do not skip a check silently.

If a check is slow or flaky, say which one and what it printed rather than
dropping it from the report.

## Report

List each command with its result, for example:

```text
typecheck                 pass
test:run                  pass (569 files)
gate:biome                pass (warnings 322/339)
build                     pass
test:simulation           pass
test:physics              pass (known position warning)
server:tick               pass
server:fuzz --ticks 1000  pass
cli:game bsp load washoi_dm2    pass (Faces: 7475)
```

Name anything you did not run and why.
