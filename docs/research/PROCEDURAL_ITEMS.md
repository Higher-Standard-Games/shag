# Procedural Health and Armor Pickups

**Date:** 2026-07-20  
**Status:** Investigation and implementation plan  
**Scope:** Client-side visuals and effects for health and armor map pickups  
**Risk:** Renderer-facing, but gameplay and networking should remain unchanged  
**Out of scope:** Weapons, weapon drops, ammo, and procedural pickup placement

---

## Summary

Health and armor pickups can be generated entirely at runtime from Babylon.js
geometry, materials, and animation. Their existing MD3 models are not part of
the authoritative gameplay model: the server operates on pickup classname,
kind, position, id, active state, and grant rules. We can therefore replace only
the client visual while preserving map compatibility, pickup behavior,
respawn timing, demos, bots, and network state.

The recommended direction is a small procedural visual framework used only for
FPS health and armor:

```text
BSP entity: item_health_mega / item_armor_ra
                         |
             existing shared pickup table
                         |
          +--------------+---------------+
          |                              |
     server gameplay                 client FPSPickup
       unchanged                          |
                              +-----------+-----------+
                              |                       |
                      health / armor            weapon / ammo
                   procedural visual          current model path
```

The result should be a deterministic family of recognizable “pickup
sculptures,” not randomly generated objects. A compact recipe controls the
base symbol, tier, color, size, plate/ring count, animation cadence, and effect
intensity.

---

## Goals

- Remove the runtime dependency on health and armor MD3 models.
- Preserve all existing BSP classnames and authored pickup positions.
- Preserve the server-authoritative pickup active mask and grant rules.
- Give health and armor distinct silhouettes that remain readable without
  bloom or color alone.
- Make higher-value items look like expanded forms of the same base object.
- Include idle, collection, disappearance, and respawn effects.
- Keep visual animation separate from authoritative position and collection
  range.
- Make the implementation disposable, testable, and safe across map changes.

## Non-goals

- No procedural weapon models.
- No changes to thrown weapon Havok physics.
- No automatic generation of pickup locations.
- No randomized gameplay values or respawn timings.
- No protocol changes solely for visual effects.
- No exact client-side respawn countdown without authoritative timing data.

---

## Verified Current Architecture

### Definitions

Health and armor definitions live in
[`src/shared/entities/definitions/items.ts`](../../src/shared/entities/definitions/items.ts).
They currently provide:

- stable id and display name;
- `EntityType.HEALTH` or `EntityType.ARMOR`;
- BSP classname and aliases;
- an MD3 `modelPath`;
- scale;
- `glowColor`.

The existing families are:

| Family | Definitions |
|---|---|
| Health | small (+5), medium (+25), large (+50), mega, ultra |
| Armor | shard (+5 AP), green, yellow, red |

Gameplay amounts and caps do not come from the MD3 definitions. They are
implemented in
[`src/shared/items/ItemGrants.ts`](../../src/shared/items/ItemGrants.ts).

### Authoritative item matrix

The following names and values are taken from
[`items.ts`](../../src/shared/entities/definitions/items.ts),
[`PickupTable.ts`](../../src/shared/bsp/PickupTable.ts),
[`ItemGrants.ts`](../../src/shared/items/ItemGrants.ts), and
[`PickupSystem.ts`](../../src/games/fps/server/systems/PickupSystem.ts).

| Definition constant | Registry id | BSP classname(s) | Pickup type / kind | Authoritative benefit | Cap / special rule | First spawn | Respawn |
|---|---|---|---|---|---|---:|---:|
| `HEALTH_SMALL` | `health_small` | `item_health_small` | `health / small` | +5 HP | Caps at 100 HP | Immediate | 20 s |
| `HEALTH_MEDIUM` | `health_medium` | `item_health_medium`, alias `item_health` | `health / medium` | +25 HP | Caps at 100 HP | Immediate | 20 s |
| `HEALTH_LARGE` | `health_large` | `item_health_large` | `health / large` | +50 HP | Caps at 100 HP | Immediate | 20 s |
| `HEALTH_MEGA` | `health_mega` | `item_health_mega` | `health / mega` | +100 HP | Overheals to 200; decays 1 HP/s toward 100 | 15 s delay | 60 s |
| `HEALTH_ULTRA` | `health_ultra` | `item_health_ultra` | `health / ultra` | +100 HP | Same grant behavior as mega; overheals to 200 | 15 s delay | 60 s |
| `ARMOR_SHARD` | `armor_shard` | `item_armor_shard` | `armor / shard` | +5 AP | Caps at 100 AP | 15 s delay | 25 s |
| `ARMOR_GREEN` | `armor_ga` | `item_armor_ga` | `armor / ga` | Inserts 1 plate | Completes the next 25-AP plate boundary, cap 100 | 15 s delay | 25 s |
| `ARMOR_YELLOW` | `armor_ya` | `item_armor_ya` | `armor / ya` | Inserts 2 plates | Completes through two 25-AP plate boundaries, cap 100 | 15 s delay | 25 s |
| `ARMOR_RED` | `armor_ra` | `item_armor_ra` | `armor / ra` | Inserts 4 plates | Fills armor to 100 AP | 15 s delay | 25 s |

