# Voltaic Rift — Shooting Effect Research and Design

**Status:** Procedural renderer and authoritative beam-truth integration implemented; visual tuning in progress
**Date:** 2026-07-19
**Target branch:** `0.9.20-voltaic-beams`
**Scope:** Procedural graphics for the canonical Voltaic weapon (including legacy `lasergun` input), from authored muzzle to impact
**Constraint:** TypeScript and Babylon.js only; no external visual assets

---

## 0. Decision

Build **Voltaic Rift**: a hitscan line that looks less like a laser and more
like the weapon has torn open a narrow electrical fault in the air.

The effect has two presentations:

- **Hero presentation:** the local player's extravagant first-person effect.
- **World presentation:** a cheaper, cleaner version shown for other players.

They share gameplay truth, not identical decoration. The straight damaging
spine and resolved endpoint must be accurate enough to trust. Jagged streams,
forks, afterimages, turbulence, and minor timing variation are visual fiction
and may differ between clients.

The production renderer should use:

1. one fixed-topology, GPU-deformed multi-strip mesh for the beam;
2. one compact procedural mesh for the impact storm;
3. a separate instanced strip batch only when real chain targets exist.

The common first-person cost is two primary draws: beam and impact. The common
world cost is one batched beam draw plus one batched impact draw for all visible
remote continuous-beam users.

The visual signature is:

> a surgically straight white-hot truth line, assaulted by hot gold-orange
> electrical streams, wrapped in a
> blue-violet pressure scar, terminating in a violent geometric impact storm.

### 0.1 Weapon and model contract

There is one weapon and one renderer: `voltaic`. `lasergun` is only a Warsow
compatibility ID/classname and source-level compatibility export. It is
canonicalized to `voltaic` before inventory, snapshot, combat, viewmodel, bot,
or effect selection. It must never acquire separate stats, ammo state, model
selection, or visual routing.

The production Voltaic deliberately uses the repository's complete original
modern Lasergun model set at `/data/models/weapons/lasergun/lasergun.glb` for
both world and view models. This is the runtime conversion of the IQM supplied
by `z_weapons.pk3`, not the older Warsow MD3 from `data0_21pure.pk3`. The
similarly named Voltaic model is WIP and is not the production selection. This
filename choice is an asset decision, not a second Lasergun weapon path.

The model's authored `tag_flash` node is the muzzle source. In first person,
the tag is projected through the weapon camera and converted to the matching
world-camera ray, keeping the beam pixel-attached when weapon and gameplay FOV
differ. In world view, the live tag is carried with the hand-attached weapon
hierarchy. Camera/eye offsets exist only as defensive fallbacks for incomplete
legacy models.

---

## 1. Effect contract

### 1.1 The invariants

These properties communicate gameplay and must survive every quality level:

- The beam appears across its full length immediately. Nothing travels from the
  muzzle to the target.
- A thin, straight spine identifies the actual hitscan direction.
- The endpoint is the resolved hit point, a local collision result, or the best
  available approximation in that order.
- The hero beam starts on the authored visible muzzle pixel. For another
  player, the authored weapon tag is preferred; a smoothly interpolated weapon
  or eye fallback is still better than a stale event origin.
- World geometry occludes the effect.
- Start, stop, and contact changes feel prompt.

### 1.2 The freedoms

These properties have no damage meaning and should be used aggressively:

- the number and exact path of electrical streams;
- fork position, direction, and lifetime;
- the previous-state afterimage;
- sheath turbulence and color variation;
- broken-ring rotation and impact spike arrangement;
- local micro-timing within one electrical state;
- first-person scale and exaggeration;
- remote quality and level of detail.

No bolt path needs to be transmitted. No two clients need to render the same
fork. Random-looking detail only needs to remain stable enough on each client
not to flicker incoherently.

### 1.3 Accuracy tiers

The effect should distinguish visual truth from decorative plausibility:

| Property | Local hero view | Enemy/world view |
|---|---|---|
| Active state | Exact predicted/reconciled weapon state | Recent fire/weapon state |
| Start | Authored live `tag_flash`, screen-space matched into world | Authored hand-attached `tag_flash`; weapon/eye fallback |
| Straight spine | Server damage endpoint with predicted fallback | Server damage endpoint |
| Player intersection | Authoritative player contact | Authoritative player contact |
| Impact class | Exact if available | World/player/miss when available; generic otherwise |
| Electrical paths | Local presentation only | Independently generated and simplified |
| Forks and ghosts | Full | Reduced or omitted |
| Damage implication | Spine and contact only | Spine and contact only |

The minimum believable remote result is a beam that leaves roughly the right
place, points in the right direction, stops at roughly the right surface or
target, and does not continue through the map. Pixel-identical replay is not a
goal.

### 1.4 Goals

- Produce a stronger signature than the classic Quake lightning and Warsow
  laser effects without copying either one.
- Make sustained fire feel like maintained electrical violence rather than a
  static tube or a sequence of projectiles.
- Give first-person players a spectacular hero effect without obscuring aim.
- Give observers a readable and performant world effect.
- Remain attractive with bloom disabled and exceptional with normal bloom.
- Allocate nothing and rebuild no geometry while a beam is active.
- Spend complexity on silhouette, timing, and impact rather than particle count.
- Generate every new visual procedurally in repository code.

### 1.5 Non-goals

- No gameplay rebalance, damage change, or conversion away from hitscan.
- No requirement that decorative electricity match between clients.
- No broad network, lag compensation, audio, or weapon-model redesign.
- No general-purpose VFX framework.
- No new authored VFX textures, sprite sheets, GLBs, or downloaded effects.
- No swarm of independent particles along the beam.
- No dependence on a full-screen glow layer for basic readability.

---

## 2. What is wrong now

The replaced implementation in the branch baseline explained both the poor
view and the poor scaling:

- The local lightning is nine core cylinders plus nine glow cylinders.
- Every render update creates a new array of `Vector3` points, calls
  `Math.random()`, then repositions and reorients all 18 meshes.
- The current coherent bow can reach roughly 110 world units, so the apparent
  bolt can depart dramatically from the damaging ray.
- Core and glow are ordinary `StandardMaterial` cylinders, producing a rounded
  pipe rather than a sharp electrical line.
- Remote Voltaic ends at `origin + direction * 850`; it does not perform even a
  local world trace, so it can pass through geometry.
- Remote start is the fire-event origin rather than a continuously interpolated
  visible muzzle.
- Separate materials, meshes, transforms, and point lights multiply with every
  visible player.

The replacement can look much richer while being cheaper because the current
cost is dominated by object count and CPU transform work, not sophisticated
shading.

### 2.1 Repository capabilities already available

The engine already provides the pieces needed for an asset-free replacement:

- Babylon.js `ShaderMaterial`;
- custom static `VertexData`;
- thin instances and custom per-instance buffers;
- WebGL2 standard derivatives for clean analytic edges;
- HDR post-processing and bloom;
- world and weapon camera layers;
- a capped point-light pool;
- effect prewarming infrastructure.

