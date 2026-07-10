# Trigger Brushes & Targets — Teleporters and Jumppads

Date: 2026-07-10
Status: T1–T4 core done — **teleporters and jumppads are live end-to-end**;
remaining: T4b (events/sounds/VFX, spawn facing) + the wdm2 browser pass
Target test map: **wdm2** (4 teleporters + 1 jumppad)

## Progress log

- **T4 CORE DONE (2026-07-10)** — wiring, both sides:
  - Server: `HeadlessMapLoader` extracts `BspData.triggers` via the shared
    table → `GameServer.setTriggerVolumes` → `FPSMovementSubsystem` installs
    into every profile (existing + created-later). Wired in
    `headless-netserver-v2` and `record-demo`. **Smoke-tested live on wdm2:
    `[Map] Found 5 trigger volumes (4 teleporters, 1 jumppads)` →
    `[GameServer] 5 trigger volumes configured`.**
  - Client: `Game.ts` map-load callback runs the SAME extraction from the
    client's parsed BSP (new `CollisionManager.getBsp()`) →
    `V2NetworkClient.setTriggerVolumes` → prediction profile. Pads and
    teleporters are now client-predicted with zero reconciliation snap by
    construction.
  - Camera: `V2NetworkClient.onTeleport(cb)` fires ONLY from the fresh-input
    prediction path (never reconciliation replays, which recompute past
    steps); `Game.ts` hooks it to the new `FPSController.setViewYaw(yaw)`
    (writes the input-handler mouse accumulator AND the camera — setting
    only the camera would snap back on the next mouse move).
  - Gates: tsc clean, 1254/1254, test:simulation, server:tick, server:fuzz.
  - **Remaining (T4b, browser-adjacent):** teleport_in/out + jumppad_launch
    snapshot events with sounds/VFX (server edge-detects off the result
    flags), spawn-facing from the spawn-point `angle` key (same camera
    plumbing — use `setViewYaw`), the `q3AngleToGameYaw` empirical sign
    check on wdm2's t2 exit, and the full wdm2/wdm7 browser pass.

- **T3 DONE (2026-07-10)** — teleporters in the shared `MovementProfile` +
  server side effects:
  - Profile: teleporter volumes evaluated BEFORE pads at the end-of-step
    position; at most one trigger fires per step (a dest inside another
    trigger chains one step per tick — no intra-tick loops, verified by
    test). Exit = `dest + 25u` waist lift; result flags `teleported`,
    `teleportYaw`, `triggerId`. `actualHorizSpeed` samples the pre-teleport
    position so the speedometer/animations don't see a 50k-ups frame.
  - **Velocity policy is a CONFIG field, not a live cvar** (deviation from
    the §3.5 plan): `MovementConfig.teleportSpeedMode` — `1` (default)
    preserves horizontal speed redirected along the exit yaw; `0` = Q3 fixed
    `teleportExitSpeed` (400). Profiles read config only, so demo re-sim
    stays exact without snapshotting cvars (avoids the F8 caveat entirely).
    Promote to a cvar later only if playtest wants runtime switching.
  - Server (`FPSMovementSubsystem`): `teleported` ticks are whitelisted from
    the `[Authority]` position-delta tripwire; fall tracking is cleared on
    teleport (a 600u fall + teleport near the floor no longer lands as a
    fatal drop — regression test); `telefragAtExit` queues 9999
    armor-piercing `DamageType.Telefrag` damage (frag credited to the
    teleporting player) for living players overlapping the exit box.
  - Tests: 8 profile (`TeleporterTrigger.test.ts` — wdm2 *1→t1 fixture,
    both speed policies, default yaw, one-trigger-per-step incl. tele→pad
    chain, no speed spike, replay idempotency), 3 subsystem (telefrag hit /
    filtered / tripwire whitelist+control), 1 fall regression. Gates: tsc
    clean, 1254/1254, test:simulation, `server:tick` checksum unchanged,
    server:fuzz pass.
  - Still needs (T4): the empirical `q3AngleToGameYaw` sign check on wdm2's
    t2 exit, client camera-yaw rotation on predicted teleport, events/VFX.