Armor plates are not always a flat `+25/+50/+100`. Pickup insertion completes
the current partial plate before adding subsequent plates. For example, green
armor takes 58 AP to 75 AP rather than 83 AP.

### Shared pickup identity

[`src/shared/bsp/PickupTable.ts`](../../src/shared/bsp/PickupTable.ts) maps BSP
classnames onto a pickup type and kind, converts the BSP origin into Babylon
coordinates, and assigns deterministic pickup ids in BSP order.

Both client and server derive their pickup list from this shared extractor.
Consequently, procedural visuals do not need a new network identity or a new
map entity format.

### Client creation

[`src/engine/entities/EntityManager.ts`](../../src/engine/entities/EntityManager.ts)
registers handlers for weapon, ammo, armor, and health definitions. A handled
BSP entity becomes an
[`FPSPickup`](../../src/games/fps/world/FPSPickup.ts) with:

- `type`: weapon, ammo, health, or armor;
- `value`: weapon/ammo value or definition id;
- model path, scale, and glow color;
- authoritative pickup id;
- server-managed respawn.

This is the branch point where health and armor can select a procedural visual
without changing how the map or server describes them.

### Generic pickup visual lifecycle

[`src/engine/world/Pickup.ts`](../../src/engine/world/Pickup.ts) currently owns:

- MD3/GLB loading and preloader-cache cloning;
- a single leader mesh;
- optional physics for thrown pickups;
- BSP-aware ground placement;
- active/inactive visibility;
- a per-frame observer;
- proximity checks;
- pickup audio;
- local or server-managed respawn behavior;
- cleanup.

Weapons rely on the root-level leader-mesh behavior because Havok bodies cannot
be parented beneath the pickup node. Static health and armor do not need that
physics restriction, but should still use the same activation and cleanup
contract.

### Server behavior

[`src/games/fps/server/systems/PickupSystem.ts`](../../src/games/fps/server/systems/PickupSystem.ts)
owns collection tests, grants, first-spawn delay, active state, and respawn
timing. Armor and mega/ultra health are initially delayed. Snapshot state
reconciles the corresponding client `FPSPickup` through its stable pickup id.

None of this code needs to know how a pickup is rendered.

---

## Current Visual Gaps Found During Investigation

These findings are relevant because the procedural implementation should not
build on behavior that only exists in comments:

1. `PickupOptions.bobbing` is documented, but the option is not consumed by the
   current `Pickup` update path.
2. `glowColor` is passed into pickups and `tick()` attempts to pulse
   `glowLight`, but `Pickup` never constructs that `PointLight`.
3. Health and armor currently resolve to the `ammo_pickup` sound key because
   `FPSPickup.getPickupSoundKey()` distinguishes only weapon versus non-weapon.
4. The developer command `spawn_pickable_entity` can resolve health and armor
   definitions, but `EntityManager.spawnEntityById()` currently classifies
   every non-weapon definition as ammo.
5. `Pickup.loadModel()` combines model acquisition, mesh installation, ground
   placement, physics, observer registration, and visibility reconciliation.
   Adding procedural visuals by copying or overriding this entire method would
   create two lifecycle implementations.
6. `Pickup.dispose()` force-disposes the leader mesh’s materials and textures.
   Procedural visuals cannot safely share cached materials unless their visual
   handle owns disposal or uses reference counting.

These are implementation concerns, not blockers.

---

## Proposed Visual Architecture

### Visual handle

Introduce an engine-generic visual contract that can represent either a loaded
model or a generated visual bundle:

```ts
export interface PickupVisual {
  /** Stable, non-bobbing world anchor or leader used for visibility checks. */
  root: Mesh;

  /** Cosmetic update only; must not change authoritative pickup position. */
  update(dt: number, elapsed: number): void;

  /** Toggle persistent geometry/effects to match server active state. */
  setActive(active: boolean): void;

  /** Spawn detached transient feedback, then hide the persistent visual. */
  playCollect?(): void;

  /** Play an activation/assembly transition. */
  playRespawn?(): void;

  /** Dispose meshes, materials, observers, emitters, and transient ownership. */
  dispose(): void;
}
```

The exact names may change during implementation, but the ownership boundary
should remain.

### Factory seam

`PickupOptions` can accept an optional `visualFactory`. The default factory
continues to load `modelPath`, preserving all weapon/ammo behavior. FPS health
and armor inject their procedural factory when constructed.

This is preferable to deep subclass duplication because the generic pickup
continues to own:

- ground placement;
- activation reconciliation;
- proximity;
- server-managed respawn behavior;
- observer registration;
- cleanup.

`modelPath` can initially remain as a fallback. Once the procedural family is
approved, health and armor definitions can omit it. `EntityDef.modelPath` is
already optional; `PickupOptions.modelPath` would need to become optional when
a factory is present.