No new rendering dependency is justified.

### 2.2 Lessons from classic effects

Quake III's lightning succeeded because it was immediate, bright, unmistakably
continuous, and cheap. Its limitations are visual age, texture dependence, and
a relatively simple repeated bolt language.

Warsow's Lasergun is readable and responsive, but its tiled ribbon/material
language is deliberately restrained. Making that beam wider, noisier, or more
particle-heavy would not create a new identity.

The useful lesson is not to imitate their geometry. It is to preserve their
clarity:

- the player sees the entire hitscan relationship at once;
- the damaging direction remains legible during motion;
- contact matters as much as the beam body;
- the effect cannot become a projectile trail.

Voltaic Rift should keep those rules and spend modern GPU budget on a more
violent silhouette, layered color, and contact response.

---

## 3. Final visual composition

### 3.1 One shot, five visual ideas

The complete hero effect is composed from five ideas:

1. **Truth spine**
   - A straight white-hot line from visual muzzle to resolved endpoint.
   - Razor thin, stable, and always present while firing.
   - Warm ivory in its center with a restrained golden inner falloff.

2. **Rift streams**
   - Three angular gold electrical paths snapping around the truth spine.
   - One dominant stream establishes the silhouette.
   - Two subordinate streams appear in broken intervals and cross the dominant
     path without replacing the core.

3. **State ghost**
   - Only the previous dominant stream remains briefly after each snap.
   - It fades in approximately 25–45 ms.
   - This creates violent persistence without multiplying the whole effect.

4. **Pressure sheath**
   - A broad, faint blue-violet scar surrounding the final two-thirds.
   - Its border shivers asymmetrically rather than forming a smooth glow tube.
   - It suggests displaced or ionized air and separates the gold beam from warm
     map lighting.

5. **Impact storm**
   - A compact white nucleus at the true endpoint.
   - A broken gold crown oriented to the hit surface when a normal is known.
   - Six to ten short radial spikes and one violet pressure halo.
   - The crown changes state while contact persists; it does not respawn a pile
     of particles on every damage tick.

These are logical layers, not five draw calls.

### 3.2 Spatial composition

The effect is deliberately restrained near the reticle and extravagant near
contact:

- first 8 percent: narrow muzzle clamp; almost no displacement;
- 8–35 percent: the dominant stream separates from the spine;
- 35–70 percent: all streams and the sheath become visible;
- 70–95 percent: maximum jagged displacement and occasional forks;
- final 5 percent: paths compress back into the impact nucleus.

Use an envelope such as:

```text
displacement(t) =
  smoothstep(0.04, 0.28, t)
  * smoothstep(1.0, 0.92, t)
  * mix(0.55, 1.0, smoothstep(0.25, 0.8, t))
```

This protects first-person aim, pins every path to contact, and places the
spectacle where the player is already looking for hit feedback.

### 3.3 Temporal composition

Electricity should not swim like a sine wave:

- generate a new discrete electrical state at approximately 18–24 Hz;
- switch immediately to the new stream geometry;
- retain the previous dominant stream as a short fading ghost;
- vary state duration by a small stable amount to avoid a mechanical metronome;
- pulse the impact nucleus on the same state boundary;
- animate crown rotation in coarse steps with a tiny continuous drift;
- never seed from render-frame count.

The fixed state cadence is close to the weapon's damage rhythm but does not have
to equal it. Decoupling presentation makes low frame rates and network jitter
less visible.

### 3.4 Fire lifecycle

**Attack, 0–35 ms**

- The truth spine appears immediately.
- A sharp muzzle pinch and impact nucleus lead the broader sheath.
- Rift streams reach full displacement over one short electrical state.

**Sustain**

- Spine stays stable.
- Streams snap between states.
- The prior dominant state ghosts briefly.
- The impact storm compresses and erupts without blinking away.

**Release, 35–60 ms**

- Stop the truth spine promptly.
- Let the sheath, state ghost, and impact halo collapse quickly.
- Do not leave a long trail that implies continuing damage.

### 3.5 Color and energy hierarchy

Suggested linear/HDR direction, subject to real-map tuning:

| Layer | Hue | Relative energy | Purpose |
|---|---|---:|---|
| Truth spine | ivory-white | 1.00 | gameplay direction |
| Inner edge | pale gold | 0.75 | electrical heat |
| Dominant stream | saturated gold | 0.65 | silhouette |
| Subordinate streams | amber/orange | 0.35–0.50 | complexity |
| Previous ghost | orange-red | 0.12–0.22 | persistence |
| Pressure sheath | blue-violet | 0.06–0.14 | color separation and scale |
| Impact nucleus | white | 1.10–1.35 | contact priority |
| Crown/spikes | gold with violet fringe | 0.40–0.80 | impact violence |

The complementary violet is not a second weapon color. It should be visible
mainly at the outer edge and on dark surfaces, disappearing before it turns the
beam into neon vapor.

### 3.6 Suggested starting values

These are spike values, not final art constants:

| Parameter | Hero POV | World presentation |
|---|---:|---:|
| Core width | 1.4–2.2 px | 1.2–2.0 px |
| Rift streams | 3 | 1 dominant, optional second |
| Max projected displacement | 12–24 px | 5–12 px |
| Max world displacement | 8–16 units | 4–10 units |
| Snap rate | 18–24 Hz | 14–20 Hz |
| Previous-state ghost | 25–45 ms | off by default |
| Decorative forks | 1–2 | 0–1 |
| Sheath width | 18–40 px | 8–20 px |
| Impact crown radius | 10–28 px | 6–16 px |
| Release | 35–60 ms | 25–50 ms |

Both projected and world limits are required. The smaller limit wins so the
effect cannot consume the screen at close range or disappear completely at
distance.

### 3.7 Muzzle treatment

The beam should not look pasted onto the camera:

- Begin with a bright two- or three-pixel pinch at the live muzzle.
- Add a tiny broken collar inside the beam draw, no separate particle emitter.
- Clamp stream displacement almost to zero near the muzzle.
- Fade broad sheath energy over the first few percent.
- Advance the visual start if it falls behind the near plane.

The muzzle treatment is a transition, not a repeated firearm flash.

### 3.8 Impact variants

**World**

- Stop at the surface.
- Orient the broken crown to the surface normal.
- Offset it slightly along the normal to avoid z-fighting.
- Keep the billboard nucleus facing the current camera.

**Player**

- Use the same nucleus but omit the flat wall crown.
- Tighten the core and add two short crawling spikes.
- Begin real chain arcs at this contact.

**Miss**

- End cleanly at range.
- Fade the outer sheath over the last few percent.
- Do not show a wall crown or environmental light.

Impact variants should be visual input states, not inferred through expensive
per-frame scene queries.

### 3.9 Chain discharge

Actual chain targets deserve more energy than decorative forks:

- begin at the primary impact nucleus;
- include a thin truth line between actual chain endpoints;
- use one or two displaced rift streams with larger amplitude;
- snap at the same cadence but use independent presentation seeds;
- make the first chain edge brightest and reduce energy with chain depth;
- keep decorative forks shorter, dimmer, and unattached to characters.

Chain arcs are additional effect draws only when the gameplay event contains
real chain edges. They are not part of the common no-chain budget.

---

## 4. Rendering technique research

### 4.1 Options compared

| Technique | Visual ceiling | CPU/update cost | Fragment cost | Draw/object count | Decision |
|---|---:|---:|---:|---:|---|
| Cylinder segments | low | very high | moderate | very high | reject |
| CPU rebuilt ribbon | good | medium/high | low | low | reject for sustain |
| GreasedLine | good | medium when points change | low/moderate | low | compatibility fallback |
| One wide analytic quad | excellent | negligible | high across full envelope | one draw | research comparator |
| Fixed GPU multi-strip | excellent | negligible | low/moderate | one draw | production recommendation |
| Particle chain | noisy | medium/high | high overdraw | variable | impacts only, if ever |

The important comparison is the final two rows.

An analytic four-vertex quad is elegant: the fragment shader can draw every
line, fork, and halo as a signed-distance field. Its weakness is that every
pixel in the broad beam rectangle evaluates all procedural fields, including
the large transparent gaps between jagged streams. A long diagonal beam can
make that rectangle surprisingly large.

A fixed multi-strip spends a few hundred vertex invocations instead. The vertex
shader evaluates procedural centers at static nodes and the rasterizer shades
only the actual strips. On the expected WebGL2 hardware, a few hundred vertices
are negligible compared with repeatedly evaluating noise over thousands of
transparent fragments. It also produces naturally angular piecewise-linear
lightning.

This is the Carmack-style trade: use more of the cheap thing—static vertices—to
avoid large quantities of the expensive thing—overdraw and fragment work.

### 4.2 Production primitive: fixed GPU multi-strip

Create one immutable hero mesh containing several disconnected indexed strips:

| Part | Approximate nodes | Purpose |
|---|---:|---|
| Truth spine | 2 | exact damaging line and inner glow |
| Pressure sheath | 20–24 | broad irregular outer field |
| Dominant stream | 28–32 | main jagged silhouette |
| Subordinate stream A | 24–28 | broken secondary energy |
| Subordinate stream B | 24–28 | broken secondary energy |
| Previous dominant ghost | 28–32 | short persistence |
| Fork A | 6–8 | optional rupture |
| Fork B | 6–8 | optional rupture |

With two side vertices per node, duplicated joins where useful, and static
indices, one hero sheet is 352 vertices. The hero duplicates that immutable
sheet once and rotates the pair +/-45 degrees around the truth axis, producing
an X-shaped volumetric cross-section at 704 vertices while remaining one draw.
The world mesh stays a single billboard sheet, omits the ghost, one subordinate
stream, and one fork, and remains below 150 vertices.

The topology is created once. During firing, only uniforms or instance buffers
change. The vertex shader decides each part's position, width, intensity, and
visibility from its static `aAlong`, `aSide`, `aPart`, and `aNode` attributes.

The strips share one `ShaderMaterial` and one blending mode, so the complete
beam is one draw. Additive or premultiplied blending makes overlaps within the
same mesh harmless.

### 4.3 Why not GreasedLine as the primary

GreasedLine remains a useful reference, but its installed `setPoints()` path
processes and replaces line data. That is better than 18 cylinders, but it
still puts sustained deformation and buffer work on the CPU. Multiple layered
GreasedLines would also make the one-draw composition harder. It is not a
shipping fallback; reconsider it only if the fixed topology exposes a concrete
production defect.

Do not make it the visual ceiling.

### 4.4 Mesh attributes

A compact static vertex layout is enough:

```ts
// position.x = normalized along coordinate
// position.y = strip side, -1 or +1
// position.z = part id (+16 for the hero's second crossed sheet)
// uv.x       = normalized node coordinate inside this part
// uv.y       = stable per-node variation
```

The hero mesh is a normal retained mesh because there is only one first-person
beam. The world mesh uses thin instances and custom buffers so all visible
remote beams can share one draw.

Suggested world instance data:

```ts
interface VoltaicGpuSample {
  startAndSeed: Float32Array; // xyz + presentation seed
  endAndState: Float32Array;  // xyz + electrical state
  colorEnergy: Float32Array;  // rgb + intensity
  widthsFlags: Float32Array;  // width, displacement, impact kind, life
}
```

Use retained maximum-size typed arrays. Update active slots in place and set the
active instance count; do not allocate a new array per event or frame.

### 4.5 Vertex generation

For every stream node:

1. interpolate its straight center from start to end;
2. evaluate a coarse and fine value field at the node coordinate;
3. multiply by the spatial displacement envelope;
4. offset in a camera-facing perpendicular basis;
5. evaluate neighboring node centers to derive a screen-facing join direction;
6. for the hero, rotate the two sheet-side vectors +/-45 degrees around the
   truth axis; for world/chain, retain one billboard side vector;
7. extrude `aSide` by the hybrid world/pixel half-width;
8. project normally so world depth still occludes the strip.

The stream center is generated in the plane most legible to the viewing camera.
That makes the decorative shape view-dependent, which is acceptable and
desirable. The truth spine remains the same world segment.

At a near-parallel camera angle, the usual cross product between beam tangent
and view direction becomes unstable. Fall back to camera right, then retain the
last valid side vector for the local hero beam. Reject non-finite output before
uploading remote endpoints.

### 4.6 Cheap sharp noise

The desired motion needs value noise, not general fractional Brownian motion.
A small multiplication-and-`fract` hash avoids texture access and expensive
trigonometric hash calls:

```glsl
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float linearNoise(float x, float seed) {
  float cell = floor(x);
  float f = fract(x);
  float a = hash11(cell + seed);
  float b = hash11(cell + 1.0 + seed);
  return mix(a, b, f) * 2.0 - 1.0;
}
```

For a stream:

```glsl
float boltField(float s, float state, float seed) {
  float coarse = linearNoise(s / 92.0, seed + state * 17.0);
  float fine = linearNoise(s / 27.0, seed * 3.1 + state * 41.0);
  return coarse + fine * 0.34;
}
```

Evaluate this in the vertex shader. The strip interpolation between nodes is
the intentional sharp lightning shape; do not smooth the value-noise fraction.
Use explicit fixed expressions rather than a dynamic loop.

The decoration does not require cross-GPU bit identity. If exact demo visuals
later become desirable, send or record only the small state seed and accept
minor floating-point variation—not path vertices.

### 4.7 Stream construction

The three streams should not look like parallel copies:

- dominant: coarse field plus fine fractures, full path;
- subordinate A: different seed, broken visibility windows, 65–80 percent
  amplitude;
- subordinate B: different scale and polarity, 45–70 percent amplitude;
- ghost: previous dominant state, 70–90 percent amplitude, rapidly fading;
- fork: begins on the dominant path, diverges through a short node interval,
  never reaches an unrelated target.