- **T2 DONE (2026-07-10)** — jumppads in the shared `MovementProfile`:
  `setTriggerVolumes(volumes)` (teleport volumes skipped until T3), AABB
  overlap at the end-of-step position with crouch-aware bounds, `jumppadLaunch`
  + `triggerId` result flags (edge-detection is the consumer's job — profile
  stays stateless), invalid pads (target not above pad) dropped at install.
  10 tests in `simulation/__tests__/JumppadTrigger.test.ts` (wdm2 mega pad
  fixture, angled pad, velocity replace, re-touch, replay-idempotency, full
  arc integration). Gates: tsc clean, 1242/1242, test:simulation,
  `server:tick` checksum **unchanged** (no volumes installed ⇒ zero behavior
  change), server:fuzz pass.
  **Design deviation from the plan (and from Q3), important:** the launch is
  solved from the **player's current position each fire**, not precomputed
  from the pad center. Testing exposed why: the pad re-fires every tick while
  the player is inside the 16u volume (~5 ticks), and Q3-style fixed velocity
  accumulated the re-fires into a **+28u apex overshoot** (331 vs 304 on the
  wdm2 pad). Q3 suppresses this with `ps->jumppadEnt` contact state — but
  per-pad contact state is a reconciliation-replay hazard (stale flag on the
  first replayed step ⇒ suppressed/doubled launch). Per-position solving is
  stateless AND convergent: every re-fire re-aims at the target, the last
  fire wins, and the apex lands ON dest (±Euler discretization; asserted
  312±8 in the arc test). Side effect: entry point inside the pad no longer
  offsets the landing — everyone lands on target (slightly "tighter" than
  Q3; watch it in the browser pass).

- **T1 DONE (2026-07-10)** — `src/shared/bsp/TriggerTable.ts`
  (`extractTriggerVolumes` + `q3AngleToGameYaw`) + 11 tests in
  `src/shared/bsp/__tests__/TriggerTable.test.ts` using the real wdm2
  records as fixtures (all 5 volumes, Babylon swap with min<max preserved,
  dest resolution + yaw, dead-vertical pad geometry check, fail-closed drops,
  determinism). Deviation from plan: the spawn-`angle` fix was **deferred to
  T4** — spawn facing needs the same client camera-yaw plumbing as teleport
  exits (yaw is client-authoritative input), so it lands with that wiring
  instead of as a dead field. `q3AngleToGameYaw` still needs the empirical
  sign check on wdm2's t2 exit (flagged in the code).

## TL;DR

Teleporters and jumppads are **brush-entity triggers** already present in our
Warsow BSPs — we parse everything needed today and simply never consume it.
The classnames are (ground truth, dumped from the actual PK3s — the triggers do
**not** carry a `misc_` prefix, that was the right suspicion):

| Role | Trigger (brush volume) | Target (point) | Link |
| --- | --- | --- | --- |
| Teleporter | `trigger_teleport` (`model "*N"`, `target "tX"`) | `misc_teleporter_dest` (`targetname`, `origin`, `angle`) | `target` → `targetname` |
| Jumppad | `trigger_push` (`model "*N"`, `target "X"`) | `target_position` (`targetname`, `origin`) | `target` → `targetname` |

Plan: a shared `TriggerTable` extractor (same pattern as `PickupTable`), trigger
evaluation **inside the shared `MovementProfile`** so both server sim and client
prediction apply identical, replay-idempotent results (the lesson of the
slide-timing and blade-dash B1 bugs), Q3's `AimAtTarget` ballistic solve for pad
velocity, and server-only side effects (telefrag, events) driven by result flags.

---

## 1. Ground truth from the BSPs

Dumped with a scratchpad script (jszip + entities lump = lump 0, plain text;
models lump = lump 7). Our maps are **FBSP v1** (qfusion); lump indices for
entities/models match IBSP.

### wdm2 (the target test map)

```
4× trigger_teleport      4× misc_teleporter_dest
1× trigger_push          1× target_position used as pad target
71× target_position      (all but one are bot/nav hints — only the one
                          referenced by a trigger_push "target" matters)
4× misc_portal_camera/surface   (mirror/portal visuals — out of scope)
```

