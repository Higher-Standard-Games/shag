# BSP triangle-soup collision — misc_models are wrongly solid (v0.9.21 investigation)

**2026-10-16 review:** the historical claim below that unsupported draw-surface
centroids prove required gameplay collision is being re-evaluated. Probes can
start embedded or sample decorative/sky-portal geometry. See the
[collision-authority investigation](./v0.9.31-collision-authority.md) before using
these counts to justify triangle-soup collision. The old implementation decision
is preserved here as history, not a verified current requirement.

## Symptom
Small decorative geometry baked into maps — e.g. the little lamp/decor "models" on
the wdm2 floor — collide with players and shots. In Q3/Warsow they are non-solid;
you walk through them.

## Root cause (not what it looks like)
It is **not** a brush flag we're missing. Those decorations aren't brushes at all —
q3map2 bakes `misc_model` entities into the BSP as **render faces (drawSurfs)**, most
of them **triangle-soup** surfaces (`faceType 3`, `MST_TRIANGLE_SOUP`).

The Q3/Warsow collision model (`CM_*`) is built from **brushes + patches only**:
- `CMod_LoadBrushes` / `CMod_LoadLeafBrushes` → brush collision
- `CMod_LoadPatches` → **only** `MST_PATCH` (`faceType 2`) surfaces
- Triangle-soup and planar drawSurfs are **never** added to the collision model.

So a misc_model's faces have `SOLID` content on their shader (baked from the shader),
but that content is irrelevant for collision in Q3 because faces aren't collision
primitives — only brushes and patches are. A misc_model is solid in Q3 **only** if the
mapper gave it clip (spawnflag 2 / `_clipmodel`), which emits real clip *brushes*.

Our engine diverges in `SweepCollisionBackend.processFaces()`: it builds collision
meshes for `faceType 2` (patches — correct) **and `faceType 3` (triangle soup —
wrong)**, gated only on `contentFlags & SOLID`. `traceLeafFaces()` then collides them
with no further filter. Result: every SOLID-shader triangle-soup surface is solid,
including all baked misc_models.

### Second bug (not latent): detail brushes treated as non-solid
`shouldCollideWith()` and `ContentFlags.isSolid()/isPlayerSolid()` skipped any brush
with `CONTENTS_DETAIL` — but detail is a **vis/portalization** flag, not a solidity
flag. Q3/Warsow collide detail brushes normally. A scan of the pack found **716
detail brushes across 8 maps** — wbomb1 (462) and wdm12 (199) most, all
`SOLID|DETAIL|TRANS` (glass panels / railings: translucent for vis, but solid). We
were making all of them walk-through. Fixed by removing the detail exclusion in both
places (detail brushes now honor their SOLID/PLAYERCLIP content like every other brush).

## Data (all 38 shipping maps)
- Every map has real patches (`faceType 2`): wdm2 = 91, wbomb2 = 865, wctf2 = 1664.
- Triangle soup (`faceType 3`) is **mostly `textures/` shaders** (world geometry, likely
  `-patchMeta`'d curves/meshes), with a smaller `models/` (misc_model) slice:
  - wdm2: 442 soup total → **1 `models/`**, 441 `textures/`
  - wbomb4: 7214 soup → 2617 `models/`, 4597 `textures/`
  - wctf2: 1269 soup → 0 `models/`, 1269 `textures/`

## Fix options & tradeoff
1. **Q3-authentic — stop colliding all triangle soup (`faceType 3`).** Matches Q3/Warsow
   exactly. **Risk:** removes collision from the thousands of `textures/`-shaded soup
   faces per map. Warsow itself doesn't collide those (so maps *should* stay playable on
   brush/patch collision), but if any surface here is load-bearing only via its soup face
   (e.g. a `-patchMeta` curve with no clip brush), players fall through. **Needs
   per-map playtesting.**