Broken windows can be calculated per segment from node index and state. Do not
alpha-dither at a frequency that crawls or sparkles under temporal AA.

### 4.8 Strip joins and cracks

A naive independent quad per segment can leave pinholes at acute corners.
Use one of these in order:

1. a continuous indexed strip whose node extrusion uses the normalized average
   of incoming and outgoing screen-space normals;
2. a clamped miter length, beveling extremely sharp turns;
3. tiny overlapping joint diamonds generated by the same topology only if the
   first two still show cracks.

The corona portion of each strip should hide microscopic join errors. Round
caps are unnecessary for internal nodes and waste fragments.

### 4.9 Fragment shader

The fragment shader should be intentionally boring. Interpolate a signed strip
coordinate and derive a soft edge:

```glsl
float d = abs(vSide);
float aa = max(fwidth(d), 0.001);
float core = 1.0 - smoothstep(0.20 - aa, 0.20 + aa, d);
float glow = 1.0 - smoothstep(0.72 - aa, 1.0 + aa, d);
```

Part id selects a small fixed color/energy table. Stream interruption, fork
life, and state fading should be decided in the vertex shader or through flat
varyings wherever possible.

Avoid:

- texture samples;
- fragment noise;
- unbounded loops;
- lighting calculations;
- shadows, fog, picking, and collision;
- `discard` unless profiling proves it wins on target GPUs.

### 4.10 Width and displacement

Use a hybrid measure for both line width and stream displacement:

1. calculate a world-space target;
2. derive world units per pixel at the node's view depth;
3. enforce a projected minimum for readability;
4. enforce a projected maximum for aim comfort and fill rate;
5. cap the result in world units so distant beams do not gain gameplay weight.

Core and displacement need separate clamps. A distant enemy beam may retain a
one-pixel spine while its decorative displacement collapses almost completely.

### 4.11 Blend mode and bright backgrounds

Pure additive blending is simple, order independent, and bloom-friendly, but a
white or gold beam can vanish against a near-white lightmap. The strongest
candidate is Babylon's premultiplied-alpha mode:

```text
result = source + destination * (1 - sourceAlpha)
```

It permits HDR source energy while gently suppressing the immediate background
under the narrow core. Compare it directly against additive and normal combine
in real maps. If premultiplied output wins, accept imperfect ordering when two
remote beams overlap; that rare artifact is cheaper and less harmful than a
permanent contrast pass.

Do not add a black cartoon outline. The gold inner edge and violet outer edge
should provide chromatic contrast.

### 4.12 Depth and cameras

- Depth test on; depth write off.
- Back-face culling off for the generated strips.
- Shadows, lighting, collision, and picking off.
- Hero beam on the appropriate first-person/world composition path used by the
  current weapon camera setup.
- World beam batch on the normal world layer.
- No transparent mesh should ignore walls.
- Advance or fade the first node when it intersects the near plane.

The local and world meshes use the same visual language but do not need the
same topology, material defines, or camera layer.

### 4.13 Impact storm primitive

Build one immutable impact mesh containing two procedural parts:

- a camera-facing flare quad for the white nucleus and pressure halo;
- a surface-oriented quad for the broken crown and radial spikes.

Both parts share one material and one draw. A static part id tells the vertex
shader whether to construct a camera-facing or normal-oriented basis. The
fragment shader uses polar distance and angle to produce:

```text
nucleus = tight radial falloff
crown   = thin irregular ring * broken angular mask
spikes  = sparse angular rays * short radial envelope
halo    = broad low-energy radial falloff
```

Use a small fixed number of angular tests or a folded angular function, not a
loop over particles. State and seed rotate or break the crown without changing
topology.

World impacts can share a thin-instance batch. The local hero impact may use a
larger profile but still the same source mesh. Misses set impact visibility to
zero instead of spawning and disposing an object every update.

### 4.14 Environmental light

The effect should first succeed without a dynamic light. Existing HDR bloom and
the procedural contact shape carry most of the perceived energy at much lower
cost.

After the visual is stable, evaluate one short-range pooled endpoint light only
at high quality:

- prioritize the local hero impact;
- cap remote Voltaic lights globally;
- keep the light alive and vary intensity instead of enabling/disabling it;
- prewarm affected material variants;
- omit the light on misses and at low quality.

The light is polish, not part of the identity.

---

## 5. Hero and world presentation architecture

### 5.1 One renderer, two profiles

Do not build unrelated local and remote effects. Use one public renderer and
two deliberately different profile/topology variants:

```text
VoltaicEffectRenderer
├── HeroBeamMesh
├── WorldBeamBatch
├── HeroImpactMesh
├── WorldImpactBatch
└── ChainArcBatch
```

The shared renderer owns timing, acquisition, release, endpoint classification,
quality selection, and cleanup. The profiles own only visual scale and enabled
parts.

This keeps the weapon recognizable from every camera without wasting the hero
budget on distant players.

### 5.2 Minimal effect input

The renderer should consume resolved presentation data, not reach into weapon
simulation:

```ts
type VoltaicImpactKind = 'none' | 'world' | 'player';
type VoltaicViewKind = 'hero' | 'world';

interface VoltaicEffectSample {
  shooterKey: string;
  viewKind: VoltaicViewKind;
  visualStart: Vector3;
  resolvedEnd: Vector3;
  impactKind: VoltaicImpactKind;
  impactNormal?: Vector3;
  activationSeed: number;
  effectTimeSeconds: number;
  intensity: number;
}
```

`activationSeed` only stabilizes presentation during one held burst. It need not
be authoritative or identical across clients. `effectTimeSeconds` may come from
local presentation time; demo-perfect decoration is not an effect requirement.

### 5.3 Endpoint source order

The renderer accepts a resolved endpoint and remains independent of its source.
The shipping integration uses this order:

1. an already resolved authoritative or predicted endpoint;
2. supplied impact distance along the shot direction;
3. one local BSP trace from the received origin/direction as a predicted or
   legacy-demo fallback;
4. maximum weapon range only as a degraded fallback.

Current live play uses step 1 through the compact `voltaic_beam` event. No
decorative geometry is transmitted, and no endpoint raycast runs every render
frame. Older demos can degrade through the fallback order.

### 5.4 Remote start

Remote accuracy is often judged more by the first 30 cm than by the final 5 cm.
The beam must appear attached to the moving weapon:

1. query an interpolated remote muzzle transform when available;
2. otherwise use the interpolated hand or weapon-root transform plus a small
   configured offset;
3. otherwise use interpolated eye position plus forward offset;
4. use the discrete event origin only as a last one-frame fallback.

Update this visual start each render frame while the remote beam is alive. Do
not retrace the endpoint merely because the presentation muzzle moved.

### 5.5 Endpoint presentation smoothing

Hitscan truth is more important than smoothness. Use conservative rules:

- same hit class, same surface direction, small delta: damp over 20–40 ms;
- continuous player tracking: short capped damping;
- wall edge, hit-class change, large delta, or major normal change: snap;
- miss to hit or hit to miss: snap.

Never drag an endpoint through a wall to hide a 20 Hz sample cadence. The impact
storm's state changes can mask small snaps more honestly than excessive lerp.

### 5.6 Presentation randomness

Generate a stable seed from local values such as:

```text
hash(shooterKey, activationCounter, viewKind, localSalt)
```

Then derive each electrical state and part seed from that base. The rules are:

- randomize on activation and electrical state, not every frame;
- preserve the same state for its full interval;
- never use randomness to move the truth spine or impact point;
- let hero and world seeds differ;
- let two observers see different decorative paths;
- avoid synchronization work that has no gameplay or readability value.

This is intentional controlled non-determinism at the presentation boundary.

### 5.7 World simplification ladder

The world effect should simplify by projected importance, not merely distance:

| Projected importance | World effect |
|---|---|
| Large/near | core, dominant stream, second broken stream, sheath, compact impact, optional fork |
| Medium | core, dominant stream, narrow sheath, compact impact |
| Small/far | core, faint corona, impact point only |
| Subpixel | core only or culled if fully irrelevant |

Projected beam length, width, and screen position are better signals than raw
world distance. A long beam across the player's screen can remain important
even when its shooter is far away.

### 5.8 First-person comfort rules

The hero effect is grand, but it cannot sabotage aim:

- the truth spine stays narrow;
- large displacement grows away from the muzzle;
- subordinate streams are lower energy near the reticle;
- the sheath cannot become opaque;
- the impact nucleus has a strict projected-size cap;
- no high-contrast fork crosses the central few pixels for more than one state;
- bloom-max testing is mandatory;
- user beam-quality controls may reduce decoration without thinning truth.

Grand means a strong silhouette and response, not filling the screen with fog.

---

## 6. Performance design

### 6.1 Draw targets

| Situation | Beam draws | Impact draws | Notes |
|---|---:|---:|---|
| Local hero, no chain | 1 | 1 | normal case |
| All remote primaries | 1 batch | 1 batch | thin-instanced world profiles |
| Real chain discharge | +1 batch | included | one instance per chain edge |

Two hero draws are a target, not a religion. A measured extra pass that creates
a transformative result may be accepted, but no proposed layer currently needs
one.

### 6.2 Why the vertex-heavy design wins

The production hero mesh uses approximately hundreds of static vertices, which
is trivial compared with:

- 18 Babylon meshes and transform nodes in the current local bolt;
- repeated CPU vector allocation and cylinder orientation;
- full-envelope noise evaluation in an analytic fragment canvas;
- a particle system with repeated transparent quads.

Moving noise to the vertex shader also makes cost largely independent of screen
resolution. The sheath still incurs fill rate, so its projected width—not its
node count—is the first performance dial.

### 6.3 Hot-path rules

- No mesh, material, vector-array, or typed-array allocation during sustain.
- No vertex or index replacement after initialization.
- No CPU path construction.
- No per-node transform objects.
- One global effect time update per material/batch per frame.
- Start and endpoint values updated in retained buffers.
- Remote collision fallback evaluated only when a new fire sample arrives.
- Point lights absent by default and globally capped if enabled.
- Beam and impact slots returned after their short release envelopes.
- All subscriptions and render observers removed on disposal.

### 6.4 Quality profiles

The initial implementation ships one extravagant hero profile and one bounded
world profile. Do not add a settings matrix until profiling proves it is
needed. If a lower rung becomes necessary, remove decorative layers in the LOD
order below while preserving the truth core and contact readability.

### 6.5 LOD order

When reducing cost, remove layers in this order:

1. remote previous-state ghosts;
2. remote decorative forks;
3. remote subordinate stream B;
4. impact halo complexity;
5. remote subordinate stream A;
6. pressure sheath width;
7. impact crown;
8. dominant decorative stream.

Never remove the truth spine before culling the whole effect.

### 6.6 Shader variants

Prefer three precompiled variants over a forest of runtime branches:

- hero full;
- world adaptive;
- core-only fallback.

The meshes already have different topology, so compile-time defines can omit
unneeded state math. Prewarm all selected variants and both instanced/non-
instanced paths through `EffectPreloader` before combat.

### 6.7 Bounds and culling

GPU-deformed endpoints are not represented by a unit source mesh's original
bounds. For the tiny number of batch meshes:

- mark active hero/world batch meshes as always active; or
- update one conservative aggregate bound when samples change.

Do not recalculate bounds per remote beam every render frame. Set instance count
to zero when a batch is unused.

### 6.8 Performance gates

The visual spike should record:

- draw calls at 1, 4, 8, and 16 beams;
- CPU update time and JS allocation while firing for 30 seconds;
- GPU frame time at bloom off/default/max;
- fragment overdraw as sheath width changes;
- active meshes, materials, and lights before/during/after firing;
- buffer bytes uploaded per frame;
- first-fire hitch after map load;
- hero multi-strip versus analytic quad;
- world thin instances versus one retained mesh per beam;
- desktop, high-DPI, and mobile-resolution behavior.

The acceptance target is not a guessed millisecond number before hardware
testing. It is no material frame spike at 16 simplified world beams and a clear
reduction in CPU/object pressure versus the existing cylinder implementation.

---

## 7. In-map tuning matrix

The renderer is integrated. Tune it in representative maps and real multiplayer
views; do not build a general comparison scene or maintain alternate renderers. Small
temporary debug knobs are appropriate when a direct comparison is needed, but
the production weapon and scene are the test harness.

### 7.1 Required matrix

The lab must cover:

- first-person POV and multiple remote/world camera angles;
- dark, gray, and near-white backgrounds;
- 50, 200, and 850-unit beam lengths;
- wall, player, miss, and chain states;
- stationary and sweeping contacts;
- bloom off, default, and maximum;
- 1, 4, 8, and 16 simultaneous beams;
- normal, high, and ADS-like FOV;
- desktop, high-DPI, and mobile-like resolutions;
- hero and simplified world profiles.

### 7.2 Controls worth exposing

Useful temporary tuning controls (only add the ones needed for the current
comparison):

- core pixel width and HDR energy;
- stream count, displacement, and coarse/fine scale;
- state rate and ghost lifetime;
- sheath width and energy;
- fork probability and length;
- impact radius, spike count, and crown breakup;
- blend mode;
- hero/world profile;
- endpoint kind and normal;
- freeze state, advance one state, and slow motion;
- bloom and background selection;
- active beam count;
- camera FOV and render scale.

Freeze and single-step can be useful while judging silhouette. They do not
justify a permanent VFX editor or alternate renderer path.

### 7.3 Visual tuning sequence

Tune in this order:

1. **Spine alone**
   - readable on black, gray, and white;
   - stable at every FOV and length;
   - no near-plane explosion.

2. **Dominant stream**
   - unmistakably angular;
   - interesting frozen silhouette;
   - no smooth snake, helix, or giant bow.

