# Search & Destroy

> A round-based bomb-and-defuse gametype, Warsow Bomb compatible, designed to put the bot goal framework under real load.

**Date:** 2026-07-28
**Status:** Design complete and rules confirmed. S1 (`BombSiteTable`) implemented and verified against all six shipped bomb maps; S2-S8 planned (see 8, 9).
**Scope:** `src/games/fps/server/gametypes`, `src/shared/bsp`, `src/shared/bot`
**Depends on:** [`BOT_WEIGHTS_AND_GOALS.md`](BOT_WEIGHTS_AND_GOALS.md) Phases 1–4 (landed)

**Hard requirement:** compatible with Warsow's Bomb entity contract, so all six shipped `wbomb*` maps play unmodified.

---

## 1. Why this mode

Two reasons, and the second is the real one.

1. It is a good mode.
2. **It is the only honest test of the bot goal framework.** Phases 1–4 built weights, scored arbitration, and gametype directives, and every bit of it is verified by synthetic fixtures. Deathmatch cannot exercise it — a DM bot that ignores directives entirely still looks fine. S&D fails visibly and immediately if bots do not understand objectives, which is exactly what makes it worth building next.

The framework's acceptance criterion is that **no S&D-specific code appears in `src/bot`**. If that holds, the design worked.

### 1.1 Where it sits in the lineup

S&D **replaces Team Deathmatch on the menu**, giving three modes with distinct
jobs rather than four with overlapping ones:

| Mode | Job |
|---|---|
| **Duel** | Ultimate 1v1 — item timing and map control |
| **FFA** | Practice and fun — low commitment, always something happening |
| **S&D** | Tactical team play — rounds, objectives, no respawn |

TDM's code stays (it is the only landed consumer of `getAgentDirectives`, and
its tests pass), it simply stops being offered.

The menu surface is small and already mapped:

| Where | Change |
|---|---|
| `LobbyServer.GAMETYPE_SHELLS` | Replace the `tdm` shell with `snd` |
| `LobbyServer.normalizeGametype` | Add `snd` / `bomb` aliases |
| `LobbyServer` gametype switch | Instantiate the new gametype |
| `config/maps.json` | Tag the bomb maps `snd` |
| `headless-netserver-v2`, `record-demo` | CLI `--gametype` switches |
| `FpsMapLauncher` | Currently hardcodes `"tdm"` |

**Two map-manifest problems to fix when wiring the mode:**

1. **Only `wbomb1` is in `config/maps.json` at all**, and it is tagged `duel`.
   `wbomb2`–`wbomb6` are absent, so five of the six bomb maps are invisible to
   the lobby even though they ship.
2. Nothing validates that a map tagged for a gametype can actually host it.
   `isBombMap()` (S1) makes that checkable — an `snd`-tagged map that fails it
   is a manifest bug, and finding it at startup beats finding it in a match.

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

| Parameter | Value | Source |
|---|---|---|
| **Freeze time** | **5 s** | Proposed. No buy phase to fill; enough to read the map and pick a side. CS needs 15-20 s only because of the shop. *Unconfirmed.* |
| **Round time** | **1:30 (90 s)** | Confirmed. Attackers reach a site in under 4 s, so 90 s is already a long time to fail to commit. |
| **Bomb timer** | **35 s** | Confirmed. Matches Warsow. The real pacing device - defenders cross the map in 3-4 s, so 35 s leaves ample retake time. |
| **Plant (arm)** | **4 s** | Confirmed. Standing on the dropped bomb, not a held button - see 5.3. |
| **Defuse** | **5 s** | Confirmed. Same radius as the plant. No kits (no economy to buy them with). |
| **Round end** | **4 s** | Proposed. Result beat before the next freeze. |
| **Halftime** | **10 s** | Proposed. Side swap intermission. |
| **Rounds to win** | **6** | Proposed. ~90 s rounds plus overhead puts a full 11-round match near 18-20 min. |
| **Side swap** | after round 5 | Proposed. Each side plays at least 5; round 11 is the decider with sides already swapped. |

