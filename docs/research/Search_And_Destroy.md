# Search & Destroy

> A round-based bomb-and-defuse gametype, Warsow Bomb compatible, designed to put the bot goal framework under real load.

**Date:** 2026-07-28
**Status:** Design, with S1 (`BombSiteTable`) implemented and verified against all six shipped bomb maps.
**Scope:** `src/games/fps/server/gametypes`, `src/shared/bsp`, `src/shared/bot`
**Depends on:** [`BOT_WEIGHTS_AND_GOALS.md`](BOT_WEIGHTS_AND_GOALS.md) Phases 1–4 (landed)

**Hard requirement:** compatible with Warsow's Bomb entity contract, so all six shipped `wbomb*` maps play unmodified.

---

## 1. Why this mode

Two reasons, and the second is the real one.

1. It is a good mode.
2. **It is the only honest test of the bot goal framework.** Phases 1–4 built weights, scored arbitration, and gametype directives, and every bit of it is verified by synthetic fixtures. Deathmatch cannot exercise it — a DM bot that ignores directives entirely still looks fine. S&D fails visibly and immediately if bots do not understand objectives, which is exactly what makes it worth building next.

The framework's acceptance criterion is that **no S&D-specific code appears in `src/bot`**. If that holds, the design worked.

---

## 2. Prior art

### 2.1 The three reference points

| | Counter-Strike | CoD Search & Destroy | Warsow Bomb |
|---|---|---|---|
| Team size | 5v5 | 6v6 | 4v4–5v5 |
| **Economy** | **Central** — buy phase, round-loss bonuses | **None** — fixed loadout/class | **None** |
| Weapon source | Bought each round | Create-a-class loadout | **Picked up from the map** |
| Map items | None | None | **Armor, health, powerups** |
| Movement | Slow, counter-strafe, precise | Moderate, slide/mantle | **Very fast — strafe jump, dash, walljump, crouchslide** |
| Respawn in round | No | No | No |
| Round time | ~1:55 | ~2:30 | ~2:00 |
| Bomb timer | 40 s | 45 s | ~35 s |
| Plant time | 3.2 s | 5 s | ~3 s |
| Defuse | 10 s, 5 s with kit | 7.5 s | ~5 s |
| Sites | 2 | 2 | 2 |
| Match format | MR15, first to 16 | First to 6 | Round-based, swap at half |
| Bomb carrier | One T spawns with it, drops on death | Attacker picks up at spawn | Carrier, drops on death |

### 2.2 What each gets right, and what we take

**Counter-Strike** is the source of the tension that makes the mode work: the attackers hold the initiative and the defenders hold the ground, and the plant *inverts* those roles mid-round. Post-plant the attackers become the defenders. We take that structure wholesale — it is the mode.

We do **not** take the economy. It is CS's deepest system and it exists because there are no map items; the buy phase *is* the resource game. This engine already has a resource game — armor tiers, mega health, and now Quad, all on respawn timers. Adding money would create two competing economies, and the map one is already built and tested.

**CoD S&D** proves the mode works without an economy: fixed loadouts, faster time-to-kill, smaller maps, shorter matches. Its lesson is that removing the buy phase makes rounds *more uniform* — no eco rounds, no force-buys, no snowball. Every round is a fair fight. Given this engine has no economy and fast TTK, CoD is the closer relative and we take its match length (first to 6) and its "every round is a full-strength round" character.

**Warsow Bomb** is the compatibility target and settles the questions the other two cannot: weapons come off the map, there is no money, and movement is four times faster than CS. It also supplies the entity contract (§3) and the default site radius (§3.3).

### 2.3 The one thing that makes ours different

Movement speed changes the mode's geometry. Measured on the shipped maps (§4), an attacker reaches a bombsite in **0.7–3.6 s** while strafe-jumping, and rotating between sites costs **1.8–4.6 s**. In CS the equivalent numbers are roughly 20–30 s and 15–25 s.