The actual entities (full records):

```json
{"model":"*1","target":"t1","classname":"trigger_teleport"}
{"targetname":"t1","origin":"-784 -192 424","angle":"-1.4e-014","classname":"misc_teleporter_dest"}
{"model":"*2","target":"t4","classname":"trigger_teleport"}
{"targetname":"t4","origin":"-920 -192 232","classname":"misc_teleporter_dest"}
{"model":"*4","target":"t6","classname":"trigger_teleport"}
{"targetname":"t6","origin":"112 560 424","angle":"180","classname":"misc_teleporter_dest"}
{"model":"*5","target":"t2","classname":"trigger_teleport"}
{"targetname":"t2","origin":"752 240 424","angle":"-90","classname":"misc_teleporter_dest"}

{"model":"*3","target":"jump-mega1","classname":"trigger_push"}
{"targetname":"jump-mega1","origin":"16 -912 312","angle":"90","classname":"target_position"}
```

Key structural facts:

- **Triggers have no `origin`.** They are brush models: `model "*N"` references
  BSP submodel N. The trigger volume is that submodel's brushes.
- Submodel AABBs come straight from the models lump (Q3 coords):

```
*1  mins(-1032,-272,208)  maxs(-992,-112,384)   teleporter → t1
*2  mins(-816,  40,400)   maxs(-624,  64,576)   teleporter → t4
*3  mins( -48,-976,  0)   maxs(  80,-848, 16)   JUMPPAD    → jump-mega1
*4  mins(-488, 262,144)   maxs(-358, 392,320)   teleporter → t6
*5  mins( 656, 224, 32)   maxs( 848, 232,208)   teleporter → t2
```

  All are axis-aligned boxes (trigger brushes practically always are).
- `misc_teleporter_dest.angle` = exit yaw in degrees (Q3 convention, 0 = +X).
- The wdm2 jumppad is **dead-vertical**: pad center (16,-912,8) → target
  (16,-912,312), i.e. height 304u, zero horizontal travel. Ideal first test.

### wdm7 (secondary)

4× `trigger_push`, 0 teleporters, 4× `func_door`, 40× nav `target_position`.
Good second map for pads with horizontal travel.

---

## 2. What the codebase already has

| Piece | Where | State |
| --- | --- | --- |
| Entities lump parse | `src/engine/loader/bsp/BspLoader.ts` (`parseEntities`) | ✅ done — `bsp.entities: {classname, properties}[]` |
| Models lump parse | same, `parseModels` → `BspModel {mins, maxs, firstBrush, numBrushes}` | ✅ done |
| Shared entity-extraction pattern | `src/shared/bsp/PickupTable.ts` (`extractPickups`) — BSP-order ids, Q3→Babylon swap `{x, y:z, z:y}`, deterministic on both sides | ✅ the template to copy |
| Server map load | `src/cli/HeadlessMapLoader.ts` (`loadBspCollision`) → `GameServer.setSpawnPoints/setPickupItems/...` | ✅ add `triggers` here |
| Client map load | client gets the same `bsp.entities` (EntityManager/pickup path) | ✅ wiring point exists |
| Shared movement | `src/games/fps/simulation/MovementProfile.simulate(pos, vel, input, dt, collision)`, seq-derived `simNowMs`, used by `FPSMovementSubsystem` (server, per tick) AND `V2NetworkClient` (prediction + reconciliation replay) | ✅ the right injection point |
| Trigger contents flag | `src/engine/physics/ContentFlags.ts` → `TRIGGER = 0x40000000` | ✅ defined, unused |
| Trigger handling anywhere | — | ❌ **zero references** to trigger_push / trigger_teleport / jumppad in the entire repo |

Collision notes (verified by reading `SweepCollisionBackend`):

- Traces walk the **world leaf tree** with mask `SOLID | PLAYERCLIP`. Submodel
  brushes (`*1`…) are only reachable via `model.firstBrush`, not via world
  leaves — so trigger volumes are invisible to the current tracer. Players
  don't collide with them (correct), but there is also **no existing "am I
  inside trigger X" query**. We add one (AABB overlap — see §3.2).
