# Weapon model tuning (v1.0.0-alpha.8)

**Started:** 2026-10-28 · **Branch:** `v1.0.0-alpha.8-weapon-model-tuning`

A list of weapon model problems found in playtesting, what causes each, and
the work orders that fix them. Each work order's state is kept up to date as
it lands.

## Work orders

| WO | Weapon | Problem | Difficulty | State |
| --- | --- | --- | --- | --- |
| WO-EB1 | Electrobolt | Swap its sight for the angled `sight_small_2` | Low (asset) | Done, awaiting playtest |
| WO-EB2 | Electrobolt | Teal glow draws as solid glass, and the outline traces it | Low–medium | Done, awaiting playtest |
| WO-PG1 | Plasma Gun | Barrel core is dark instead of glowing green | Low | Done, awaiting playtest |
| WO-PG2 | Plasma Gun | Barrels spin at one constant speed | Low | Done, awaiting playtest |
| WO-PG3 | Plasma Gun | Other players' plasma gun has no barrels | Medium | Done, awaiting playtest |
| WO-GL1 | Grenade Launcher | Barrel should spin through the whole reload | Low | Done, awaiting playtest |
| WO-GL2 | Grenade Launcher | Grenades 20% faster and 30% farther | Low (tuning) | Done, awaiting playtest |
| WO-GL3 | Grenade Launcher | Other players' launcher has no barrel | Medium (same fix as WO-PG3) | Done, awaiting playtest |
| WO-VT1 | Voltaic | Empty black channel where the barrel coils should be | Medium | Done, awaiting playtest |
| WO-MG1 | Machinegun | Unused barrel model: find where it fits; maybe eject it on reload | Medium | Done, awaiting playtest |
| WO-EB3 | Electrobolt | Ammo counter digits off the holo pane after the sight swap | Low (asset) | Done, awaiting playtest |
| WO-VT2 | Voltaic | Hipfire beam appears only after a delay | Low | Done, awaiting playtest |
| WO-VT3 | Voltaic | Beam does not always show in demos | Medium | Open |
| WO-EB4 | Electrobolt | Hipfire rail's gun end leaves the barrel | Low | Superseded by WO-EB5: the rail stays where fired |
| WO-EB5 | Electrobolt | A second beam that does not follow the muzzle while strafing | Low | Done, awaiting playtest |
| WO-DR1 | Dropped weapons | After a swap, the dropped gun later jumps to another place | Medium | Done, awaiting playtest |
| WO-DR2 | Dropped weapons | A dropped gun falls through the floor (repeatable: washoi_dm11, Voltaic and Electrobolt) | Medium | Done, awaiting playtest |

## Weapon sights

There are no separate scope models. Each sight is a mesh inside its weapon's
GLB (and IQM), made of three parts: the sight body, a holo pane
(`<weapon>/sight_display`) and an LED strip.

| Sight | Look | Used by |
| --- | --- | --- |
| `sights/sight_small` | Boxy rail sight with a side block | Machinegun, Riotgun, Grenade Launcher |
| `sights/sight_small_2` | Lower, angled, hooded at the rear | Lasergun, Plasma Gun, Rocket Launcher, Electrobolt |
| `sights/sight_01` | Large holographic sight with an ammo readout | Nothing: only its textures survive |

`sight_01` has a colour, normal, gloss and display texture set in
`z_weapons-source.pk3`, but no mesh in any GLB, IQM, MD3 or FBX in
`assets-source/` or `archive/`. Using it would mean modelling a new sight to
fit those textures.

### WO-EB1: Electrobolt sight

The Electrobolt carried `sight_small`. Its GLB now carries `sight_small_2`,
taken from the Lasergun's GLB:

- The body's vertices are copied, with their skin weights (both guns bind
  the sight to `tag_expansion`, and their joint lists match), and placed with
  the old body's rear, bottom and centre line (moved by −2.19, +0.28, 0).
- The holo pane and LED strip move down 0.25 units, so they sit on the new
  body as they do on the Lasergun.
- The material is the Lasergun's `sights/sight_small_2`, with its embedded
  colour map; packaging adds its normal and gloss maps from the source bank.

The original GLB is identical to
`archive/weapons-source-v1.0.0-alpha.4/exports/electrobolt/electrobolt.glb`.
`npm run tools:weapon-models` rebuilt `washoi_weapons.pk3`; only
`electrobolt/electrobolt.glb` and the manifest changed. The package must be
published with the release.

Open question: the aim-down-sights position (`adsOffset`) is hand-tuned per
weapon, and the holo pane is now 0.5 units lower on screen (0.25 at scale 2).
Check the sight picture while aiming.

## Plasma Gun

The Plasma Gun carries two barrel sub-models,
`plasmagun/plasmagun_barrel.glb`, side by side and counter-rotating, attached
at the gun's `tag_barrel2` bone (`plasmagun/tags.txt`). Each barrel has four
materials:

| Material | Texture | Meant to draw as |
| --- | --- | --- |
| `plasmagun_barrel` | Grey-green chamber shell | Lit surface |
| `plasmagun_barrel_plasma` | Green energy streak on black | Additive, self-lit |
| `plasmagun_barrel_halo` | Green radial glow on black | Additive, self-lit |
| `plasmagun_barrel_glass` | Flat dark green | Translucent |

### WO-PG1: dark barrel core

The IQM→GLB conversion bakes every material as an opaque, lit base texture.
`WeaponViewManager` repairs the main gun's materials by name (`_glow` and
`_emit` become self-lit, `_glass` translucent), but `WeaponBarrels` loads the
barrels with plain lit PBR, and their glow layers are named `_plasma` and
`_halo`, which no rule matches. The plasma streak and halo draw as dark lit
paint with black bands, and the opaque glass shell hides the core.

Fix: `prepareBarrelMaterials` in `WeaponBarrels.ts`, one material rule for
barrel sub-models. `_plasma`, `_halo`, `_glow` and `_emit` layers draw
additive and self-lit (the black drops out); `_glass` draws translucent at
0.35. The first-person view (`WeaponBarrels`), dropped weapons
(`DroppedWeaponRenderer`) and map pickups (`FPSPickup`) apply it to the barrel
source before cloning it; other players' guns will use it with WO-PG3.
Checked in the browser on WebGPU and WebGL2: the opaque dark glass hid the
core entirely; now three green plasma streaks glow through it.

### WO-PG2: barrel spin

`WeaponBarrels.update` turns every barrel at its constant `spinSpeed`
(4 rad/s for the Plasma Gun), firing or not.

Wanted:

- slower when idle;
- about twice the current speed while firing;
- after the last shot, ease from the firing speed down to idle over about
  1.5 s.

Done: a barrel definition takes `firingSpinSpeed` and `spinDownSeconds`
beside its idle `spinSpeed`. Each shot holds the barrel at firing speed for
1.5 refire intervals; it reaches that speed in 0.15 s and, after the last
shot, slows evenly back to idle. The Plasma Gun idles at 2.6 rad/s, fires at
9.75 and winds down over 1.5 s (first 2 and 7.5; playtesting asked for 30%
faster).

### WO-PG3: no barrels on other players

`RemotePlayerRenderer.updateWeaponModel` loads only the weapon's main model.
`DroppedWeaponRenderer` loads and attaches the barrels, which is why a
dropped Plasma Gun shows them. Other players' guns need the same attachment,
with the WO-PG1 materials.