That is not a small difference — it is a different game:

- **Rotations are nearly free.** A defender who guesses wrong is not out of the round. Holding one site and rotating is viable in a way it is not in CS, which pushes toward defenders splitting less and reacting more.
- **Round timers can be much shorter.** Most of a CS round is walking.
- **Post-plant retakes are always live.** With a 3–4 s cross-map rotation, no plant is ever safe, so the bomb timer does the pacing rather than the round timer.
- **Site control decays fast.** You cannot "set up" a site for 30 s; the fight arrives immediately.

Design consequence: **shorter everything**, and lean on the bomb timer rather than the round timer as the tension source.

---

## 3. Map data: what the shipped maps actually contain

Everything in this section was parsed from the BSP entity and model lumps of all 38 shipped map pk3s, not assumed.

### 3.1 The entity contract

```text
{ "classname" "misc_capture_area_indicator"
  "targetname" "misc_capture_area_indicator1"    // may be absent
  "target"     "smallexplosions_a"               // cosmetic FX only
  "origin"     "-528 -448 360" }                 // THE site position

{ "classname" "trigger_capture_area"
  "model"      "*3"                              // brush volume, optional
  "target"     "misc_capture_area_indicator1" }  // -> indicator targetname
```

Team spawns reuse the CTF entities: `team_CTF_alphaspawn` / `team_CTF_betaspawn`.

### 3.2 Survey of the six bomb maps

| Map | Indicators | Volumes | Indicator `targetname` | alpha/beta spawns | flags |
|---|---|---|---|---|---|
| wbomb1 | 2 | 2 | `misc_capture_area_indicator1/2` | 9 / 7 | yes |
| wbomb2 | 2 | **0** | **none** | 8 / 16 | yes |
| wbomb3 | 2 | **0** | **none** | 6 / 6 | yes |
| wbomb4 | 2 | **0** | **none** | 6 / 9 | yes |
| wbomb5 | 2 | 6 (4/2) | `bombsitea0` / `bombsiteb0` | 8 / 8 | yes |
| wbomb6 | 2 | 7 (3/4) | `misc_capture_area_indicator1/2` | 4 / 6 | **no** |

Four properties the extractor must respect:

1. **Exactly two indicators on every bomb map.** The reliable invariant. `wdm4`/`wdm9` also have capture areas (3 each) but *no team spawns* — they are not bomb maps. The correct detection test is **2 indicators AND `team_CTF_alphaspawn` present**.
2. **Half the maps have no volume at all.** The radius fallback is therefore the *primary* path, not a defensive workaround (§3.3).
3. **Half have no `targetname`**, and naming is inconsistent where present. Site identity cannot depend on it — derive ids from BSP order and treat "A"/"B" as display only, exactly as `extractPickups()` already does for pickup ids.
4. **Entity order does not match site letter** (wbomb6 lists indicator2 first). Harmless as long as server and bots derive ids from the same bytes.

### 3.3 Default site radius: 384 units, cylindrical

Warsow applied a default radius so a mapper could drop a bare indicator and be done — which is *why* three maps ship without volumes. Measuring the union AABB of the volumes on the maps that do have them:

| Map | Site | Size (x×y×z) | Circumscribed radius |
|---|---|---|---|
| wbomb1 | 1 | 456×280×56 | 268 |
| wbomb1 | 2 | 800×280×264 | 424 |
| wbomb5 | A | 704×640×320 | 476 |
| wbomb5 | B | 544×544×192 | 385 |
| wbomb6 | 1 | 480×384×224 | 307 |
| wbomb6 | 2 | 672×448×224 | 404 |

Mean 377, median 394. **384** sits in the middle, matches wbomb5's B site to within a unit, and is `3 × 128` — three squares of the standard mapping grid.

**It must be a cylinder, not a sphere.** Heights run 56 → 320; a spherical test would allow planting from far above wbomb1's flat site 1. Use a horizontal radius plus a separate vertical band — the shape `PickupSystem` already uses (`PICKUP_RADIUS_SQ` + `VERTICAL_RANGE_MIN`/`MAX`).