3. **Snap timing and ghost**
   - violent without noisy flicker;
   - coherent at 30 FPS;
   - still energetic at 144+ FPS.

4. **Subordinate streams and sheath**
   - enrich negative space;
   - never erase the spine;
   - remain restrained near the reticle.

5. **Impact storm**
   - more memorable than adding more beam strands;
   - stable against walls and players;
   - compact enough not to hide targets.

6. **World profile**
   - recognizable as the same weapon;
   - attached and accurately aimed enough;
   - cheap at 16 beams.

7. **Chain state**
   - real target connections dominate decorative forks;
   - composition reads outward from primary impact.

### 7.4 Acceptance criteria

The tuning pass is complete only when:

- the straight damaging ray is instantly legible in every profile;
- the hero effect reads as a maintained electrical rift, not a textured laser,
  smooth braid, or generic zig-zag;
- a frozen frame has a deliberate silhouette;
- the impact is at least as memorable as the beam body;
- bloom-off remains attractive and bloom-max remains usable;
- near-white surfaces do not erase the core;
- first-person tracking remains comfortable;
- world beams leave the visible weapon closely enough to feel attached;
- remote world endpoints do not routinely continue through solid walls;
- decorative differences between clients have no apparent damage meaning;
- 16 world beams produce no mesh/material growth or material frame spike;
- release is prompt and no orphan effect survives switch, death, or disconnect.

### 7.5 Reject conditions

Reject a tuning direction if:

- it needs bloom to exist;
- it resembles a glowing plumbing tube;
- it resembles a smooth helix or DNA strand;
- it becomes a projectile pulse;
- the broad sheath dominates the center of aim;
- forks repeatedly look attached to undamaged players;
- impact is just a circular sprite-like blob;
- the world profile looks like an unrelated weapon;
- a prettier still frame causes obvious sweeping shimmer or aliasing.

---

## 8. Implementation notes and work order

The first production implementation now exists on this branch. It includes:

- fixed-topology hero, world, impact, and chain meshes;
- procedural GLSL deformation and contact rendering with no external assets;
- one canonical `voltaic` definition and combat/render path, with `lasergun`
  normalized strictly as a Warsow compatibility alias;
- the modern z_weapons IQM conversion at
  `/data/models/weapons/lasergun/lasergun.glb` selected as the production
  Voltaic world/view model while the older Warsow MD3 and separate WIP Voltaic
  model remain unused;
- retained thin-instance world/chain batches with zero idle template draws;
- exact `voltaic_beam` server truth events carrying origin, direction, endpoint,
  normal, and player/world/miss classification for canonical `voltaic` events;
- an 8-degree temporal direction gate that accepts legitimate authoritative
  wander but rejects stale endpoints after a rapid aim turn, preventing the
  beam from bending toward an old direction;
- hip-fire wander evaluated in seconds rather than raw 125 Hz tick units, with
  independent low-frequency yaw/pitch phases and a regression cap on adjacent
  shot angles, so it meanders coherently instead of orbit-jumping;
- a camera-projected hero ribbon basis that remains stable when the beam and
  view ray are nearly collinear, eliminating the non-ADS electrical-field spin;
- first-person attachment to the live authored `tag_flash`, projected between
  the weapon and world cameras so different FOVs cannot detach the beam;
- per-frame remote attachment to the authored hand-mounted `tag_flash`, with
  weapon-root and eye fallbacks, without retracing or moving the endpoint;
- a 704-vertex hero beam topology made from two orthogonal 352-vertex sheets
  rotated +/-45 degrees around the truth axis. Both contain the core, pressure
  sheath, three primary electrical streams, previous-state ghost, and four
  short terminal forks, producing a volumetric X cross-section without another
  draw while the world profile remains a compact single sheet;
- a twelve-quad procedural storm topology in the existing second hero draw:
  endpoint nucleus/crown, an always-live muzzle corona and axial petals, plus
  eight shader-ballistic contact streaks (four remotely) that eject along the
  hit normal and fall under gravity. The burn-through spray adds no texture,
  particle system, allocation, or additional draw call;
- exact thin-instance shader prewarming and frame-coalesced buffer uploads;
- deterministic lifecycle, overflow, protocol, and authoritative-contact tests;
- explicit `hitscanType === "beam"` viewmodel routing so gameplay-only
  `chainCount` cannot choose presentation;
- local beam activation gated by authoritative loaded-ammo state, with one
  stop/reset operation for release, reload, and clip exhaustion, preventing an
  empty Voltaic from leaving the held-fire beam alive;
- complete removal of the legacy local and remote tapered-cylinder held beams;
- a real WebGL2 smoke check proving Babylon 8.56 compiles all hero/world/chain
  shader variants and the canonical alias resolves to one definition;
- a production GLB load proving the modern model exposes a finite authored
  `tag_flash` node.

The remaining work is visual comparison and tuning in real maps, not renderer
architecture discovery.

### 8.1 Suggested focused file split

Keep the implementation small and Voltaic-specific:

```text
src/engine/weapon/voltaic/
├── VoltaicEffectRenderer.ts
├── VoltaicBeamGeometry.ts
├── VoltaicShaderMaterial.ts
└── VoltaicProfiles.ts
```

`HitscanEffects` stays the coordinator during migration. Do not create a general
beam framework until another implemented effect proves it needs the same
primitive.

The impact topology and material can live with the renderer initially. Split a
fifth file only if the implementation becomes genuinely difficult to read.

### 8.2 Babylon.js construction notes

- Use modular imports for `Mesh`, `VertexData`, `VertexBuffer`, `ShaderMaterial`,
  `Effect`, math types, and thin-instance support.
- Store GLSL strings in TypeScript and register through `Effect.ShadersStore`,
  following the existing `GlowOverlayShaderMaterial` pattern.
- Build static position, UV, optional custom attribute, and index buffers once.
- Set depth write off, depth test on, lighting/shadows/picking/collision off.
- Use separate prewarmed hero and world materials/defines.
- Keep world instance buffers dynamic and retained.
- Do not change alpha mode while active; that creates material state churn.
- Keep time in seconds from a stable presentation clock, not frame count.
- Mark renderer-owned meshes for correct map/scene cleanup.

### 8.3 Primitive decision — implemented

The fixed GPU multi-strip was selected and implemented directly. Separate
GreasedLine/analytic comparators would now duplicate working production code
without answering the remaining question, which is visual tuning in real maps.
The retained topology is deliberately bounded:

| Profile | Vertices | Runtime geometry work |
|---|---:|---|
| Hero beam | 704 | uniforms only; two crossed sheets in one draw |
| World beam | 146 | thin-instance buffers only |
| Real chain | 92 | thin-instance buffers only |
| Combined muzzle/impact/spark storm | 48 | uniforms or thin-instance buffers only |

There are no CPU-generated bolt paths, particles, textures, per-frame mesh
rebuilds, or per-stream draws.

