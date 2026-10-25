# Internal release record: 1.0.0-alpha5.1

Date: October 25, 2026. The owner requested the exact version
`1.0.0-alpha5.1`, merging `v1.0.0-beta-papercuts` in both repositories.
No new blogpost, public release notice or addition to the existing alpha.5
post was requested. The existing alpha6 changelog remains an empty future-cycle
stub; its shipped entries are recorded here instead of being announced again.

## Included changes

- Projectiles whose trail meshes were disposed during scene clearing retire
  before their next visual update. Their parent transforms can survive the
  clear; updating the dead ribbon previously threw and stopped rendering during
  loading. Subsequent shots also replace disposed shared trail materials.
- The remote-weapon ownership regression waits for its lazy module import
  before checking attachment, avoiding a cold-import timeout under build load.
- Credits name the soundtrack: made with Suno (Suno Premier). The Sound section
  listed only the Warfork sound packs.
- Demos and spectating show `FRAGGED <name>` for the player being followed.
  It appeared only for the local player's own frags, so a demo never showed it.

## Validation and release procedure

The final papercuts suite passed 735 files: 5,725 tests passed and one skipped.
Typechecking, Biome, the build, docs build and the five required renderer/network
regressions passed. The projectile scene-clear reproduction passed three cycles
each on real-GPU WebGL2 and WebGPU after failing with the pre-fix source. Exact
commands, the initial ownership-test timing failure and its synchronization fix
are in [the investigation](projectile-trail-lifetime-2026-10-25.md).

Both merges were fast-forwards, FPS first. FPS main is
`0759316308429c2ad36aa1e3bda1b111b22016e7`; the engine already pins that revision.
All four outer release-version fields are kept at `1.0.0-alpha5.1`.
The release receives an annotated outer tag `v1.0.0-alpha5.1`.

The release adds no media or package-format changes. Persistent `public/data`
and the regional canonical media are preserved. No asset upload is required.
The source code is unchanged since validation; release-version builds and docs
checks are run before publication. The matching FPS main is published before
engine main so regional deploy timers can resolve the recorded pair.