These are `MatchConfig` fields reinterpreted for a round mode (5.1), not new configuration. All of them belong in `MatchConfig` and should be env-overridable like `SHAG_TIMELIMIT` already is — they are the first thing a playtest will want to move.

---

## 5. Rules

Confirmed against Warsow behaviour. Where a rule is a proposal rather than a
confirmation it says so.

### 5.1 Round lifecycle

**Rounds are not a new state machine. A round IS the existing phase cycle.**

The match phases already model exactly the shape a round needs — a countdown
that freezes and counts in, an active period on a timer, and an end. S&D reuses
them and simply loops instead of terminating:

```text
Warmup ──► Countdown ──► Active ──┐         (round 1)
             ▲                    │
             │   round ends       │
             └────────────────────┤
                                  │  score limit reached
                                  ▼
                              PostGame
```

| Phase | Role in S&D | Timer source |
|---|---|---|
| `Warmup` | Once per match — players join and ready up | `warmupTimeout` |
| `Countdown` | **Round freeze.** Result of the previous round shown, players spawned and frozen, bomb placed, items reset | `countdownDuration` |
| `Active` | **The live round**, pre-arm | `timeLimit` = *round* time (90 s) |
| `PostGame` | End of **match**, not round | `postGameDuration` |

`MatchConfig` already carries everything needed, with only the interpretation
changing:

- **`scoreLimit` = rounds to win** (6). `addTeamScore()` and the score-limit
  check in `GametypeController` already exist and already work on team scores.
- **`timeLimit` = round length** (90 s), not match length.
- **`countdownDuration` = freeze time**, absorbing the round-result beat so no
  extra phase is needed.

**The post-arm period is not a phase.** The phase stays `Active`; the gametype
holds `armed` + `armedAtTick` internally and reports the bomb's remaining time
in place of the round timer. Making it a phase would leak a mode-specific
concept into machinery every gametype shares.

**What actually has to change**, having reused all of the above:

1. `Active` currently transitions to `PostGame` when its timer expires. Round-
   based modes must instead end the round and return to `Countdown` — unless the
   score limit is met.
2. A round can end *mid-`Active`* (defuse, detonation, elimination), so the
   gametype needs to be able to say "round over now" rather than waiting on a
   timer.
3. `Countdown` does not freeze input today; `applyPostGameInputFreeze` gates on
   `PostGame`. It needs to cover the freeze phase too.
4. The `overtimeOnDraw` path on `Active` expiry is a duel rule. For a round mode
   an expired timer is a defender win, not a draw, so round-based modes bypass it.

That is one new transition, one new hook, and two small gates — against a nested
round state machine, which is what this replaces.

### 5.2 Win conditions

| Condition | Winner |
|---|---|
| Bomb detonates | Attackers |
| Bomb defused | Defenders |
| All attackers dead, **pre-arm** | Defenders |
| All defenders dead, **pre-arm** | Attackers *(nothing can stop the plant; playing it out is dead time)* |
| Round timer expires, not armed | Defenders |
| All attackers dead, **post-arm** | *Nobody - round continues* |

### 5.3 The bomb - Warsow rules

This is where the mode departs from CS/CoD, and it is the distinctive part.

**Spawn.** The bomb is a world object placed on the ground near the attacking
team's spawn at round start. It is **not** handed to a player - someone must go
and pick it up, which is itself a small opening decision.

**Carry.** Any attacker may pick it up by touching it. Carrying is *safe*:
speed, landings and knockback do not drop it in the open. The carrier is visible
to their own team only.

**Drop-to-plant.** Inside a bombsite, the carrier's horizontal speed falling
below **100 ups** drops the bomb at their feet. That is the plant initiation -
there is no plant button. Outside a site the rule does not apply, so crossing
the map is never a movement skill check.