### Anchor and animated root

Each procedural item should have two transform levels:

```text
authoritative pickup anchor (fixed)
└─ cosmetic visual root (bobs, rotates, scales)
   ├─ core symbol
   ├─ shell / plates
   ├─ orbiting rings or motes
   └─ aura

floor-effect root (fixed at ground)
└─ disc / rings / glyph
```

The collection check, audit position, and pickup id remain attached to the
fixed anchor. Only the cosmetic root moves. This avoids visual animation
affecting server/client position matching or perceived pickup range.

### Update ownership

The initial implementation may use the existing pickup observer. The preferred
final design is one scene-level `ProceduralPickupVisualSystem` updating all
registered visuals. This avoids one render observer per item and provides a
single place for distance-based effect quality.

Animation phase should be seeded from `pickupId`, so multiple items do not bob
and pulse in perfect synchronization. The seed is cosmetic and must not enter
server simulation.

---

## Procedural Visual Grammar

The two families share a pedestal and construction language, but must be
distinguishable by silhouette and motion.

### Chosen art direction

Proceed with the **chunky cel-shaded techno-relic** direction:

- low-poly, arena-readable silhouettes;
- dark structural geometry around a vivid emissive core;
- exaggerated but controlled animation;
- geometry-based glyphs, rings, plates, and motes;
- strong color accents with shape/count as redundant cues;
- bloom as polish rather than a readability requirement.

This is now the target direction for the prototype rather than one option among
several. It can still be tuned after the first in-map review.

### Health: energy reliquary

Base identity: a chunky three-dimensional health cross suspended inside an
energy core.

| Kind | Geometry | Motion and effects |
|---|---|---|
| Small, +5 HP | Small cross fragment or compact cross/orb | Gentle bob, faint cyan pulse, very few motes |
| Medium, +25 HP | Complete cross inside a core | One orbiting ring, clear breathing pulse |
| Large, +50 HP | Larger cross with an outer crystal shell | Two counter-rotating rings, stronger aura |
| Megahealth | Oversized cross/core with an opening four-part corona | Heartbeat pulse, satellites, periodic floor ripple, distant beacon |
| Ultra, if retained | Mega structure in an unstable alternate state | Magenta/white energy, sharper corona, faster internal orbit |

Health motion should feel organic:

- slow vertical figure-eight movement;
- subtle breathing scale, approximately `0.97` to `1.03`;
- soft heartbeat brightness;
- rising plus-shaped motes;
- outer petals that gently open and close on megahealth.

The cross remains present at every tier so health is readable at range even
when bloom is disabled.

### Armor: assembling force shield

Base identity: a hexagonal shield core surrounded by discrete protective
plates.

The visual progression can mirror the existing plate gameplay:

| Kind | Geometry | Motion and effects |
|---|---|---|
| Shard, +5 AP | Broken triangular shield fragment | Small angular oscillation, weak ground glyph |
| Green armor | One substantial shield segment | One segment orbits and periodically locks to the core |
| Yellow armor | Two opposing shield segments | Counter-motion and a visible scan sweep |
| Red armor | Four segments forming a complete shield | Segments periodically snap into a complete barrier or cage |

Armor motion should feel mechanical and defensive:

- less vertical movement than health;
- plate rotation with deliberate snap/lock moments;
- a scanning emissive band;
- a counter-rotating inner core;
- occasional geometry-based arcs between plates;
- a heavier low-frequency pulse for high-tier armor.

This communicates value using completion, size, and silhouette as well as the
traditional green/yellow/red colors:

```text
fragment -> one plate -> half shield -> complete shield
```

---

## Exact Effect Recipes

All dimensions and timings below are **initial implementation targets**, not
existing gameplay constants. They should be exposed as recipe data so they can
be tuned without rewriting geometry or lifecycle code. World dimensions use
the same Quake-scale units as map/player coordinates.

### Shared timing and motion conventions

| Effect | Initial target |
|---|---|
| Cosmetic hover origin | 12 units above the detected floor |
| Bob curve | Sine with a small lateral figure-eight for health; vertical sine only for armor |
| Animation phase | Deterministically offset by `pickupId` |
| Nearby cosmetic boost | Within 160 units: +15% emissive strength and +10% motion rate |
| Standard collection transient | 280 ms |
| High-tier collection transient | 420 ms for mega, ultra, and red armor |
| Standard respawn assembly | 450 ms |
| High-tier respawn assembly | 700 ms for mega, ultra, and red armor |
| Floor offset | 0.75-1.5 units above detected floor to avoid z-fighting |
| Far-effect reduction | Disable motes and secondary transparent layers first |

The nearby boost is visual only. It must not reuse or alter authoritative
collection tests.

### Health recipes

All health items use a three-dimensional cross built from orthogonal bars, an
inner emissive core, and blue/cyan family lighting. Value is expressed through
scale, shell completion, ring count, and pulse strength.

