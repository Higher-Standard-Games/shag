# Machinegun: effects, spread and recoil

**Status:** decided 2026-10-09, in progress on branch `v0.9.27-machinegun`. See
section 7 for the decisions and the design as built.
**Ask (Tarmo):** the machinegun's tracer is a placeholder line and looks bad, while
the wall impacts it shares with the riotgun look great. Hip fire should spread a
lot; ADS should spread a little and kick harder. It should feel powerful, not like
a bean sprayer.

## 1. What the machinegun does today

| Area | Today | Where |
|---|---|---|
| Fire rate, damage | 10 damage, one shot every 13 ticks (9.6 a second), 30-round clip | `src/shared/entities/definitions/weapons/machinegun.ts` |
| Spread values | `spread: 1.5` hip, `adsSpread: 0.3` ADS | same file |
| **Spread on the server** | **None.** The single-ray hitscan path aims exactly down the view (plus Voltaic beam wander, which is zero for the machinegun). `spread`/`adsSpread` are read only by the pellet path and by projectiles, so the machinegun's values do nothing | `src/games/fps/server/systems/WeaponSystem.ts` (single ray ~1463, pellets ~1443, projectiles ~1846) |
| Local tracer | `HitscanEffects.fireTracer`: a 1-pixel `MeshBuilder.CreateLines` line, yellow to 30% alpha, 0.08 s. It starts **at the camera** (2 units ahead of the eye), not the gun, and goes straight down the view. A new mesh per shot | `src/engine/weapon/HitscanEffects.ts:237`, called from `WeaponViewManager.ts:1793` |
| Remote tracer | Same `fireTracer` from the `weapon_fire` event's origin and direction | `src/games/fps/client/GameEvents.ts:1075` |
| Impacts | Wall mark, impact flash light, 6 sparks (`TRACER_SPARKS`). This is the part shared with the riotgun and it looks good | `HitscanEffects.ts` (`spawnWallMark`, `spawnImpactSparks`) |
| Muzzle flash | Yellow, intensity 18, 0.075 s | `machinegun.ts`, `MuzzleFlashRenderer` |
| Recoil | **View model only.** `WeaponRecoil` pushes the gun back 1.5 units and pitches it up to about 7° per shot, at `recoilScale` 1.0 (the machinegun sets none). ADS cuts it to 20% (`RECOIL_ADS_MULT`), the opposite of what we want | `src/engine/weapon/WeaponRecoil.ts` |
| Camera kick | None for any weapon. The only camera shake in the game is the explosion shake | `ExplosionEffect.triggerCameraShake` |

So the machinegun is a perfectly accurate laser that fires 9.6 times a second, drawn
as a hairline coming out of your eye, with a gun that barely moves when you aim. Each
of those adds to the bean-sprayer feel.

Found on the way, outside this topic: remote riotgun shots are drawn with 20
pellets at 12°, while the server fires 18 at 8° (`GameEvents.ts:1077`).

## 2. Tracer: options

What reads as a good bullet tracer in an arena shooter: it comes **out of the
gun**, it is **bright and thick at the core**, it **travels** (even for a hitscan
weapon, a streak that moves for 30–60 ms reads as a bullet rather than a laser),
and it leaves **a faint trail** that fades.

| Option | What it is | Pros | Cons |
|---|---|---|---|
| **T1. Traveling streak** | A camera-facing quad (billboard ribbon) 60–120 units long with an additive hot-core gradient: white centre, orange edge, soft ends. It travels from muzzle to hit at a fixed speed (about 12,000 u/s, so 40 ms across a big room) and dies at the impact. | Reads as a bullet. One quad per shot. Same look from every angle. | New mesh type (a billboard ribbon). Needs its own small material. |
| **T2. Reuse the riotgun's traveling pellet** | `spawnTravelingPellet`: a 6-sided cone cylinder sliding along the ray, emissive. | Already exists and already looks good on the riotgun. A day's work at most. | A cylinder is lit flat and looks thin edge-on, so it would look the same as the riotgun's pellets. One mesh and material are created per shot. |
| **T3. Streak plus smoke trail** | T1, plus a very faint grey ribbon left along the path that fades over 0.3–0.5 s. | The most "powerful" read; you see where the stream of fire is going. | Most draw calls; needs a limit on how many trails exist at 16 players. |
| **T4. Tracer rounds** | Draw a tracer on every 2nd or 3rd shot only, as real tracer ammunition does. The others show muzzle flash and impact only. | Cleaner and less noise in a firefight; each tracer means more. | Fewer visuals per second; your own fire might feel thinner. |