**Arm.** With the bomb on the ground inside a site, an attacker standing within
the plant radius for **4 s** arms it. Any attacker can arm, not only whoever
carried it. Leaving the radius cancels; progress does not persist.

**Detonate.** 35 s from the arm. The round timer stops the moment the bomb is
armed - the bomb timer takes over as the clock.

**Defuse.** A defender standing within the **same radius** for **5 s** defuses.
Any defender; leaving cancels. *(Proposal: progress does not persist across
defusers - simpler, revisit if it feels bad.)*

**Death.** A carrier who dies drops the bomb where they fell. Any attacker may
retrieve it; defenders cannot pick it up or move it. A bomb lying in the open is
recoverable but never denied.

### 5.4 The beeping

The armed bomb beeps positionally, audible to **both** teams - it is how
defenders locate it, and how attackers feel the clock.

| Remaining | Interval |
|---|---|
| 35 -> 10 s | 1.0 s |
| 10 -> 5 s | 0.5 s |
| 5 -> 0 s | 0.25 s |

*(Proposal: a separate one-shot warning in the last 10 s of `RoundLive`, so
attackers who have not planted feel the round clock too. Distinct from the bomb
beep, which does not exist yet at that point.)*

### 5.5 Spawning, freezing and waiting

**On entering `RoundFreeze`:**

1. Every player - living, dead, or spectating a teammate - is respawned at their
   own team's spawn set.
2. Spawn point chosen from the team's points, seeded on round number via the
   existing `rngFrom` so re-simulation and demos agree.
3. Health, armor and weapons reset to the gametype loadout; powerup timers
   cleared (`clearPowerups`, already called on respawn).
4. Map items fully reset (`PickupSystem.resetForMatch`), re-arming the
   first-spawn delay so mega/armor timing is identical every round.
5. Input frozen - players can look but not move, shoot or use.
6. The bomb is placed (5.6).

**On entering `RoundLive`:** input unfrozen. Nothing else changes.

**On death:** no respawn for the rest of the round. The dead follow a living
teammate's view (the demo POV and death-camera machinery already does this
shape). Dead players must not leak information the living cannot see - free-fly
spectating would hand a dead attacker the entire defensive setup.

**On `RoundEnd`:** result beat, scores updated, no respawns. Then either the
next `RoundFreeze`, the halftime intermission, or `PostGame`.

**Halftime:** after round 5, a 10 s intermission, sides swap, round counter
continues. Score follows the *player*, not the side.

### 5.6 Where the bomb spawns

`team_CTF_alphaflag` / `team_CTF_betaflag` look like the obvious anchor and
**are not usable.** Measured on the shipped maps, the flag stands are placed
inconsistently relative to both spawns and sites - on wbomb5 the attacker flag
is *further* from the sites than the attacker spawn is - and **wbomb6 has no
flags at all** while still being a valid bomb map.

| Map | attacker flag -> attacker spawn | flag -> nearest site | spawn -> nearest site |
|---|---|---|---|
| wbomb1 | 2494 | 2520 | 3558 |
| wbomb2 | 2358 | 1693 | 3377 |
| wbomb3 | 1088 | 3591 | 3653 |
| wbomb4 | 2237 | 2540 | 3569 |
| wbomb5 | 1202 | 3474 | 3255 |
| wbomb6 | none | - | 3970 |

They are CTF leftovers, not bomb furniture. So:

1. **If a dedicated bomb-spawn entity is present, use it.** No shipped map has
   one; this exists for custom maps. Proposed classname `misc_bomb_spawn`, read
   by `BombSiteTable` alongside the sites.
2. **Otherwise place it at the attacking team's spawn centroid**, traced down to
   the floor and nudged clear of any spawn point so it never spawns inside a
   player.

Since the fallback covers every shipped map, it is the path that must be solid;
the entity is a convenience.

### 5.7 Items, and the Quad question