Where volumes exist they stay authoritative; 384 is the fallback for bare indicators.

---

## 4. Measured map geometry, and what it dictates

Distances are spawn-centroid to site, with times at run speed (400 ups) and sustained strafe-jump (~1100 ups; the lobby reports per-map top speeds of 1090–1340).

| Map | atk→A | atk→B | def→A | def→B | A↔B rotate |
|---|---|---|---|---|---|
| wbomb1 | 729 (0.7 s) | 2101 (1.9 s) | 3857 (3.5 s) | 3558 (3.2 s) | 2497 (2.3 s) |
| wbomb2 | 2919 (2.7 s) | 3925 (3.6 s) | 3955 (3.6 s) | 3377 (3.1 s) | 5090 (4.6 s) |
| wbomb3 | 1249 (1.1 s) | 1527 (1.4 s) | 3653 (3.3 s) | 4724 (4.3 s) | 2169 (2.0 s) |
| wbomb4 | 908 (0.8 s) | 1652 (1.5 s) | 3569 (3.2 s) | 3775 (3.4 s) | 2002 (1.8 s) |
| wbomb5 | 1952 (1.8 s) | 2570 (2.3 s) | 4624 (4.2 s) | 3255 (3.0 s) | 2733 (2.5 s) |
| wbomb6 | 2512 (2.3 s) | 2212 (2.0 s) | 4320 (3.9 s) | 3970 (3.6 s) | 2604 (2.4 s) |

*(Straight-line; real routes are longer. Treat as lower bounds — the ranking and the order of magnitude are what matter.)*

### 4.1 Which team defends is not what the naming suggests

**On all six maps, `team_CTF_alphaspawn` is closer to the nearest bombsite than `team_CTF_betaspawn`** — wbomb1 is the extreme at 729 vs 3558 units. `team_CTF_alphaflag` also sits essentially *on* a bombsite (188 u on wbomb1, 315 on wbomb3, 627 on wbomb4).

Confirmed by running the implemented `validateBombRoles()` over every shipped bomb map with beta as attacker: it passes 6/6.

| Map | attacker→nearest site | defender→nearest site |
|---|---|---|
| wbomb1 | 3558 | 729 |
| wbomb2 | 3377 | 2919 |
| wbomb3 | 3653 | 1249 |
| wbomb4 | 3569 | 908 |
| wbomb5 | 3255 | 1952 |
| wbomb6 | 3970 | 2212 |

wbomb2 is the narrowest margin and was described as "roughly symmetric" from the per-site figures; on the nearest-site metric the direction is still unambiguous.

In CS and CoD the sites live in the **defenders'** half; attackers cross the map. So the geometry says **alpha's base contains the objectives, and alpha therefore defends** — regardless of what the name suggests about which team "goes first".

> **Implication:** getting this backwards makes every map unplayable in a way that is easy to miss in code review and obvious the moment you load in — attackers would spawn on top of the objective and plant in under a second.
>
> **Therefore: validate at map load.** If the attacking team's spawn centroid is closer to the nearest site than the defending team's, log an error and refuse to start (or auto-swap). A cheap assertion converts a subtle "the mode feels wrong" bug into a loud one. This is worth doing even once the convention is confirmed, because a community map could get it wrong.

### 4.2 Timings that follow

Full map traversal here costs 3–5 s where CS costs 20–30 s. Copying CS's clocks would produce a mode that is mostly standing around.

