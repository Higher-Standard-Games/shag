# SHAGGED API — letting AI agents build maps

**Status:** research, 2026-10-10. No code changed. Sources: the SHAGGED editor source in `src/engine/editor/`, [SHAGGED.md](SHAGGED.md), the bot and audit CLIs, and public descriptions of Blender's AI integrations (linked at the end).

## Summary

Give SHAGGED a programmatic API so an AI agent can author, compile and test a map the way a human does in the editor: through typed operations on the same map document, with automatic checks after each step. Blender's AI integrations expose the modelling program to agents; ours would expose a level editor *and* the game that plays the result.

This is more feasible than it sounds, because most of the hard parts already exist and are already headless:

- the editor's map document is pure TypeScript — validated, undoable transactions in Quake coordinates, with no DOM or Babylon dependency;
- `.map` export is deterministic, and a Node server already saves revisions, runs MakeBSP/MakeLight and publishes playable builds;
- the game can already judge a compiled map without a browser: BSP inspection, bot navigation graphs, stuck-geometry and PVS audits, bot matches, demo recording and timedemo benchmarks.

What is missing is a thin layer: a stable set of operations over the document, a CLI and an MCP server that expose them, a written rulebook for good Washoi maps, and a single "map report" that turns the existing checks into feedback an agent can act on. A first useful version — an agent builds a sealed multi-room map that compiles and whose spawns and items are reachable — is a small project.

The differentiator is not "AI makes a map". It is a **closed loop**: the agent can build, compile, walk with bots, measure performance and fix what it finds, without a human in the loop for every iteration, while a human can watch the same document live in the editor and take over at any point.

## What Blender's AI integrations teach us

The best-known example, blender-mcp, has two parts: an add-on inside Blender that opens a local socket, and an MCP server that the AI client talks to. Its tools fall into two styles:

- **Scene introspection first.** `get_scene_info` returns the scene as JSON. Agent guides tell the model to call it before changing anything.
- **An escape hatch.** `execute_blender_code` runs arbitrary Python with full `bpy` access. It is powerful and dangerous (it can delete the scene), and several alternative servers deliberately replace it with many small typed tools.

Two limitations matter for us. The add-on needs a running, interactive Blender: it does not start in background mode. And Blender has no notion of "is this model good": the agent has to look at renders.

SHAG can avoid all three problems:

| Blender pattern | SHAGGED equivalent |
| --- | --- |
| Live add-on socket into the GUI | Optional live bridge into the browser editor. The core API does not need the GUI at all. |
| `execute_blender_code` escape hatch | **No code execution.** Typed operations on a validated document. Every change passes `validateDocument`, so an agent cannot produce a document the exporter rejects. |
| Judge quality by renders only | Machine checks: compile/leak, Map Health, reachability, stuck spots, bot play, performance. Renders are an addition, not the only signal. |

## What already exists

Verified in source on 2026-10-10.

| Piece | Where | Why it matters for an API |
| --- | --- | --- |
| Map document | `EditorDocument.ts` | Plain JSON (`schemaVersion: 2`): box brushes with per-face materials, `patchDef2` patches, point entities, brush entities owning brushes by ID. `transact()` validates every change and keeps 100 undo steps. Stable IDs throughout. No DOM or Babylon imports. |
| Deterministic export | `MapWriter.ts` (`writeMap`) | The same document always produces the same `.map` bytes. Diffs and caching are reliable. |
| Shape helpers | `RoomTemplate.ts`, `EditorBoxTools.ts`, `PatchPresets.ts` (bevel, arch), `PatchGeometry.ts`, `FaceUv.ts` | Pure functions an API can wrap: a sealed lit room, box resizing, curved presets, natural texture alignment. |
| Catalogues | `EntityCatalog.ts` (56 point classes and 9 brush classes from `entities.def`, with documented keys and required-key markers), `TextureCatalog.ts` (search, folders, tags) | An agent can discover legal classnames, keys and textures instead of guessing. |
| Map Health | `MapHealth.ts` (`inspectMapHealth`) | Pure diagnostics with stable object IDs: missing spawns, missing required keys, broken target links, duplicate targetnames, unknown classes, unknown shaders, missing shader images. |
| Editor server | `server/ShaggedHttpServer.ts`, `MapStore.ts`, `CompileJobs.ts`, `PublishedBuild.ts`; `npm run shagged:server` | Loopback HTTP: list/load/save revisions with optimistic locking (`expectedRevision`, HTTP 409 on conflict), compile jobs (`fast`/`default`/`release`), logs, playable publication. Only fixed recipes, never caller-chosen executables or paths. |
| Compile CLI | `npm run shagged:compile -- <map>` | Headless compile of a saved revision through the same job runner. |
| BSP inspection | `npm run cli:bsp` (`info`, `entities`, `textures`, `effects`, `build`) | Confirms what MakeBSP actually produced. |
| Reachability | `src/bot/BotNavGraph.ts` | Builds a waypoint graph from the compiled BSP (spawns, items, floor sampling) with walk/jump/fall/jump-pad/teleporter edges and A* paths. It can answer "can every spawn reach every item?". |
| Geometry audits | `npm run audit:stuck`, `npm run audit:pvs` | Find places a player hull gets stuck, and how well the map's visibility data culls. |
| Play and measure | `npm run bot:server`, `demo:record`, `timedemo` | Bots can play the map. A recording can become a benchmark fixture (`benchmark:fixture -- --demo <file>`), and the timedemo reports frame time. |
| Live editor | `BrowserEditorHost.ts`, `EditorSession.ts`, `editor open/close/status/return` | Humans already edit in four views; Playtest launches the compiled map and returns to the editor. |