Map items stay - that is the Warsow answer, it is already implemented, and it is
the resource game that replaces CS's economy. Two round-level rules:

- **Items reset every round** (5.5). Otherwise round 2 opens with a stripped map
  and the losing side is punished twice.
- **The 15 s first-spawn delay is now round-relative.** In a 90 s round the mega
  appears at the 17% mark rather than once per match. Probably right; wants a
  playtest.

**Quad is disabled in S&D for the first playable version.** All six bomb maps
carry one, and 4x damage in a no-respawn round with no comeback mechanism is a
large variable to introduce while the mode is unproven. `PickupSystem` already
branches on pickup type, so this is a filter, not a feature. Revisit once the
base mode plays well.

## 6. What does not exist yet

Surveyed against the current branch. This is the actual work.

| # | Gap | Evidence |
|---|---|---|
| **G1** | **No round loop.** `MatchState` has no notion of rounds — grepping it for "round" returns zero hits, and `Active` always terminates the match. Much smaller than it first appeared: rounds reuse the existing phase cycle (5.1), so this is one new transition plus an `endRound()` hook, not a second state machine. | `MatchState.ts` |
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

### 7.4 Existing machinery to reuse

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

### 7.5 Verified vs. assumed

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

## 8. Feature matrix

Everything the mode needs, and where each piece actually stands. "Reuse" means
the machinery exists and needs wiring, not writing.

### 8.1 Data and map

| Feature | Status | Notes |
|---|---|---|
| Bomb site extraction | **Done** | `BombSiteTable`, verified against all 6 maps |
| Site containment (cylinder + volumes) | **Done** | `isInsideBombSite` |
| 384 default radius | **Done** | Measured, 5.3 |
| Bomb-map detection | **Done** | `isBombMap` — rejects wdm4/wdm9 |
| Role-vs-geometry assertion | **Done** | `validateBombRoles`, passes 6/6 |
| Team spawn extraction | **Done** | `extractTeamSpawns` |
| Team spawn *selection* | **Build** | `TeamSpawnStrategy.choose()` is a TODO; nothing calls `setTeamPoints` |
| `misc_bomb_spawn` entity | **Optional** | No shipped map has one; fallback covers everything |

### 8.2 Round lifecycle

| Feature | Status | Notes |
|---|---|---|
| Round loop | **Reuse** | A round is the existing `Countdown -> Active` cycle; only the exit transition is new (5.1) |
| Round timer (90 s) | **Reuse** | `Active` already ticks `timeLimit`; reinterpreted as round length |
| Rounds-to-win limit | **Reuse** | `scoreLimit` + `addTeamScore` + the existing check already do this |
| Freeze time (5 s) | **Reuse** | `Countdown` phase; generalize `applyPostGameInputFreeze` to cover it |
| Round end beat | **Reuse** | Absorbed into `countdownDuration` — no extra phase |
| `endRound(winner)` hook | **Build** | A round can end mid-`Active` on defuse/detonation/elimination |
| Post-arm timer swap | **Build** | Gametype-internal `armed` state; not a phase |
| Per-round item reset | **Reuse** | `PickupSystem.resetForMatch` is exactly this |
| Per-round player reset | **Reuse** | `respawnPlayer` already resets health/armor/weapons/powerups |
| Respawn suppression | **Build** | `processRespawns` auto-respawns at a deadline; needs a gate |
| Round scoring | **Build** | Score follows the player across the swap |
| Halftime side swap | **Build** | After round 5 |
| Dead-player spectate | **Reuse** | Demo POV + `DeathCamera` already do follow-cam |

### 8.3 Bomb