All options should:
- **Start at the muzzle.** Locally from `WeaponViewManager.getMuzzleWorldPosition()`,
  which already projects the view model's muzzle socket into the world (the Voltaic
  beam uses it). For remote players, from their third-person weapon's muzzle if we
  have one, else the event origin.
- **End where the bullet went**, which once spread exists (section 3) is not the
  centre of the screen.
- **Pool meshes.** Today every shot creates and disposes a mesh. At 9.6 shots a
  second and up to 16 shooters, a fixed pool (or thin instances of one quad) is the
  right shape.
- **Keep the impacts exactly as they are.** You said they look great.

Optional extras, if wanted later: brass casings ejecting from the view model (a
small pooled physics-free arc), a heat shimmer at the muzzle after a long burst, a
louder and sharper fire sound with a tail.

## 3. Spread: options

### 3.1 The numbers

Hip fire "REALLY big", ADS "a little". Suggested starting points, to tune in play:

| Mode | Today (has no effect) | Proposal |
|---|---:|---:|
| Hip | 1.5° | **6°** cone |
| ADS | 0.3° | **0.8°** cone |

At 6° a target 1,000 units away gets a 105-unit circle, about twice a player's
width: you can hip-fire across a small room, but not snipe. At 0.8° the circle is
14 units across, so ADS still hits reliably at range.

### 3.2 Bloom or flat

| Option | Behaviour |
|---|---|
| **S1. Flat** | Every shot gets the same cone. Simple, predictable. |
| **S2. Bloom** | The cone grows with sustained fire and recovers when you stop: say hip 3° on the first shot growing to 7° over 8 shots, ADS 0.4° growing to 1.2°. This rewards bursts over holding the trigger, which is a big part of feeling powerful rather than spraying. Needs a per-player heat value on the server, kept in `WeaponState`, and the same value on the client for the crosshair. |

The crosshair should show the cone in either case: its gap from the spread, and with
bloom, opening as you fire. The crosshair already has `baseGap`.

### 3.3 Making the client and server agree

This is the part that needs care. With 6° of spread, a tracer that goes one way
while the bullet went another reads as "it hit but did no damage".

- The server must pick the deviation **deterministically** (demos and the re-sim
  depend on it). The riotgun uses `computeSpreadSeed(tick, entityId, shotCount)`.
- The local tracer is drawn **at once**, before the server answers, so the client
  must compute the same deviation itself. It cannot know the server tick the shot
  will be simulated on, and `shotCount` can drift (a missed shot, a respawn).
- **Recommendation: seed from the input command's sequence number** (with the entity
  id). The client stamps every command with `sequence`. The server reads the same
  number off the command it simulates (`InputComponent.sequence`). Both sides
  therefore know it exactly, with nothing extra on the wire. The other
  players' clients draw from the `weapon_fire` event's direction. Today that is
  the plain view direction (`WeaponSystem.ts` ~1183), so the server must apply
  the same deviation there too.
- Bloom (S2) adds one wrinkle: the client's heat value must follow the same rule
  from the same inputs. It is deterministic from fire ticks, so it can.
- The riotgun's local pellets are random today and do not match its server pellets
  either. That is less visible across 18 pellets, but the same fix would apply if
  wanted.

**Networking risk:** this changes what the server simulates, so it falls under the
networking regression rules in `AGENTS.md`. It also changes the machinegun's hits in
the deterministic re-sim (`server/ReSim.ts` uses a machinegun loadout), so re-sim
bundles recorded before the change will no longer reconcile. Bundles are short-lived,
so that is acceptable, but it should be said in the changelog.

## 4. Recoil and kick: options

What you described: ADS should kick **more** than today, and the weapon should feel
powerful. Today only the gun model moves, and less when aiming.