- Client renders nothing for these entities (`BspEntityHandlers` registry only
  handles `func_door`; unhandled classnames are skipped). Trigger brushes must
  stay invisible — no renderer change needed.

---

## 3. Design

### 3.1 Shared TriggerTable (`src/shared/bsp/TriggerTable.ts`)

Mirror `PickupTable` exactly: a pure, deterministic extractor both sides run on
the same BSP entity + model arrays.

```ts
export interface TriggerVolume {
  id: number;                      // BSP order — stable both sides
  type: "teleport" | "push";
  // Babylon-space AABB of the trigger submodel (Q3 mins/maxs, Y↔Z swapped)
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  // Resolved destination (teleport: dest origin+angle; push: target_position)
  dest: { x: number; y: number; z: number };
  /** Exit yaw in game radians (teleport only; from misc_teleporter_dest.angle) */
  destYaw?: number;
}

export function extractTriggerVolumes(
  entities: Array<{ classname: string; properties: Record<string, string> }>,
  models: Array<{ mins: [number,number,number]; maxs: [number,number,number] }>,
): TriggerVolume[];
```

Extraction rules:

- Keep `trigger_teleport` / `trigger_push` with a parseable `model "*N"` and a
  `target` that resolves to a `misc_teleporter_dest` / `target_position`
  (also accept `info_notnull` and `misc_teleporter_dest` as push targets —
  Q3 allows both). Unresolved targets: warn + drop (fail closed, like pickups).
- Coord swap everything at extraction (`{x, y: z, z: y}` for origins AND for
  model mins/maxs — note swapping min/max Y↔Z keeps min<max because it's a
  per-axis relabel).
- `destYaw`: convert Q3 degrees → our yaw convention. **Verify empirically**
  with wdm2's `t2` (angle −90) exit during implementation — the conversion is
  `gameYaw = π/2 − radians(q3Angle)` by coordinate algebra (Q3 dir
  `(cosθ, sinθ, 0)` → Babylon `(cosθ, 0, sinθ)`; our yaw dir is
  `(sin(yaw), 0, cos(yaw))`), but one sign error here sends players backwards,
  so test it, don't trust it. (Related existing gap: spawn points ignore
  `angle` too — `HeadlessMapLoader` never reads it. Fix while we're here.)

### 3.2 Volume test

Player AABB (radius 16, −24/+40 around origin — `PlayerPhysicsConstants`)
overlap vs trigger AABB, in Babylon coords. Six comparisons per trigger; wdm2
has 5 triggers → trivial cost, no spatial index needed. Brush-accurate testing
(plane-eval against `model.firstBrush` sides, contents `TRIGGER`) is a later
upgrade if a map ever ships a non-box trigger; the AABBs above show wdm2 doesn't
need it.

### 3.3 Where it runs: inside `MovementProfile` (the critical decision)

Evaluate triggers **in the shared profile**, at the end of `simulate()` after
position integration, given a static `TriggerVolume[]` set once at map load:

```ts
profile.setTriggerVolumes(volumes);   // server: FPSMovementSubsystem per entity
                                      // client: V2NetworkClient after map load
```

Why this altitude and not a server subsystem:

- **Prediction & reconciliation.** Client prediction replays unacked inputs
  through the same profile. If the server alone applied pad velocity or a
  teleport, every replay would diverge until acked — the exact class of bug as
  the crouch-slide timing issue (fixed by seq-derived clocks) and the known
  blade-dash B1 snap. In the profile, both sides compute identical results;
  jumppads and teleports become **snap-free and replay-idempotent for free**.
- **Determinism / re-sim.** The anti-cheat re-sim oracle (`ReSim`, `demo:verify`)
  replays recorded usercmds through the profile. Server-side-only triggers would
  make re-sim diverge on every pad/teleport tick. In-profile + table-in-bundle
  keeps the oracle exact. (Add the trigger table to re-sim bundle inputs, like
  the movement config.)
- It's a pure function of (position, static table) — no wall-clock, no RNG:
  safe for `server:tick` / `server:fuzz` checksums.

The profile result gains two flags (like `isSliding` / `wallJumpState`):