Gaps:

- **No operation layer.** Edits happen inside `EditorSession` (3,064 lines of UI and gesture code) or by direct `transact` callbacks. There is no named, typed list of operations an outside caller can invoke.
- **No CLI or agent entry point** for document edits; the CLIs start at "compile a saved map".
- **No live channel** between the server and an open editor. The browser saves through HTTP and polls compile jobs; it does not receive changes made elsewhere.
- **No mapping rulebook** an agent can read, and no combined report of the existing checks.
- **Geometry is axis-aligned boxes plus patches.** There are no arbitrary convex brushes or CSG yet ([SHAGGED.md](SHAGGED.md) feature matrix), so agent-built maps will look blocky until patches and the planned Block Builder kit are used.

## Proposed design

Three layers, one source of truth: the same `EditorDocumentData` the human editor uses.

```mermaid
flowchart LR
  subgraph Agents
    MCP[MCP client: Claude, others] --> MCPS[shagged:mcp]
    Script[Scripts and CI] --> CLI[shagged CLI]
  end
  subgraph Core[Pure core, Node and browser]
    Ops[Operations: typed, validated, one transaction each]
    Gen[Generators: room, corridor, stairs, jump pad, teleporter pair]
    Rules[Rulebook checks: Map Health plus new rules]
  end
  subgraph Server[shagged:server]
    Store[Revisions with optimistic locking]
    Jobs[Compile and publish]
    Report[Map report: compile, nav, stuck, PVS, bots, perf]
    Live[Live channel: SSE or WebSocket]
  end
  MCPS --> Ops
  CLI --> Ops
  Ops --> Store
  Gen --> Ops
  Store --> Jobs --> Report
  Live <--> Editor[Browser SHAGGED editor]
  Store --> Live
```

### Layer 1: an operation library (pure core)

Extract a named operation set from what `EditorSession` does today, as pure functions over the document:

```ts
type Op =
  | { op: "box.create"; min: Vec3q; max: Vec3q; shader: string }
  | { op: "box.update"; id: string; min?: Vec3q; max?: Vec3q; shader?: string }
  | { op: "face.material"; id: string; faces: FaceKey[]; shader: string; align?: "natural" | Partial<FaceMaterial> }
  | { op: "entity.place"; classname: string; origin: Vec3q; keys?: Record<string, string> }
  | { op: "brushEntity.assign"; classname: string; brushIds: string[]; keys?: Record<string, string> }
  | { op: "patch.preset"; kind: "bevel" | "arch" | "flat"; /* sweep */ }
  | { op: "object.move" | "object.duplicate" | "object.delete"; ids: string[]; delta?: Vec3q }
  | { op: "gen.room" | "gen.corridor" | "gen.stairs" | "gen.jumppad" | "gen.teleporterPair"; /* parameters */ };

function apply(doc: EditorDocumentData, ops: Op[]): { doc: EditorDocumentData; created: string[]; issues: MapHealthIssue[] };
```

