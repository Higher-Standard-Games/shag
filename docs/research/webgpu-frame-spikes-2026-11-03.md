# WebGPU frame spikes in a full duel

November 3, 2026. A dm5 duel against a bot (`washoi_dm5_duel_20261103_213207.shagdemo`,
ten minutes) had heavy frame drops in play. This note follows them from the
demo, on the owner's machine (RTX 4070 SUPER), Edge with WebGPU, snapshots on,
vsync off.

## How it was measured

- **Timeline**: the whole demo played once, every frame timed and split into
  phases (scene update, mesh selection, each camera's draw, the time between
  frames), with the snapshot frame kind and the JS heap after each frame.
- **Allocation and heap profiles**: Chrome's sampling heap profiler over 30 s
  of a fight (bytes allocated per site), and from boot with only live objects
  kept (what holds the heap).
- **GC trace**: a CDP trace with the `v8.gc` categories, which gives every
  minor and major collection with its main-thread phases.
- **Slow-frame splits**: a fight stretch (4:00 to 4:30) replayed with each
  `onBeforeRender` observer, the scene's render targets and the gaps between
  Babylon's render stages timed per frame, averaged over frames slower than
  12 ms.

## What the drops were

**Major garbage collections.** Every frame over 50 ms coincided with a heap
drop of 25 to 260 MB. The page allocated 34 MB a second, and a major
collection paused the main thread for 35 to 208 ms. A third of that pause
was V8 clearing its external string table: Babylon labels each command
encoder and render pass with the frame number (`[frameId|n] - MainRenderPass`)
and builds texture-view labels by concatenation, so every frame handed the
browser new strings, each kept as an external string until the next major
collection walked them all. After 120 s of play that walk took 75 ms.

**Explosion updates.** In fights the scene update itself took 12 to 21 ms for
a dozen frames at a time while an explosion was alive. Explosion sparks
expire every few frames, and each expiry re-uploaded the explosion layers'
instance buffers whole, sized for 96 explosions (3840 spark slots and 1152
ray slots, about 400 KB a frame): 6.75 ms per frame on average over the slow
frames, against 0.03 ms after the change.

**Smaller allocators.** The soft-particle depth pass enumerated each soft
material's mesh map with `for…in` on every camera, building a string per key
(5.3 MB/s; Babylon never deletes a key, it sets it to undefined, so the maps
only grow). World fog for effect materials built six arrays on every bind.

## Changes

- `WebGPULabels.ts`: the per-frame WebGPU calls (command encoders, render and
  compute passes, texture views) get one kept string per label text, the frame
  stamp dropped. External-string clearing went from 25–75 ms to under 8 ms per
  major collection, and a major collection after the same heap growth from
  208 ms to 57 ms (in-page A/B over 120 s).
- `ExplosionBatchRenderer`: each layer uploads only its live slots from the
  lowest one changed since the last upload; an expiry of the last slot uploads
  nothing.
- `Q3SoftParticleDepth`: the soft meshes are a list rebuilt only when a soft
  material's mesh map is written (a proxy on the map notes the writes).
- `AtmosphericFogShader`: fog values go into one reused array.

## Result

The same demo, whole, before and after:

| | Before | After |
|---|---|---|
| Average fps | 289 | 404 |
| Median frame | 3.1 ms | 2.2 ms |
| p99 frame | 16.9 ms | 8.1 ms |
| p99.9 frame | 28.2 ms | 15.9 ms |
| Frames over 25 ms | 328 | 22 |
| Frames over 50 ms | 11 | 0 |

A run between the two, with only the label and soft-particle changes, came
out slower than both (245 fps), with the owner's browser open on the same GPU;
the long frames are the reliable part of the comparison, the averages less so.

## Recordings in fights

With the spikes gone, the worst frames were recording frames (20 to 34 ms in
fights, against 2 ms for a replayed one). The controller's stops over the
whole demo, in one session so that learning carries over: 957, from 168 in the
first minute to about 75 a minute later. 545 were draw-list changes and 412
disposals (buffers, meshes, textures, materials).