| Item | Core size | Rings / motes | Idle effect | Floor effect | Collection | Respawn |
|---|---:|---|---|---|---|---|
| 5 HP (`health_small`) | 14-unit fragmented cross | 0 rings / 1 rising plus mote | 2-unit bob, 2.8 s cycle; slow 18 deg/s yaw; faint 2.4 s pulse | 18-unit cyan segmented ring, 35% intensity | Fragment contracts to a point; one small ring expands and fades in 220 ms | Fragment rises from the glyph and fades in over 350 ms |
| 25 HP (`health_medium`) | 22-unit complete cross in a 24-unit core | 1 ring / 2 plus motes | 3-unit figure-eight bob, 2.4 s cycle; ring at 28 deg/s; 2.0 s breathing pulse | 26-unit cyan ring plus flattened cross glyph | Core collapses while the ring expands to 1.8x over 280 ms | Ring draws inward, then cross scales from 0.35x to 1x over 450 ms |
| 50 HP (`health_large`) | 28-unit cross in a 32-unit four-piece shell | 2 counter-rings / 4 plus motes | 4-unit bob, 2.2 s cycle; shell petals move +/-8 deg; stronger 1.8 s pulse | 34-unit double ring with outward traveling brightness | Shell opens, core flashes, two rings expand at staggered 70 ms intervals | Shell pieces rise separately and lock around the cross over 520 ms |
| Mega (`health_mega`) | 36-unit cross/core in a 46-unit corona | 3 rings / 8 motes / 4 satellites | 5-unit bob, 1.9 s cycle; double-beat emissive pulse every 1.6 s; corona opens 12 deg | 48-unit triple ring, periodic outward ripple, faint 80-unit beacon | Corona bursts outward, core implodes, floor shock ring expands to 2.2x over 420 ms | Beacon ignites first; satellites spiral in; corona and core assemble over 700 ms |
| Ultra (`health_ultra`) | Mega geometry with sharper corona | 3 tilted rings / 8 motes / 4 satellites | 5-unit bob; magenta/white alternating double beat; slightly irregular ring axes | 48-unit magenta ring with alternating clockwise/counterclockwise segments | Mega burst with a brief white center flash and magenta after-ring | Mega assembly with rings initially misaligned, then snapping into stable axes |

Suggested starting colors retain the current definitions:

| Item | Existing `glowColor` |
|---|---|
| Small | `(0.4, 0.6, 1.0)` |
| Medium | `(0.45, 0.7, 1.0)` |
| Large | `(0.5, 0.8, 1.0)` |
| Mega | `(1.0, 0.3, 0.3)` |
| Ultra | `(1.0, 0.2, 0.5)` |

Mega and ultra are structurally related, but ultra should read as an unstable
alternate state rather than merely a recolor.

### Armor recipes

All armor items use a dark hexagonal energy core, angular shield plates, and a
floor diamond. Plate count visually follows the grant model.

| Item | Core / plate size | Plates / accents | Idle effect | Floor effect | Collection | Respawn |
|---|---:|---|---|---|---|---|
| 5 AP shard (`armor_shard`) | 15-unit triangular prism fragment | 1 broken fragment / no orbit ring | 1.5-unit bob, 3.0 s cycle; +/-6 deg angular rock; faint edge scan | 18-unit broken green ring with small diamond glyph | Fragment splits into three slivers that converge and vanish in 220 ms | Three slivers rise and weld into the fragment over 350 ms |
| Green (`armor_ga`) | 24-unit hex core with one 24-unit plate | 1 plate / 1 small arc | 2-unit bob, 2.8 s cycle; plate orbits 22 deg/s and locks every 2.8 s | 28-unit green containment ring, one bright quadrant | Plate snaps to the core, core compresses, one ring contracts in 280 ms | Plate rotates up from the floor and locks onto the core over 450 ms |
| Yellow (`armor_ya`) | 28-unit hex core with two 28-unit plates | 2 opposing plates / 2 arcs | 2.5-unit bob, 2.6 s cycle; plates counter-rotate and lock every 2.4 s; vertical scan | 36-unit yellow double ring and shield-diamond glyph | Plates clap inward, emit opposing arcs, then dissolve into a contracting floor ring | Plates rise from opposite sides and lock with a bright scan over 500 ms |
| Red (`armor_ra`) | 34-unit core with four 32-unit plates | 4 plates / 4 arcs | 3-unit bob, 2.4 s cycle; complete-shield lock for 280 ms every 2.0 s; heavy 1.6 s pulse | 46-unit red four-quadrant ring, complete shield glyph, faint 80-unit beacon | Plates form a complete barrier for one frame, then burst outward as the core collapses over 420 ms | Beacon and floor quadrants activate in sequence; four plates assemble clockwise over 700 ms |

Suggested starting colors retain the current definitions:

| Item | Existing `glowColor` |
|---|---|
| Shard | `(0.3, 1.0, 0.3)` |
| Green | `(0.2, 1.0, 0.2)` |
| Yellow | `(1.0, 0.85, 0.1)` |
| Red | `(1.0, 0.2, 0.2)` |

### Geometry primitives

Prefer a small reusable primitive vocabulary:

- cross bars: merged boxes with flat-shaded normals;
- core: low-tessellation sphere or custom faceted polyhedron;
- armor core: six-sided cylinder rotated into a shield-like orientation;
- shield plates: custom extruded wedge `VertexData`;
- rings: one merged segmented-ring mesh per independently animated ring;
- floor glyphs: thin merged bars/wedges;
- motes: tiny instanced crosses or shards;
- beacon: low-alpha tapered cylinder or crossed vertical planes;
- arcs: short emissive rods following a precomputed angular path, not a
  heavyweight particle simulation.

Structural material should be dark and moderately rough. Energy material should
be emissive, slightly transparent where needed, and use the recipe color.
Outlines should come from the established scene/cel presentation rather than a
new per-item post-process.

---

## Shared Floor Effect

Both families can use a generated floor pedestal:

- a thin translucent disc just above the floor;
- one or two segmented rings;
- a central health-cross or shield glyph;
- an optional soft energy column connecting floor and item;
- an expanding ring on collection;
- inward-moving rings during respawn.

Health rings radiate outward. Armor rings rotate or contract inward.
Megahealth and red armor may receive a faint vertical beacon for arena-scale
readability.

The first implementation should use ordinary geometry instead of Babylon
surface decals:

- geometry is deterministic and textureless;
- it avoids BSP decal projection complexity;
- a small floor offset avoids z-fighting;
- cleanup is straightforward.

Open issue: a horizontal ring can clip into steep or uneven floors. If this is
visible on real maps, the ground-placement result should expose the hit normal
so the pedestal can align to the surface.

---

## Materials and Effects

### Baseline

Use modular Babylon imports and simple materials:

- `MeshBuilder` primitives or small custom `VertexData`;
- `StandardMaterial` with diffuse and emissive color;
- transparency only where it materially improves the silhouette;
- existing bloom as an enhancement, not a requirement;
- no external bitmap texture requirement.

If soft particles are later required, their mask can be generated in memory.
The first version should prefer tiny animated meshes, such as crosses, shards,
and rings, over one `ParticleSystem` per pickup.

### Avoid one dynamic light per pickup

The procedural family should not create a permanent `PointLight` for every
item. Emissive geometry plus bloom is cheaper and avoids pressure on material
light limits. A carefully capped local light could be explored for megahealth
or red armor, but it is not part of the baseline.

### Readability without post-processing

Every tier must remain recognizable when bloom is disabled:

- solid central geometry;
- different overall scale;
- ring or plate count;
- distinct family silhouette;
- color as a redundant cue rather than the only cue.

---

## Cosmetic State Machine

The visual state follows authoritative pickup activity:

### Appearing

- geometry starts near the floor pedestal;
- pieces assemble toward the core;
- emissive intensity rises;
- the idle loop begins after assembly.

### Idle

- cosmetic root bobs and rotates;
- materials pulse;
- rings, plates, and motes animate;
- ground effect remains stable.

### Nearby

- optional subtle increase in pulse or orbit energy;
- must remain cosmetic and must not imply that an unavailable server pickup is
  collectible;
- may optionally desaturate when the local player cannot benefit, provided the
  item remains clearly visible.

### Collected

- persistent core hides immediately when the authoritative state becomes
  inactive;
- a detached transient effect may continue for roughly 200–400 ms;
- health can collapse into a bright point and emit an expanding ring;
- armor plates can snap inward or fly outward before fading.

Detached ownership is important: disabling the persistent pickup root must not
prematurely kill the collection effect.

### Inactive

- persistent visual and expensive effects are disabled;
- an optional extremely faint dormant pedestal is acceptable;
- no exact countdown is shown.

### Respawning

- transition from inactive to active triggers local assembly;
- gameplay becomes active according to the server mask, independent of visual
  animation;
- late joiners should not receive misleading collection or respawn bursts.

The current active mask contains availability, not remaining respawn time.
Accurate pre-respawn telegraphing would require additional authoritative timing
or a deliberately approximate cosmetic convention.

---

## Suggested Recipe Data

A recipe can keep the family compact and make tiers parameter-driven:

```ts
type ProceduralPickupFamily = "health" | "armor";

interface ProceduralPickupRecipe {
  family: ProceduralPickupFamily;
  kind: string;
  color: { r: number; g: number; b: number };
  accentColor: { r: number; g: number; b: number };
  scale: number;

  ringCount: number;
  plateCount: number;
  moteCount: number;

  hoverHeight: number;
  bobAmplitude: number;
  bobFrequency: number;
  spinSpeed: number;
  pulseFrequency: number;

  beaconStrength: number;
  collectStyle: "collapse" | "shatter";
  respawnStyle: "assemble" | "materialize";
}
```

The recipe belongs in the FPS client visual layer. Shared entity definitions
should continue to describe gameplay identity and map compatibility, not
Babylon runtime objects or factory functions.

---

## Performance Plan

Procedural does not automatically mean cheap. Several small meshes per item can
create more draw calls than one MD3.

Baseline constraints:

- share immutable geometry where practical;
- share materials only after visual-owned disposal or reference counting is in
  place;
- merge non-moving parts of a visual;
- keep independently animated rings/plates separate;
- prefer one scene updater over one observer per item;
- disable motes and complex motion at distance;
- render only core silhouette and pedestal at far distance;
- avoid per-item dynamic lights;
- cap transparent layers to limit overdraw;
- stop all updates while a pickup is inactive.

Potential quality tiers:

| Distance/quality | Visuals |
|---|---|
| Near | Full core, plates/rings, motes, pulse, floor effect |
| Mid | Core, major plates/rings, simplified floor effect |
| Far | Emissive silhouette and optional beacon only |

Runtime-generated prototype geometry should be cached from the first
implementation. Thin instances remain optional; ordinary Babylon instances are
the initial sharing mechanism because each component still needs an independent
transform.

### Geometry cache decision

Use a hybrid model: generate each procedural recipe lazily once per Babylon
scene, then instantiate its geometry for every matching pickup.

```text
ProceduralPickupAssetCache (scene-scoped)
|
|- health_medium prototype geometry
|  |- pickup #3 instances
|  `- pickup #8 instances
|
|- armor_ya prototype geometry
|  |- pickup #5 instances
|  `- pickup #11 instances
|
`- shared primitive/prototype assets
   |- segmented rings
   |- shield plates
   `- faceted cores
```

Cache:

- composite geometry for rigid parts that always move together;
- separate prototype geometry for independently animated rings, plates, motes,
  satellites, and floor components;
- immutable structural materials where safe;
- energy-material templates;
- quality/revision variants.

Keep per pickup:

- transform hierarchy;
- seeded animation phase and lifecycle state;
- active/inactive state;
- private mutable energy materials when emissive intensity or alpha differs;
- short-lived collection/respawn transition state.

A suitable cache identity is:

```text
<registry-id>:<quality>:<recipe-revision>
health_medium:high:v1
armor_ya:high:v1
armor_ya:low:v1
```

The cache should be scene-scoped, for example through a
`WeakMap<Scene, ProceduralPickupAssetCache>`. A `WeakMap` does not dispose GPU
resources by itself, so the cache must also register scene disposal and
explicitly dispose its prototype meshes and material templates.

If map changes reuse the same Babylon scene, keep the cache alive across maps.
Individual pickups are disposed while prototype geometry remains available for
the next map. Recipe revision in the key provides deliberate invalidation
during development.

The first request for a recipe performs generation. Map pickups are created
during the loading pipeline, so lazy generation naturally prewarms everything
used by that map before play. A separate procedural preloader is unnecessary
until profiling proves otherwise.

Do not persist generated GLBs or add an IndexedDB/disk cache. The geometry is
small, recipe-driven, and cheap to rebuild once per scene. The cache exists to
avoid duplicate GPU geometry and repeated setup within a running scene, not to
turn procedural items back into authored assets.

### Cache ownership and disposal

The visual/cache ownership boundary must be explicit:

| Owner | Disposes |
|---|---|
| Individual `PickupVisual` | Instances, transforms, private mutable materials, active transient references |
| `ProceduralPickupAssetCache` | Prototype/source meshes, shared geometry, shared immutable materials and templates |
| Transient owner/pool | Detached collection rings, fragments, and temporary materials |

Current `Pickup.dispose()` force-disposes leader-mesh materials and textures via
`mesh.dispose(false, true)`. Procedural instances must not pass through that
blind disposal path: destroying one pickup could otherwise invalidate cached
resources used by every matching item. The `PickupVisual.dispose()` contract
must become the authoritative cleanup path for factory-created visuals.

Collection transients should be created on demand and self-dispose initially.
Add a small scene-level pool only if profiling shows meaningful allocation or
GC spikes during repeated pickup collection.

---

## Gameplay and Networking Impact

Expected gameplay impact: none.

The following remain authoritative and unchanged:

- BSP classname and position;
- pickup id;
- type and kind;
- grant amounts and caps;
- collection radius and eligibility;
- first-spawn delay;
- respawn timing;
- active mask;
- bot-visible pickup position;
- demos and snapshot reconciliation.

The procedural visual system reacts to active-state transitions. It does not
decide whether a pickup can be collected or when it respawns.

No generated animation transform should be written back into the shared pickup
table, server state, or network entity state.

---

## Implementation Plan

### Planned code layout

New modules:

```text
src/engine/world/
`- PickupVisual.ts                 # Generic visual handle/factory contracts

src/games/fps/world/pickups/procedural/
|- ProceduralPickupFactory.ts      # Select recipe and construct a visual
|- ProceduralPickupVisual.ts       # Runtime state, animation, transitions
|- ProceduralPickupRecipes.ts      # All tunable per-item data
|- ProceduralPickupGeometry.ts     # Cross, core, plate, ring, glyph builders
|- ProceduralPickupMaterials.ts    # Structural/energy material ownership
|- ProceduralPickupAssetCache.ts   # Scene-scoped prototype geometry/material cache
|- ProceduralPickupTransient.ts    # Detached collect/respawn one-shots
|- types.ts
`- __tests__/
   |- ProceduralPickupRecipes.test.ts
   `- ProceduralPickupVisual.test.ts
