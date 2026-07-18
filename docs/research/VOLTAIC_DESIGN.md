# Voltaic and Lasergun Beam Graphics — Research and Design

**Status:** Effect-only visual design; implementation not started
**Date:** 2026-07-18
**Scope:** The Voltaic shooting effect only, from muzzle to impact
**Constraint:** All new beam graphics must be generated in TypeScript/Babylon.js with no external visual assets
**Performance target:** Maximum spectacle from 2 primary draws, no external visual assets

---

## 0. Executive decision

The beam should be rebuilt around one principle:

> **The visible primary spine is the hitscan result. Motion and personality live around that spine, never in place of it.**

The recommended production design is:

1. **Build the Voltaic Rift, not a cleaner laser line.**
   - A razor-white straight spine appears over the full hitscan path instantly.
   - Three jagged gold lightning streams violently snap around that spine.
   - A faint blue-violet shock sheath makes the air around the bolt feel torn
     open.
   - One or two short forks rupture outward during each electrical state.

2. **Put the apparent complexity in one hero shader.**
   - One camera-facing quad draws the exact core, three bolt streams, shock
     sheath, forks, and previous-state ghost analytically.
   - The primary geometry is four vertices and six indices and never changes.
   - The shader receives only start, end, time, seed, intensity, and visual
     width.
   - The desired common cost is one beam draw plus one impact-storm draw.

3. **Make electricity snap instead of swim.**
   - Generate a new deterministic bolt state approximately 18–24 times per
     second.
   - Switch quickly to the new shape while the previous state fades for roughly
     25–45 ms inside the same shader pass.
   - Use piecewise-linear procedural noise with sharp corners, not smooth helix
     motion and not per-frame `Math.random()`.

4. **Make the endpoint the explosion of the composition.**
   - Terminate in a large white-hot nucleus.
   - Surround it with a broken rotating crown, radial electrical spikes, and a
     restrained halo.
   - Pulse the endpoint on contact without blinking the full beam.
   - Chain arcs, when shown, erupt from this nucleus using the same visual
     language at a larger displacement.

5. **Keep spectacle away from the crosshair.**
   - The field begins narrow at the muzzle.
   - Chaos and sheath width grow through the middle of the beam.
   - Maximum rupture occurs in the final third and at impact.
   - The exact core never bends, disappears, or travels.

6. **Render the same hero effect for enemies, accurately enough to trust.**
   - Local POV and enemy clients call the same renderer and profiles.
   - The straight core begins at the currently visible muzzle and ends at the
     resolved impact supplied to the effect.
   - Bolt streams, forks, sheath, and ghosting are decorative and reconstructed
     locally from shooter seed and effect time; no lightning path is networked.
   - Each client billboards the effect to its own camera, so the rift never
     presents a paper-thin edge.
   - If the remote muzzle is temporarily unavailable, use an interpolated eye
     fallback without changing the endpoint.

This document supersedes the **visual** decision in
[`v0.9.16-weapon-system-overhaul.md`](./v0.9.16-weapon-system-overhaul.md) that
specified a whole-bolt random re-jitter every frame. It does **not** supersede
the gameplay decision that Voltaic uses chain lightning.

---

## 1. Goals and non-goals

### 1.1 Goals

- Make Voltaic feel like an electrical catastrophe held open by the gun.
- Preserve a precise first-person sight line inside a much larger hero effect.
- Make the same effect spectacular from first-person and world-camera angles.
- Preserve the immediate visual language of a hitscan weapon.
- Replace the inherited Lasergun aesthetic rather than imitate it.
- Make the effect attractive with bloom enabled and still readable with bloom
  disabled.
- Keep all new visuals procedural and repository-native.
- Make sustained fire allocation-free after beam acquisition.
- Make every major visual layer react coherently to the same effect clock.
- Spend visual complexity at the endpoint and final third of the beam.

### 1.2 Non-goals

- No new GLB, texture, sprite sheet, particle texture, or authored shader asset.
- No gameplay rebalance is automatically authorized by this design.
- No conversion of either weapon into a projectile or simulated traveling bolt.
- No network protocol, hit detection, lag compensation, weapon-state, audio, or
  model redesign in this effect brief.
- No general-purpose renderer framework.
- No reliance on post-process bloom as the only way the beam can be seen.
- No screen-space beam that ignores world depth or shines through walls.

### 1.3 Assumptions

- Voltaic is the visual replacement for the Lasergun weapon role; this document
  is not designing two competing primary beam aesthetics.
- Voltaic remains an 850-unit, 20 Hz single-ray hitscan weapon.
- Voltaic keeps chain lightning and hipfire wander unless a separate gameplay
  decision changes them.
- Existing weapon models and sounds remain; “no external assets” applies to the
  new shooting graphics.
- Babylon.js remains at or near the installed `@babylonjs/core` 8.56.0 API
  during implementation. The manifest currently permits this through
  `^8.44.1`.
- The effect receives valid muzzle and impact positions from existing gameplay
  code. How those positions are produced or replicated is outside scope.

---

## 2. Source audit: current behavior

### 2.1 Relevant files

| Area | File | Current responsibility |
|---|---|---|
| Generic hitscan VFX | `src/engine/weapon/HitscanEffects.ts` | Tracers, beams, lightning, impacts, chain arcs |
| First-person beam lifecycle | `src/engine/weapon/WeaponViewManager.ts` | Updates active beam every render frame |
| Local fire/charge input | `src/games/fps/FPSPlayer.ts` | Starts and stops the first-person beam |
| Remote fire dispatch | `src/games/fps/client/GameEvents.ts` | Converts network events into VFX |
| Remote weapon pose | `src/games/fps/client/RemotePlayerRenderer.ts` | Interpolated player and hand-attached weapon |
| Server weapon trace | `src/games/fps/server/systems/WeaponSystem.ts` | Fire cadence, damage, wander, chains |
| Snapshot construction | `src/games/fps/server/SnapshotBuilder.ts` | Publishes weapon events and weapon state |
| Event types | `src/engine/network/core/SnapshotEvent.ts` | Client-side discriminated snapshot events |
| Binary codec | `src/shared/net/BinaryProtocol.ts` | Active event encode/decode |
| Demo playback | `src/games/fps/client/DemoService.ts` | Replays recorded weapon events |
| Weapon definitions | `src/shared/entities/definitions/weapons/{lasergun,voltaic}.ts` | Gameplay and presentation configuration |

### 2.2 Existing first-person path

`FPSPlayer.updateFiring()` starts an active beam after the current charge/ADS
rules. `WeaponViewManager.update()` then:

1. Gets an approximate first-person muzzle position.
2. Gets `mainCamera` forward.
3. Calls `HitscanEffects.updateBeam()` for Lasergun or
   `updateLightningBeam()` for Voltaic.
4. The effect performs a client scene pick from the muzzle along camera forward.

Problems:

- Gameplay targeting originates from the server eye/view position, while the
  visual raycast originates from an offset muzzle.
- Muzzle-to-target parallax can make the visual endpoint differ from the
  crosshair result.
- Voltaic server damage includes deterministic wander; the local beam uses plain
  camera forward.
- The local scene pick is cosmetic and may disagree with server BSP/player
  resolution.
- The first-person Voltaic bolt can cross the center of the screen with a bow up
  to 110 world units.

### 2.3 Existing Voltaic geometry

The active Voltaic beam creates:

- 9 core cylinder meshes.
- 9 glow cylinder meshes.
- 2 shared `StandardMaterial`s.
- 1 pooled endpoint light.

Every render frame:

- A coherent bow rotates over time.
- Every interior point also receives a new `Math.random()` offset.
- All 18 cylinders are repositioned and reoriented.

Consequences:

- The path has no temporal continuity in its high-frequency component.
- The noise rate depends on render rate.
- The primary damage indicator is overwhelmed by decorative bowing.
- Multiple remote Voltaic users multiply the mesh and transform-update cost.
- Cylinder silhouettes appear physically thick near the first-person camera.

### 2.4 Existing remote path

`weapon_fire` currently carries:

```text
entityId
weaponId
origin xyz
direction xyz
```

The remote dispatcher has a dedicated Voltaic case, but no Lasergun case.

Current effects:

- **Voltaic:** `origin + direction * 850`, no remote raycast and no authoritative
  endpoint.
- **Lasergun:** falls through to the generic default tracer with a 5,000-unit
  range.
- **Start point:** the server eye origin, not the interpolated hand/weapon muzzle.
- **Continuity:** the beam is retained until 150 ms after the last fire event.

This explains the strongest reported remote-client failure modes:

- Lasergun is not rendered as a continuous Lasergun beam.
- Voltaic can continue through walls and targets to maximum range.
- The beam can detach from the visible remote weapon because player rendering is
  interpolation-delayed while the event origin is a discrete server sample.
- The endpoint moves at the 20 Hz damage cadence while player/weapon pose is
  rendered every frame.

### 2.5 ID type inconsistency

The client event type defines `entityId` as a string, while
`HitscanEffects.remoteBeams` and `remoteLightning` are declared as maps keyed by
number. `handleRemoteWeaponFire()` accepts `any`, which hides the mismatch from
TypeScript.

JavaScript maps can still use the runtime string key, so this is not by itself a
complete explanation for the visual bug. It is nevertheless unsafe and should be
corrected in the new beam API.

### 2.6 Wander cadence finding

The server describes Voltaic hipfire wander as a “slow lissajous sweep,” but the
current phase is:

```ts
const t = tick * 0.35 + shooterId;
```

At 125 simulation ticks per second:

- yaw phase speed is `43.75 rad/s`, approximately `6.96 Hz`;
- pitch uses `t * 1.7`, approximately `11.8 Hz`;
- consecutive 20 Hz beam damage samples are separated by roughly `2.1` radians
  in the yaw phase.

With a four-degree amplitude and 850-unit range, endpoint displacement can be
around 59 units on one axis before combining yaw and pitch. This is fast enough
to look like discontinuous endpoint jumping on a remote client.

This is partly gameplay, not merely graphics. The beam renderer should correctly
display the authoritative direction regardless. Retuning the wander to genuinely
slow frequencies is recommended but requires explicit gameplay approval.

---

## 3. Out-of-scope engine audit retained for reference

This section records issues discovered during source inspection, but none are
part of the Voltaic effect proposal or its visual implementation work order. The
effect renderer assumes it is given a muzzle position and an endpoint. Gameplay
and networking corrections must be planned separately if desired.

The initial design assumed the server already owned one exact beam endpoint.
Source inspection shows that assumption is false in the live `WeaponSystem`.

### 3.1 Current player trace

`traceHitscanRay()`:

- loops through player entities;
- uses a simple ray-to-center distance test with radius 32;
- returns the first qualifying entity in iteration order;
- does not compare candidates to find the nearest player;
- does not compare the player hit distance against a BSP hit distance;
- returns the target entity origin rather than the actual ray intersection.

### 3.2 Current world trace

`traceWorldImpact()` separately traces the BSP collision world. It is currently
used for hitscan splash/insta-jump behavior, not as the general occlusion boundary
for normal single-ray weapon damage.

### 3.3 Consequences

- A server-authoritative visual endpoint cannot be obtained by merely serializing
  the existing `primaryHit.position`.
- A player behind a nearer wall may qualify in the player-only path.
- If multiple players qualify, entity iteration order can decide which is hit.
- The VFX endpoint and damage endpoint cannot be guaranteed identical.

### 3.4 Existing reusable work

`src/engine/server/lagcomp/LagCompensation.ts` already contains a better conceptual
algorithm:

1. Trace the world and compute its blocking distance.
2. Test all player capsules.
3. Select the closest player intersection that occurs before the world.
4. Return distance, point, normal, hit part, and world-block information.

However:

- the live `WeaponSystem` does not use this class;
- `WeaponDef.useLagCompensation` is configured on hitscan weapons but is not read
  by the live server weapon path;
- the lag-compensation class's world-only result currently provides a distance
  but does not retain the BSP `hitPoint` and normal in its returned `HitResult`.

### 3.5 Required prerequisite work

Introduce one result type used by damage, VFX, chains, telemetry, and future lag
compensation:

```ts
interface HitscanImpact {
  kind: "none" | "world" | "player";
  distance: number;
  point: Vec3;
  normal: Vec3;
  entityId?: EntityId;
  hitLocation?: HitLocation;
}
```

The trace must:

1. Normalize the direction once.
2. Compute the BSP impact and distance.
3. Compute the closest eligible player capsule intersection.
4. Choose the smaller positive distance.
5. Apply damage only when the winning candidate is a player.
6. Return a max-range `none` endpoint when neither wins.

This is a gameplay correctness change and therefore needs its own focused tests.
It should be implemented before the new endpoint is put on the wire.

---

## 4. Historical and engine research

### 4.1 Quake III's useful precedent

The open Quake III source keeps targeting and presentation separate:

- `CG_LightningBolt()` computes a muzzle/view direction, traces to the world, and
  uses `trace.endpos` as the beam endpoint.
- It uses the provided weapon-origin/tag point as the visual beam origin even
  though that can differ slightly from the trace origin.
- It adds an impact effect only when the trace actually hits.
- The renderer's `RB_SurfaceLightningBolt()` draws several rotated camera-facing
  rail-core quads, not a chain of solid cylinders.

The exact Q3 implementation is not a blueprint for modern visuals, but it
validates two principles:

1. Resolve the hit endpoint independently from the decorative muzzle origin.
2. Use camera-facing beam surfaces for predictable apparent width.

Relevant primary-source files:

- [Quake III `cg_weapons.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/cgame/cg_weapons.c)
- [Quake III `tr_surface.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/renderer/tr_surface.c)

### 4.2 Babylon `GreasedLine`

Babylon's
[`GreasedLine`](https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/param/greased_line)
is designed for arbitrary-width 3D lines rendered as triangles. Relevant features
available in the resolved Babylon 8.56.0 package include camera-facing expansion,
size attenuation, widths, colors, disconnected paths, dashing, offsets, and live
point replacement.

It is a strong spike primitive and already removes the current cylinder-chain
failure modes. However, installed-source inspection changes the production
recommendation:

- `setPoints()` converts the point arrays, recomputes widths and color pointers,
  and calls `_setPoints()`;
- `_setPoints()` allocates a new `ArrayBuffer`, regenerates positions, indices,
  UVs, previous/next attributes, and line-length counters;
- it reapplies vertex data and refreshes bounds unless lazy mode is used;
- the stock fragment shader produces a hard line edge and dash/color logic, not
  an analytic soft core and corona;
- a three-layer beam therefore means repeated geometry work and roughly three
  transparent draws per primary beam.

Those costs are modest for a few short lines, but they are avoidable for a
continuous effect whose topology and visual grammar are known in advance.

**Conclusion:** use GreasedLine to establish endpoint correctness, width targets,
and a fallback path. The production target should be a static analytic ribbon
whose motion is evaluated on the GPU.

### 4.3 Babylon ribbons

Babylon
[`CreateRibbon`](https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/param/ribbon/)
can update an existing ribbon when path topology is unchanged. SHAG already uses
updatable ribbons for projectile trails and weapon slash effects.

Ribbons offer full UV and material control, but a CPU-built camera-facing world
ribbon has a difficult first-person edge case: the beam direction is almost
collinear with the view direction. Robust hybrid world/pixel extrusion belongs
in the vertex shader. For a generic line this recreates GreasedLine work; for
this fixed beam it also enables the one-pass analytic material and eliminates
all recurring topology updates.

Conclusion: `CreateRibbon()` is useful for special impact sheets or afterimages.
The primary beam should use a smaller purpose-built static quad rather than the
general ribbon builder.

### 4.4 Custom `ShaderMaterial`