| Parameter | Value | Reasoning |
|---|---|---|
| **Freeze time** | **5 s** | No buy phase to fill. Enough to read the map and pick a side; CS needs 15–20 s only because of the shop. |
| **Round time** | **90 s** | CS 115 s / CoD 150 s, both scaled for far slower movement. Attackers reach a site in under 4 s, so 90 s is already a long time to fail to commit. |
| **Bomb timer** | **30 s** | The real pacing device. Defenders cross the map in 3–4 s, so 30 s leaves ample retake time — in CS's terms this is proportionally *more* generous than its 40 s. |
| **Plant time** | **3 s** | Matches CS. Long enough to be punishable, short enough to be worth attempting under pressure. |
| **Defuse time** | **5 s** | No kits (no economy to buy them with), so one flat value. 5:30 mirrors CS's 10:40 ratio. |
| **Rounds to win** | **6** | CoD's format. With ~90 s rounds plus overhead, a full 11-round match lands around 18–20 minutes. |
| **Side swap** | after round 5 | Each side plays at least 5. Round 11 is the decider with sides already swapped. |

All of these belong in `MatchConfig` and should be env-overridable like `SHAG_TIMELIMIT` already is — they are the first thing a playtest will want to move.

---

## 5. Rules

### 5.1 Round lifecycle

```text
FreezeTime (5s)  → players spawned, frozen, bomb assigned
      ↓
LiveRound (90s)  → pre_plant
      ↓
   ┌──┴──────────────────────────────┐
   │ plant (3s channel)              │ else round timer expires
   ↓                                 ↓
PostPlant (30s bomb timer)      DEFENDERS WIN (time)
   │                                  
   ├── defuse (5s channel) → DEFENDERS WIN
   ├── timer expires       → ATTACKERS WIN
   └── all attackers dead  → round continues (bomb still ticking!)
      ↓
RoundEnd (4s)   → scoreboard beat, then next round or halftime
```

**Elimination is a win condition only before the plant.** After the plant, killing every attacker does not end the round — the defenders must still defuse. This is the single most important rule in the mode; it is what makes the plant meaningful rather than a formality, and it is shared by CS, CoD and Warsow.

### 5.2 Win conditions

| Condition | Winner |
|---|---|
| Bomb detonates | Attackers |
| Bomb defused | Defenders |
| All attackers dead, **pre-plant** | Defenders |
| All defenders dead | Attackers (only if bomb planted or plantable — see below) |
| Round timer expires, no plant | Defenders |

Edge case worth deciding early: **all defenders dead, pre-plant.** CS gives the round to the Ts immediately (nothing can stop the plant). Recommend the same — otherwise the attackers walk to a site and plant against nobody for 3 s of dead time.

### 5.3 The bomb

- One attacker spawns carrying it, chosen deterministically (seeded on round number, like the existing `rngFrom` spawn selection) so re-simulation and demos agree.
- Dropped on death at the carrier's position; any attacker may pick it up.
- Cannot be picked up by defenders; a dropped bomb is recoverable but never denied.
- Carrier is visible to their own team. **Reuse `PlayerModelManager.applyPowerupGlow()`** — it already exists for the Quad carrier and does exactly the right thing cheaply.
- Plant requires standing in a site volume (or within the 384 cylinder) and holding the action for 3 s. Movement or damage cancels; progress does not persist.
- Defuse is the same channel, 5 s, and any defender may start it. Progress **does** persist across defusers in CS; recommend it does not here, for simplicity, and revisit if it feels bad.

### 5.4 Items, and the Quad question

Map items stay. That is the Warsow answer, it is already implemented, and it is the resource game that replaces CS's economy. But two things must change per round:

- **Items reset at round start.** Otherwise round 2 begins with the map stripped. `PickupSystem.resetForMatch(tick)` already does precisely this — it restores every pickup and re-arms the first-spawn delay. It is named for matches but it is exactly a round reset.
- **First-spawn delay becomes round-relevant.** The existing 15 s armor/mega delay was tuned for a continuous match; in a 90 s round it means the mega appears at the 17% mark. Probably fine, wants a playtest.

**Quad should be disabled in S&D for the first playable version.** All six bomb maps carry an `item_quad`. In a mode with no respawn, one player with 4× damage for 30 s can end a round single-handedly, and there is no comeback mechanism. That may still be *fun* — a contested round-defining prize is a legitimate design — but it is a large variable to introduce while the mode itself is unproven. `PickupSystem` already branches on pickup type, so this is a filter, not a feature.