| Feature | Status | Notes |
|---|---|---|
| Bomb world entity | **Reuse** | `DroppedWeaponSystem` is the same shape: `EntityType.Item` + metadata + ground settle |
| Spawn at attacker base | **Build** | Centroid + ground trace (5.6) |
| Pickup on touch | **Reuse** | `PickupSystem` proximity pattern, attacker-only |
| Carry state + team-only visibility | **Build** | Replicated flag |
| Carrier glow | **Reuse** | `applyPowerupGlow`, built for Quad |
| Drop below 100 ups in site | **Build** | Per-tick speed check while carrying |
| Drop on death | **Reuse** | `DroppedWeaponSystem.queueDrop` |
| Arm channel (4 s) | **Build** | No channelled-action system exists |
| Defuse channel (5 s) | **Build** | Same system |
| 35 s detonation timer | **Build** | |
| Explosion effect | **Reuse** | `ExplosionEffect` + `target_explosion` already on the maps |

### 8.4 Client / feedback

| Feature | Status | Notes |
|---|---|---|
| Arm/defuse progress UI | **Build** | Bar or pie — visual choice deferred |
| Bomb beep, 3-stage | **Build** | Scheduled `playSfx3D` at varying interval |
| Round timer HUD | **Reuse** | `FPSTimer` widget exists |
| Round score HUD | **Build** | Extend `MatchStateSnapshot` |
| Site markers / compass | **Optional** | Not required for a playable version |
| Bomb carrier indicator | **Build** | Team-only |

### 8.5 Bots

| Feature | Status | Notes |
|---|---|---|
| Goal arbitration | **Done** | Phases 1-4 |
| Weight profiles per role/round state | **Reuse** | `selectWeightProfile` key scheme already supports it |
| Directive emission | **Reuse** | `getAgentDirectives` landed |
| `teamRoles` / `roundState` on the wire | **Build** | Designed; bot side already reads them |
| Site-splitting logic | **Build** | Gametype decides which defender holds which site |
| Plant / defuse sequences | **Build** | `BotSequence` runtime is the right home |
| `map_control` consideration | **Build** | Weight key exists, no consideration behind it |
| Retake coordination | **Deferred** | Bots will path independently at first |

### 8.6 Summary