Done: `attachWorldBarrels` (in `WeaponBarrels.ts`) finds the barrel mount
(`tags.txt`, the GLB's `tag_barrel` socket or the bone), loads each barrel
and places it on the weapon; `loadBarrelSource` loads one with the WO-PG1
materials. Dropped weapons and map pickups used two copies of this code; now
they, other players' guns (`RemotePlayerRenderer`) and the winner showcase
all use the shared functions. Barrels on world models do not spin. Checked in
the browser on WebGPU and WebGL2 with the showcase path: a held Plasma Gun
shows both glowing chambers, a held Grenade Launcher its drum.

## Grenade Launcher

The launcher's barrel is a sub-model that turns one 45° step per shot
(`fireStepDegrees`).

- **WO-GL1:** spin the barrel through the whole reload, as if loading the
  next shell. The launcher has no magazine (`reloadModel: "pool"`); its
  reload is the 800 ms refire interval. Done: a stepped barrel's turn now
  lasts the refire interval, eased in and out, and the launcher turns 405°
  (a full revolution and one 45° step) per shot.
- **WO-GL2:** grenades fly 20% faster and travel 30% farther. Speed and
  range are separate: range also depends on gravity and the fuse. An aimed
  arc reaches speed² / gravity and a grenade covers speed × fuse before it
  bursts, so: speed 900 → 1080, gravity 1.05 → 1.163 (×800 base: 840 →
  930 u/s²), fuse 1.5 → 1.625 s. Both distances grow 30%; a 45° throw in the
  open goes 1234 units before the fuse instead of 949. Bots read speed and
  gravity from the weapon definition, so their aim follows.
- **WO-GL3:** other players' launcher shows no barrel; same cause and fix as
  WO-PG3.

## Electrobolt glow (WO-EB2)

In Warsow the teal parts along the barrel were a gradient glow (a halo
shining out of the weapon), not solid glass. The view model's `_glow`/`_emit`
rule draws them self-lit at alpha 0.5 over a teal tint, which reads as a
solid teal slab, and the player-weapon outline traces their edges. Fix: draw
the gradient additively (black drops out, as on the Plasma Gun barrel) and
keep these meshes out of the outline.

Done. `electrobolt_glow` is a 512×128 teal gradient fading to black, a halo;
`electrobolt_emit` is solid teal (32×32), a strip. The view model now draws
`_glow` materials as added light (`drawAsAddedLight`, shared with the barrel
rule) and keeps `_emit` self-lit as before; `applyWeaponOutlines` skips
meshes that draw added light. Weapons drawn in the world (map pickups through
the engine's `Pickup`, dropped weapons, other players' guns and the winner
showcase) drew the glow's black opaque, a black slab along a dropped
Electrobolt's barrel; `prepareWorldWeaponMaterials` now gives their `_glow`
materials the same added-light treatment. The only other `_glow` is the Lasergun's
(Voltaic): a bright energy band on dark blue rather than black, which now
adds over its glass tube and so reads brighter. Of the view model's other rules,
world weapons take only this one.

## Voltaic barrel (WO-VT1)

Between the copper brackets along the Voltaic's barrel there was an empty
black channel.

The Voltaic ships the Lasergun model: `config/weapon-models.json` packs
`lasergun/lasergun.glb` as `voltaic/voltaic.glb`. (The
`exports/voltaic/voltaic.glb` beside it is an unrelated "Cyborg Weapon" model
that nothing ships.) There is no separate barrel file. The channel is filled by
three parts of the gun itself: the glass tube (`lasergun_glass`, 58 vertices),
an emit strip (`lasergun_emit.001`, 40) and a glow plane (`lasergun_glow`, 32).
Those three carried zero skin weights, while every other part is bound fully
to `tag_expansion`. Blender draws unweighted vertices at rest, but GPU skinning
multiplies each vertex by its weights, so in the game the three parts
collapsed to a point and vanished.

Fix (asset): those 130 vertices are bound to `tag_expansion` with full weight,
like the rest of the gun. The original GLB is identical to the archived
alpha.4 copy. `washoi_weapons.pk3` was rebuilt: `voltaic/voltaic.glb` changed.
Checked in the browser (WebGPU, held gun): a teal energy tube fills the
channel. The view model draws the glass translucent and the emit/glow strips
self-lit through `WeaponViewManager`'s name rules.

## Machinegun barrel (WO-MG1)

`machinegun/machinegun_barrel.glb` ships in `washoi_weapons.pk3`, but the
Machinegun's definition lists no barrels, so nothing loads it. It is one mesh
in the gun's own `machinegun` material, about 6.2 × 1.1 × 5.2 units, at
x 7.1–13.3, y 5.7–6.8 in gun space, with a `barrel` node.
`machinegun.cfg` has `barrel 100 0` (a barrel with rotation speed 0: it
never spun in Warsow). Next: render it in place on the gun to see what part
it is. If it is a removable part, the reload could throw it off screen,
spinning in a random direction.

Rendered in place (Blender, both GLBs share gun space): it is not a barrel or
a magazine but the bolt, a flat slab in the receiver's side port with a small
bent charging lever behind it. The magazine is part of the main mesh. With
Warsow's rotation speed 0, it was most likely meant to slide back and forth
with each shot.

Done (the user chose the slide): the Machinegun lists the bolt as a barrel
sub-model with `slideDistance: 1.5`. A barrel with a slide distance moves
back along its axis and returns: on each shot within the refire interval (at
most 0.1 s: a 30% snap back, then an eased return), and once while
reloading, racked over 0.35 s starting 45% into the reload
(`WeaponBarrels.reload`, called from `WeaponViewManager.startReload`). On
other players' guns and pickups the bolt sits still in its port. Its GLB has
a static single-key animation (`ABarrel`) and no authored motion. Checked in
the browser (held gun, bolt tinted): it sits in the receiver's side port.

## Electrobolt ammo counter (WO-EB3)

The counter's digits mount at `tag_ammo`, which sits on the holo pane (about
+0.30, +0.315 from its corner on both the Electrobolt and the Lasergun).
WO-EB1 moved the pane down 0.25 but not the tag, so the digits floated off
it. The swap now moves `tag_ammo` (and the digit tags under it) with the
pane: 9.686 → 9.436 in y.

## Voltaic hipfire beam (WO-VT2)

Fired from the hip, the local beam was drawn only after a 0.25 s
presentation "charge" in `FPSPlayer`, while the shots, and their damage,
started on the first frame (the server has no charge). Aimed, it drew at
once. The beam now draws from the first frame either way. The renderer and
shader add no delay of their own.

## Electrobolt rail start (WO-EB4)

The rail is drawn when the server's `electro_rail` event arrives, from the
muzzle at that moment to the server's impact, and lingers 0.55 s. Its start
stayed fixed in the world while the gun kicked and turned, most visibly from
the hip, so the gun end hung off the barrel. A rail can now carry a
`followStart` callback (`RailEffectRenderer`), which rewrites its start every
update; the local shooter's rails follow the muzzle while the same gun is
held. The shader's helix envelope is zero at the start, so the beam stays
pinned there. The end never moves.