- **Projectile fade-in, 161 of the draw-list changes.** A rocket or grenade
  fades in over 100 ms through its visibility; below 1 an opaque mesh draws in
  the transparent queue, so reaching 1 moved it back, a change for every shot.
  The fade now ends at 0.999. Stops over the demo fell to 771.
- **View weapon switches, most of the disposals.** Every switch disposed the
  view model (with its barrels and ammo counter) and built the next from its
  cached source: 303 view meshes and 65 ammo counters disposed over the demo.
  A switch took 10 ms and added 45 ms over the eight frames after it. The view
  now parks each weapon whole once its barrels and ammo counter have loaded,
  and the next switch to it brings it out again: 2.6 ms, and 9 ms over the
  frames after it (25 switches measured in 150 s of the demo).

The 120 plasma gun barrel meshes in the same tally were the view model's
parts (under `weapon_plasmagun`, the view's node), so the parking covers
them. Third-person guns were parked already, through a model recycler, but
third-person blades were not: every switch to the blade cloned a blade and
its grip nodes for that player. Blades now park with the guns, and the blade
slash trail (a ribbon mesh, a material and a feather texture per swing) keeps
up to four finished trails for later swings.

Tally with the view weapons parked, the fade change and the slash trails
reused (blades not yet parked): 482 stops, 106 in the first minute and about
30 a minute after the third. What remains is mostly deaths: per death the
hitbox (with its own material), the player model and its materials, a
ragdoll and its trail are disposed or created, and a respawn builds the model
again. A model creation costs 3.5 ms, and the eight frames after it peak at
15 ms and add 32 ms in all (16 creations in 180 s of the demo).

## Weapon shaders compiled in play

The full-demo run after the view weapon parking had three frames over 50 ms
again (at 2:19 and 5:34), none of them collections. Each came at a respawn:
the held view weapon compiled two PBR effects (a 45 ms frame), and half a
second later the main thread waited 130 to 180 ms in
`CommandBufferHelper::WaitForAvailableEntries` while the GPU process built
the pipelines. Diffing the defines of every effect compiled during play
against the nearest one compiled at load found two causes:

- **Clustered light defines** (`CLUSTLIGHT_SLICES 16 / CLUSTLIGHT_BATCH 32`
  in play against `0 / 0` at load). The weapons were preloaded before the
  point light pool created the gameplay light cluster; the projectile
  preparation started the pool afterwards. A weapon rebuilt at every switch
  compiled the right variant within its slow switch; a parked one compiled it
  the first time it was held. The preloader now starts the pool first.
- **Light order** (`POINTLIGHT2 DIRLIGHT3` against `DIRLIGHT2 HEMILIGHT3`).
  The muzzle-flash light was scoped to the held weapon only, so every switch
  took it from one weapon and gave it to the next. Babylon appends a light a
  mesh newly takes but lists them in scene order when it rebuilds the list,
  and the order is part of the defines. The muzzle flash now covers the parked
  weapons too (they draw nothing), and the view weapons' light lists are
  rebuilt whenever the scope is set, so they always come out in scene order.

Effects compiled during the first 5:45 of play: 7 before, none after.

## Weapons and projectiles vanishing (November 4)

Playtesting (Opera and Firefox, a live duel against a bot) showed the blade
gone for a while after switching back to it, and plasma bolts invisible until
a burst of new shots. Both come from one gap in the snapshot controller. A
recording frame forces every mesh hidden in place to draw (collapsed), except
one hidden by a disabled ancestor: forcing the ancestor on would show its
other children too. The view weapon parking disables the weapon's root, and
the projectile pool disabled each shot's node. Once such a mesh had been
learned as hidden in place, putting it away or bringing it back no longer
changed the draw-list signature, so a recording made while it was put away
kept replaying without it after it came back. The projectile fade ending at
0.999 removed the last signature change a reused shot made.

Reproduced in a paused demo with snapshots on: a plasma bolt spawned in front
of the camera, despawned into the pool, a recording forced while it is
parked, then spawned again. On the committed code the bolt drew from the
third cycle on as 0 pixels (snapshots off: about 8,000); the blade switched
away to the riot gun and back drew as 0 pixels in every cycle (off: about
12,000). With the changes below, both draw in every cycle.

- The controller lists, when a recording completes, the meshes hidden in
  place that it did not draw, and stops replaying when one of them shows
  ("unrecorded mesh shown").
- Projectile shots and pickups hide each of their meshes instead of a parent
  node, so the recording draws them collapsed and they come back without a
  new recording. View weapons still park by their root (their ammo counter
  hides digits of its own), so a switch back costs one recording.

Cost: projectiles and pickups parked in place now draw collapsed in every
replayed frame. In one session, disposing every idle shot changed the mean
frame by no more than the noise between rounds (4.38 against 4.77 ms, then
4.41 against 4.22 ms), and the committed code measured the same at the same
time (4.0 to 4.7 ms with about 585 meshes recorded). Whole-demo runs on this
machine while browsers were open drifted between 225 and 423 fps for the
same code, so no whole-demo number is given for this change.

## Player bodies kept between lives (November 4)

The remaining disposals were deaths: per life a body (rig, clips, materials)
and a hitbox outline (a line mesh with a material of its own) were disposed
and built again.  now keeps up to two bodies per player
id (, and  for the ragdoll, which
holds a body without its manager), and the renderer keeps one hitbox outline
per player. A kept body is hidden part by part, its anchor enabled, so a
recording draws it collapsed.

Babylon's ragdoll changes a body in ways a reused one must undo:
 unlinks every bone from its transform node and
 does not link them back, and our ragdoll empties the body's clip
list, renames its root mesh and makes its parts unpickable. Each body records
its bone nodes, clips, name and pickability when it is made, and release puts
them back.

Over 150 s of the dm5 demo: 9 bodies made, then every respawn reused one (12
reuses); bringing a body back took 0.8 ms against 3.5 ms for building one;
disposal stops fell from about 13 to 6 for meshes and 14 to 2 for materials;
no replayed frame left out a shown mesh (render-hook ground truth). A reused
enemy body was seen in play animating normally.

## Where the night ended

The same demo, whole, with every change above:

| | Start | End |
|---|---|---|
| Average fps | 289 | 423 |
| Median frame | 3.1 ms | 2.2 ms |
| p99 frame | 16.9 ms | 6.1 ms |
| p99.9 frame | 28.2 ms | 13.9 ms |
| Frames over 25 ms | 328 | 10 |
| Frames over 50 ms | 11 | 0 |
| Worst frame | 165 ms | 39 ms |
| Recording frames | 2716 | 779 |
| Pipelines built in play | 3 | 2 |

The worst frames left are recording frames (21 to 34 ms) and a collection or
GPU wait (39 ms). One run before this one, with the owner's machine busier,
came out at 346 fps; the long frames held in both.

## What is left

- **Recording frames** are now the worst frames: 20 to 34 ms when a fight
  changes the draw list, against 2 ms for a replayed one.
- **Player models on death and respawn** are the main source of the draw-list
  changes that remain. Parking a model instead of disposing it needs care: a
  ragdoll moves its bones with physics and switches its bounds, and a reused
  body must come back in its normal pose and bounds.
- **The snapshot controller's own update** is about 1.2 ms of a 2.9 ms replayed
  frame in a fight: rebinding the materials that change every frame
  (0.37 ms for 49 draws), the world matrices of every recorded mesh, and the
  draw-list signature (0.07 ms).
- **BSP vertices** are kept as one object and twelve small arrays per vertex
  (131,059 vertices on dm5). Releasing them shortened a forced full collection
  from 53 to 37 ms, but V8 marks concurrently, so in play they cost the
  background threads more than the pause.
- Babylon's animation interpolation (player skeletons) allocates about 2 MB/s.