### 8.4 Hero effect — implemented

- Live authored muzzle attachment is pixel-correct across different weapon and
  gameplay FOVs.
- The local trace responds immediately; recent authoritative contact replaces
  it only while its direction remains within the safe truth envelope.
- The one beam draw contains the core, sheath, three streams, ghost, and four
  terminal forks duplicated across two +/-45-degree sheets. Its X-shaped
  cross-section, local-only core, field displacement, halo, muzzle, and endpoint
  caps are deliberately larger than the world profile.
- The current hero tuning widens the local sheath, truth core, and electrical
  streams by roughly 10-12% while leaving the remote profile unchanged.
- Decorative displacement stays zero at the authored muzzle but reaches its
  main amplitude within the first 14% of the beam. This keeps the truth core
  attached while making the electrical field visibly peel away near the gun.
- The second draw contains both the large start corona/spark petals and the
  endpoint nucleus/crown/rays, plus eight procedural ballistic contact streaks.
  Both wall and player contacts eject these streaks from the resolved endpoint
  along its surface normal. Misses suppress every endpoint piece while retaining
  the muzzle treatment.
- Contact streak cross-sections are four times the initial tune, with a
  six-pixel minimum half-width for a twelve-pixel on-screen body. Their outward
  and tangential velocities are roughly 70% higher, trails are longer, and the
  hero refresh cycle is about 28% faster. The result is a violent electrical
  spray rather than tiny, nearly stationary embers.
- The hero muzzle corona is sized beyond the viewmodel silhouette because the
  weapon camera intentionally overlays world-camera effects at the barrel.
- Attack/release, switch, death, ammo exhaustion, and disposal use retained
  lifecycle state rather than creating or abandoning meshes. Empty-clip state
  explicitly shuts down both the beam and charge presentation.
- Voltaic uses the shared Plasmagun downshift reload and its 1.3-second timing.
  The previous 0.065-second value was obsolete fire-cadence data in the reload
  field and visibly compressed the full animation; beam cadence remains 20 Hz
  through `fireRate`.

The remaining exit gate is subjective but important: tune in live maps until
the effect feels extravagant without covering the crosshair or target.

### 8.5 World effect — implemented, multiplayer tuning pending

- All visible remote primaries share the simplified thin-instanced world beam
  and impact batches.
- Authoritative server endpoints and contact classes supply damage truth.
- Each client generates its own harmless electrical variation.
- The start follows the live hand-attached `tag_flash`; weapon-root and eye
  fallbacks cover late/incomplete model state.
- Capacity is bounded at 32 retained remote samples with deterministic stale
  release and least-recently-touched eviction.

The remaining exit gate is a manual two-client check under motion, packet loss,
teleport, death, disconnect, and a realistic 16-beam firefight. Decorative
equality with the shooter is explicitly not required.

### 8.6 Chain and final polish

Real damage chains already use the fixed instanced arc batch and actual target
endpoints, visually distinct from decorative terminal forks. Real-map tuning
must still decide whether any dynamic endpoint light earns its shading cost;
the current effect deliberately spends no new light or particle budget.

### 8.7 Prewarm, fallback, and deletion — implemented

Hero, instanced world, impact, and chain shader variants are prewarmed. The old
local and remote tapered-cylinder beam paths are deleted. Tests cover retained
resource counts, instance activation, timeouts, eviction, release, and cleanup.
Unrelated tracer, pellet, and bolt effects remain on their existing paths.

### 8.8 Work-order boundaries

The prepared `0.9.20-voltaic-beams` branch is the correct integration line.
Architecture, identity, protocol, and retained rendering are implemented; the
next review should remain effect-focused: playtest silhouette, start/end scale,
bloom behavior, target visibility, and remote attachment. Do not expand this
into a general VFX framework or another protocol redesign.

The reviewed endpoint mismatch justified one deliberately narrow protocol
addition: `voltaic_beam`. It transmits only the damage-bearing truth spine and
contact classification. Electrical paths, forks, pulses, widths, timing, and
hero/world quality remain independent client presentation and consume no
network bandwidth.

### 8.9 Validation record and required regression

The current implementation passed:

- real WebGL2 shader compilation for hero, world, expanded impact/spark, and
  chain variants;
- actual production GLB load with a finite authored `tag_flash`;
- `pnpm typecheck`;
- `npm run build`;
- `npm run test:run`: 127 files and 1432 tests;
- `npm run test:simulation` and `npm run test:physics`;
- `npm run server:tick` deterministic checksum comparison;
- `npm run server:fuzz -- -- --ticks 1000`: zero errors and matching replay
  checksum;
- headless `wdm2` BSP load and information dump;
- a valid 120-tick headless `sim replay W+JUMP 120` run.

Known harness noise is unrelated to this effect: `test:physics` retains its
existing StepSlideMove Y-position warning while exiting successfully; the
headless shell reports missing `public/engine.json` but continues with the
explicit `GAME_PATH`; and its documented compound semicolon replay still treats
later input segments as commands. The single-sequence replay above verifies the
simulation path without that parser limitation.

Renderer/network edits remain high-risk under `AGENTS.md`. After every further
change, rerun:

```bash
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- -- --ticks 1000
npm run cli:game -- -- --exec 'bsp load wdm2; bsp info; quit'
```

Also run the verified repository scripts:

```bash
pnpm typecheck
npm run test:run
npm run build
```

Targeted tests should cover:

- pool acquire, update, release, reuse, and scene disposal;
- immutable vertex/index buffers across sustained updates;
- finite output for zero-length, vertical, and camera-aligned beams;
- stable electrical state for the same local seed/time;
- correct hero/world quality selection;
- remote timeout and entity cleanup;
- no mesh/material count growth over repeated firing cycles;
- shader compilation in real WebGL2, not only `NullEngine`;
- context restoration and first-fire prewarm behavior.

---

## 9. Why this can beat the classics

The goal is not to claim victory through polygon count. The proposed effect
combines properties that older classic implementations rarely had at once:

| Quality | Classic lightning beam | Classic laser ribbon | Voltaic Rift target |
|---|---|---|---|
| Instant hitscan readability | strong | strong | invariant truth spine |
| Distinct moving silhouette | moderate | restrained | snapping multi-stream rupture |
| Contact as visual centerpiece | limited/secondary | compact | full procedural impact storm |
| First-person hero direction | limited | generally shared | deliberately maximal |
| Simplified remote direction | renderer-dependent | renderer-dependent | designed profile and LOD |
| Bright-background treatment | texture/blend dependent | material dependent | analytic edge plus tested blend |
| Sustained CPU transforms | implementation dependent | often ribbon updates | fixed topology, uniforms only |
| External visual assets | commonly yes | commonly yes | none |
| Client-identical decoration required | no | no | explicitly no |

The actual competitive advantage is composition:

1. The straight spine makes it more trustworthy than a wildly bent bolt.
2. The snapping silhouette gives it more life than a tiled ribbon.
3. The complementary pressure scar gives it a recognizable color structure.
4. The endpoint storm makes maintained contact feel consequential.
5. Hero/world profiles spend spectacle where it matters instead of multiplying
   cost for every observer.