| Option | What it is |
|---|---|
| **R1. Stronger view model recoil** | Give the machinegun `recoilScale` 1.6 and a per-weapon ADS multiplier (new `adsRecoilScale`, default today's 0.2; machinegun 0.8). Purely visual. |
| **R2. Camera kick (view punch)** | Each shot pitches the camera up a little (ADS about 0.35°, hip about 0.2°) with a small random yaw, recovering over about 150 ms. This is what makes a gun feel strong in Quake-family and modern shooters alike. Purely visual: it moves the rendered camera, not your aim, so the server and your input are unaffected. |
| **R3. Aim recoil** | The kick moves your actual aim and you pull down against it, as in CS. This is a gameplay change, server-authoritative, and a big change of identity for an arena shooter. **Not recommended.** |
| **R4. Muzzle climb from spread** | With bloom (S2), bias the growth upwards so a long burst climbs. A gameplay change, but small and deterministic. Optional. |

R1 and R2 together give the power read without touching gameplay. A per-weapon
setting (`viewKick: { pitch, yaw, adsPitch, recover }` in `WeaponDef`) lets the
riotgun and rocket launcher use it too.

## 5. Recommendation

| WO | Work | Gameplay? | Effort | Risk | Model |
|---|---|---|---|---|---|
| MG-1 | Server spread for single-ray hitscan (machinegun only, by `spread`/`adsSpread`), seeded from entity id and input sequence; the `weapon_fire` direction carries the spread. Tests, networking regressions, changelog note on re-sim bundles | **Yes** | M | Medium (networking) | Opus |
| MG-2 | Client predicts the same deviation for the local tracer and impact. Shared function in `src/shared/SpreadUtils.ts` used by both sides; a test that the two agree | No (visual) | S | Low | Sonnet |
| MG-3 | New tracer: T1 traveling streak from the muzzle, pooled, and the impacts unchanged. Remote players use it too | No | M | Low (renderer, but additive) | Opus |
| MG-4 | Camera kick R2 plus stronger view model recoil R1 with `adsRecoilScale` | No | S | Low | Sonnet |
| MG-5 | Crosshair gap follows the cone (and bloom, if chosen) | No | S | Low | Sonnet |
| MG-6 | Optional: bloom S2, smoke trail T3, brass casings | Bloom is | M each | Medium | Opus |

Order: MG-1 and MG-2 together (they must agree), then MG-3, then MG-4 and MG-5. The
gameplay change lands first so that the visuals are tuned against the real spread.

## 6. Decisions needed

1. **Tracer style:** T1 traveling streak (recommended), T2 reuse the riotgun pellet,
   or T3 streak plus smoke trail? Tracer on every shot, or every 2nd or 3rd (T4)?
2. **Spread:** flat (S1) or bloom (S2)? And are 6° hip and 0.8° ADS the right
   starting numbers?
3. **Recoil:** camera kick and stronger view model recoil (R1 + R2, visual only), or
   should the kick also move your aim (R3)?
4. Should the riotgun's local pellets be made to match the server (section 3.3) in
   the same pass, and should its remote pellet count and cone be corrected?

## 7. Decisions and design as built (2026-10-09)

**Decisions (Tarmo):** T1 traveling streak on every shot; spread with bloom (tight
first shots that open up the longer the trigger is held); recoil visual only (R1 +
R2); the riotgun's pellets drawn where the server's went, and its remote pellet
count and cone corrected.

**Correction to section 3.3.** The local shooter's shots are not predicted: the
tracer, pellets and muzzle flash are drawn when the server's `weapon_fire` event
for our own shot arrives (`GameEvents.ts`, `weapon_fire` → `wvm.fire()`). Until
now they were drawn down wherever the camera pointed *on arrival*, so a mouse
moved during the round trip sent the tracer somewhere the shot never went. So
the client does not have to predict the spread at all. The server decides it and
puts it in the event; every client, the shooter included, draws from the event.

- **Machinegun:** the server picks one deviation per shot and uses it for both the
  damage ray and the `weapon_fire` direction. No wire change.
- **Riotgun:** `weapon_fire` gains the pellet seed and cone, as a new event code
  (24) so older demos decode as before. Every client rebuilds the server's exact
  pellets with `generateSpreadDirections`.
- **Bloom:** a per-player heat value in the server's `WeaponState`. Each shot uses
  the current cone, then adds `1 / shotsToMax`; heat drains over
  `recoverySeconds`. Settings in `WeaponDef.spreadBloom`. Spread values are cone
  half-angles, as `generateSpreadDirections` defines them.
- **Kick:** a view punch in `FPSController`, added to the rendered camera and left
  out of the angles sent to the server, so it never moves aim. Per weapon in
  `WeaponDef.viewKick`. View model recoil gets a per-weapon ADS factor
  (`WeaponDef.adsRecoilScale`).
- **Tracer:** a pooled, camera-facing streak that travels from the muzzle to where
  the server's ray went; the impact plays when it arrives.
- **Bloom heat drains only off the trigger.** A first cut drained heat for all
  time between shots; at 9.6 shots a second that outran the 1/8 added per shot,
  so the cone never opened. Heat now drains only for the time beyond 1.25× the
  refire interval (`bloomIdleSeconds`), the same rule on the server and in the
  crosshair.
- **Anti-cheat.** The accuracy calibration (`server/Calibrate.ts`) now fires
  aimed. From the hip the cone hides aim quality, so the hip-fire accuracy
  signal separates an aimbot from a human less well. If the accuracy signal is
  ever used to gate, it should count aimed shots on their own.