Babylon
[`ShaderMaterial`](https://doc.babylonjs.com/typedoc/classes/BABYLON.ShaderMaterial)
supports repository-owned vertex and fragment code with uniforms. SHAG already
registers GLSL through `Effect.ShadersStore` in
`GlowOverlayShaderMaterial.ts`, so a procedural one-pass beam shader is feasible.

Advantages:

- analytic soft core/corona in one draw;
- arbitrary axial pulses and noise;
- exact opacity control;
- HDR output tailored to the current bloom threshold.

Costs:

- custom clip-space line extrusion must be implemented and tested;
- transparency, fog, depth, multi-camera, WebGL/WebGPU, and mobile behavior become
  SHAG responsibilities;
- the repository's existing custom shaders are GLSL-oriented;
- first-shot shader variants must be prewarmed to avoid the known weapon-effect
  hitch pattern.

Conclusion: the custom shader is now the production recommendation, not merely a
fallback. The installed engine already uses `ShaderMaterial`, the beam needs no
lighting model or textures, and its fixed topology sharply bounds the risk.
GreasedLine remains the reference/fallback during the spike so visual progress
does not depend on completing the optimized batch immediately.

### 4.5 Bloom and glow

SHAG already has an HDR Babylon `DefaultRenderingPipeline` with configurable
bloom. A separate `GlowLayer` would add another render target and blur path.
Babylon's
[`GlowLayer`](https://doc.babylonjs.com/features/featuresDeepDive/mesh/glowLayer)
is useful for selectively glowing emissive meshes, but it is unnecessary for the
first prototype.

Recommendation:

- render an explicit low-alpha corona so bloom-off remains readable;
- let the existing HDR bloom naturally enhance the bright core when enabled;
- do not make a new global glow layer a beam dependency.

### 4.6 Alpha and depth

Babylon blend modes combine transparent pixels with the existing frame; see the
official
[`blend mode` documentation](https://doc.babylonjs.com/features/featuresDeepDive/materials/using/blendModes/).

Recommended beam state:

- depth test: enabled;
- depth write: disabled;
- core: alpha combine or restrained additive;
- corona/detail: additive or premultiplied/combined after visual testing;
- `isPickable = false`;
- shadows: disabled;
- no collision participation;
- world camera/layer, not the viewmodel-only camera layer.

Pure additive blending reduces sorting artifacts but can overexpose crossed
beams. The prototype must be checked on bright and dark maps with bloom from 0 to
3.

### 4.7 Modern Warsow source audit

The current Warsow/qfusion source was inspected at commit
`d4f91d54ab4f21e83536bac9a3aab8dab7c62a56`. Its Lasergun is substantially more
careful than a simple legacy beam:

- local Lasergun presentation is predicted;
- remote origin and endpoint samples are interpolated;
- the gameplay trace origin and weapon projection origin are separate;
- sustained effects are tracked and pooled per owner and POV/non-POV slot;
- the straight strong beam uses a 12-unit view-aligned tiled ribbon;
- the weak curved beam uses 24 configurable subdivisions, traces each segment,
  and uploads camera-facing quads;
- endpoint contact includes a rotating model, particles, a loop sound, and a
  light;
- one tiled beam material supplies the visual identity.

This is the baseline to beat. The transferable lessons are prediction,
interpolation, pooled ownership, endpoint truth, visual-muzzle separation, stable
world-space tiling, and a continuous contact response. The CPU subdivision and
asset-driven material are not constraints SHAG needs to inherit.

### 4.8 GPU-native analytic ribbon

The optimized primary beam needs only one static quad with attributes for
longitudinal coordinate and side. The vertex shader expands it between two
instance-provided endpoints. The fragment shader interprets the quad as a beam
cross-section and analytically composes all layers.

The useful primitives are:

- `smoothstep` for controllable coverage ramps;
- `fwidth` for resolution-aware antialiasing of procedural edges;
- a small number of sine harmonics for stable, band-limited field motion;
- HDR color above 1.0 for the existing bloom pipeline;
- thin-instance custom attributes for endpoint and profile data.

The official Babylon instance API permits custom per-instance vertex attributes,
and the resolved package exposes `thinInstanceSetBuffer()`,
`thinInstanceBufferUpdated()`, and partial buffer updates. Standard derivatives
are supported by Babylon across WebGL2 and the WebGL1 extension path.

One wide quad can contain:

1. a straight antialiased damage core;
2. a broad exponential or smoothstep corona;
3. three piecewise-linear jagged bolt signed-distance fields;
4. one or two state-seeded forks;
5. a fading copy of the previous electrical state;
6. a blue-violet torn-air sheath with irregular density;
7. muzzle and endpoint width envelopes.

No curve vertices need to be regenerated for the primary beam. The procedural
field is continuous at every frame rate because time is an input, not a reason to
create a new random path.

The best motion is intentionally not continuously smooth. Electricity should
snap between discrete deterministic states. The exact core is continuous; the
outer streams switch at roughly 18–24 Hz while the previous state fades briefly.
This gives the violence of high-speed lightning photography without CPU geometry
rebuilds or frame-rate-dependent randomness.

### 4.9 Architecture comparison after deeper research

| Architecture | Visual ceiling | Per-frame CPU | Primary draws | Main weakness | Decision |
|---|---:|---:|---:|---|---|
| Cylinder chain | Low | High | up to 18/beam | pipe silhouette, transforms | Remove |
| Three GreasedLines | Good | Medium | about 3/beam | rebuilds buffers, hard edge | Prototype/fallback |
| Dynamic CPU ribbon | Good | Medium | 1-3/beam | tessellation/upload each frame | Reject for primary |
| Analytic quad per beam | Excellent | Low | 1/beam | custom shader ownership | Safe intermediate |
| Thin-instanced analytic quad | Excellent | Very low | 1 per render batch | culling/buffer complexity | Production target |
| Full-screen raymarch/post-effect | Potentially high | Low | 1+ full-screen | depth/composition/overdraw | Reject |
| GPU particle beam | Medium | Low | 1+ | noisy, weak endpoint truth | Impact detail only |

The production renderer should be able to fall back from instanced analytic to
one analytic mesh per beam without changing its shader grammar or public API.
That keeps batching an optimization rather than a prerequisite for correctness.

### 4.10 Carmack-style rendering decision

The production trick is to make one rectangle impersonate an entire electrical
system.

```text
4 vertices / 6 indices
        ↓
straight core + 3 lightning streams + forks + ghost + shock sheath
        ↓
1 beam draw
```

The shader evaluates distance to several analytic curves inside the quad. Each
curve is generated from two bands of piecewise-linear one-dimensional noise:

- coarse knots create the large violent silhouette;
- fine knots create sharp local fractures;
- an endpoint envelope pins the chaos to the muzzle and impact;
- state and stream seeds keep the three bolts related but non-identical;
- the previous state is evaluated once more at reduced intensity during the
  short transition window.

Use fixed, explicitly written noise evaluations rather than a general FBM loop.
The shader needs at most two spatial scales. More octaves mostly add shimmer and
fragment cost, not readable electricity.

This is the highest spectacle-per-primitive option found in the comparison. It
also leaves a clean fallback: the same visual state can drive two or three
ordinary procedural ribbons if a target GPU rejects the hero shader.

---

## 5. Visual design principles

### 5.1 Hitscan readability rules

1. The full damaging path appears immediately.
2. The primary spine terminates at the resolved impact.
3. Traveling pulses are overlays on an already-visible beam.
4. The primary spine cannot wander away from its true damaging ray.
5. Decorative forks do not touch an entity unless that entity is a real chain
   target.
6. No impact effect appears on a max-range miss.
7. World impacts and player impacts are visually different.

### 5.2 First-person comfort rules

- Keep the beam narrow near the camera.
- Fade in opacity over the first short section rather than presenting an opaque
  pipe beside the camera.
- Do not place a large point light at the near muzzle every 48 ms.
- The beam should not oscillate across the crosshair.
- Recoil/bob may move the decorative muzzle start, but not the target endpoint.
- At full ADS, the beam should feel more optically stable.

### 5.3 Remote readability rules

- The beam must visually leave the remote weapon/hand.
- The endpoint must be stable enough to read tracking skill.
- A released beam should disappear promptly without a one-frame hole between 20
  Hz samples.
- Third-person corona width must not scale into a giant opaque rod at long range.
- Multiple beams crossing should remain attributable by color and origin.

### 5.4 Distinguishing actual and decorative branches

Voltaic has two kinds of branch:

- **Decorative filament/fork:** low intensity, short, never attaches to another
  player, no gameplay meaning.
- **Chain arc:** server-provided target-to-target connection, brighter, longer,
  accompanied by target contact feedback.

The two must not look identical. Otherwise players cannot tell which opponents
were actually damaged.

---

## 6. Brainstormed concepts and evaluation

### 6.1 Clean surgical lance

**Description:** Thin white-hot core, colored corona, tight contact point.

**Strengths**

- Maximum aim readability.
- Very cheap.
- Works for both first- and third-person.

**Weaknesses**

- Too generic by itself.
- Voltaic needs additional electrical character.

**Decision:** Use as the shared foundation.

### 6.2 Frequency ruler

**Description:** Small bright bands cross the Lasergun beam at regular spacing
and move toward impact.

The base beam remains fully visible; bands are only phase information.

**Strengths**

- Communicates coherent, engineered energy.
- Motion reinforces direction without implying delayed damage.
- Babylon GreasedLine dashing can prototype it without a custom shader.

**Weaknesses**

- Dash count must scale with beam length to keep spacing consistent.
- Hard-edged dashes can strobe at low frame rates if moved too quickly.

**Decision:** Recommended Lasergun detail.

### 6.3 Electrical cage

**Description:** A straight Voltaic spine with two low-opacity filaments that
depart from and reconnect to the spine.

**Strengths**

- Reads as electricity while preserving aim truth.
- Supports restrained, temporally coherent noise.
- Filaments can be batched as disconnected GreasedLine paths.

**Weaknesses**

- Too much amplitude recreates the current visual confusion.
- Filaments can alias or visually merge into a thick rope.

**Decision:** Recommended Voltaic detail.

### 6.4 Whole-beam bowed lightning

**Description:** The entire primary path forms a large coherent bow.

**Strengths**

- Immediately dramatic.
- Clearly distinguishes Voltaic from Lasergun.

**Weaknesses**

- Implies damage follows a curved path.
- Crosses the reticle and hides tracking truth.
- Near-camera movement is uncomfortable.
- Already performs poorly in the current implementation.

**Decision:** Reject for the primary beam. Allow larger curvature only on
secondary chain arcs.

### 6.5 Retinal afterimage

**Description:** A faint 40–60 ms ribbon remains at the previous beam position
during fast aim movement.

**Strengths**

- Makes fast flicks and tracking changes feel energetic.
- Could give Lasergun a “laser calligraphy” identity.

**Weaknesses**

- Can obscure opponents and imply a wider damage area.
- Adds transparent geometry and sorting.
- Especially risky in first person.

**Decision:** Optional prototype, disabled by default. If used, prefer
third-person/spectator or a very low-opacity Lasergun-only afterimage.

### 6.6 Harmonic nodes

**Description:** A few energy knots move along the already-visible beam.

**Strengths**

- Gives forward motion without changing the primary shape.
- Procedural spheres or short line bands require no assets.

**Weaknesses**

- Free-moving spheres may read as projectiles.
- Extra mesh management is unnecessary if frequency bands achieve the same goal.

**Decision:** Fold into the Lasergun frequency-band layer; do not spawn spheres.

### 6.7 Contact drilling

**Description:** Sustained contact grows a small rotating multi-lobed ring at a
world impact.

**Strengths**

- Rewards maintaining contact visually.
- Makes the endpoint feel powerful.
- Can be generated from line loops or a small procedural disc.

**Weaknesses**

- Requires contact continuity state.
- A growing scorch mark can falsely suggest persistent world damage.

**Decision:** Use a restrained pulsing contact crown, not a permanent or growing
decal.

### 6.8 Hit tension

**Description:** On player contact, Voltaic's core becomes tighter/brighter and
endpoint activity increases.

**Strengths**

- Strong tactile feedback.
- Does not need a large hit marker.

**Weaknesses**

- Must be driven by authoritative `impactKind`, not a client pick.
- Excessive brightness can reveal enemies in ways not intended by gameplay.

**Decision:** Recommended with small intensity differences.

### 6.9 Spiral or double helix

**Description:** One or two regular helices orbit the core.

**Strengths**

- Visually unique and procedural.
- Works well for a sci-fi coherent beam.

**Weaknesses**

- Reads more like plasma or a rail trail if the spine itself twists.
- Regular helix geometry costs more points and can shimmer at range.

**Decision:** Reject for the hero effect. A helix is too orderly and reads like
plasma containment. Voltaic should rupture and reconnect unpredictably.

### 6.10 Screen-space flash only

**Description:** Replace most world beam geometry with a muzzle flash, crosshair
feedback, and endpoint flare.

**Strengths**

- Very cheap and comfortable in first person.

**Weaknesses**

- Loses the weapon's defining continuous-beam identity.
- Fails remote readability.

**Decision:** Reject.

### 6.11 Traveling bolt

**Description:** Show only a segment moving from muzzle to endpoint.

**Strengths**

- Strong motion and speed.

**Weaknesses**

- Communicates projectile travel time.
- Directly conflicts with hitscan philosophy.

**Decision:** Reject. Moving overlays are allowed only over a fully visible
instantaneous spine.

### 6.12 Smooth contained storm or ion braid

**Description:** A straight white-hot core is held inside two amber electrical
field filaments that appear to orbit it. Their transverse position, brightness,
and apparent depth evolve continuously from physical distance, time, and seed.

**Strengths**

- Immediately distinguishes Voltaic from a conventional laser.
- Looks volumetric from one camera-facing quad.
- Requires no texture, curve rebuild, or particle swarm.
- The core remains a perfect hitscan ruler.
- Front/back dimming creates a readable cadence without gaps in damage truth.

**Weaknesses**

- Excessive amplitude becomes a plasma corkscrew.
- High spatial frequency aliases at distance.
- Both filaments can visually merge at unfavorable phases.

**Decision:** Superseded. The single-quad analytic insight is retained, but the
smooth braid aesthetic is rejected in favor of snapping jagged lightning.

### 6.13 Surface ion wake

**Description:** While a world impact sweeps across a surface, retain the last
few authoritative contact points as a rapidly fading, surface-aligned hot groove
and tiny outward sparks.

**Strengths**

- Makes floor and wall sweeping feel physical and powerful.
- Adds motion history where it is semantically true: at the contact surface.
- Creates a signature effect absent from classic Quake/Warsow beams.
- Can use a tiny fixed ring buffer and one batched procedural strip.

**Weaknesses**

- A long-lived mark could imply continuing damage.
- Repeated decals would be expensive and clutter competitive scenes.
- Network endpoint jumps must not connect across unrelated surfaces.

**Decision:** Optional polish only. Do not include it in the first hero-effect
spike. The live impact storm is more important than persistent floor history.

### 6.14 Voltaic Rift

**Description:** A precise white spine holds open three violently jagged gold
lightning streams inside a faint blue-violet shock sheath.

**Strengths**

- Huge, unmistakable silhouette.
- Looks like a weapon-scale lightning strike rather than a laser ribbon.
- The exact core preserves hitscan readability.
- All primary layers can be synthesized in one shader pass.
- Chaos can grow toward impact without covering the crosshair.

**Weaknesses**

- Excessive width can obscure a target.
- Poorly filtered fine fractures will shimmer.
- Three equally bright streams can become visual soup.

**Decision:** Final hero concept. Use one dominant stream, two subordinate
streams, and one invariant core. Amplitude and brightness must have hierarchy.

### 6.15 Snap-state ghosting

**Description:** Outer lightning changes in discrete states. For 25–45 ms after
a state change, the previous bolt remains as a dim violet/gold ghost.

**Strengths**

- Creates violent high-frequency motion without camera-space blur.
- Makes 18–24 Hz state changes feel intentional rather than choppy.
- Can be drawn in the same shader from the previous state seed.
- Suggests electrical persistence in the air.

**Weaknesses**

- A long ghost becomes a rail trail.
- Drawing all three previous streams doubles procedural evaluations.

**Decision:** Recommended. Ghost only the former dominant stream plus a weak
sheath imprint at first. Add more only if the Beam Lab proves it worthwhile.

### 6.16 Torn-air shock sheath

**Description:** A broad, low-opacity blue-violet envelope surrounds the bolt.
Its edge is irregular and locally punctured by the current electrical state.

**Strengths**

- Gives the beam scale and volume.
- Separates the gold bolt from bright yellow or white map surfaces.
- Makes bloom feel like emitted energy rather than a soft line filter.
- Costs only additional fragment math inside the existing quad.

**Weaknesses**

- Too much opacity becomes a solid tube.
- A uniformly smooth sheath looks like a force field.

**Decision:** Recommended at low opacity. Break density along the length and
allow short holes around major forks.

### 6.17 Impact storm

**Description:** A large white-hot nucleus surrounded by a rotating broken
crown, radial spikes, small crawling arcs, and a restrained halo.

**Strengths**

- Provides the visual payoff at the point the player is aiming toward.
- Can be one compact procedural mesh/material draw.
- Makes sustained contact feel powerful without blinking the beam.
- Provides a natural source for chain arcs.

**Weaknesses**

- Can hide the target if oversized.
- Too many free particles increase cost and visual noise.

**Decision:** Mandatory. Prefer a fixed procedural star/crown mesh over a large
particle system. The nucleus stays compact; spikes and halo provide the size.

---

## 7. Final visual specification

### 7.1 Shared beam anatomy

Every active beam consists of the following **logical** layers. Core, corona,
and primary detail are composed inside one analytic material pass, not separate
meshes or draws:

1. **Core layer**
   - Straight from visual muzzle to authoritative endpoint.
   - Thin, near-white center tinted toward weapon color.
   - Highest opacity and HDR intensity.

2. **Corona layer**
   - Same authoritative path.
   - Approximately 2.5–4 times core width.
   - Low alpha and lower HDR intensity.
   - Present even when bloom is disabled.

3. **Detail layer**
   - Lasergun bands or Voltaic filament bundle.
   - Lower opacity than the core.
   - Never replaces the core.

4. **Muzzle transition**
   - Short alpha/width ramp at the visual origin.
   - Small persistent nozzle glow while active.
   - No repeated large muzzle flash on every 20 Hz damage tick.

5. **Endpoint contact**
   - Type-specific procedural effect.
   - One capped pooled point light for the endpoint, subject to existing light
     pool limits.

### 7.2 Lasergun profile

**Identity:** coherent industrial cutting beam.

Suggested initial values for prototype tuning:

| Parameter | Initial direction |
|---|---|
| Core color | white-hot center with red/orange tint |
| Corona color | saturated red |
| Core apparent width | narrow; target roughly 1.5–2.5 px at common range |
| Corona apparent width | roughly 5–8 px, low alpha |
| Band spacing | approximately 24–36 world units |
| Band speed | fast enough to flow, slow enough not to strobe |
| Path displacement | zero |
| Release fade | approximately 35–60 ms |

Detail behavior:

- The complete core is always present.
- A dashed bright overlay moves from muzzle toward impact.
- Dash count is derived from beam length so world spacing is stable.
- On a player hit, the endpoint becomes brighter and slightly tighter.
- On a wall hit, render a compact red contact crown aligned to the surface
  normal.

### 7.3 Voltaic profile

**Identity:** guided electrical tether with real chain discharge.

Suggested initial values:

| Parameter | Initial direction |
|---|---|
| Core color | near-white warm yellow, retaining current weapon palette |
| Corona color | amber/orange |
| Primary core width | slightly thinner than current cylinders |
| Filament count | 2 |
| Primary filament amplitude | approximately 2–5 world units, length-scaled and capped |
| Primary path samples | none; analytic field over one straight quad |
| Filament time | continuous server/demo-derived time |
| Field rotation | approximately 1–2 turns over an 850-unit beam |
| Projected detail cutoff | fade harmonics before they become subpixel |
| Decorative fork life | approximately 60–100 ms |
| Chain arc amplitude | larger than primary, approximately 6–14 units |
| Release fade | approximately 45–70 ms |

Detail behavior:

- The primary spine follows the actual authoritative wandered damage ray.
- Two filaments appear to orbit the spine with amplitude pinned to zero at both
  endpoints.
- Filaments use different phases plus a restrained second harmonic; brightness
  is modulated as each strand passes in front of or behind the spine.
- A compression band moves toward the endpoint but never erases or replaces the
  instantaneous core.
- Occasional decorative forks may leave an interior point but remain short and
  never attach to another player.
- Real chain arcs connect server-provided target points and are brighter than
  decorative forks.

### 7.4 World impact

For `impactKind === "world"`:

- terminate exactly at the server point;
- orient a tiny procedural ring/crown using the server surface normal;
- pulse brightness while contact continues;
- place the pooled light slightly away from the wall along the normal;
- do not create a new permanent wall mark every 48 ms;
- refresh one short-lived 4–6-point surface ion wake keyed by shooter;
- split the wake across discontinuous surfaces instead of drawing through air.

### 7.5 Player impact

For `impactKind === "player"`:

- terminate at the actual ray/capsule intersection, not target origin;
- do not render a wall-oriented disc;
- brighten/tighten the contact;
- Voltaic may add two or three short crawling arcs around the point;
- chain arcs begin at this actual primary contact point.

### 7.6 Miss

For `impactKind === "none"`:

- terminate at weapon range;
- slightly fade the last few percent of the beam;
- do not spawn a contact crown or point light burst.

### 7.7 Why this can exceed the classic effects

The aim is not merely more particles. It is to preserve everything the classic
effects got right while improving the categories their renderers could not
address cheaply.

| Quality | Quake III lightning | Modern Warsow Lasergun | Proposed Voltaic |
|---|---|---|---|
| Immediate hitscan path | Yes | Yes | Yes, invariant core |
| Trace origin separated from visual muzzle | Yes | Yes | Yes |
| Predicted local presentation | Limited-era model | Yes | Yes |
| Interpolated remote presentation | Basic snapshot era | Yes | Yes plus authoritative impact payload |
| Soft antialiased core without texture | No | Asset/material dependent | Yes, analytic |
| Distinct volumetric identity | Rotated core planes | Tiled ribbon/curved weak mode | Shader-only contained storm braid |
| World-spaced motion | Limited | Tiled material | Analytic bands/compression |
| Persistent contact feel | Impact effect | Model, particles, light, sound | Crown, capped light, surface ion wake |
| Sustained CPU geometry work | Low for straight legacy bolt | CPU quads/subdivisions | None for primary beam |
| Multi-beam batching | Renderer-specific | Dynamic batches | Explicit thin-instance target |
| External visual assets | Yes | Yes | None |

The differentiator is coherence: muzzle, core, field, hit tension, chain arcs,
contact crown, and ion wake all respond to one authoritative impact state. A
larger but disconnected particle effect would look busier, not better.

---

## 8. Rendering architecture

### 8.1 Recommended class split

Keep `HitscanEffects` as the public coordinator but move beam-specific state into
a focused renderer:

```text
HitscanEffects
└── ProceduralBeamRenderer
    ├── BeamProfile
    ├── BeamInstancePool
    ├── AnalyticBeamBatch (world)
    ├── AnalyticBeamBatch (POV)
    ├── AnalyticBeamMaterial
    ├── ProceduralArcBatch
    └── BeamImpactRenderer
```

Proposed API:

```ts
type BeamImpactKind = "none" | "world" | "player";

interface BeamSample {
  shooterId: string;
  weaponId: "lasergun" | "voltaic";
  visualStart: Vector3;
  traceOrigin: Vector3;
  direction: Vector3;
  distance: number;
  impactKind: BeamImpactKind;
  impactNormal?: Vector3;
  serverTick?: number;
  localPredicted: boolean;
}

interface BeamInstance {
  updateSample(sample: BeamSample): void;
  setVisualStart(start: Vector3): void;
  stop(fadeSeconds?: number): void;
}
```

### 8.2 Why a separate renderer

`HitscanEffects.ts` already handles many unrelated effect types and is over 1,200
lines. A beam renderer provides:

- explicit pooled lifecycle;
- string-keyed shooter identity;
- profile-based visuals;
- testable deterministic field functions and instance packing;
- a place to handle endpoint smoothing without affecting tracers and bolts;
- easier shader and fallback prewarming.

### 8.3 Fixed topology and batching plan

The source mesh is a static quad with four vertices and six indices. Each vertex
stores only:

- `aAlong`: 0 at muzzle and 1 at endpoint;
- `aSide`: -1 or +1 across the beam.

World and POV effects use separate batches because the current viewmodel uses a
second camera, `WEAPON_LAYER_MASK`, and rendering group 1. Within each batch,
thin instances share one material and static geometry.

Suggested instance attributes:

```ts
// Four vec4 attributes = 64 dynamic/static bytes per active beam.
iStartProfile = [start.x, start.y, start.z, profileId];
iEndFlags = [end.x, end.y, end.z, packedImpactFlags];
iColorSeed = [color.r, color.g, color.b, seed01];
iParams = [worldWidth, intensity, hitEnergy, phaseOffset];
```

The Babylon matrix instance buffer can contain static identity matrices. Only
endpoint/state attributes need synchronization. At 16 active beams, uploading
four vec4 values per beam is 1 KiB per update before driver overhead. Do not
allocate new arrays; retain one maximum-size `Float32Array` per attribute group
and set `thinInstanceCount` to the active count.

Expected primary cost:

- one world-beam draw and one POV-beam draw in the common full-quality case;
- no geometry reconstruction;
- no per-segment transform nodes;
- no transparent sorting requirement when the selected blend is order
  independent;
- bounded fill rate from one corona-width quad per beam.

If thin-instance integration complicates the first spike, render one static quad
mesh per active beam using the same material and uniforms. That intermediate is
still one draw and no geometry rebuild per beam, and it preserves the optimized
shader design.

### 8.4 Width strategy

Neither purely world-space nor purely screen-space width is ideal:

- world width disappears at range;
- fixed pixel width can make distant beams too visually important.

Implement a hybrid width in the vertex shader:

1. Transform both endpoints into view space.
2. Derive a view-facing side vector from the beam tangent and view direction.
3. Compute world units per pixel at each endpoint from depth, vertical FOV, and
   viewport height.
4. Begin with the profile's world width.
5. Clamp the core to a small minimum and maximum projected pixel width.
6. Allow the corona to attenuate more aggressively than the core.
7. Apply a separate near-muzzle width/alpha envelope for POV comfort.

When the beam points almost directly at the camera, the tangent/view cross
product becomes unstable. Fall back to camera right/up, retain the previous
valid side for that instance if available, and reject non-finite output. The
spike must also clip or advance a muzzle point that falls behind the near plane.

Do not lock numeric widths until tested at:

- common 16:9 desktop resolution;
- high-DPI display;
- mobile resolution;
- FOV extremes;
- ADS FOV;
- 100–850 unit beam lengths.

### 8.5 Field generation and compatibility fallback

This CPU path generator is retained only for the GreasedLine compatibility
fallback and for comparison testing. The production analytic primary beam does
not rebuild a path. The straight fallback core needs only start/end.

For Voltaic filaments:

```ts
for each sample i:
  t = i / (sampleCount - 1)
  envelope = sin(PI * t)
  base = lerp(start, end, t)
  offset =
    right * noise1(seed, i, stateA/stateB) +
    up    * noise2(seed, i, stateA/stateB)
  point = base + offset * envelope * amplitude
```

Temporal algorithm:

1. Compute an integer VFX state index at 20–30 Hz.
2. Generate path A from `stateIndex`.
3. Generate path B from `stateIndex + 1`.
4. Smoothly interpolate A→B using fractional state time.
5. Seed from shooter ID, weapon ID, filament index, and state index.

Properties:

- fixed result for the same seed and time;
- no frame-rate dependence;
- pinned muzzle and endpoint;
- continuous motion;
- reproducible demo playback if demo time is used.

The path generator should use plain numeric vectors or a small reusable scratch
buffer so it can be unit-tested without a Babylon scene.

### 8.5.1 Production analytic beam field

The straight primary beam has no generated path. Let `s = aAlong * beamLength`
be physical distance along the ray and `y` be signed transverse position across
the expanded quad.

Conceptual fragment functions:

```glsl
float aaLine(float distanceToLine, float halfWidth) {
  float aa = max(fwidth(distanceToLine), 0.0001);
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, distanceToLine);
}

float endpointEnvelope(float t) {
  return smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.94, t);
}

float phase = s * spatialFrequency + effectTime * phaseSpeed + seedPhase;
float orbitY = sin(phase) + 0.28 * sin(phase * 2.17 + seedPhase);
float orbitZ = cos(phase);
float filamentCenter = amplitude * endpointEnvelope(aAlong) * orbitY;
float filament = aaLine(abs(y - filamentCenter), filamentHalfWidth);
float frontBack = mix(0.35, 1.0, orbitZ * 0.5 + 0.5);
```

The final HDR signal combines:

```text
core       = antialiased narrow line at y = 0
inner glow = wider smooth falloff
corona     = broad low-energy falloff
filaments  = two phase-separated analytic lines
bands      = world-spaced axial modulation of detail, never of core existence
caps       = muzzle/endpoint envelopes
```

Use two or three harmonics, not high-frequency hash noise. This is cheaper,
band-limited, deterministic, and easier to art-direct. Derive time from the
rendered server/demo clock; never from the number of rendered frames.

Spatial frequency must be expressed in world units so changing beam length does
not stretch the pattern. At distance, fade the second harmonic and then the
filaments based on projected width. The core survives every LOD.

### 8.5.2 Lasergun shader profile

- Set path amplitude to zero.
- Use a narrower core and red/orange corona.
- Evaluate a world-spaced saw/sine band mask moving toward the endpoint.
- Keep a dim continuous sheath between bands.
- Vary band brightness, not beam continuity.

### 8.5.3 Voltaic shader profile

- Use the straight warm-white core at all times.
- Draw two amber filaments separated by phase and slightly different harmonic
  weighting.
- Use the analytic quadrature term to dim the rear half of each orbit.
- Add a low-frequency compression envelope that moves toward contact.
- On authoritative player impact, reduce filament amplitude near the last 15
  percent and raise core/contact intensity slightly, producing hit tension.

### 8.5.4 Chain and fork geometry

Real chain arcs do need a curved centerline. Use a second fixed strip template of
8-12 segments. Its vertex shader generates deterministic transverse offsets from
segment coordinate, seed, endpoints, and time. Thin-instance one arc per actual
server-provided chain edge.

Decorative forks use the same batch with a short endpoint and a non-gameplay
flag. Their intensity and length must remain below real chain arcs. At low
quality, omit decorative forks before reducing primary readability.

### 8.6 Endpoint smoothing

Server samples arrive at the 20 Hz fire cadence. A naive lerp can drag the beam
through geometry when the endpoint changes from one surface to another.

Recommended topology-aware rule:

- same `impactKind`, small positional delta, and similar normal:
  critically damp over approximately 30–50 ms;
- player target moving continuously:
  modest smoothing, capped so the beam does not visibly trail far behind;
- impact kind change, large delta, or sharply different world normal:
  snap to the new endpoint;
- max-range miss ↔ wall/player hit:
  snap.

The endpoint remains authoritative; smoothing is only presentation.

### 8.7 Start-point smoothing

Local start:

- use `WeaponViewManager.getMuzzleWorldPosition()`;
- eventually prefer a real tag/socket if weapon models expose one;
- update every render frame.

Remote start:

- add a `RemotePlayerRenderer.getWeaponMuzzleWorldPosition(entityId)` query;
- compute from the hand-attached weapon leader/root transform plus a
  weapon-specific local muzzle offset;
- fallback to interpolated eye position + forward offset while the model loads.

The remote start follows interpolated presentation. It should not reuse the
discrete server event origin.

### 8.8 Muzzle offsets

If existing GLBs do not expose a stable muzzle node, add presentation-only config:

```ts
beamVisual: {
  thirdPersonMuzzleOffset: { x, y, z },
  firstPersonMuzzleOffset?: { x, y, z },
}
```

The offset is transformed by the attached weapon root world matrix. Keep the
server eye origin in the event as the trace origin and fallback.

### 8.9 Edge quality and bright-background readability

The analytic material must remain readable without bloom and against both dark
and bright lightmapped surfaces:

- use derivative-based antialiasing on the core and filaments;
- make the corona an explicit smooth falloff, not a post-process assumption;
- evaluate additive, alpha-combine, and premultiplied-alpha output in HDR;
- test a very subtle outer contrast fringe in the combined/premultiplied mode;
- never depend on a full-screen glow layer or generated texture.

A contrast fringe is a narrow, low-opacity outer region that slightly attenuates
the background before the bright core contribution. It can keep a yellow-white
beam visible on a bright wall, but it must remain subtle enough not to look like
a cartoon outline. If one blend mode cannot provide both the desired HDR core
and fringe, prefer a clean one-pass beam over adding a permanent second pass;
reserve a second contrast pass for low-visibility accessibility settings only.

### 8.10 Prewarming

`EffectPreloader.ts` exists because first weapon effects can trigger material
variant compilation and visible hitches. The final beam materials must be
created/compiled during effect warmup:

- analytic primary material and its selected blend mode;
- instanced and non-instanced defines;
- curved arc material;
- GreasedLine fallback material;
- impact material;
- bloom on/off does not require a new first-shot compile during combat.

### 8.11 Culling, depth, and lifetime details

Shader-generated world endpoints are not represented by the unit quad's local
bounds. Therefore either:

1. mark the two small beam batch meshes `alwaysSelectAsActiveMesh = true`; or
2. refresh one aggregate batch bound when endpoint samples change.

The first option is simpler and reasonable for at most two batch meshes. Do not
refresh per-beam Babylon bounds every render frame merely to save a vertex
shader invocation on an empty batch; set `thinInstanceCount = 0` when unused.

Required mesh/material state:

- depth test enabled and depth write disabled;
- shadows, picking, collision, and lighting disabled;
- world and POV batches assigned to their correct layer masks;
- alpha mode chosen once per material, not toggled during fire;
- global effect time set once per frame;
- active endpoint buffers updated in place;
- beam slots released only after the short release envelope reaches zero.

Do not attach point lights along the beam. One capped endpoint light and an
optional tiny muzzle light provide the useful environmental response without
creating per-beam light/shader-variant pressure.

### 8.12 Concrete Babylon implementation notes

Suggested file split:

```text
src/engine/weapon/beam/
├── BeamTypes.ts
├── BeamProfiles.ts
├── ProceduralBeamRenderer.ts
├── AnalyticBeamBatch.ts
├── AnalyticBeamMaterial.ts
├── ProceduralArcBatch.ts
└── BeamImpactRenderer.ts
```

Required modular imports include the normal `Mesh`, `VertexData`,
`ShaderMaterial`, `Effect`, and math modules plus the thin-instance side effect:

```ts
import '@babylonjs/core/Meshes/thinInstanceMesh';
```

Use the template `position.xy` as `(aAlong, aSide)` so the static mesh consumes
one vertex attribute. A thin-instanced shader then needs four matrix columns and
four custom vec4 attributes: nine vertex attribute locations in total, below the
WebGL2 minimum of 16. Keep impact/profile codes as small exact float enums; do
not require GLSL bitwise packing.

Conceptual mesh setup:

```ts
const positions = new Float32Array([
  0, -1, 0,
  0,  1, 0,
  1, -1, 0,
  1,  1, 0,
]);
const indices = new Uint16Array([0, 1, 2, 2, 1, 3]);

mesh.thinInstanceSetBuffer('matrix', identityMatrices, 16, true);
mesh.thinInstanceSetBuffer('iStartProfile', startProfile, 4, false);
mesh.thinInstanceSetBuffer('iEndImpact', endImpact, 4, false);
mesh.thinInstanceSetBuffer('iColorSeed', colorSeed, 4, false);
mesh.thinInstanceSetBuffer('iParams', params, 4, false);
mesh.thinInstanceCount = activeCount;
```

The shader should use Babylon's instance declaration/vertex includes and
multiply the generated world position by `finalWorld`. Identity instance
matrices keep endpoint attributes in world space while ensuring the instancing
path and matrix attributes remain active.

Per render frame:

1. Update the local POV muzzle and interpolated remote muzzles in their retained
   slots.
2. Advance presentation smoothing using delta time.
3. Write only active start/end/state values into retained typed arrays.
4. Call `thinInstanceBufferUpdated()` once for each changed buffer, or use
   partial updates after profiling.
5. Set the global effect clock and viewport/FOV uniforms once per batch.
6. Render; do not touch vertex/index topology.

Per 20 Hz authoritative sample:

1. Update impact distance, kind, normal, and target identity.
2. Apply topology-aware endpoint snap/smoothing rules.
3. Refresh contact crown and ion-wake continuity state.
4. Do not rebuild any primary-beam geometry.

Batching decision:

- Additive output is order independent and safe for thin-instance grouping.
- Combined/premultiplied output with a contrast fringe may be order dependent.
- If bright-background quality requires order-dependent blending, keep the
  analytic shader but submit per-beam meshes in sorted order. Visual quality is
  more important than collapsing eight already-cheap draws into one.
- World and POV remain separate under every strategy because their cameras,
  layer masks, and near-plane behavior differ.

Fallback ladder:

1. Thin-instanced analytic batches.
2. One retained analytic quad mesh per beam.
3. Pooled GreasedLine layers using the same profiles.
4. Core-only GreasedLine on a platform that cannot compile the custom shader.

The public `ProceduralBeamRenderer` API must not expose which rung is active.

---

## 9. Out-of-scope network notes retained for reference

Nothing in this section is required to build or evaluate the visual effect. It
is retained only as historical context from the broader first research pass and
must not expand the effect-only work order.

### 9.1 Recommended wire change

Extend the active `weapon_fire` event with beam-impact data rather than creating
a second event that duplicates shooter and weapon identity.

Conceptual addition:

```ts
interface WeaponFireEvent {
  // existing
  entityId: string;
  weaponId: string;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;

  // beam/hitscan visual result
  impactKind?: "none" | "world" | "player";
  impactDistance?: number;
  normalX?: number;
  normalY?: number;
  normalZ?: number;
}
```

Distance is preferable to three endpoint floats because the event already has
origin and normalized direction:

```ts
endpoint = traceOrigin + direction * impactDistance;
```

This retains the exact eye/crosshair line even when the decorative muzzle is
offset.

Suggested binary representation:

```text
existing weapon_fire payload
flags u8
  bit 0: has impact payload
  bits 1–2: impact kind
if impact:
  impactDistance f32
  normal xyz f32
```

Normal can later be packed to signed 16-bit components if bandwidth profiling
justifies it. Start with simple floats.

At 20 samples/second, the fixed addition is small compared with the existing
string-heavy event and snapshot payload. Measure rather than prematurely pack.

### 9.2 Why keep trace origin and direction

- Other hitscan/tracer effects already use them.
- Demo playback can reconstruct the exact ray.
- A remote weapon model may not be loaded, so eye origin remains a fallback.
- The visual muzzle must connect to a world endpoint derived from the eye ray,
  not create a parallel muzzle ray.

### 9.3 Beam activity and stopping

Do not rely only on `REMOTE_BEAM_TIMEOUT = 0.15`.

Every snapshot already includes `weapon_state` with:

- `currentWeapon`;
- `reloading`;
- `lastFireTick`.

The client can derive whether a remote beam should still be active:

```ts
const recent = snapshotTick - lastFireTick <= beamGraceTicks;
active = isBeamWeapon(currentWeapon) && !reloading && recent;
```

Use event samples for endpoint updates and per-snapshot weapon state for
convergent shutdown. Recommended visual grace is roughly one to two fire
intervals plus interpolation margin, followed by a short fade.

An explicit active/stop bit can be added later if testing proves the derived
state insufficient. The old `src/shared/net/GameState.ts` contains a
`weapon_stop` concept, but the active `BinaryProtocol` and `SnapshotEvent` union
do not; do not assume that legacy path works.

### 9.4 Local prediction

Local firing must remain responsive:

1. Start the visual immediately when current local charge/fire rules allow it.
2. Predict a crosshair endpoint locally.
3. Reconcile to authoritative server impact samples.

For Voltaic, the best long-term parity is to move the deterministic aim-wander
function into a shared pure module used by server and local prediction.

Possible API:

```ts
computeBeamDirection({
  yaw,
  pitch,
  tick,
  shooterId,
  isADS,
  wanderDeg,
}): Vec3
```

This requires the local side to use the predicted simulation tick, not
`performance.now()`.

### 9.5 Wander retune proposal

Separate from the graphics implementation, consider replacing tick-as-phase with
seconds:

```ts
const timeSec = tick / 125;
const yawPhase = timeSec * TAU * 0.8 + seed;
const pitchPhase = timeSec * TAU * 1.3 + seed2;
```

This preserves the authored four-degree envelope while making “slow sweep” true.

This changes accuracy/feel and therefore needs:

- explicit gameplay approval;
- server simulation tests;
- playtesting at hipfire and ADS;
- anti-cheat accuracy calibration awareness.

The new renderer does not depend on accepting this retune.

### 9.6 Chain arcs

Current `weapon_chain` events contain only world points. Minimum implementation:

- use the new primary actual contact point as the first chain point;
- keep remaining target positions;
- render refreshed, pooled arcs at the 20 Hz cadence.

Higher-quality future form:

```ts
targets: Array<{
  entityId: string;
  fallbackPoint: Vec3;
  damageScale: number;
}>
```

That would let clients attach chain endpoints to current interpolated target
poses. It costs protocol work and is not required for the first primary-beam
replacement.

### 9.7 Demo compatibility

Demo recording captures snapshot events verbatim and playback reuses remote
weapon-fire rendering. Therefore:

- update the binary/demo event type once;
- make live and demo playback call the same beam-sample API;
- drive procedural filament time from demo playback time/server tick;
- do not seed from wall-clock time;
- define behavior for older demos with no impact payload:
  - client BSP trace fallback for world endpoint;
  - max-range fallback if map picking is unavailable;
  - never invent an authoritative player hit.

---

## 10. Implementation work plan

### Phase A — correctness tests and unified impact

**Goal:** one authoritative first impact used by damage and presentation.

Tasks:

1. Add pure ray/capsule or reuse/refactor the better lag-compensation intersection.
2. Compare all player candidate distances.
3. Compare closest player against BSP distance.
4. Return actual point, normal, distance, kind, entity, and hit location.
5. Apply damage from the winning result.
6. Feed chain lightning from actual primary contact.
7. Preserve telemetry semantics.

Required tests:

- nearer of two aligned players is hit;
- wall blocks player;
- player before wall is hit;
- dead/self entities ignored;
- miss returns exactly weapon range;
- world result returns point and normal;
- crouched/standing capsule behavior is defined;
- chain starts at actual primary intersection.

Risk:

- This changes gameplay correctness and deterministic simulation checksums.
- It must not be hidden inside a “graphics-only” patch.

### Phase B — protocol and demo payload

**Goal:** every client receives the same beam distance and impact type.

Files likely involved:

- `src/games/fps/server/systems/WeaponSystem.ts`
- `src/games/fps/server/SnapshotBuilder.ts`
- `src/engine/network/core/SnapshotEvent.ts`
- `src/shared/net/BinaryProtocol.ts`
- `src/engine/__tests__/ProtocolCodecs.test.ts`
- `src/engine/__tests__/GameEventSerialization.test.ts`
- demo event tests

Tests:

- none/world/player round trips;
- normal and distance float round trips;
- zero distance and max range;
- older demo fallback behavior;
- event dispatch remains exhaustive.

### Phase C — procedural beam renderer spike

**Goal:** compare the new visual primitive without replacing every call site.

Build:

- `ProceduralBeamRenderer.ts`;
- pooled `BeamInstance`;
- one static analytic quad per beam as the first custom-shader step;
- derivative-antialiased core, corona, Lasergun bands, and Voltaic braid;
- fixed endpoint/state arrays with zero hot-path allocation;
- straight Lasergun;
- straight-spine Voltaic with two analytic orbiting filaments;
- simple world/player/miss endpoint indicators;
- debug spawn/update/stop hooks.

Prototype comparison:

1. One-pass analytic quad per active beam.
2. Thin-instanced analytic world and POV batches.
3. GreasedLine fallback using the same profile values.
4. Additive versus combined/premultiplied HDR blend.

Decision gate:

- analytic rendering is the visual target; choose per-mesh or thin-instanced
  submission based on measured complexity and performance;
- retain GreasedLine only if the custom shader fails a platform requirement, not
  because its default edge is visually sufficient.

### Phase D — first-person integration

Tasks:

- route `WeaponViewManager` through the new renderer;
- target from crosshair/predicted trace;
- start from live viewmodel muzzle;
- reconcile endpoint samples;
- remove whole-bolt bow;
- ensure charge, ADS, reload, release, switch, death, and ammo exhaustion stop it;
- keep beam on world camera layer and viewmodel on weapon camera layer.

### Phase E — remote integration

Tasks:

- add a real Lasergun remote beam case;
- change all beam maps/API keys to string entity IDs;
- expose remote interpolated muzzle position;
- use authoritative impact distance;
- update start every render frame from remote pose;
- update target from samples;
- topology-aware endpoint smoothing;
- derive shutdown from weapon state plus short grace;
- cleanup on entity removal/disconnect.

### Phase F — impacts and chain polish

Tasks:

- procedural world contact crown;
- short surface ion wake with discontinuity rules;
- distinct player contact;
- pooled endpoint light policy;
- batched Voltaic chain arcs;
- deterministic decorative forks;
- falloff-scaled chain brightness;
- prevent per-tick decal accumulation.

### Phase G — prewarm, quality controls, cleanup

Tasks:

- warm materials/effects in `EffectPreloader`;
- add a small quality CVar, not dozens of public tuning knobs;
- suggested `cg_beamQuality 0|1|2`:
  - 0: core + impact only;
  - 1: core + corona + one detail path;
  - 2: full detail/filaments/forks;
- optional developer-only command for profile inspection;
- delete old active/remote beam cylinder code after comparison;
- retain generic tracer/bolt/pellet behavior.

---

## 11. Performance budget

### 11.1 Targets

- Zero new mesh/material allocations during sustained beam updates.
- Fixed four-vertex/six-index primary topology.
- Target one world primary-beam batch plus one POV batch at full quality.
- Accept one analytic draw per beam as an intermediate/fallback, still far below
  the current cylinder cost.
- No geometry-buffer replacement during primary beam updates.
- At most four vec4 instance attributes, approximately 64 bytes per active beam
  per full state upload; static matrices do not need per-frame replacement.
- At most one pooled endpoint light per active primary beam, with the global pool
  cap still respected.
- No per-frame creation of `Vector3[]`, instance arrays, or materials in the hot
  path; reuse fixed typed arrays and scratch vectors.
- No client scene raycast for remote beam endpoint once authoritative data exists.
- Beam update CPU time should remain negligible with 8 simultaneous shooters.

### 11.2 Quality scaling

| Quality | Core | Corona | Detail | Impact light | Decorative forks |
|---|---|---|---|---|---|
| 0 | yes | no or minimal | no | capped/off | no |
| 1 | yes | yes | reduced | capped | no |
| 2 | yes | yes | full | capped | yes |

### 11.3 Metrics to capture

- draw calls with 1, 4, and 8 active beams;
- bytes uploaded to dynamic buffers per frame;
- fragment overdraw and GPU time as corona width changes;
- active meshes/materials before, during, and after firing;
- JS heap allocation while holding fire for 30 seconds;
- CPU frame time of beam update;
- GPU frame time with bloom 0 and default;
- first activation hitch after map load;
- analytic per-beam versus thin-instance batch cost;
- projected-detail LOD transition stability;
- mobile/low-quality behavior.

---

## 12. Validation plan

### 12.1 Headless-first regression

Because renderer and networking are high-risk, run the required `AGENTS.md`
commands after implementation:

```bash
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
```

Also run:

```bash
npm run typecheck
npm run test:run
npm run build
```

### 12.2 Targeted automated tests

#### Simulation

- nearest player/world impact selection;
- wall occlusion;
- actual hit distance;
- normal propagation;
- Voltaic chain primary point;
- ADS zeroes gameplay wander;
- deterministic wander and trace result;
- checksum stability for repeated identical runs.

#### Protocol

- event round-trip for all impact kinds;
- optional payload absent for old/non-beam fire;
- normals and distances;
- exhaustive client event routing;
- demo encode/decode.

#### Renderer with Babylon `NullEngine`

- pool acquire/update/stop/reuse;
- no growth in mesh/material count across repeated cycles;
- stable static vertex/index data across repeated updates;
- correct thin-instance count and packed endpoint/profile attributes;
- deterministic field parameters for the same seed/time;
- endpoint envelope evaluates to zero filament amplitude at both caps;
- finite vectors for zero-length and vertical beams;
- string entity keys;
- cleanup on `clear()` and scene disposal.

#### Browser shader checks

- analytic shader compiles on the actual WebGL2 engine;
- derivative AA stays stable at dynamic-resolution and DPI changes;
- per-mesh and instanced variants produce equivalent pixels;
- no near-plane NaN or full-screen quad explosion;
- context loss/restore recreates material and instance buffers;
- bloom changes do not compile a new combat-time variant.

### 12.3 Manual two-client matrix

Test both directions: browser A watches B, then B watches A.

Scenarios:

- fire into a wall at 50, 200, and 850 units;
- fire past a wall edge;
- track a moving player in front of and behind geometry;
- two aligned players;
- rapid 180-degree turns;
- crouch, jump, walljump, slide, and teleport while firing;
- switch weapon while holding fire;
- reload/ammo exhaustion/death/disconnect;
- Voltaic hipfire and ADS;
- chain one and two secondary targets;
- spectator and demo playback;
- weapon model loading late;
- bloom 0, default, and maximum;
- dark, midtone, and near-white surfaces with the same beam profile;
- low/medium/high beam quality;
- 30, 60, 120, and 144+ FPS;
- high FOV and ADS FOV;
- simulated latency/interpolation and net jitter.

### 12.4 Visual acceptance criteria

- Lasergun is always a beam remotely, never a generic tracer.
- Remote beams stop at the same wall/player seen by the shooter.
- Remote origin follows the visible weapon with no eye-origin detachment.
- No visible 20 Hz on/off flashing during sustained fire.
- Release feels prompt.
- First-person beam never becomes an opaque pipe covering the target.
- Voltaic primary spine clearly indicates the damaging ray.
- Voltaic reads as a contained electrical field, not a generic zig-zag bolt.
- Surface ion wake never bridges unrelated walls or survives long enough to
  imply continuing damage.
- Decorative forks cannot be mistaken for chain damage.
- Chain arcs attach to actual affected targets.
- Bloom-off remains readable.
- Eight simultaneous beams do not cause material/mesh growth or a major frame
  spike.

---

## 13. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Unified trace changes gameplay | High | Separate Phase A, focused tests, deterministic regressions |
| Server/live lag compensation is not integrated | High | Do not claim it is; design impact type to be reusable when integrated |
| Custom shader fails on a target GPU | High | Prewarm/browser matrix; retained GreasedLine fallback |
| Thin-instance integration complicates culling | Medium | Two always-active batch meshes or per-beam analytic intermediate |
| Analytic braid looks flat | Medium | Quadrature front/back modulation, restrained phase separation |
| Procedural harmonics alias at range | Medium | Derivative AA and projected-detail LOD |
| Wide corona causes fill-rate cost | Medium | Tight quad bounds and quality-scaled corona width |
| Transparent beams sort badly | Medium | Depth test on, depth write off, restrained additive blend |
| Additive beam disappears on bright walls | High visual | Explicit corona; test combined/premultiplied output and subtle contrast fringe |
| Endpoint smoothing crosses walls | High visual | Topology-aware snap rules |
| First-person line clips near camera | Medium | Near-origin width/alpha ramp and clip tests |
| Remote model lacks muzzle socket | Medium | Configured local offset plus interpolated eye fallback |
| Point lights cause shader variants/hitches | High | Pool/cap, prewarm, quality control |
| Procedural motion differs in demos | Medium | Seed/time from server/demo ticks, never wall-clock randomness |
| Voltaic wander remains too fast | Medium | Renderer follows truth; separate approved gameplay retune |
| Protocol change breaks old demos | Medium | Explicit missing-payload fallback |
| Detail makes hitscan feel projectile-like | High design | Always-visible core; overlays never carry the only energy |
| Surface wake reads as damage-over-time | Medium design | 80–140 ms cap, surface-only continuity, no gameplay-sized decal |

---

## 14. Open questions for the visual spike

These require rendering, not more desk research:

1. Does hybrid world/pixel extrusion remain stable at the near plane and across
   SHAG's FOV range?
2. Is one analytic pass enough for soft bloom-off edges and bright-background
   contrast, or is an accessibility-only contrast pass justified?
3. Which HDR blend mode best balances bloom, order independence, and visibility
   on near-white lightmapped walls?
4. Does the existing bloom threshold respond to the chosen emissive intensity
   without washing out the beam?
5. Can Lasergun band motion remain visible at 30 FPS without strobing?
6. Does the pseudo-volumetric two-filament braid read correctly during fast
   strafes and extreme view angles?
7. What exact third-person muzzle offsets fit the existing Lasergun and Voltaic
   GLBs?
8. How much endpoint smoothing is tolerable before it feels lagged?
9. Should first-person decorative filaments be lower amplitude than remote ones?
10. What ion-wake duration and point count feel physical without reading as
    damage-over-time?
11. Does thin instancing materially outperform one analytic mesh per active beam
    at SHAG's realistic maximum player count?
12. Should the core use a subtle contrast fringe on bright maps, and can it be
    achieved without a second draw?

---

## 15. Recommended work-order boundaries

To keep reviewable patches and isolate risk:

1. **WO-BEAM1: authoritative first impact**
   - Simulation only; world/player nearest hit and tests.

2. **WO-BEAM2: beam impact protocol**
   - Event types, binary codec, demos, tests.

3. **WO-BEAM3: procedural renderer spike**
   - Analytic quad shader, GreasedLine fallback, pooling, debug harness.

4. **WO-BEAM4: first-person integration**
   - Muzzle/target split, prediction/reconciliation, lifecycle.

5. **WO-BEAM5: remote integration**
   - Interpolated muzzle, endpoint samples, shutdown, Lasergun fix.

6. **WO-BEAM6: impact and chain polish**
   - Contact crown, surface ion wake, chain arcs, forks, lights.

7. **WO-BEAM7: prewarm, performance, QA**
   - Thin-instance batching, effect preloader, quality CVar, mandatory
     regression and manual matrix.

Do not combine all seven into one implementation patch. The gameplay trace change
and renderer replacement deserve independent review and rollback points.

---

## 16. Final recommendation in one paragraph

Build a shared fixed-topology analytic beam whose camera-facing quad connects the
current weapon muzzle to a server-resolved first impact and draws core, corona,
bands, and field filaments in one HDR shader pass. Thin-instance world and POV
batches where measured useful, retaining one analytic mesh per beam and
GreasedLine as fallbacks. Give Lasergun a stable red cutting lance with
world-spaced frequency bands. Give Voltaic a warm-white hitscan spine inside a
pseudo-volumetric two-filament amber ion braid, a contact-compression response,
an 80–140 ms surface ion wake, and brighter server-driven chain arcs between
actual targets. Resolve world and player hits in one nearest-impact server trace
before serializing distance/kind/normal with `weapon_fire`; update remote starts
from interpolated weapon pose, endpoints from authoritative samples, and
shutdown from per-snapshot weapon state.

---

## 17. Sources

### Repository sources inspected

- `AGENTS.md`
- `src/engine/weapon/HitscanEffects.ts`
- `src/engine/weapon/WeaponViewManager.ts`
- `src/engine/weapon/EffectPreloader.ts`
- `src/games/fps/FPSPlayer.ts`
- `src/games/fps/client/GameEvents.ts`
- `src/games/fps/client/RemotePlayerRenderer.ts`
- `src/games/fps/client/DemoService.ts`
- `src/games/fps/server/systems/WeaponSystem.ts`
- `src/games/fps/server/SnapshotBuilder.ts`
- `src/engine/server/lagcomp/LagCompensation.ts`
- `src/engine/network/core/SnapshotEvent.ts`
- `src/shared/net/BinaryProtocol.ts`
- `src/shared/net/GameState.ts`
- `src/shared/collision/CollisionWorld.ts`
- `src/shared/collision/SharedCollisionWorld.ts`
- `src/shared/entities/WeaponDef.ts`
- `src/shared/entities/definitions/weapons/lasergun.ts`
- `src/shared/entities/definitions/weapons/voltaic.ts`
- `src/engine/effects/PostProcessingManager.ts`
- `src/engine/loader/shader/GlowOverlayShaderMaterial.ts`
- `node_modules/@babylonjs/core/Meshes/GreasedLine/greasedLineBaseMesh.js`
- `node_modules/@babylonjs/core/Meshes/GreasedLine/greasedLineMesh.js`
- `node_modules/@babylonjs/core/Shaders/greasedLine.vertex.js`
- `node_modules/@babylonjs/core/Shaders/greasedLine.fragment.js`
- `node_modules/@babylonjs/core/Meshes/thinInstanceMesh.d.ts`
- `docs/manual/guides/weapon-system.md`
- `docs/manual/guides/networking.md`
- `docs/manual/guides/shader-system.md`
- `docs/research/v0.9.16-weapon-system-overhaul.md`
- `docs/research/RENDERING_PIPELINE.md`

### External primary/official sources

- [Babylon.js: Creating a GreasedLine](https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/param/greased_line)
- [Babylon.js: Creating ribbons](https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/param/ribbon/)
- [Babylon.js: ShaderMaterial API](https://doc.babylonjs.com/typedoc/classes/BABYLON.ShaderMaterial)
- [Babylon.js: Blend modes](https://doc.babylonjs.com/features/featuresDeepDive/materials/using/blendModes/)
- [Babylon.js: GlowLayer](https://doc.babylonjs.com/features/featuresDeepDive/mesh/glowLayer)
- [Babylon.js: Instances and custom per-instance buffers](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances/)
- [Babylon.js: WebGL2 and standard derivatives](https://doc.babylonjs.com/setup/support/webGL2)
- [Khronos: OpenGL ES shading language derivatives and `fwidth`](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html)
- [NVIDIA GPU Gems: Real-Time Glow](https://developer.nvidia.com/gpugems/gpugems/part-iv-image-processing/chapter-21-real-time-glow)
- [id Software: Quake III Arena source](https://github.com/id-Software/Quake-III-Arena)
- [Quake III `cg_weapons.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/cgame/cg_weapons.c)
- [Quake III `tr_surface.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/renderer/tr_surface.c)
- [Warsow/qfusion source](https://github.com/Warsow/qfusion)
- [Warsow `cg_main.cpp`](https://github.com/Warsow/qfusion/blob/master/source/client/cgame/cg_main.cpp)
- [Warsow `polyeffectssystem.cpp`](https://github.com/Warsow/qfusion/blob/master/source/client/cgame/polyeffectssystem.cpp)
- [Warsow `trackedeffectssystem.cpp`](https://github.com/Warsow/qfusion/blob/master/source/client/cgame/trackedeffectssystem.cpp)

### Unverified items

- Final visual quality of the analytic braid in SHAG's actual maps and
  post-process pipeline.
- Exact per-beam versus thin-instance cost under realistic player counts.
- Best HDR blend mode and whether a one-pass contrast fringe is viable.
- Existing GLB-local muzzle coordinate values.
- Mobile behavior of the custom shader and derivative AA.
- Appropriate endpoint smoothing constants under real network conditions.
- Whether Voltaic gameplay wander should be retuned; this document recommends
  evaluation but does not authorize the balance change.