Revisit once the base mode plays well.

---

## 6. What does not exist yet

Surveyed against the current branch. This is the actual work.

| # | Gap | Evidence |
|---|---|---|
| **G1** | **No round concept anywhere.** `MatchState` has phases (Warmup/Countdown/Active/PostGame) and nothing else — grepping it for "round" returns zero hits. Every existing mode is a single continuous match. | `MatchState.ts` |
| **G2** | **No respawn suppression.** `GametypeController` queues every death with a min/max delay and auto-respawns at the deadline. S&D needs "dead until round end", which no hook currently expresses. | `GametypeController.processRespawns` |
| **G3** | **Team spawns are never parsed.** Spawn extraction looks for `info_player_deathmatch` / `info_player_start` / `info_player_team1` / `info_player_team2` — the Quake conventions. `team_CTF_alphaspawn` / `team_CTF_betaspawn` appear in **no** source file, so all 4–16 team spawns on every bomb map are currently invisible. | `SpawnPointManager.ts`, `HeadlessMapLoader.ts` |
| **G4** | **`TeamSpawnStrategy.choose()` is a TODO.** The class exists and `setTeamPoints()` is never called by anything. TDM's `getSpawnStrategy()` returns `"furthest"` with a comment saying team spawns are not implemented. | `SpawnPointStrategy.ts:149` |
| **G5** | **No `BombSiteTable`.** The extraction contract is specified (§3) but unwritten. Must be shared server+bot like `PickupTable`, so both derive identical site ids from identical bytes. | — |
| **G6** | **No bomb entity or carry/plant/defuse mechanics.** No channelled-action system exists at all. | — |
| **G7** | **`teamRoles` / `roundState` are designed but not in `MatchStateSnapshot`.** Both are public information and belong in the broadcast snapshot; the bot side already reads them (`BotGameState.matchState`, `getOwnRole()`). | `BOT_WEIGHTS_AND_GOALS.md` §4.3 |

G1 and G2 are the substantial ones: they are new *lifecycle*, not new content, and they will touch `MatchState` and `GametypeController` — code every other mode depends on. Worth doing behind the existing phase machinery rather than beside it.

---

## 7. Bots

The framework is already built. What S&D adds is data.

### 7.1 Weight profiles

Profile keys resolve `gametype:role:roundState → gametype:role → gametype → DEFAULT`, which is exactly the shape this mode needs:

```typescript
"snd:attacker:pre_plant"   { itemGreed: 0.2, itemDenial: 0.1, objectivePush: 0.9, teamCohesion: 0.6, carrierProtect: 0.8, mapControl: 0.2, aggression: 0.5, riskTolerance: 0.7 }
"snd:attacker:post_plant"  { itemGreed: 0.1, itemDenial: 0.0, objectivePush: 0.3, teamCohesion: 0.5, carrierProtect: 0.0, mapControl: 0.9, aggression: 0.4, riskTolerance: 0.3 }
"snd:defender:pre_plant"   { itemGreed: 0.2, itemDenial: 0.1, objectivePush: 0.1, teamCohesion: 0.4, carrierProtect: 0.0, mapControl: 0.9, aggression: 0.4, riskTolerance: 0.3 }
"snd:defender:post_plant"  { itemGreed: 0.0, itemDenial: 0.0, objectivePush: 1.0, teamCohesion: 0.3, carrierProtect: 0.0, mapControl: 0.1, aggression: 0.2, riskTolerance: 0.9 }
```

Note how the plant **inverts both profiles** — attackers flip from pushing to holding ground, defenders from holding to pushing at all costs. That role inversion is the mode's core tension, and here it is four lines of data.

### 7.2 Directives per round state

