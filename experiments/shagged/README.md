# SHAGGED experiments and API validation

`solamphi1/` contains the Relay Yard map source, authoring batches, previews and
its build/review instructions.

Run the real stdio MCP/CLI smoke test from the repository root:

```text
node experiments/shagged/mcp-smoke.mjs
```

It requires the local MakeBSP/MakeLight tools and installed game media. It
creates a uniquely named `qa_shagged_*` room in the managed agent document store,
but isolates saved server revisions, native job logs, published packages and
its summary report under `.cache/shagged-mcp-validation/`. It does not edit
Relay Yard or the lobby map pool.

Checks: compile/reuse/force, cross-session status and paged transcript reads,
complete face/patch/group inspection, spatial queries, stable pagination,
concurrent stale-revision rejection in two MCP sessions and two CLI processes,
and CLI snapshot round trips. Summary: `.cache/shagged-mcp-validation/report.json`.

Map-specific collision and GPU validation remain separate in `solamphi1/`.

Read-only discovery validation against installed `wfdm5` and its lamp props:

```text
node experiments/shagged/discovery-smoke.mjs
```

This checks installed BSP inspection and material pagination, searchable model
paths and bounds, and compiler/runtime entity-class filtering over real MCP
stdio. It neither creates nor edits maps. Installed `wfdm5` and at least one
lamp model with inspectable bounds are required; native compilation is not.

For natural creation alignment and atomic rejection of unknown image sizes:

```text
node experiments/shagged/natural-alignment-smoke.mjs
```

This requires the installed concrete material palette. It authors a uniquely
named QA room through MCP, checks the persisted face scale against catalog
dimensions, and removes its own QA document afterwards. No compiled package
or existing map is changed.

Convex/rotated brush authoring, numeric side materials, ownership queries and
atomic rejection of unsupported cuts:

```text
node experiments/shagged/convex-smoke.mjs
```

This removes its own uniquely named QA document afterwards and does not
compile a package. Native convex collision/UV checks live in
`src/engine/editor/server/__tests__/ConvexCompile.test.ts`.

Real-GPU WebGL2 editor component QA (headless Edge):

```text
node experiments/shagged/convex-browser-probe.mjs
```

The probe owns a private Vite server on port 3112 and an isolated Edge profile.
It renders a diagonal bridge, octagonal platform and wedge; checks actual-hull
picking and rotation controls; captures brush/wireframe/textured screenshots under
`.cache/shagged-convex-*.png`; and records browser logs/GPU details in
`.cache/shagged-convex-browser-report.json`. Its static fixture shares the
editor's Babylon imports. Only JSZip is prebundled, avoiding stale Babylon
lazy shader chunks in the isolated probe. No user map or profile is changed.

## Graphical brush vertex QA

`node experiments/shagged/convex-browser-probe.mjs --vertices` extends the convex
GPU probe with a real mouse drag, undo and exact vertex height editing. It uses
an isolated editor document and private server. Results and screenshots are
written to `.cache/shagged-vertices*`; see
`docs/research/SHAGGED_VERTEX_VALIDATION.md` for checks and limits.

## Graphical convex face QA

`node experiments/shagged/convex-browser-probe.mjs --faces` checks real
Shift/Alt mouse picking on a visible diagonal side, Fit, shift nudging,
undo and Wrap. The fixture resolves actual triangle-to-side identity rather
than inferring a box face from a normal. Results and the inspector screenshot
are written to `.cache/shagged-faces*`.