6. Fixed GPU topology makes all of that cheaper than the current primitive.

If any one of those is weak, adding particles will not save the effect. If all
six are strong, the effect can be both cleaner and more spectacular than the
reference weapons.

---

## 10. Risks and spike questions

### 10.1 Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Multi-strip joints crack | medium | averaged normals, clamped miters, corona overlap |
| Lightning looks too smooth | high | unsmoothed value noise and discrete state snaps |
| Lightning looks like random scribble | high | dominant hierarchy, two frequency bands, pinned envelopes |
| Hero effect obscures aim | high | narrow muzzle zone, projected caps, bloom-max testing |
| Additive beam disappears on white | high | compare premultiplied output; retain chromatic edge |
| Premultiplied remote beams sort imperfectly | low/medium | accept rare overlap or select additive world variant |
| Sheath consumes fill rate | medium/high | tight strip, projected-width clamp, first LOD dial |
| Impact hides a player | high | hard projected radius cap and player-specific compact profile |
| Decorative fork implies damage | high | short, dim, unattached; real chains always brighter |
| Remote endpoint remains implausible | high | supplied end or one-shot local BSP trace before max range |
| Remote beam detaches from weapon | high | render-frame interpolated muzzle with fallbacks |
| Near-parallel view creates NaN/explosion | high | camera-right fallback, finite guards, near-plane tests |
| Custom shader hitches on first use | medium | prewarm every selected variant |
| Mobile fragment cost is high | medium | vertex noise, core-only fallback, narrow world LOD |
| Too many variants become maintenance burden | medium | three compiled profiles only |
| Point light causes map shader churn | high | off by default, cap and prewarm if accepted |

### 10.2 Questions only the visual spike can answer

1. Does the multi-strip beat the analytic quad on both appearance and GPU time
   in SHAG's actual maps?
2. Is 28–32 dominant-stream nodes enough at 850 units without looking coarse?
3. Which blend mode survives near-white surfaces while keeping satisfying HDR
   bloom?
4. How large can the hero sheath become before it competes with the reticle?
5. Is 18, 20, 22, or 24 Hz the strongest snap cadence at both 30 and 144 FPS?
6. Does the previous-state ghost improve violence or merely add clutter?
7. Can one folded angular impact shader create a crown that does not resemble a
   flat sprite?
8. Does the violet pressure edge read as torn air or as unrelated neon?
9. At what projected size should the world profile collapse to core-only?
10. Does premultiplied world batching produce visible ordering artifacts in a
    realistic 8–16 player firefight?
11. Is a dynamic impact light worth its material and shading cost after the
    shader-only effect is complete?

These are the top areas to improve through direct iteration. Further protocol
or simulation design will not answer them.

---

## 11. Final recommendation

Ship Voltaic Rift as one fixed GPU-deformed multi-strip beam plus one procedural
storm mesh. Keep a surgically straight white-hot hitscan spine as the only
damage-bearing visual truth. Around it, let the first-person hero profile snap
three angular gold streams, one previous-state ghost, four short terminal
forks, and a blue-violet pressure scar, with maximum chaos in the final third.
Use the second draw for both the oversized muzzle tingle/sparks and the violent
contact storm. Give other clients a deliberately simplified world profile
using the same spine and identity but independently generated decoration.
Attach both views to the model's live authored muzzle and stop at authoritative
truth where available; exact fork parity is intentionally irrelevant. Generate
noise in the vertex shader over immutable topology, keep fragment work to
antialiased analytic falloffs, and thin-instance world effects.

That is the best current route to an effect that is more spectacular than the
classic beams, more accurate than the current Voltaic, and cheaper to sustain.

---

## 12. Sources

### 12.1 Repository sources inspected

- `AGENTS.md`
- `package.json`
- `src/engine/weapon/HitscanEffects.ts`
- `src/engine/weapon/WeaponViewManager.ts`
- `src/engine/weapon/EffectPreloader.ts`
- `src/games/fps/client/GameEvents.ts`
- `src/games/fps/client/RemotePlayerRenderer.ts`
- `src/games/fps/client/DemoService.ts`
- `src/games/fps/server/systems/WeaponSystem.ts`
- `src/games/fps/server/SnapshotBuilder.ts`
- `src/engine/network/core/SnapshotEvent.ts`
- `src/shared/net/BinaryProtocol.ts`
- `src/shared/entities/definitions/weapons/voltaic.ts`
- `src/engine/effects/PostProcessingManager.ts`
- `src/engine/loader/shader/GlowOverlayShaderMaterial.ts`
- installed Babylon.js GreasedLine and thin-instance source/type declarations
- `docs/manual/guides/weapon-system.md`
- `docs/manual/guides/networking.md`
- `docs/manual/guides/shader-system.md`
- `docs/research/v0.9.16-weapon-system-overhaul.md`

The manifest permits `@babylonjs/core` through `^8.44.1`; the installed package
audited during this research is 8.56.0.

### 12.2 External primary and official sources

- [Babylon.js ShaderMaterial API](https://doc.babylonjs.com/typedoc/classes/BABYLON.ShaderMaterial)
- [Babylon.js VertexData API](https://doc.babylonjs.com/typedoc/classes/BABYLON.VertexData)
- [Babylon.js instances and custom buffers](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances/)
- [Babylon.js blend modes](https://doc.babylonjs.com/features/featuresDeepDive/materials/using/blendModes/)
- [Babylon.js GreasedLine](https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/param/greased_line)
- [Babylon.js WebGL2 support](https://doc.babylonjs.com/setup/support/webGL2)
- [Khronos OpenGL ES Shading Language specification](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html)
- [id Software Quake III Arena source](https://github.com/id-Software/Quake-III-Arena)
- [Quake III weapon effect code](https://github.com/id-Software/Quake-III-Arena/blob/master/code/cgame/cg_weapons.c)
- [Quake III renderer surface code](https://github.com/id-Software/Quake-III-Arena/blob/master/code/renderer/tr_surface.c)
- [Warsow qfusion source](https://github.com/Warsow/qfusion)
- [Warsow polygon effects](https://github.com/Warsow/qfusion/blob/master/source/client/cgame/polyeffectssystem.cpp)
- [Warsow tracked effects](https://github.com/Warsow/qfusion/blob/master/source/client/cgame/trackedeffectssystem.cpp)

### 12.3 Explicitly unverified

- Final tuning in representative bright, dark, and bloom-disabled SHAG maps.
- Measured GPU advantage over the analytic quad on target hardware.
- Best blend mode against SHAG's brightest maps.
- Final hero and remote projected-width constants after playtesting.
- Mobile shader performance and derivative quality.
- Whether a pooled endpoint light adds enough value to justify its cost.
- Two-client visual attachment and contact quality under packet loss.

Those are implementation-spike questions, not reasons to expand the design.