| Round state | Role | Directive |
|---|---|---|
| pre_plant | attacker, carrying | `move_to` the target site, `priority 0.9` |
| pre_plant | attacker, not carrying | `escort` the carrier, `priority 0.7` |
| pre_plant | defender | `hold_area` at a site, split across the team |
| post_plant | attacker | `defend` the planted site, `priority 0.9` |
| post_plant | defender | `move_to` the bomb, `priority 1.0`, `urgency` rising with the timer |

`urgency` is the mechanism for "10 seconds left, go now regardless" — it is a separate consideration from `objective_push` precisely so a gametype can raise time pressure without permanently inflating the objective's importance.

### 7.3 What bots still cannot do

Honest list, because these will show up immediately in playtest:

- **No channelled-action support.** Bots have no concept of "stand still for 3 s and hold a button". This needs a `BotSequence` — the sequence runtime already exists and handles exactly this shape (commitment windows, abort conditions, authoritative confirmation), so a `plant_bomb` / `defuse_bomb` sequence is the natural fit.
- **No site-splitting logic.** Directives are per-player, so the *gametype* decides which defender holds which site. That is the right place for it, but it is real logic to write.
- **No retake coordination.** Post-plant, bots will each independently path to the bomb rather than trading or stacking. Acceptable for a first version.
- **`map_control` does not exist yet.** It has a weight key but no consideration behind it, so `mapControl: 0.9` currently does nothing. Defenders will hold sites because they are *told* to (directives), not because they value ground. Worth building, and it benefits duel too.

---

## 7.4 Existing machinery to reuse

Consolidated here because it is scattered through the sections above and it is
what makes the work smaller than §6 implies. None of this needs inventing.

| Need | Reuse | Why it fits |
|---|---|---|
| Per-round item reset | `PickupSystem.resetForMatch(tick)` | Restores every pickup and re-arms the first-spawn delay. Named for matches; it is exactly a round reset. |
| Shared site identity | The `PickupTable` pattern | Server and bots derive identical ids from identical BSP bytes, with no handshake. Bomb sites need precisely this guarantee. |
| Site containment test | `PickupSystem`'s `PICKUP_RADIUS_SQ` + `VERTICAL_RANGE_MIN`/`MAX` | Already the cylinder shape §3.3 requires, rather than a sphere. |
| Bomb carrier visual | `PlayerModelManager.applyPowerupGlow()` | Built for the Quad carrier; writes only emissive + outline, so it is cheap per frame. |
| Deterministic bomb assignment | `rngFrom(tick, id, salt)` | The same seeded RNG spawn selection uses, so re-simulation and demos agree. |
| Plant / defuse channels | `BotSequence` runtime | Already models commitment windows, abort conditions and authoritative confirmation — the exact shape of a channelled action. |
| Round role → bot policy | `selectWeightProfile(gametype, role, roundState)` | The `gametype:role:roundState` key scheme was designed for this and is landed. |
| Per-player orders | `BaseGametype.getAgentDirectives()` | Landed in Phase 4, including per-client delivery. |
| Match config overrides | `SHAG_TIMELIMIT` env pattern | Every §4.2 timing wants to be tunable in playtest without a rebuild. |

## 7.5 Verified vs. assumed

Being explicit, because §4.2's timings read like facts and are not.

**Measured from the shipped pk3s** — entity counts and classnames per map, site
volume extents, the 384 radius corroboration, spawn-to-site and site-to-site
distances, and which team spawns nearer the objectives.

**Read from the codebase** — the seven gaps in §6, and every reuse in §7.4.

**Known from the reference games** — the CS/CoD/Warsow comparison in §2.1.

**Reasoned, not verified** — every timing in §4.2. They are derived from measured
geometry rather than copied from CS, which makes them better starting points, not
correct ones. The strafe-jump figure (~1100 ups) is a sustained-speed assumption;
real routes are longer than straight lines, so traversal times are lower bounds.

