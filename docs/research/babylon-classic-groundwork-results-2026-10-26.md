# Current-renderer groundwork: first implementation results

Date: October 26, 2026. Branch: `v1.0.0-alpha6-renderer-groundwork`.
Reference checkpoint: engine `c63c14b3` / Babylon 9.31.2; FPS
`0759316308429c2ad36aa1e3bda1b111b22016e7` unchanged.
See the [progress matrix](babylon-classic-to-lite-groundwork-plan-2026-10-26.md#feature-branch-and-progress-matrix).

## Delivered and deliberately bounded

- Current Voltaic batches upload a contiguous interval of changed logical slots
  per stream, retaining the same pools, geometry, seeds, clocks and shaders.
- Partial-buffer restoration recreates full-capacity matrix/custom buffers from
  retained CPU arrays. Engine restoration subscriptions are removed on renderer
  or scene disposal.
- `Q3StageEvaluation.ts` provides numeric wave/tcMod evaluation with injected
  randomness, while `ShaderAnimationSystem` retains its clock, ordering, material
  binding and existing public exports. No universal clock change was made.
- Animated frame textures are assigned only when the actual material target
  differs. This preserves intervening/multiple writers rather than trusting a
  cached frame index.
- A narrow `Q3AnalyticAnimationPlugin` and reusable browser fixture compare GPU
  scroll/sine expressions with current Standard/PBR rendering on WebGL2/WebGPU.
  **The plugin is a diagnostic comparison adapter, not automatically selected
  for gameplay materials.** It requires UV1, identity texture transforms, opaque
  base-image semantics and caller-owned elapsed/registration phase. It does not
  implement arbitrary tcMods, emissive layers, alpha routing or demo clock policy.

The P5 decision is to defer shared-clock UBOs and broader shader-stage adoption
until a meaningful eligible workload is established. No Lite dependency,
renderer preference, release version, FPS runtime or production media changed.

## Matched effect fixture

Headless Edge reached the real NVIDIA RTX 4070 SUPER GPU. The controlled fixture
used one remote beam in the existing 32-slot world pool, a fixed camera, manual
effect time and 120 updates/renders at 256 × 256. Both current backends were
tested. The archived reference module was read from `c63c14b3` into ignored
`.cache/` and imported beside the candidate. No live source checkout/revert or
concurrent edit was used for this comparison.

| Backend | Reference submitted bytes | Candidate submitted bytes | Calls, each | Matched final image |
| --- | ---: | ---: | ---: | --- |
| WebGL2 | 552,960 | 17,280 | 1,080 | Identical SHA-256 |
| Babylon WebGPU | 552,960 | 17,280 | 1,080 | Identical SHA-256 |

That is **4,608 → 144 bytes/update, 96.875% less submitted payload** in this
one-active-slot fixture. It is not a measured reduction in bus traffic or a
whole-game FPS improvement. The same nine calls still occur for an upsert.
At high occupancy or widely separated changes, the contiguous interval can
cover much of the pool; no claim of the same percentage applies there.
Wall-clock loop/readback durations are retained in local JSON only as diagnostic
context. They include GPU/readback work and are not stable CPU render benchmarks.

Image hashes, compared within each backend:

- WebGL2: `e2fcb4774a203a2d805b166b3633a4894717b671246584025f03f7dd9ffb4ff9`
- WebGPU: `db171fec61fc554d449c4d2c37ed682c7c318c527e5c04c401ceb163a4c9ee8f`

The WebGL fixture used `WEBGL_lose_context` and restored identical pixels from
the retained effect state. After restoration it waits for readiness and rendered
frames before readback; the initial fixture read too early and produced a
mismatch. No extra effect event was needed to repopulate the buffers. WebGPU
device loss was not exercised by this test.

## Shader experiment and actual content inventory

The analytic fixture tested Standard and PBR materials with scroll, sine-wave
diffuse modulation and both together at five times, including negative rates,
negative time and 1005.25 seconds. There were 30 comparisons per backend, 60
total. All passed the two-level 8-bit channel tolerance; the largest observed
channel difference was **one**, in PBR wave cases. Candidate materials remained
frozen while time changed. Nonbackground pixels were required to prevent an
empty render from passing.

The first reference captures exposed a fixture issue: changing an identity UV
matrix to a nonidentity matrix can select a different Babylon shader variant.
Readback now waits for scene readiness before drawing. This finding reinforces
the existing loading/warmup requirement; it is not evidence that skipped draws
are an accepted optimization.

A real local playback of `washoi_dm5_ffa_20261025_170933.shagdemo` loaded
`washoi_dm5` on WebGL2 with 618 meshes at the inventory point, 16 registered
animation entries, and no failed HTTP requests. Its stages included:

- Seven fixed-scale-only BSP registrations (one generated PBR, others Standard).
- Two emissive frame animations (jump pad and sign).
- A sine-wave emissive teleporter and a rotating fan.
- A mixed scale-plus-scroll water stage with authored color.
- Four rotating/scrolling projectile emission registrations, some with triangle
  waves. This inventory is a point in demo playback, not an exhaustive asset list.

Those are mostly outside the deliberately narrow opaque identity-UV base-image
candidate. Promoting it to a broad gameplay default would need more semantics
and ownership work than this evidence justifies. Retain it as a functioning
comparison fixture and future Lite reference; keep the classic CPU route for
normal map content. The fixed-scale registrations are a separate profiling
candidate, not silently converted into a new timing/freeze policy here.

The demo logged existing skin-root warnings. This pass did not repair model
hierarchies, prove live FFA networking, or establish complete gameplay WebGPU
parity. Shader fixture agreement is not a substitute for those checks.

The [fixed-scale follow-up](babylon-classic-fixed-scale-results-2026-10-26.md)
corrects the initial inventory tally from eight to seven fixed-scale entries
and validates a narrow fast path for them. The original JSON contains seven;
the earlier written tally was an arithmetic error, not a content change.

## Reproduction

Headless validation precedes browser probes. Start a private, no-HMR Vite server:

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3117
```

In a second shell at the assembled root:

```powershell
node scripts/benchmarks/renderer-groundwork.mjs webgl2 effects 3117 c63c14b3
node scripts/benchmarks/renderer-groundwork.mjs webgl2 effects
node scripts/benchmarks/renderer-groundwork.mjs webgpu effects 3117 c63c14b3
node scripts/benchmarks/renderer-groundwork.mjs webgpu effects
node scripts/benchmarks/renderer-groundwork.mjs webgl2 materials
node scripts/benchmarks/renderer-groundwork.mjs webgpu materials
```

Restart the private server after source edits. The optional commit argument
reads the reference effect module from Git without changing either worktree;
it requires a hexadecimal commit hash and effects mode. Logs/measurements are
written to `.cache/renderer-groundwork/`, with separate reference files. The
probe restores its upload-method wrapper and disposes scenes/engines/Edge.
The frontend fixture is imported only by this diagnostic driver; it is not a
normal game entry or a player-facing setting.

The map inventory used the existing private-browser demo procedure and a local
one-off reader of the animation registry. It was not added as a supported
public registry API. Broader automated content coverage remains future work.

## Validation and limits

Completed runtime validation commands:

```powershell
npm.cmd run typecheck
npm.cmd run test:run -- --silent
npm.cmd run gate:biome
npm.cmd run build
npm.cmd --prefix src/games/fps run test:simulation
npm.cmd --prefix src/games/fps run test:physics
npm.cmd --prefix src/games/fps run server:tick
npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000
npm.cmd --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
```

The complete test run passed 737 files, 5,737 tests and one skipped test.
Focused checks cover ordered overwrite/negative modulo/RNG semantics,
registration phase and existing disabled-clock behavior; frame target ownership;
sparse slot updates, tail/swap removal, reuse, restoration and disposal order.
The simulation/physics/tick/fuzz checks passed, with zero fuzz errors and matching
repeat checksums. The indexed headless map check reported 7,475 faces.

The first focused disposal/buffer-capacity assertions were corrected to use
Babylon's public observer state and instanced-buffer data accessors: observable
removal is deferred, and ordinary mesh vertex counts do not size instance data.
The typecheck also caught an overly broad readback-buffer type in the diagnostic
hash code; an owned byte copy resolves it. The Biome gate caught import/format
issues, which were fixed without changing its baseline.

Typecheck and production build passed. Biome passed at its existing baseline of
0 errors and 47 warnings; the build retained its existing large-chunk warning.
`npm.cmd run docs:build` passed, and the local result validator checked the GPU
records, 60 frozen-material comparisons, 15 research links and Markdown fences.
No global FPS, full-scene p99, device-loss,
all-map or automatic analytic-stage adoption result is claimed. Historical
research snapshots retain their preimplementation source hashes; they must not
be regenerated and described as the old baseline after these runtime changes.

## Files in this implementation

- `src/engine/rendering/data/DirtySlotRange.ts`
- `src/engine/weapon/voltaic/VoltaicEffectRenderer.ts`
- `src/engine/weapon/__tests__/VoltaicEffectRenderer.test.ts`
- `src/engine/loader/shader/Q3StageEvaluation.ts`
- `src/engine/loader/shader/ShaderAnimationSystem.ts`
- `src/engine/loader/shader/Q3AnalyticAnimationPlugin.ts`
- `src/engine/loader/shader/__tests__/Q3StageEvaluation.test.ts`
- `src/engine/loader/shader/__tests__/Q3AnalyticAnimation.test.ts`
- `src/engine/loader/shader/__tests__/TextureTransforms.test.ts`
- `src/engine/rendering/__qa__/RendererGroundworkFixture.ts`
- `scripts/benchmarks/renderer-groundwork.mjs`
- `docs/manual/guides/shader-system.md`
- `docs/manual/guides/render-variables.md`
- `docs/research/babylon-classic-to-lite-groundwork-plan-2026-10-26.md`
- `docs/research/babylon-classic-groundwork-results-2026-10-26.md`
- `docs/changelog/v1.0.0-alpha.6.md`