```ts
interface AdvancedMovementResult {
  // ...existing...
  teleported?: boolean;      // teleport applied this step
  jumppadLaunch?: boolean;   // pad velocity applied this step (rising edge)
}
```

**Server-only side effects** key off the flags in `FPSMovementSubsystem`:
telefrag (queue `CombatSystem` damage for players overlapping the exit),
one-shot snapshot events for sound/VFX (`teleport_out`/`teleport_in`/
`jumppad_launch` — same pattern as `weapon_chain`). The shared profile never
touches other entities or emits events.

### 3.4 Jumppad math (Q3 `AimAtTarget`, adapted — see T2 progress note)

```
origin  = PLAYER position at fire time      (≈ pad surface; Q3 uses the pad center)
height  = target.y − origin.y               (≈ 304 on the wdm2 pad)
time    = sqrt(height / (0.5 · gravity))    (gravity = MovementConfig.gravity = 1000 → ≈ 0.78 s)
v_xz    = (target.xz − origin.xz) / time    (wdm2 pad: ≈ 0 — dead vertical)
v_y     = gravity · time                    (≈ 780 ups)
```

- Velocity is **replaced**, not added (Q3 behavior).
- **Per-position, per-fire solve** (deviation from Q3's precomputed fixed
  velocity): the pad re-fires every tick the player is still inside the
  volume; with a fixed velocity those re-fires accumulate into an apex
  overshoot (+28u measured on the wdm2 pad). Q3 counters with `ps->jumppadEnt`
  contact state — a replay hazard for us. Re-aiming from the current position
  each fire is stateless and convergent: the last fire inside the volume wins
  and the arc lands ON the target.
- `height ≤ 0` → invalid pad: dropped at `setTriggerVolumes` (center check)
  and guarded per-fire (player above target ⇒ no-op).
- **Worked check for the wdm2 pad: velocity ≈ (0, 780, 0) Babylon, apex
  312±8 absolute (the mega platform) — asserted in `JumppadTrigger.test.ts`.**
- Do NOT route through `queueImpulse`/knockback — pads must not incur the
  Warsow knockback air-drag decay. (Verified: launch bypasses the KB path.)
- Q3 also holds air control briefly (`PMF_TIME_KNOCKBACK`); we skip that for
  v1 (our air control is mild) and tune after the browser pass.

### 3.5 Teleporter behavior

On overlap (guard: **max 1 teleport per simulate step** — prevents dest-inside-
another-trigger loops):

1. `position = dest + (0, PLAYER_ORIGIN_HEIGHT(24) + 1, 0)` (dest origins sit at
   floor level: t4 = 232 vs floor ~208).
2. Velocity policy (cvar `sv_teleport_speed_mode`):
   - `0` **Q3**: `velocity = forward(destYaw) · 400`
   - `1` **Warsow-ish (recommended for a movement game)**: keep horizontal
     speed magnitude, redirect along `destYaw`; zero vertical.
3. View yaw: the server can't force the client camera (yaw is client input).
   Because the **client predicts the teleport itself** (§3.3), the client
   rotates its own camera to `destYaw` at the moment its prediction teleports —
   no server round-trip, no fight with the input sanitizer. Remote players just
   appear at the exit (snap is natural for a teleport).
4. Server-side on the flag: telefrag any other player whose AABB overlaps the
   exit (damage 9999, `armorPiercing 1`, new `DamageType.Telefrag` → killfeed),
   emit `teleport_out` (entry pos) + `teleport_in` (exit pos) events.

### 3.6 Authority-hardening interactions (must-do, easy to forget)

- **Position-delta tripwire** (`[Authority] moved Xu in one tick`, log-only):
  will fire on every teleport. Whitelist ticks where the profile returned
  `teleported` (the subsystem sees the flag right where the tripwire runs).
- **MovementValidator / anti-warp**: advisory only today — confirm no strikes
  accrue from teleport ticks.
- **Re-sim bundles** (`ReSimBundle`): include the trigger table (or the map
  name + extractor version) so `demo:verify` reproduces trigger ticks.

---

## 4. Work orders