| | Count |
|---|---|
| Done | 7 |
| Reuse (wire, don't write) | 14 |
| Build | 20 |
| Optional / deferred | 4 |

The ten reuses are what make this tractable: round reset, player reset, input
freeze, dropped-item entities, carrier glow, follow-cam, explosion FX, the timer
widget, and the whole bot goal stack are all already built and tested.

The build column now concentrates in **two** places: the channelled-action
system (arm/defuse, needed by players *and* bots) and the bomb entity. The round
lifecycle left the list once rounds were modelled as the existing phase cycle
rather than a nested state machine (5.1) — the single largest simplification in
the design so far.

## 9. Implementation order

Each step independently verifiable; the early ones are useful even if the mode
stalls. The feature matrix (8.6) says the build work concentrates in three
places — **the round state machine, the channelled-action system, and the bomb
entity** — so those get designed before they get typed.

**S1 — `BombSiteTable`. DONE.** `src/shared/bsp/BombSiteTable.ts` + 24 tests.
Shared extraction, `isBombMap()`, `extractTeamSpawns()`, `isInsideBombSite()`
(cylinder per 3.3) and `validateBombRoles()` (4.1).

Verified against the real BSPs of all six bomb maps: 2 sites each, volume counts
1/1, 0/0, 0/0, 0/0, 4/2, 4/3, wbomb6 labelled B/A exactly as the out-of-order
prediction said, and wdm4/wdm9/wdm2 correctly rejected. Unit tests use fixtures
rather than pk3s so they run wherever the suite does.

**S2 — Team spawns.** Implement `TeamSpawnStrategy.choose()`, wire
`setTeamPoints()` from the extractor, deterministic per-round distribution.
Includes the 4.1 role-vs-geometry assertion at map load.

*Required by S&D* — every round spawns both teams at their own spawn set. (It
also fixes TDM, which currently falls back to `"furthest"` because team spawns
were never implemented; that is now a side benefit rather than the reason, since
TDM is leaving the menu.)

**S3 — Round loop.** Reuses the phase cycle (5.1), so this is far smaller than
it first looked: a round-based exit from `Active` (back to `Countdown`, or to
`PostGame` on the score limit), an `endRound(winner)` hook for round ends that
are not timer expiries, input freeze extended to `Countdown`, respawn
suppression, per-round reset via `resetForMatch`, and the halftime swap.

Still the step that touches shared match code, so: **land it with TDM and Duel
green at every commit**, and keep every round-specific branch behind a
`roundBased` config flag so non-round modes take exactly the path they take
today.

**S4 — Channelled actions.** A shared arm/defuse progress system: start
condition, per-tick continuation, cancel on leaving the radius, replicated
progress for the HUD. Needed by players *and* bots, so it belongs in shared
simulation rather than in the gametype.

**S5 — The bomb.** Entity (modelled on `DroppedWeaponSystem`), spawn placement,
pickup, carry state, the <100 ups in-site drop, drop-on-death, detonation, and
the beep.

**S6 — Wire the mode.** `teamRoles` + `roundState` into `MatchStateSnapshot`;
the `snd:*` weight profiles; the directive emitter; Quad filtered out.

**S7 — Bot channelled actions.** `plant_bomb` / `defuse_bomb` sequences on the
existing `BotSequence` runtime.

**S8 — Playtest and tune.** Every "Proposed" row in 4.2 is a first guess.

## 10. Open questions

Resolved this round, kept for the record:

| | Question | Resolution |
|---|---|---|
| ~~Q1~~ | Is alpha the defending team? | **Verified 6/6** by `validateBombRoles` over the real BSPs. Geometry is unambiguous; still worth confirming against Warsow itself, and the load-time assertion stays either way. |
| ~~Q3~~ | Does the <100 ups drop apply everywhere? | **Only inside a site.** Carrying across the map is safe; the rule is the plant initiation, not a movement tax. |
| ~~Q4~~ | Where does the bomb spawn? | **Attacker spawn centroid**, ground-traced. `team_CTF_*flag` measured and rejected: inconsistent placement, absent on wbomb6 (5.6). |
| ~~Q7~~ | Items reset per round? | **Yes.** Persisting punishes the losing side twice. |

Still open:

| | Question | Leaning |
|---|---|---|
| Q2 | Vertical band for the 384 fallback cylinder | `DEFAULT_BOMBSITE_HALF_HEIGHT = 192` is the least-evidenced number in the design. The volumes say how tall a *site* is, not how far above a bare indicator a plant should count. Playtest. |
| Q5 | Freeze time length | 5 s proposed, unconfirmed. The only timing the spec did not fix. |
| Q6 | Does defuse progress persist across defusers? | No, for simplicity; revisit if it feels bad. |
| Q8 | Quad in S&D | Disabled initially (5.7); revisit once the mode plays. |
| Q9 | Rounds to win / swap point | 6 and after round 5 proposed, unconfirmed. |
| Q10 | Can defenders *move* a dropped, unarmed bomb? | No — recoverable but never denied. Confirm this matches Warsow. |
| Q11 | Does the round-end beat show who won and why? | Assumed yes; needs a HUD decision. |

## 11. Risks

- **S3 still touches shared match lifecycle**, even though modelling rounds as the existing phase cycle (5.1) shrank it a lot. The round-specific branches must sit behind a `roundBased` flag so Deathmatch, TDM and Duel keep taking exactly the path they take today — a regression here breaks every mode at once.
- **The mode is unplayable if roles are backwards** and the failure is silent in code (§4.1). The load-time assertion is not optional.
- **Bots will look worst here first.** That is the point of building it, but expect the first playtest to expose gaps in *movement* and *combat* rather than in goal selection — the goal layer is the best-tested part of the bot.
- **Timings are all first guesses.** They are reasoned from measured map geometry rather than copied, which makes them better starting points, not correct ones.
- **No channelled-action system exists**, for players or bots. S4 and S6 are more than they look.