2. **Targeted — skip triangle-soup collision only for misc_model shaders** (`models/…`,
   `mapobjects…`). Low regression risk (leaves world `textures/` soup collision intact),
   directly fixes the visible lamp/decor solidity. Not fully Q3-authentic, and the shader
   heuristic can miss oddly-named model shaders.

**Recommendation:** ship option 2 now (safe, fixes the reported symptom), and evaluate
option 1 behind a playtest pass — ideally validated by walking each map with a
"no-soup-collision" build and checking for fall-through.

## Decision (v0.9.21)
Option 1 was tried first and **reverted — it broke the game.** Final decision is
**option 2 (skip only `models/` | `mapobjects` soup)**, plus the detail-brush fix, plus a
third fix (asymmetric hull, below) found while investigating the fallout.

### Why option 1 failed (measured, not theorized)
The premise above — that `textures/`-shaded soup is `-meta`/`-patchMeta` output still
backed by its source brushes — is **wrong for these maps**. q3map2 emits
`MST_TRIANGLE_SOUP` for any surface that can't be a lightmapped planar face, which
includes **vertex-lit world geometry** (`textures/…_vertex` walkways, platforms, floors).
That geometry is soup-only: nothing else holds it up.

Probe over the whole shipping pack — for every walkable (normal z ≥ 0.7) SOLID soup face,
trace down from its centroid and see what catches you:

| build | walkable soup faces with no support |
|---|---|
| before the branch (soup solid) | **0** across all 36 maps |
| option 1 (no soup collision) | **336** across 10 maps |

Worst offenders: wbomb4 (149), wbomb5 (66 — **30 of them drop out of the world entirely**,
no ground within 8192u), wbomb2 (35), wbomb1 (30), wbomb3 (17), wctf2 (15), wtutorial1 (11),
wbomb6 (7), wdm1 (4), wdm17 (2 — 1 bottomless). These are `vertex_woodplank03`,
`vertex_grey65`, `vertex_redmetalbase`, `metal1_vertex` — i.e. walkways and platforms
players and bots stand on.

Splitting the same probe by shader prefix shows option 2 is safe:

| soup shader class | walkable surfaces that lose support |
|---|---|
| `models/` \| `mapobjects` (baked misc_models) | **0** across all 36 maps |
| `textures/` (world geometry) | **336** across 10 maps |

So skipping decoration soup fixes the reported symptom with zero measured collision loss.
Verified the classifier catches the right things — the skipped shaders are exactly
`models/mapobjects/lights/coldlight_01`, `…/decor_misc/aircondition_*`,
`models/mapobjects/jumppad/flame`, `…/jumppad/{l,u}_ring`,
`models/mapobjects/teleporter/teleporter_01_a`, `mapobjects_decor_misc_spanner`, etc.
(The jumppad and teleporter models being solid was its own bug — they sat on top of pads.)

### Third bug, found via the same investigation: face collision used a symmetric hull
`traceTriangleSwept()` offset the player box from the triangle plane with
`state.extents` — `max(|mins|, |maxs|)` per axis. The player hull is **asymmetric**
(`PLAYER_MINS_Z = −24` to the feet, `PLAYER_MAXS_Z = +40` to the head), so on a floor
this used 40 instead of 24 and rested the origin **exactly 16 units too high**. Every
patch and triangle-soup surface floated the player 16u; brush surfaces did not, because
`traceBrush()` has always used the correct asymmetric support point
(`offset[j] = normal[j] < 0 ? maxs[j] : mins[j]`).

Fixed by giving `traceTriangleSwept` front/back offsets from the real hull, matching
`traceBrush`. This is what the "players/bots hover above curved floors" reports were.
Measured over all spawn/item entity origins in the pack: 65 points now settle 2–16u lower
(40 of them ≈14u), none higher, none lose their ground.

Regression tests: `src/engine/__tests__/SweepCollisionBackend.test.ts` — world soup stays
solid, `models/`/`mapobjects_` soup does not collide, and a soup floor rests the player at
the same height as an equivalent brush floor.