| WO | Task | Files | Difficulty / model | Parallel? |
| --- | --- | --- | --- | --- |
| T1 | `TriggerTable.ts` shared extractor + unit tests (fixture = the wdm2 entity/model records in §1, incl. unresolved-target and Y↔Z swap cases) + spawn-angle fix in `HeadlessMapLoader` | `src/shared/bsp/TriggerTable.ts`, `__tests__/TriggerTable.test.ts` | Low — Sonnet | yes |
| T2 | Jumppads in `MovementProfile`: `setTriggerVolumes`, AABB overlap, precomputed launch velocity, `jumppadLaunch` flag; tests (vertical wdm2 pad; a synthetic angled pad; replay-idempotency: simulate twice from same state ⇒ identical) | `src/games/fps/simulation/MovementProfile.ts` + tests | Medium — Opus (movement + determinism) | after T1 |
| T3 | Teleporters in profile (position set, velocity policy cvar, `teleported` flag, 1-per-step guard) + server side effects (telefrag, events, tripwire whitelist) | `MovementProfile.ts`, `FPSMovementSubsystem.ts`, `CombatSystem.ts` (`DamageType.Telefrag`), `MovementVars.ts` (cvar) | Medium/High — Opus | after T1 |
| T4 | Wiring + client: `HeadlessMapLoader` → `GameServer.setTriggerVolumes` → subsystem/profiles; client map-load → `V2NetworkClient`; camera-yaw rotate on predicted teleport; `teleport_in/out` + `jumppad_launch` snapshot events, sounds (check `sounds/world/` in data pk3s for Warsow tele/jumppad samples) + simple VFX | `HeadlessMapLoader.ts`, `GameServer.ts`, `V2NetworkClient.ts`, `Game.ts`, `SnapshotBuilder`/`GameEvents` | Medium — Sonnet, browser pass required | after T2/T3 |

Regression gates (server/movement code — per `AGENTS.md`): `npm test`,
`test:simulation`, `server:tick`, `server:fuzz`, and a `demo:verify` sanity run.
Browser validation on **wdm2** via `lobby:server` + `bot:server` + `dev`:

- Each of the 4 teleporter pairs: entry → correct exit, facing `destYaw`,
  no reconciliation snap on the local player, telefrag works (stand a bot on
  the exit).
- The mega jumppad: clean vertical launch to the mega platform (~780 ups,
  304u apex), no air-drag sag, launch sound/VFX once per touch.
- wdm7 afterwards for horizontal-travel pads.

## 5. Open questions / risks

- **Yaw convention conversion** (§3.1) — verify with wdm2 `t2` (angle −90);
  a sign error here is the most likely first bug.
- **Teleport velocity policy** — Q3 fixed-400 vs speed-preserving: playtest
  call; shipping both behind `sv_teleport_speed_mode` costs nothing. Note it's
  read inside the deterministic tick — same caveat as `sv_falldamage*` (F8):
  re-sim bundles must snapshot it.
- **Crouched player in a low trigger**: our AABB test uses standing bounds;
  use current crouch state's mins (profile knows `isCrouching`) — *3 is only
  16u tall, feet-level, so either works, but be correct.
- **Bots**: will hit pads/teles randomly; BotVision/nav doesn't know about
  them. Fine for now; note for the bot roadmap.
- **`func_door` gap (related, out of scope)**: doors animate client-side only
  (`BspEntityHandlers`) — server collision never moves; wdm7 doors are
  walk-through on the server. Same submodel machinery (T1's model-AABB access)
  is the first step toward fixing that later.
- **misc_portal_surface/camera** (wdm2 mirrors): unrelated visual feature,
  explicitly out of scope.

## 6. Reference — dump tooling

Scratchpad script used for §1 (jszip; entities = lump 0, models = lump 7,
40-byte records `mins[3]f maxs[3]f firstFace numFaces firstBrush numBrushes`).
Re-create as needed:

```bash
node dump-bsp-entities.mjs public/data/map_wdm2.pk3          # classname histogram
node dump-bsp-entities.mjs public/data/map_wdm2.pk3 --full   # trigger/target records
```

Worth promoting into a real CLI later (`npm run bsp:entities -- wdm2`) — it was
immediately useful and costs ~40 lines.