```

Expected existing files modified:

| File | Planned responsibility |
|---|---|
| `src/engine/world/Pickup.ts` | Accept/install a visual factory, drive visual updates, reconcile visibility, delegate disposal |
| `src/games/fps/world/FPSPickup.ts` | Select procedural health/armor visuals; preserve model visuals for weapon/ammo; select dedicated sound family |
| `src/engine/entities/EntityManager.ts` | Preserve health/armor type in manual spawning and pass the same definition identity used by map spawning |
| `src/shared/entities/definitions/items.ts` | Keep current colors during rollout; remove health/armor MD3 paths only after procedural mode is accepted |
| `src/games/fps/world/__tests__/FPSPickup.test.ts` | Extend active-mask and lifecycle transition coverage |
| `src/engine/world/__tests__` or `src/engine/__tests__` | Lock the generic model/procedural factory contract |

No planned changes are required in `PickupTable`, `ItemGrants`,
`PickupSystem`, snapshot encoding, or weapon physics.

### Runtime construction sequence

1. `EntityManager` resolves the existing definition and constructs
   `FPSPickup` with its stable registry id, type, color, and pickup id.
2. `FPSPickup` chooses `ProceduralPickupFactory` only for `health` and `armor`.
3. The factory resolves a recipe by registry id (`health_medium`, `armor_ya`,
   and so on).
4. Geometry builders create a fixed anchor, animated cosmetic root, floor
   root, solid structural parts, and emissive parts.
5. `Pickup` performs ground placement once, then places the cosmetic and floor
   roots without changing the authoritative pickup position.
6. The existing pickup render tick calls `visual.update(dt, elapsed)` alongside
   proximity handling. Centralizing all item updates is deferred until profiling
   shows the existing per-pickup observer is material.
7. Snapshot-mask changes call the visual's active-state transition.
8. Map cleanup calls one visual-owned `dispose()` that also owns detached
   transient cleanup.

### Initial authoritative-state rule

Server-managed procedural visuals should start hidden until their first active
mask value is known. The first reconciliation applies visibility without
playing collection or respawn effects. Only subsequent transitions animate:

```text
unknown -> active    show immediately; no respawn effect
unknown -> inactive  remain hidden; no collection effect
active  -> inactive  hide persistent visual; play world collection transient
inactive -> active   enable gameplay visual; play respawn assembly
```

This fail-closed initialization prevents delayed armor/megahealth from flashing
at match start and prevents late join from replaying historical effects. Cached
mask state must be cleared or generation-tagged on every map transition so a
new map cannot inherit ids from the previous map.

### Effect implementation strategy

- Idle motion is computed from elapsed time and seeded phase, not accumulated
  frame-by-frame rotations; this avoids drift and makes animation frame-rate
  independent.
- Persistent item geometry remains owned by the visual handle.
- Collection effects clone only the few meshes they need into a short-lived
  transient owner before the persistent root is disabled.
- Respawn animation never delays authoritative activation. The core is visible
  from the first active frame and the remaining pieces assemble around it.
- Floor geometry is placed once after ground detection. It does not bob with
  the item.
- Material intensity is animated by updating a small known material set, not by
  traversing the entire scene graph every frame.
- Prototype geometry is generated lazily and cached per scene/recipe. Pickups
  receive geometry instances plus private mutable energy materials where
  independent pulse state requires them.
- Arcs and motes are mesh effects in the first version. Babylon particle
  systems are not required for the target look.

### Phase 0: establish the visual seam

1. Add a `PickupVisual`/factory contract to the generic pickup layer.
2. Split model acquisition from common visual installation and lifecycle.
3. Preserve the current model-backed factory as the default.
4. Make `modelPath` optional only when a visual factory is supplied.
5. Route activation, update, collection feedback, and disposal through the
   visual handle.
6. Ensure map cleanup recognizes and disposes all procedural roots.
7. Do not change weapons or their Havok leader-mesh behavior.

Avoid adding more behavior to the existing virtual `loadModel()` call from the
base constructor. Prefer an explicit factory passed through options so
subclass fields are not accessed before subclass construction completes.

### Phase 1: two-item visual prototype

Implement:

- `health_medium`: cyan cross, energy core, one ring, health pedestal;
- `armor_ya`: yellow core, two shield plates, scan motion, armor pedestal.

Add a temporary visual mode such as:

```text
r_pickupProcedural 0  # MD3 fallback
r_pickupProcedural 1  # procedural health/armor
```

The exact command/cvar name should be verified against current console naming
conventions during implementation.

Fix `spawn_pickable_entity` type classification so these definitions can be
previewed directly:

```text
spawn_pickable_entity health_medium
spawn_pickable_entity armor_ya
```

### Phase 2: complete tier families

Health:

- small;
- medium;
- large;
- mega;
- ultra decision/variant.

Armor:

- shard;
- green;
- yellow;
- red.

Use recipe parameters wherever possible. Bespoke code should be reserved for
meaningful silhouette changes such as mega petals or red armor’s complete
shield lock.

### Phase 3: lifecycle polish

- collection transients;
- respawn assembly;
- seeded animation phase;
- proximity response;
- dedicated health/armor pickup sounds if assets exist;
- bloom-off readability;
- uneven-floor behavior.

### Phase 4: optimization and MD3 retirement

- profile item-heavy maps;
- merge static submeshes;
- add distance quality;
- centralize updates;
- validate cleanup across repeated map changes;
- remove health/armor `modelPath` values after the fallback is no longer needed;
- retain weapon/ammo model loading unchanged.

---

## Validation Plan

### Unit and headless tests

Add tests for:

- recipe selection for every health/armor kind;
- generated root exists and is tagged as pickup-owned;
- active/inactive transitions toggle all persistent visual components;
- collection transient survives persistent-root disable and self-disposes;
- respawn transition is not replayed on unchanged masks;
- materials, meshes, observers, and transient effects are cleaned up;
- map reload does not retain procedural visual instances;
- `spawnEntityById()` preserves health and armor type;
- weapon/ammo paths still select model-backed visuals.

Where practical, use Babylon `NullEngine` to inspect mesh/material state without
a browser.

### Required renderer/network regression commands

Because the likely implementation touches a renderer-facing pickup lifecycle,
run the project’s required regression suite:

```bash
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
```

Also run the standard headless movement smoke:

```bash
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
```

### Browser validation

Headless tests cannot judge the art or effect timing. Manually verify:

- every tier is identifiable from multiple angles and distances;
- health and armor cannot be confused;
- bloom disabled still produces a readable item;
- floor effects do not z-fight or clip badly;
- collection feedback is visible but not distracting;
- delayed armor/mega items do not flash incorrectly at map start;
- late join does not replay misleading effects;
- repeated map changes leave no meshes, observers, or materials behind;
- performance on an item-heavy map is not worse than the accepted budget.

---

## Risks and Open Questions

1. **Art direction:** chunky cel-shaded techno relic is the current preferred
   direction, but it needs an in-map prototype.
   **Decision update:** the direction is now chosen; the remaining risk is tuning its proportions, intensity, and motion in-map.
2. **Initial active-state flash:** delayed armor and megahealth may be
   constructed before the first inactive mask arrives. The procedural version
   makes any flash more noticeable; initial reconciliation should be audited.
3. **Collection event identity:** the active mask tells the client that an item
   disappeared, but not necessarily whether the local player collected it.
   World collection feedback can play on any active-to-inactive transition;
   local-only feedback must use an authoritative local-player event/state.
4. **Respawn timing:** exact countdown or pre-spawn buildup is not supported by
   the current mask alone.
5. **Floor orientation:** horizontal geometry may clip on ramps.
6. **Transparent overdraw:** layered shields, auras, and floor discs can become
   expensive.
7. **Material sharing:** current forced material disposal is incompatible with
   naive shared-material caches.
8. **PVS and cleanup:** procedural roots need the same ownership metadata and
   disposal guarantees as current pickups.
9. **Audio assets:** dedicated health and armor keys should only be wired after
   their actual asset registration is verified.
10. **Ultrahealth:** the codebase currently defines it. Decide whether it is a
    separate silhouette, a mega variant, or intentionally unsupported by maps.

---

## Decisions So Far

- Health and armor are the only procedural pickup families in scope.
- Existing BSP entities and placements remain authoritative.
- The chosen art direction is chunky cel-shaded techno relic.
- Weapons retain their current model and Havok paths.
- Health uses a cross/core visual language.
- Armor uses a shard/plate/shield completion language.
- Higher tiers add geometry and motion, not merely color.
- The authoritative pickup anchor remains fixed; only child visuals animate.
- A geometry-based floor pedestal is preferred over a projected decal for the
  first implementation.
- Emissive geometry and bloom are preferred over permanent per-item lights.
- Runtime generation is lazy-once per scene/recipe; matching pickups reuse
  cached geometry instances while keeping independent transform/material state.
- The first proof should be medium health and yellow armor.

---

## Assumptions

- Procedural generation means deterministic runtime visual construction, not
  random gameplay generation.
- Existing item classnames, grants, and timings are correct and remain in
  scope as dependencies rather than redesign targets.
- Health and armor are static map pickups, not Havok-thrown objects.
- A short-lived MD3 fallback is acceptable during development even though the
  final goal is to remove the health/armor model requirement.

## Unverified

- Final visual style in a live arena.
- Real GPU/draw-call cost of the proposed mesh counts.
- Best floor-effect behavior on irregular BSP surfaces.
- Availability of suitable dedicated health/armor pickup audio.
- Whether shipped maps use `item_health_ultra` in practice.
- Whether the active mask arrives early enough to prevent delayed-item startup
  flashes on all client load paths.