Design rules:

- **A batch is one transaction.** A list of operations either applies completely or not at all, through the existing `transact` and `validateDocument`. One undo step per batch, so a human can undo an agent's whole step.
- **Dry run and diff.** Every call can run with `dryRun: true` and return what would change (created/changed/deleted IDs, bounding boxes, new issues) without saving.
- **Optimistic locking.** Writes carry `expectedRevision`, as the server already requires. A human editing the same map in the browser and an agent can never silently overwrite each other.
- **Actionable errors.** Validation errors name the object, the field and the rule ("brush b12: x min 128 is not less than max 64"), never a stack trace.
- **Stable units.** Quake units, Z up, documented once in every tool description. Never Babylon coordinates.
- **Generators expand to ordinary objects.** A "room" becomes six brushes plus a light; a "teleporter pair" becomes a trigger brush entity, a `misc_teleporter_dest` and matching `target`/`targetname` keys. The document never contains hidden macro state, so a human can edit the result freely. (The [Block Builder](SHAGGED.md) proposal uses the same rule.)

### Layer 2: entry points

- **CLI** (`npm run shagged -- <command>`): `new`, `info`, `query`, `apply <ops.json>` (JSON or JSON Lines, with `--dry-run`), `health`, `compile`, `report`, `export`. Useful for scripts, tests and CI, and for agents that work through a shell.
- **MCP server** (`npm run shagged:mcp`, stdio): the same operations as typed tools, plus read-only resources — the rulebook, entity catalogue, texture catalogue and the current map summary. MCP is the protocol most AI clients already speak, and Blender's experience shows typed tools are safer than a code-eval tool. It talks to `shagged:server` over loopback, so the server stays the single writer of map files.
- **Live bridge** (later): `shagged:server` pushes document revisions to an open editor (Server-Sent Events are enough), so a human watches the agent build in four views, can undo its last batch, or keeps editing. The editor's existing revision check prevents lost updates.

### Layer 3: the map report (the feedback loop)

One command, `report`, runs the checks that already exist and returns a structured result an agent can act on:

| Check | Existing tool | Example finding |
| --- | --- | --- |
| Document rules | `validateDocument`, `inspectMapHealth`, new rulebook checks | "entity e7 trigger_teleport: target `arena2` has no destination" |
| Compiles, sealed | `CompileJobs` (MakeBSP `-leaktest`) | "leak: compile log points near (512, 128, 64)" |
| What was built | `cli:bsp info/entities` | brush and face counts, entities that survived compilation |
| Reachable | `BotNavGraph` | "item i3 (weapon_rocketlauncher) is unreachable from 2 of 4 spawns" |
| No traps | `audit:stuck` | "player hull stuck at (300, 40, 18)" |
| Visibility | `audit:pvs` | "PVS culls only 12%: the map is one open space" |
| Plays | `bot:server` + `demo:record` | bot deaths and pickups per minute, unused areas |
| Performance | `timedemo` on the recorded demo | median and p95 frame time against a budget |

Every finding carries coordinates or object IDs, so the agent can fix the exact object. Bot play and timedemo are slower (minutes, not seconds) and should be opt-in levels of the report.

## The mapping rulebook

An agent needs written rules, and the rules that can be checked should be checked. A first rulebook, from SHAG's own constants and SHAGGED's verified conventions:

**Units and the player** (from `src/shared/server/simulation/physics/constants.ts`):

- The player box is 30 × 30 units wide and 64 tall (32 crouched). Corridors at least 64 wide and 96 high leave comfortable room; 128 is a fight-able hallway.
- A step is at most 18 units; taller ledges need a jump. A standing jump rises about 45 units (jump velocity 270, gravity 800), so a 32-unit ledge is a hop and anything over about 44 needs stairs, a jump pad or a teleporter.
- Normal run speed is 320 units per second; at that pace a 1,024-unit room takes about three seconds to cross.

**Geometry and compile** (from [SHAGGED.md](SHAGGED.md)):

- Build on the grid (8 or 16 units); brushes must not overlap in volume.
- The playable space must be **sealed**: no gap from inside to the void, or MakeBSP's leak test fails.
- Caulk first: give hidden faces `common/caulk`, then texture visible faces.
- Shader names are written without the `textures/` prefix ("blx/blx_dark"); MakeBSP adds it.
- Triggers use `common/trigger`. Brush entities never set `origin` or `model`.