**Inferred and needs confirmation** — that alpha is the defending team (§4.1).
The geometry is unambiguous on five of six maps, but geometry is evidence about
the *maps*, not about Warsow's convention. Confirm against Warsow's gametype
source or by loading a map; the §4.1 load-time assertion is worth keeping either
way.

## 8. Implementation order

Each step should be independently verifiable, and the early ones are useful even if the mode stalls.

**S1 — `BombSiteTable`. ✅ DONE.** `src/shared/bsp/BombSiteTable.ts` + 24 tests.
Shared extraction per §3, with fixtures for all three authoring styles: volumes +
names (wbomb1), `bombsite[ab]` naming (wbomb5), and bare indicators (wbomb3).
Also `isBombMap()`, `extractTeamSpawns()`, `isInsideBombSite()` (cylinder, per
§3.3) and `validateBombRoles()` (§4.1).

Verified against the real BSPs of all six bomb maps: 2 sites each, volume counts
1/1, 0/0, 0/0, 0/0, 4/2, 4/3, and wbomb6 labelled B/A exactly as the
out-of-order prediction said. `wdm4`/`wdm9`/`wdm2` correctly rejected.

Unit tests use fixtures rather than reading pk3s, so they run wherever the suite
does; the real-map check was a one-off verification, since no existing test
depends on map assets being present.

**S2 — Team spawns (G3, G4).** Parse `team_CTF_*spawn`, implement `TeamSpawnStrategy.choose()`, wire `setTeamPoints()`. **Benefits TDM immediately**, independent of S&D, and includes the §4.1 role-vs-geometry validation.

**S3 — Round lifecycle (G1, G2).** Round state inside the Active phase, per-round reset via the existing `resetForMatch`, respawn suppression, side swap, round scoring. The riskiest step because it touches shared match code; land it with TDM still passing.

**S4 — Bomb mechanics (G6).** Carry, drop, pickup, and the plant/defuse channel. Carrier glow reuses `applyPowerupGlow`.

**S5 — Wire the mode.** `teamRoles` + `roundState` into `MatchStateSnapshot`; the `snd:*` weight profiles; the directive emitter.

**S6 — Bot channelled actions.** `plant_bomb` / `defuse_bomb` sequences.

**S7 — Playtest and tune.** Every number in §4.2 is a first guess.

---

## 9. Open questions

| | Question | Leaning |
|---|---|---|
| Q1 | Is alpha really the defending team, or is the geometry coincidental? | Geometry is unambiguous on 5/6 maps; validate at load either way (§4.1) |
| Q2 | Vertical band for the 384 fallback cylinder | Unknown — the volumes say how tall a *site* is, not how far above a bare indicator a plant should count. Playtest |
| Q3 | Does defuse progress persist across defusers? | No, for simplicity; revisit if it feels bad |
| Q4 | Quad in S&D | Disabled initially (§5.4); revisit once the mode plays |
| Q5 | Does the round timer stop on plant? | Yes — bomb timer takes over, as in all three references |
| Q6 | All defenders dead pre-plant: instant win or play it out? | Instant win, as CS |
| Q7 | Items reset per round, or persist to reward early control? | Reset. Persisting punishes the losing side twice |
| Q8 | Should the bomb carrier be visible to *enemies* too? | No. Warsow/CS keep it team-only; a visible carrier removes all attacker deception |

---

## 10. Risks

- **S3 touches shared match lifecycle.** Rounds are a genuinely new concept in a codebase where every mode is one continuous match. The temptation will be to special-case S&D inside `GametypeController`; resist it, or every future mode inherits the mess.
- **The mode is unplayable if roles are backwards** and the failure is silent in code (§4.1). The load-time assertion is not optional.
- **Bots will look worst here first.** That is the point of building it, but expect the first playtest to expose gaps in *movement* and *combat* rather than in goal selection — the goal layer is the best-tested part of the bot.
- **Timings are all first guesses.** They are reasoned from measured map geometry rather than copied, which makes them better starting points, not correct ones.
- **No channelled-action system exists**, for players or bots. S4 and S6 are more than they look.