## Electrobolt second beam (WO-EB5)

Reported after WO-EB4: two beams per shot, and while strafing only one
follows the muzzle. Checked so far: the server emits one `electro_rail`
per shot (`WeaponSystem`), the client draws one rail per event
(`handleElectroRail`, its only caller of `fireRail`), the view's `bolt` case
draws nothing, and the old `fireBolt` trail has no callers. In the browser
(washoi_dm2, a hand-fired local rail) one call drew one beam. The rail's
meshes are on the default layer only, so the weapon camera does not draw
them, and all their instance buffers are updatable.

The user's screenshots settled it: one rail whose start flickered between
the barrel and a point by the eye. `getMuzzleWorldPosition` returns a point 5
units in front of the eye on the screen ray through the muzzle, right only
for the camera it was computed with. WO-EB4 refreshed the start in the
rail's per-frame update, which can run before the first-person controller
moves the camera; a start one camera move behind, 5 units from the eye, lands
far off the barrel on screen. Refreshing the starts just before the world camera rendered fixed the
flicker, but the playtest wanted the opposite of WO-EB4: the rail should leave
the muzzle and then stay in the world where it was fired, not follow the
player. The follower is gone. `handleElectroRail` takes the start once, at
the shot, 32 units along the screen ray through the muzzle
(`getMuzzleWorldPosition(32)`), far enough from the eye that the start
stays on the barrel for the frame it was taken and out of the near plane.

## Dropped weapons (WO-DR1, WO-DR2)

Reported: after swapping for a weapon on the ground, the dropped weapon
sometimes moves to another place a while later, which looks like a leftover
client/server correction; and sometimes the dropped weapon falls through
the floor, every time with the Voltaic and the Electrobolt on washoi_dm11.

Cause: the client threw dropped weapons with its own Havok body (a convex
hull against Havok's map mesh) while the server steps each drop with the
shared item throw (`shared/items/ItemThrow`) through the BSP collision world.
They disagreed. Once the Havok body slowed below 2 units/s the client let go
of it and lerped the weapon to the server's position: the move a while after
landing (WO-DR1). Where Havok's mesh lacked a floor the server collides with,
the body fell through it and never slowed enough to be corrected (WO-DR2).

Fix: the client replays the server's throw. `weapon_drop` carries the throw's
start and velocity; `DroppedWeaponRenderer` steps `stepThrownItem` from there
at the server's 1/125 s over the same collision world map pickups land
through (`SharedCollisionWorld` over the collision manager's sweep backend),
drawn between steps, every frame. The model spins, rolls and tumbles while
airborne and comes to rest flat on its nearer side at its last heading. A
weapon first seen without its drop (joined late, or more than 0.5 s after the
drop) eases to the server's position. When both have settled and the start's
network rounding left them apart, it eases onto the server's spot. Havok is
no longer used for dropped weapons.

Checked headless on washoi_dm11 with the server's collision: 5600 swap-style
throws around the seven weapon pickups. 74 left the floor they started on,
and the down-trace at each resting spot found open space above: tossed over
the edge beside the Voltaic to the lower level, not through a floor (one,
under a floor at y −192, is likely under an overhang). Two around the Rocket
Launcher never settle (wedged); not addressed. In the browser on
washoi_dm11, a throw from the Voltaic spot landed where the headless server
throw did, to the unit, and dropped guns came to rest lying on the floor.

Feel, after playtesting (the replayed throw was less lively than Havok's):
dropped weapons bounce. The shared throw takes an optional `bounce`, the
share of falling speed kept on hitting the floor (`DROPPED_WEAPON_BOUNCE`
0.35, with 70% of the horizontal speed); a landing that would rebound
slower than 90 u/s stops instead. The server and the client both pass it
for drops, so they still agree; map items pass none, so where they rest is
unchanged. The model's spin follows the throw: a bounce halves it and jolts
it a little, sliding rolls the gun with its speed while the spin dies away,
and at rest it eases onto its side over about 0.2 s. On washoi_dm11 the
headless test now finds 96 throws over the edge beside the Voltaic (the
bounce carries farther), 10 that end below the y −192 floor (over the edge,
then under its overhang) and 4 that are still creeping down a ramp by the
Rocket Launcher at 7 u/s when the 5 s budget runs out; they rest at its
foot within 10 s.

## Voltaic in demos (WO-VT3)

Reported: the Voltaic beam does not always show in demo playback. Demos
draw every beam, the recorder's own included, through the remote path
(`voltaic_beam` events into `updateRemoteLightningBeam`), not the local
hero beam, so WO-VT2 does not cover it. Not yet investigated.