**Gameplay:**

- At least one `info_player_deathmatch`; for FFA, spread several apart with no direct line of sight between them.
- Every spawn should reach every weapon and every important item (checked by the nav graph).
- Teleporters and jump pads need a matching destination (`target` ↔ `targetname`).
- Give every room a light entity; an unlit compiled room is black.

**Performance** (from today's [WebGPU research](v0.9.27-webgpu.md)):

- Frame time is CPU-bound and grows with draw calls. Prefer fewer, larger brushes; avoid many small detail brushes in sight at once.
- Design so the PVS can cull: rooms joined by bends or doorways, not one big open field.

The rulebook should live in the repository as a document the MCP server serves as a resource, with each checkable rule mapped to a report code so the agent sees "rule R4 failed" together with the rule's text.

## Phased plan

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| **P0: core and CLI** | Operation library extracted from `EditorSession` behaviour; `shagged` CLI with `new`, `apply`, `info`, `health`, `compile`; three generators (room, corridor, teleporter pair). | A script builds two rooms joined by a corridor with spawns, a light per room and a weapon; it compiles with no leak; `cli:bsp` shows the entities; applying the same script twice gives identical `.map` bytes. |
| **P1: MCP and report** | `shagged:mcp` with typed tools and rulebook resources; `report` combining health, compile, BSP, nav reachability and stuck audit. | An AI client, given only a short brief ("small three-room FFA map"), produces a map that passes the report without human edits. Record the transcript and iterations. |
| **P2: live bridge** | Server pushes revisions to the open editor; editor shows agent changes and allows undoing a whole agent batch. | A human and an agent edit the same map; neither loses an edit; the human undoes an agent step from the editor. |
| **P3: play and polish** | Bot playtest and timedemo levels of the report; top-down plan images and editor screenshots for the agent to look at; more generators (stairs, arenas, Block Builder kit pieces). | An agent improves a map between iterations using bot and performance findings (for example, fixes an unreachable item, reduces p95 frame time). |

P0 is mostly moving existing logic behind names: the document, validation, writer, health check and compile path are done.

## Implementation log

### P0 slice 1: operations, generators and CLI (2026-10-10)

**Status: working end to end.** A JSON operations script builds a two-room map that compiles sealed with MakeBSP/MakeLight and is published as playable, without the browser editor.

Files:

- [`src/engine/editor/api/Operations.ts`](../../src/engine/editor/api/Operations.ts): `applyOperations(doc, ops)` and `emptyDocument()`. Operations: `box.create`, `box.update`, `face.material`, `entity.place`, `entity.update`, `brushEntity.assign`, `object.move`, `object.duplicate`, `object.delete`, `gen.room`, `gen.corridor`. Returns created/changed/deleted IDs and Map Health issues.
- [`src/engine/editor/api/Generators.ts`](../../src/engine/editor/api/Generators.ts): `generateRoom` (hollow room around an interior, wall thickness, doorway openings on any side, optional light) and `generateCorridor` (open-ended room along x or y).
- [`src/cli/shagged.ts`](../../src/cli/shagged.ts), `npm run shagged -- <command>`: `new`, `apply` (JSON array, `{ops: [...]}` or JSON Lines; `--dry-run`), `info` (`--objects`), `health`, `export`, `compile` (`--quality`). Output is JSON.
- Tests: [`api/__tests__/Operations.test.ts`](../../src/engine/editor/api/__tests__/Operations.test.ts) with the fixture [`two-rooms.ops.json`](../../src/engine/editor/api/__tests__/fixtures/two-rooms.ops.json).

Decisions made while building it:

- **Readable, deterministic IDs.** The GUI uses random UUIDs; API objects get the caller's ID or the next free `brush-N`/`ent-N`/`bent-N`, and generated parts derive from the generator's ID (`west-floor`, `west-east-2`, `west-light`). Agents can refer to what they made, and the same script gives the same bytes.
- **Validated after every operation**, so an error names the operation that caused it (`op 1 (box.create): Invalid x bounds on brush bad`), and a failing batch leaves the input untouched.
- **`face.material` needs the image size** for UV alignment, except `common/*` tool shaders (caulk, trigger, clip), so caulk-first texturing works now; a texture-lookup tool should supply sizes later.
- **Openings must lie inside the interior span** of their wall, so a room's corners stay sealed. A wall with a doorway becomes up to four pieces (strips either side, lintel, sill).
- **Corridors stop at their own length.** Their open ends meet a room's outer wall face to face; the corner columns of the removed end walls are dropped, because the joined room's wall seals that corner. Joining is by coordinates today: the corridor's interior cross-section must equal the room's opening.
- **`compile` uses the server's own `MapStore` and `CompileJobs` directly**, so no running `shagged:server` is needed. It saves the document as a revision (skipping the save when the source is unchanged), compiles, publishes to `public/data` and reports state, BSP hash, package and leak. The job runner left the process open after finishing, so the CLI now exits explicitly after printing.

Evidence:

- Fixture applied: 20 brushes, 3 lights, 2 spawns, 1 rocket launcher; Map Health reports no issues.
- `compile --quality fast`: `playable`, no leak, MakeBSP + MakeLight under one second, published `map_shaggedapi_test_00002.pk3`.
- `cli:bsp info` on the result: FBSP v1, 20 brushes, 120 brush sides, 7 entities (worldspawn, 3 lights, 2 spawns, weapon), 8 PVS clusters.
- Applying the script to two fresh documents and exporting gives byte-identical `.map` files (13,089 bytes).
- `npm run typecheck`, `npm run gate:biome`, and `vitest run src/engine/editor` (36 files, 193 tests) pass.

Not yet done or verified:

- Playing the compiled map (`map shaggedapi_test`) in the browser; no bots or reachability check yet.
- A `gen.connect` helper that derives a corridor from two rooms' openings, stairs, and teleporter-pair generators.
- The CLI's local documents do not round-trip through the browser editor's drafts yet; the server sidecar written by `compile` should open there with Server Open, but that was not tried.
- Two test packages (`map_shaggedapi_test_00001.pk3`, `_00002.pk3`) and their pointer are in the gitignored `public/data`; a cleanup or retention policy for agent builds is open.

### P0 slice 2: the map report with reachability (2026-10-10)

**Status: working.** `npm run shagged -- report <doc.json>` returns one JSON verdict: Map Health, compile, then reachability of the compiled map.

- [`src/engine/editor/api/Reachability.ts`](../../src/engine/editor/api/Reachability.ts): `analyzeReachability(nodes, edges, doc)`. A directed breadth-first walk over the bot navigation graph (walk, jump, fall, jump-pad and teleporter edges) from every spawn. It reports items some spawn cannot reach (with how many spawns can) and spawns that cannot reach every other spawn. Findings are in Quake coordinates and matched back to editor IDs by classname and nearest origin (within 96 units, because items settle to the floor when compiled).
- The CLI builds the graph exactly as bots do: `createBotVision(mapName)` then `BotNavGraph.buildFromVision`.
- **Fix found on the way:** the bots' `loadBspBuffer` ([`BspDataLoader.ts`](../../src/shared/bsp/BspDataLoader.ts)) searched a fixed list of paths and could not see SHAGGED's numbered packages, so bots would never have loaded a SHAGGED-built map. It now resolves through the pk3 index first, as the game server and the AGENTS.md rule require (`resolveMapBspViaIndex`, which follows SHAGGED's current-build pointer), and keeps the old list as a fallback.
- **No duplicate builds:** `compile` (and therefore `report`) reuses the current published build when its source hash and quality match, instead of publishing another identical package (`"reused": true`).
- Library logging is silenced inside `report` so stdout is only the JSON result.

Evidence:

- Two-room fixture: `report` → `ok: true`; 2 spawns, 1 item, nothing unreachable; build reused.
- Same map with a brush blocking the corridor (`shaggedapi_blocked`): `ok: false`. `weapon_rocketlauncher` (`objectId: "rl"`) is reachable from 1 of 2 spawns, and both `spawn-east` and `spawn-west` are reported cut off (`reaches: 0`).
- Unit tests: [`Reachability.test.ts`](../../src/engine/editor/api/__tests__/Reachability.test.ts) (4), including that a one-way drop does not make the way back reachable.

Not yet covered by the report: stuck spots (`audit:stuck`), PVS quality (`audit:pvs`), bot play and frame time.

### P1 slice 1: the MCP server (2026-10-10)

**Status: working with a real MCP client.** `npm run shagged:mcp` serves the operations, pipeline and guide over stdio.

- Dependency: `@modelcontextprotocol/sdk` **1.30.1** as an exact-pinned **dev dependency** (it is a local authoring tool started through an npm script, never shipped in the browser bundle or the game server). It brings `zod` 4 for tool input schemas. An install without dev dependencies cannot run `shagged:mcp`, like the other vite-node tools.
- [`src/cli/shagged-mcp.ts`](../../src/cli/shagged-mcp.ts): tools `shagged_guide`, `shagged_new_map` (empty or the sealed test room), `shagged_list_maps`, `shagged_map_info`, `shagged_apply` (with `dryRun`), `shagged_health`, `shagged_compile`, `shagged_report`, `shagged_entity_classes`; resource `shagged://guide`. Read-only tools carry `readOnlyHint`. Maps are documents in the gitignored `server-data/shagged/agent/<mapName>.json`, written atomically, with one edit at a time per map.
- [`src/engine/editor/server/AgentPipeline.ts`](../../src/engine/editor/server/AgentPipeline.ts): describe, health, compile (with build reuse), reachability and report, shared by the CLI and the MCP server so both behave identically.
- [`docs/manual/guides/shagged-api.md`](../manual/guides/shagged-api.md): the guide served to agents and humans alike: coordinates, every operation, a worked example, how to join rooms and corridors, the mapping rules, and how to read the report.
- **stdout is the protocol channel.** vite-node prints a banner, and map/bot/compiler code logs to stdout, some of it at import time, before the server could redirect its console. [`scripts/shagged-mcp.mjs`](../../scripts/shagged-mcp.mjs) therefore launches the server under vite-node and forwards only JSON-RPC lines to stdout, everything else to stderr. The server also redirects its own console to stderr.

Connecting a client, from the repository root (Claude Code shown; any stdio MCP client works the same way):

```text
claude mcp add shagged -- node scripts/shagged-mcp.mjs
```

Evidence: a probe using the SDK's own `Client` and `StdioClientTransport` listed the 9 tools and the guide resource; created `mcp_probe`; applied the two-room fixture (26 objects, no issues); got a clean error for a duplicate ID (`op 0 (box.create): id "west-floor" already exists`); found `weapon_rocketlauncher` through `shagged_entity_classes`; and `shagged_report` returned compile `playable`, no leak, reachability ok (2 spawns, 1 item). The CLI's `report` still returns `ok` after the pipeline refactor. Typecheck, the Biome gate and the editor tests (37 files, 197 tests) pass.

Not yet tried: an actual AI agent building a map from a brief through these tools (the P1 acceptance). The probe proves the plumbing, not the design quality.

### Acceptance run 1: a three-room FFA map from the guide (2026-10-10)

Brief: "a small three-room FFA map". Built from `docs/manual/guides/shagged-api.md` alone (by the implementing agent, so a friendly test, not an unbiased one): a 768 × 768 × 384 arena with a 40-unit hop-up platform, two 512 × 512 side rooms joined by 96-unit corridors, 4 spawns, rocket launcher, electrobolt, yellow armour, health and mega health. 15 operations, applied first time with no issues; compiled sealed and playable.

**The report then failed:** every arena item unreachable, every spawn reaching only its room-mate. Investigation showed **the map was fine and the bots' navigation graph was broken on every map**:

- Floor-sample nodes are stored 1 unit above the surface, but the walk test sweeps the player hull, which reaches 24 units **below** its origin (`SweepCollisionBackend`: mins.z = -24 at height 64). Every walk test from a floor or item node therefore started inside the floor and failed; floor nodes only ever linked through jump edges to spawns, which are stored at standing height.
- Measured on shipped maps before the fix: **wdm2**: 0 of 63 floor nodes had a walk edge, 4 walk edges in total; **wdm5**: 2 of 81, 14 walk edges. Bots were navigating on jump/fall/teleporter edges between spawns and items only.
- Fix ([`BotNavGraph.ts`](../../src/bot/BotNavGraph.ts)): the walk test sweeps from standing height (`WALK_TEST_LIFT` = 24) for nodes that sit on a surface (floor and item); stored node positions, which bots steer to, are unchanged. The movement fingerprint gains `walk-origin:24`, so saved navigation caches rebuild.
- After: **wdm2** 51 of 63 floor nodes walkable, **272** walk edges; **wdm5** 54 of 81, **270** walk edges; the three-room map 18 of 18, and its report passes (4 spawns, 5 items, all mutually reachable, 171 edges).
- Test: `BotNavGraph.test.ts` "tests walks from standing height…" models the hull (clear only when both ends are at least 24 units up) and fails without the fix (verified).

This is the first real payoff of the closed loop: an agent-facing check exposed a bug that had silently degraded bot navigation on every shipped map.

Lessons for the API from this run:

- Joining rooms by hand needs care: the corridor must start at the room wall's **outer** face, and the opening must match the corridor's cross-section. The guide's worked example made this possible; a `gen.connect` helper would remove the arithmetic.
- `entity_classes` is essential: Washoi names differ from Quake 3 (`weapon_electrobolt`, not a railgun).
- Still missing for richer maps: stairs (anything above a 44-unit hop), jump pads, and texture lookup with image sizes.

### P1 slice 2: connect, stairs, carve, and player reachability (2026-10-10)

**Status: working.** The acceptance map rebuilt with `gen.connect` needs no doorway or corridor arithmetic, and multi-level maps are checked correctly.

- [`BoxCsg.ts`](../../src/engine/editor/api/BoxCsg.ts): exact axis-aligned box subtraction (up to six boxes, deterministic order).
- New operations: **`brush.carve`** (subtract a box from every brush it cuts; pieces keep material and brush-entity owner, named `<id>`, `<id>-2`, …), **`gen.connect`** (from two rooms' interiors: carve the corridor's whole outer cross-section through both walls, then fill it with the corridor, so the join is sealed whatever the rooms' wall thickness; refuses different floor heights and corridors wider than the rooms' shared span), **`gen.stairs`** (solid steps on the floor, rising at most 18 per step, whole-unit treads).
- **Player reachability** ([`PlayerReach.ts`](../../src/engine/editor/server/PlayerReach.ts)). The bot graph cannot plan over stairs (straight swept-box links, height difference under 40, 256-unit floor sampling), so a balcony reached only by stairs was reported unreachable. The report's verdict now comes from a flood fill using the game's own movement: `stepSlideMove` with the player hull from every spawn in 32-unit steps over 8 directions, settling onto whatever is below (drops), and hopping where blocked. A hop counts only when it lands within jump height (45): the movement step can stair-step a further 18 at the apex, and the report must not overstate. The bot graph's result is still reported, as `botNavigation`, because bots need it.

Evidence (each `report` about 12–13 s on this machine):

| Map | Player reachability | Bot navigation |
| --- | --- | --- |
| Three rooms via `gen.connect` + 96-unit balcony with stairs (62 objects, no arithmetic) | **ok**: 4 spawns, 4 items, 4,367 positions | mega unreachable (stairs) |
| Same, stairs deleted (control) | **fails**: mega reachable from 0 spawns | mega unreachable |
| First three-room map (40-unit hop-up platform) | ok | ok |
| Two-room map | ok | ok |
| Two-room map with the corridor plugged | **fails**: rocket launcher from 1 of 2 spawns, both spawns cut off | same |
| The guide's own example, extracted from the guide and applied | ok, no leak | ok |

Tests: [`ConnectStairs.test.ts`](../../src/engine/editor/api/__tests__/ConnectStairs.test.ts) (volume-exact subtraction, carve keeps material and ownership, connect leaves no overlaps and an open doorway, refusals, stairs never above 18 per step) and [`PlayerReach.test.ts`](../../src/engine/editor/server/__tests__/PlayerReach.test.ts) (a 40 ledge is hoppable, a 60 ledge is not, stairs climb to 60, never over the void).

Open:

- Bots cannot route up stairs (bot graph limitation, separate from SHAGGED); the report surfaces it per map.
- Jump pads and teleporter-pair generators.
- An unbiased acceptance run with a fresh agent that has only the guide and the MCP tools.

### P1 slice 3: texture lookup (2026-10-10)

**Status: working.** Agents texture faces by name; the image size comes from the catalog.

- [`ImageSize.ts`](../../src/engine/editor/ImageSize.ts): width and height from TGA, PNG, JPEG, KTX and KTX2 headers, without decoding the image.
- [`server/TextureLookup.ts`](../../src/engine/editor/server/TextureLookup.ts): the editor's own `buildTextureCatalog` over every package in `public/data` (file lists and shader scripts, later packages overriding earlier ones, as in the game), plus the size of the image each texture actually draws. Building reads all 104 packages (510 MiB) in about 7.4 s, two passes so they are never all in memory at once; the result is cached in the gitignored `server-data/shagged/texture-catalog.json`, keyed by the packages' names, sizes and dates, and served from memory afterwards (2 ms). 2,101 textures; every one with an image has a size.
- `npm run shagged -- textures <words> [--folder] [--limit]` and the MCP tool `shagged_textures`: the texture browser's search, with sizes, tags and tool/sky/transparent/missing flags.
- `face.material` without `size` gets it from the catalog (`withTextureSizes` in the pipeline, used by CLI and MCP `apply`); an unknown texture is rejected and points to the search. Health in the CLI, MCP and report now passes the catalog, so unknown shaders and shaders without an image are reported.
- Checked: a search for "metal floor" returns `factory/factory_metal_floor` (32 × 32) and others; caulking all of a wall then texturing its room-facing face `blx/blx_dark` by name stored size 32 × 32; a misspelt texture is rejected; health on the three-room maps is clean with the catalog (the generators' default `blx/blx_grid` resolves). Through MCP: 10 tools listed; search, apply by name and health all work.
- Test: [`ImageSize.test.ts`](../../src/engine/editor/__tests__/ImageSize.test.ts) (5).

Not done: comparing every catalog size with the browser's decoded size (the browser decodes images; this reads headers); per-map package textures are included, since the catalog reads every package.

## Risks and open questions

- **Quality.** Agents are good at following rules and bad at taste. Expect valid but dull maps at first; the rulebook, generators and bot feedback have to carry the design quality. Human review stays essential.
- **Geometry limits.** Only axis-aligned boxes and patches exist. Interesting architecture needs patches, prefab kits, and eventually convex brushes/CSG, which is a separate, larger project.
- **Visual judgement.** Rendering editor screenshots needs a browser (headless Edge already works for renderer QA). A cheaper first step is a 2D top-down plan image drawn from the document in Node.
- **Compile toolchain.** MakeBSP/MakeLight binaries are local Windows files today; Linux builds were never run. CI or remote agents need them.
- **Safety.** Keep the current server rules: loopback only, configured origins, names validated as identifiers, no caller-chosen paths or executables, no code execution. Add per-batch limits (objects per batch, total brushes) so a runaway agent cannot fill the disk or lock the compiler.
- **Concurrency.** Optimistic locking already exists; the live bridge must surface conflicts clearly rather than merging silently.
- **Licensing of maps.** Decide who owns and how to credit agent-made maps before publishing any to the public map pool.

## Verdict

Feasible, and a genuine differentiator: few engines combine an in-engine level editor, a headless compiler pipeline and bots that can playtest the result. Start with P0: it proves the idea with mostly existing code, and every later phase builds on the same operation set.

## Sources

- [blender-mcp README mirror](https://www.remoteopenclaw.com/mcp/jagathgj/BlenderMCP): add-on plus MCP server architecture.
- [blender-mcp server source (fork)](https://glama.ai/mcp/servers/@Nanashi1526/blender-mcp/blob/efc833c7e9bad7515fc1f8a4f844949b9901f978/src/blender_mcp/server.py): `get_scene_info` over the add-on socket.
- [Another fork's server source](https://glama.ai/mcp/servers/@Aryeon0228/BlenderMCP/blob/9ef060bfec2038359e31903c9c83e3536c42c2b0/blender_mcp_server.py): `execute_blender_code` and its warning.
- [Hermes agent Blender skill](https://tessl.io/registry/skills/github/NousResearch/hermes-agent/blender-mcp): inspect the scene first; the add-on does not start in background mode.
- [A typed-tools Blender MCP server](https://glama.ai/mcp/servers/@ShirshovDIM/retopoflow_blender_mcp/blob/78358fedc1d6d47808d380d331e176370b479c59/src/tools/scene.py): typed tools instead of a code-execution catch-all.

These are third-party listings and forks of the original `ahujasid/blender-mcp` project; tool sets differ between forks.
