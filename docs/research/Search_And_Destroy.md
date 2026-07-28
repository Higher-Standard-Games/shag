# Search & Destroy

> A round-based bomb-and-defuse gametype, Warsow Bomb compatible, designed to put the bot goal framework under real load.

**Date:** 2026-07-28
**Status:** S1-S6 implemented — the mode is playable end to end against bots that do not yet understand it. S7 (bot plant/defuse) and S8 (playtest) remain.
**Scope:** `src/games/fps/server/gametypes`, `src/shared/bsp`, `src/shared/bot`
**Depends on:** [`BOT_WEIGHTS_AND_GOALS.md`](BOT_WEIGHTS_AND_GOALS.md) Phases 1–4 (landed)

**Hard requirement:** compatible with Warsow's Bomb entity contract, so all six shipped `wbomb*` maps play unmodified.

> **The original gametype source ships with the game.** `data0_21pure.pk3`
> contains `progs/gametypes/bomb/*.as` — Warsow's actual bomb implementation in
> AngelScript (main, bomb, round, site, player, media, **bots**), about 93 KB.
> It is the authoritative answer to every rule, constant and edge case in this
> document, and §4.4 records where it corrected assumptions that had been
> inferred from map geometry and from Counter-Strike.

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

**Test pool: `wbomb2` ("Reactors").** The original Warsow bomb development map
— flat, with doors and interior structure. Tagged `snd` in `config/maps.json`;
`wbomb1` left the duel pool and `wdm17` ("Le Toxiquet") took its place.

Usefully, wbomb2 is one of the three maps with **no `trigger_capture_area`**, so
testing on it exercises the 384 radius fallback (§3.3) — the path that covers
half the bomb maps and would otherwise go unexercised until later.

The remaining bomb maps join the pool when the mode ships. One manifest gap
stays open: nothing validates that a map tagged for a gametype can actually host
it. `isBombMap()` (S1) makes that checkable — an `snd`-tagged map that fails it
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
| Bomb timer | 40 s | 45 s | 30 s |
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

### 4.1 Roles, and a lesson about inferring rules from geometry

**Alpha attacks. Beta defends.** That is the Warsow rule and it is the spec.

It is worth recording that measurement led me to the opposite conclusion, and
why. Across the shipped maps, alpha spawns markedly *nearer* the bombsites:

| Map | alpha → nearest site | beta → nearest site |
|---|---|---|
| wbomb1 | 624 | 3438 |
| wbomb2 | 2644 | 3191 |
| wbomb3 | 1111 | 3574 |
| wbomb4 | ~908 | ~3569 |
| wbomb5 | ~1952 | ~3255 |
| wbomb6 | ~2212 | ~3970 |

In Counter-Strike and Call of Duty the sites sit in the **defenders'** half, so
the side spawning nearer must be defending. Applying that rule here gives
"alpha defends" — confidently, consistently, and wrongly.

**The geometry was measured correctly; the rule imported to interpret it was
from a different game.** Warsow Bomb simply does not place its objectives the
way CS does. Measurement can tell you what a map looks like; only the game's own
rules tell you what that shape means.

The practical consequence was a real defect: `validateBombRoles()` asserted that
defenders must spawn nearer, and would have rejected **every shipped bomb map**.
It has been replaced by `analyzeBombRoleGeometry()`, which reports distances and
warns only about a layout that is broken on its own terms — an attacker spawn so
close to a site (`TRIVIAL_PLANT_DISTANCE`, 700 u) that a plant could begin before
defenders could possibly contest it.

#### wbomb2 is the properly designed bomb map

Per-spawn measurement also shows why wbomb2 is the right test choice. It is the
only map where the two teams are each nearer a *different* site:

| Map | alpha → site A / site B | beta → site A / site B |
|---|---|---|
| **wbomb2** | 2644 / 3844 | 3825 / **3191** |
| wbomb1 | **624** / 1964 | 3747 / 3438 |
| wbomb3 | **1111** / 1389 | 3574 / 4606 |

wbomb2 is near-symmetric, with each side holding an approach — consistent with
it being the original bomb development map. wbomb1 and wbomb3 are lopsided,
which fits their being converted CTF layouts, and wbomb1 in particular will trip
the trivial-plant warning at 624 units.

### 4.2 Timings that follow

Full map traversal here costs 3–5 s where CS costs 20–30 s. Copying CS's clocks would produce a mode that is mostly standing around.

| Parameter | Value | Source |
|---|---|---|
| **Freeze time** | **5 s** | Proposed. No buy phase to fill; enough to read the map and pick a side. CS needs 15-20 s only because of the shop. *Unconfirmed.* |
| **Round time** | **1:30 (90 s)** | **Ours.** Warsow uses 60 s. Kept deliberately: 90 s was chosen with the map traversal times in 3.4 in hand, and it is one cvar to try the other. |
| **Bomb timer** | **30 s** | **Warsow** (`g_bomb_bombtimer`). We had guessed 35 s. |
| **Plant (arm)** | **4 s** | **Warsow** (`g_bomb_armtime`). Standing near the planted bomb, not a held button - see 5.3. |
| **Defuse** | **7 s** | **Warsow** (`g_bomb_defusetime`). We had guessed 5 s; defusing is deliberately slower than arming, which is what makes a late retake a real gamble. |
| **Plant speed** | **< 400 ups** | **Warsow** (`BOMB_MAX_PLANT_SPEED`). We had guessed 100. |
| **Spawn protection** | **3 s** | **Warsow** (`g_bomb_spawnprotection`). Not yet planned; see 4.4. |
| **Round end** | **4 s** | Proposed. Result beat before the next freeze. |
| **Halftime** | **10 s** | Proposed. Side swap intermission after round 9 (4.3). |
| **Score limit** | **10** | **Ours.** Warsow uses 16. Kept: a shorter match suits a game with no economy to build across a half. See 4.3. |
| **Lead required** | **2** | Warsow tennis rule. At 9-9 play continues until a team is two clear. |
| **Side swap** | after round 9 | Proposed. One team attacks the whole first half; 9 makes the limit unreachable before the swap. |

Where "ours" differs from Warsow it is a deliberate choice rather than an
oversight — everything we had merely *guessed* now takes Warsow's number (4.4).

These are `MatchConfig` fields reinterpreted for a round mode (5.1), not new configuration. All of them belong in `MatchConfig` and should be env-overridable like `SHAG_TIMELIMIT` already is — they are the first thing a playtest will want to move.

---

### 4.3 Match format: tennis rule and the one-sided swap

Warsow Bomb runs a **score limit of 16 with a two-point lead requirement** — at
15-15 nobody has won, and rounds continue until one team is two clear. It also
does something that looks odd until you know why: **one team attacks for the
entire first half**, then the sides swap, rather than alternating each round.

The reasoning is that attacking is the stronger side. Alternating every round would
hand the advantage back and forth and mostly measure who got the odd rounds; a
clean split gives each team the same number of attacking rounds, so the format
measures how well each side used its favoured half.

**Proposed for this game — the same shape, shortened:**

| Parameter | Value |
|---|---|
| Score limit | **10** |
| Lead required | **2** (tennis rule) |
| Sides swap after | **round 9** |
| Attacker at start | **alpha** |

Nine rounds before the swap means the maximum score reachable in the first half
is 9, so **the swap can never be skipped** — no team can win without playing both
sides. At 9-9 the tennis rule takes over and play continues until a two-round
lead.

`MatchConfig.scoreLimit` already exists and is already checked against team
scores. The lead requirement and the swap round are new fields; `overtimeOnDraw`
is a *duel* rule (extend time on a tie) and is not the same thing.

**Overtime alternates.** Once both halves are played the half-split has done its
job — each team has had its nine attacking rounds — so overtime switches to
alternating sides every round. The per-round advantage the split exists to avoid
is no longer a concern, because from here the requirement is a *two-round lead*,
and a lead of two spans one attack round for each team however the sides fall.

Full sequence:

```text
rounds 1-9    alpha attacks          first half
              (max reachable score is 9, so the swap can never be skipped)
   swap
rounds 10-18  beta attacks           second half
              match ends the moment a team has >= 10 AND leads by >= 2
   9-9 after 18 rounds
rounds 19+    sides alternate        overtime, until a team leads by 2
```

A team reaching 10 without a two-round lead does **not** win — 10-9 continues.
That is the tennis rule, and it is why overtime is reached at 9-9 rather than
being a separate tie-break.

### 4.4 Ground truth from the Warsow source

Constants read directly from `progs/gametypes/bomb/`. Where our plan differed,
the plan was a guess and this is not.

| | Our plan | Warsow | Notes |
|---|---|---|---|
| Round time | 90 s | **60 s** (`g_bomb_roundtime`) | I argued for 90 s because movement here is fast; Warsow has the same movement and uses 60. The direction was right and did not go far enough. |
| Bomb timer | 35 s | **30 s** (`g_bomb_bombtimer`) | |
| Arm time | 4 s | **4 s** (`g_bomb_armtime`) | Matched. |
| Defuse time | 5 s | **7 s** (`g_bomb_defusetime`) | Defusing is deliberately slower than arming. |
| Score limit | 10 | **16** (`g_scorelimit`) | |
| Swap after | round 9 | round `scoreLimit - 1` | **Same formula.** |
| Lead required | 2 | `abs(alpha - beta) > 1` | **Same rule.** |
| Overtime | alternate each round | `roundCount >= roundLimit * 2` | **Same rule.** |
| Initial attacker | alpha | `INITIAL_ATTACKERS = TEAM_ALPHA` | **Confirmed.** Settles §4.1. |
| Plant speed | < 100 ups | **< 400 ups** (`BOMB_MAX_PLANT_SPEED`) | |
| Spawn protection | — | 3 s (`g_bomb_spawnprotection`) | Not yet planned. |

**Four mechanics the source corrected, all of which change behaviour rather than
just numbers:**

1. **There are two radii, and this document conflated them.**
   `BOMB_ARM_DEFUSE_RADIUS = 100` is measured from *the planted bomb*.
   `BOMB_AUTODROP_DISTANCE = 400` is measured from *the site indicator* and is
   what decides where a plant is legal. Using the site radius for arming would
   let a bomb be defused from anywhere in the room. (The measured-from-brushes
   estimate of 384 in §3.3 was a good approximation of the second number.)

2. **Progress is shared and decays.** Warsow keeps one counter on the bomb:
   `bombProgress += frameTime` while any qualifying player is near, and
   `-= frameTime` when none are. It is not per-player and it does not reset.
   That is a better game — an interrupted defuse bleeds down rather than
   vanishing, so trading a kill and stepping back in is a real play, and the
   falling bar tells a defender exactly how long they have. **Answers Q6.**

3. **Planting also requires level ground.** A downward trace must find a surface
   with `normal.z >= 0.90`. The source's own comment notes this removes real
   plant spots such as wbomb1's B ramp — a gameplay rule, not a technicality.

4. **Planting is not arming.** The carrier slowing in a zone *plants* the bomb
   immediately; arming is the separate 4 s hold that follows. Our model had
   collapsed the two into "drop, then stand on it".

Also worth taking, though not yet implemented: the beep interval is one twelfth
of the time remaining, clamped to 200–5000 ms, which accelerates smoothly with
no staged thresholds to tune; a manual drop *throws* the bomb (300 ups) and
locks the dropper out of retaking it for 1 s; and `bots.as` exists, which is
worth reading before Phase 7.

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

**Drop-to-plant.** Inside a bombsite, on ground flat enough to place it on, the
carrier's speed falling below **400 ups** plants the bomb where they stand. That
is the plant initiation - there is no plant button. Outside a site the rule does
not apply, so crossing the map is never a movement skill check.

**Arm.** With the bomb planted, an attacker standing within **100 units of the
bomb** - not merely inside the site - for **4 s** arms it. Any attacker can arm,
not only whoever carried it. Leaving does not cancel: the shared meter decays
(4.4), so the site is a fight over ground rather than an all-or-nothing channel.

**Detonate.** 30 s from the arm. The round timer stops the moment the bomb is
armed - the bomb timer takes over as the clock.

**Defuse.** A defender standing within the **same 100 units** for **7 s**
defuses - slower than arming, by design. Any defender; leaving decays rather
than cancels. *(Superseded note: progress does not persist across
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

**Halftime:** after round 9 (4.3), a 10 s intermission, sides swap, round
counter continues. Score follows the *team*, and the team keeps its score across
the swap — it is the SIDE that changes, not who the points belong to.

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
| Role-vs-geometry report | **Done** | `analyzeBombRoleGeometry` — reports distances; the assertion it replaced would have rejected every shipped map (4.4) |
| Team spawn extraction | **Done** | `extractTeamSpawns` |
| Team spawn *selection* | **Done** | `TeamSpawnStrategy.choose(…, teamId)`, wired from the extractor |
| `misc_bomb_spawn` entity | **Optional** | No shipped map has one; fallback covers everything |

### 8.2 Round lifecycle

| Feature | Status | Notes |
|---|---|---|
| Round loop | **Done** | A round is the existing `Countdown -> Active` cycle; only the exit transition is new (5.1) |
| Round timer (90 s) | **Done** | `Active` already ticks `timeLimit`; reinterpreted as round length |
| Rounds-to-win limit | **Done** | `scoreLimit` + `addTeamScore` + the existing check already do this |
| Freeze time (5 s) | **Done** | `Countdown` phase; generalize `applyPostGameInputFreeze` to cover it |
| Round end beat | **Reuse** | Absorbed into `countdownDuration` — no extra phase |
| `endRound(winner)` hook | **Done** | A round can end mid-`Active` on defuse/detonation/elimination |
| Post-arm timer swap | **Done** | `onRoundTimeExpired` returns null while armed — the bomb's timer supersedes the round's |
| Per-round item reset | **Done** | `PickupSystem.resetForRound`, at the freeze |
| Per-round player reset | **Done** | `respawnAllPlayers` at the freeze, not at the go |
| Respawn suppression | **Done** | `processRespawns` returns early in a live round |
| Round scoring | **Done** | Frags no longer touch the team score, which IS the round count |
| Halftime side swap | **Done** | After round 9 |
| `onRoundStart` hook | **Done** | Runs before the reset and respawns, so a mode's decisions are true when players appear |
| Dead-player spectate | **Reuse** | Demo POV + `DeathCamera` already do follow-cam |

### 8.3 Bomb

| Feature | Status | Notes |
|---|---|---|
| Bomb world entity | **Done** | Not an ECS entity — the bomb is gametype state replicated as an objective snapshot, since nothing else needs to collide with it |
| Spawn at attacker base | **Done** | Centroid + ground trace, following the ROLE so the half-swap moves it |
| Pickup on touch | **Done** | `BombModel.updatePickup`, attacker-only |
| Carry state | **Done** | `BombModel` (S5), replicated (S6) |
| Carrier backpack model | **Done** | `BombRenderer` attaches to the carrier's spine bone |
| Carrier glow | **Optional** | The backpack model reads better than a glow; revisit at playtest |
| Plant below 400 ups on flat ground in site | **Done** | `BombModel` (S5) |
| Drop on death | **Reuse** | `DroppedWeaponSystem.queueDrop` |
| Arm channel (4 s) | **Done** | `BombModel` over `ChannelTracker` |
| Defuse channel (7 s) | **Done** | Same, with the defender precondition |
| 30 s detonation timer | **Done** | `BombModel` (S5) |
| Explosion effect | **Reuse** | `ExplosionEffect` + `target_explosion` already on the maps |

### 8.4 Client / feedback

| Feature | Status | Notes |
|---|---|---|
| Arm/defuse progress UI | **Done** | Bar. It also renders DECAY in a different colour, which a pie could not do legibly — the direction is the information (4.4) |
| Bomb beep | **Done** | `FPSBombAudio`, on the server's interval — no stages to tune |
| Blinking timer light | **Done** | Same interval as the beep, so light and sound are one signal |
| Announcer | **Done** | Warsow's own per-side offense/defense lines, shipped in the pk3s |
| Round timer HUD | **Reuse** | `FPSTimer` widget exists |
| Round score HUD | **Done** | `round` + `teamRoles` + `roundState` on `MatchStateSnapshot` |
| Site markers / compass | **Optional** | Site positions ARE on the wire now; drawing them is deferred |
| Bomb carrier indicator | **Optional** | The backpack model is visible to everyone; a team-only marker is a later refinement |

### 8.4b Loadouts and items

Not in the original plan. Warsow Bomb turned out to be a pure loadout mode —
it zeroes every item mask (4.4) — which forced the question of what a player
starts a round with when the map still spawns items.

| Feature | Status | Notes |
|---|---|---|
| Blade + primary + secondary | **Done** | `shared/server/gametype/Loadout.ts`. One power weapon, not Warsow's pair: with map weapons still spawning, two would leave nothing worth walking to |
| Warsow spawn ammo and armor | **Done** | `AMMO_*` and `PLAYER_ARMOR` from `player.as` |
| Applies from the NEXT round | **Done** | Never mid-round, even when dead — re-kitting a lost gunfight is a free retry |
| `loadout` console command | **Done** | Short names work, including Warsow's (`lg` is the Voltaic here) |
| Loadout menu | **Build** | The console is the whole interface today |
| One item per round | **Done** | `ItemRespawnMode.round` — a 25 s armor timer means nothing in a 90 s round |
| Alternating scarcity | **Optional** | `ItemRespawnMode.alternating` is implemented and tested. Off: it is invisible without HUD support, and it leaves the second half inheriting the first half's depleted map, which breaks the mirror the side swap exists to provide |

### 8.5 Bots

| Feature | Status | Notes |
|---|---|---|
| Goal arbitration | **Done** | Phases 1-4 |
| Weight profiles per role/round state | **Reuse** | `selectWeightProfile` key scheme already supports it |
| Directive emission | **Reuse** | `getAgentDirectives` landed |
| `teamRoles` on the wire | **Done** | Designed; bot side already reads them |
| Site-splitting logic | **Build** | Gametype decides which defender holds which site |
| Plant / defuse sequences | **Build** | `BotSequence` runtime is the right home |
| `map_control` consideration | **Build** | Weight key exists, no consideration behind it |
| Retake coordination | **Deferred** | Bots will path independently at first |

### 8.6 Summary

| | Count |
|---|---|
| Done | 24 |
| Reuse (wire, don't write) | 8 |
| Build | 9 |
| Optional / deferred | 4 |

The ten reuses are what make this tractable: round reset, player reset, input
freeze, dropped-item entities, carrier glow, follow-cam, explosion FX, the timer
widget, and the whole bot goal stack are all already built and tested.

With the round lifecycle (S3) and the channelled-action system (S4) both landed,
the remaining build work is concentrated almost entirely in **the bomb entity
and its client feedback** — spawn placement, carry state, the in-site speed
drop, detonation, the beep, and the progress UI. The two pieces that looked
structural at design time are done.

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

**S2 — Team spawns. DONE.** `src/shared/bsp/SpawnPointTable.ts` +
`TeamSpawnStrategy.choose()` + 19 tests.

The spawn classname list had been duplicated in three files and every copy
listed only the Quake conventions, so `team_CTF_*spawn` matched nothing —
every team spawn on every CTF and bomb map was invisible. Verified against the
real BSPs: udon/soba counts 9/7, 8/16, 6/6, 6/9, 8/8, 4/6 across wbomb1-6,
matching the survey exactly, and wdm2 correctly reporting none.

`choose()` gained a `teamId` parameter — without it a team strategy cannot
possibly pick the right side. It deliberately skips furthest-from-enemy
scoring, which would throw a defender across the map.

**No behavioural change to duel or ffa**: checked every map in those pools and
none carries team spawns, so their spawn sets are byte-identical.

*The 4.1 role assertion is NOT included here.* `validateBombRoles()` exists and
is tested (S1), but it needs to know which team attacks — a gametype decision.
It gets called in S6, when there is a gametype to call it from.

*Required by S&D* — every round spawns both teams at their own spawn set. (It
also fixes TDM, which currently falls back to `"furthest"` because team spawns
were never implemented; that is now a side benefit rather than the reason, since
TDM is leaving the menu.)

**S3 — Round loop. DONE.** `MatchState` round machinery + `endRound()` +
`onRoundTimeExpired()` hook + 20 tests.

Reusing the phase cycle kept it small, as predicted. `roundBased`,
`roundsPerHalf` and `leadRequired` join `MatchConfig`; `Active` loops back to
`Countdown`; the half-split, overtime alternation and tennis rule all landed.

**MatchState owns the round loop but not the round rules.** An expired timer
sets a flag rather than deciding a winner — "defenders win if nothing was
planted" is an S&D rule. The controller reads the flag, asks the gametype, and
calls `endRound()`. Round ends that are not timer expiries come through the
same door.

*One subtle bug caught on the way:* `transition(Active)` resets scores, which is
right once per match and catastrophic once per round. Round modes now reset only
on round 1.

Respawns are suppressed inside a live round; input freeze extended to cover
`Countdown`. Everything sits behind `roundBased`, with tests pinning that
non-round modes still end on the timer, still reset scores on `Active`, and
publish no round context.

*Still outstanding from this step:* the per-round item reset
(`PickupSystem.resetForMatch`) is not yet called on round start, and the
halftime intermission is a plain `Countdown` rather than a longer break. Both
land with the gametype in S6.

**S4 — Channelled actions. DONE.**
`src/shared/server/simulation/ChannelledAction.ts` + 17 tests.

Deliberately **declarative, not imperative**: there is no `begin()`/`cancel()`
pair. Each tick the caller states what a player *could* be channelling right now
— or `null` — and the tracker decides start / progress / complete / cancel.

That shape was chosen because the cancel conditions for a real channel are
numerous and easy to forget: left the radius, died, target destroyed, round
ended, bomb picked up by someone else, weapon switched. With an imperative API
each is a call site that can be missed, and one miss leaves a player invisibly
arming a bomb they walked away from. Stating the precondition once per tick
makes forgetting impossible.

Ticks, not seconds, so demo re-simulation cannot drift. Progress does not
survive an interruption (§9 Q6), and switching kind or target discards it too —
walking from site A to site B never carries progress over. Several entities may
channel the same target at once, each with their own progress and first to
finish winning, which falls out rather than needing a rule.

*Caught while testing:* "hold for 5 ticks" originally took 6 updates, because
the starting tick did not count. Making it count also removed the special case
for a one-tick channel.

**S5 — The bomb rules. DONE (rules); entity wiring remains.**
`src/shared/server/gametype/BombModel.ts` + 25 tests.

Carry, the in-site speed drop, arm, defuse, detonation and reset, as a pure
model the caller feeds a view of the world each tick. It touches no
`WorldState`, spawns nothing and plays no sound — these rules interact in fiddly
ways (a carrier who dies mid-plant, a bomb dropped outside a site, a defuse
landing on the detonation tick) and are far cheaper to get right against a table
of cases than against a running server.

*Two rules the tests forced into the open:*

- **A bomb lying INSIDE a site cannot be picked up.** Otherwise planting is
  impossible: the carrier drops it by slowing down and instantly retrieves it
  from the same spot. The consequence is that a bomb cannot be relocated from
  site A to site B once committed, which is the right trade.
- **Channels resolve before the detonation deadline**, so a defuse completing on
  the final tick wins. Defenders arriving at the last possible instant is the
  most memorable thing in the mode; it should not lose to an ordering accident.

**S6 — The gametype. DONE.** `SearchAndDestroy.ts` + 32 tests, plus the
loadout table, the objective snapshot, and the client that draws it.

The mode itself is thin, which was the point: `BombModel` owns the bomb and
`MatchState` owns the round loop, both shared and tested alone, so the gametype
is wiring — read the map, build the bomb's view of the world each tick, turn its
events into round results.

Two hooks on `BaseGametype` carry it, both defaulting to no-ops so no other mode
pays for them: `onMapLoad` hands over the raw BSP lumps for a mode to extract
its own authoring, and `onTick` is the objective tick. `onTick` RETURNS a round
result rather than calling back into the controller, so a mode holds no
reference to it and stays testable standing up. `onRoundTimeExpired` returns the
same shape, where null means *the round continues* — which is how an armed bomb
outlives the round clock.

*Round-end rules taken from Warsow's `checkPlayersAlive`, asymmetric on purpose:*
killing every defender wins outright, since nothing can stop the plant. Killing
every attacker only wins if the bomb is NOT armed — otherwise the defenders
still have to walk over and defuse it, which is the tensest thing in the mode.

*Four ordering bugs this surfaced,* none of them visible until a round mode
existed to trip them:

- **Frags were about to award rounds.** In a round mode the team score IS the
  round count, so kills must not touch it. Personal score still counts frags.
- **The round counter advanced when the round went LIVE**, so the freeze was
  setting up for the previous round's attacker. Invisible in the first half,
  wrong at the swap. It now advances at the freeze, where the round begins.
- **Round modes respawned at the go**, making the freeze five seconds of
  standing around dead. Reset and respawn now happen at the freeze, which is
  what a freeze is for.
- **`getSpawnLoadout()` had no player**, so a per-player kit was impossible.

*Loadouts and items* came out of the discovery that Warsow Bomb has no map items
at all (4.4) — see 8.4b.

*On the wire:* the bomb travels as an `objective` on the existing `match_state`
event, which is already the variable-shape JSON channel, so no binary layout
work. Every time value crosses in SECONDS: the client has no tick rate to divide
by, and a HUD that needs one breaks the day the rate changes.

*Client:* a procedural dynamite bundle that rides the carrier's spine bone,
turns on the ground, or sits planted with a timer light; a HUD slab with the
phase, the fuse and the shared progress meter; Warsow's own beep and per-side
announcer lines. The light and the beep run off the SAME server-computed
interval, so they are one signal rather than two clocks drifting apart.

*Still open from the original S6 scope:* the `snd:*` weight profiles and the
Quad filter. Both belong with S7, since neither does anything until bots
understand the objective.

**S7 — Bots.** `plant_bomb` / `defuse_bomb` sequences on the existing
`BotSequence` runtime, the `snd:*` weight profiles, and the Quad filter.

Bots cannot currently fetch a bomb they cannot see; the objective snapshot (S6)
is what unblocks this. Worth reading `progs/gametypes/bomb/bots.as` first — it
is Warsow's own objective-bot logic and it ships in the pk3.

**S8 — Playtest and tune.** Every "Proposed" row in 4.2 is a first guess.

## 10. Open questions

Resolved this round, kept for the record:

| | Question | Resolution |
|---|---|---|
| ~~Q1~~ | Is alpha the defending team? | **No — alpha attacks** (`INITIAL_ATTACKERS = TEAM_ALPHA`). I had inferred the opposite from spawn geometry and was wrong; `analyzeBombRoleGeometry` now reports distances rather than asserting a role, since the assertion would have rejected every shipped map. |
| ~~Q3~~ | Does the slow-speed drop apply everywhere? | **Only inside a site**, and the threshold is **400 ups, not 100** (§4.4). Carrying across the map is safe; the rule is plant initiation, not a movement tax. |
| ~~Q4~~ | Where does the bomb spawn? | **Attacker spawn centroid**, ground-traced. `team_CTF_*flag` measured and rejected: inconsistent placement, absent on wbomb6 (5.6). |
| ~~Q6~~ | Does defuse progress persist across defusers? | **Yes — and it decays rather than resetting.** One shared counter on the bomb (§4.4). |
| ~~Q7~~ | Items reset per round? | **Yes.** Persisting punishes the losing side twice. |
| ~~Q9~~ | Who attacks in overtime? | **Sides alternate every round.** The half-split has already given each team its nine attacking rounds; a two-round lead spans one attack round each however the sides fall (4.3). |

Still open:

| | Question | Leaning |
|---|---|---|
| Q2 | Vertical band for the 384 fallback cylinder | `DEFAULT_BOMBSITE_HALF_HEIGHT = 192` is the least-evidenced number in the design. The volumes say how tall a *site* is, not how far above a bare indicator a plant should count. Playtest. |
| Q5 | Freeze time length | 5 s proposed, unconfirmed. The only timing the spec did not fix. |

| Q8 | Quad in S&D | Disabled initially (5.7); revisit once the mode plays. |

| Q10 | Can defenders *move* a dropped, unarmed bomb? | No — recoverable but never denied. Confirm this matches Warsow. |
| Q11 | Does the round-end beat show who won and why? | Assumed yes; needs a HUD decision. |

## 11. Risks

- **S3 still touches shared match lifecycle**, even though modelling rounds as the existing phase cycle (5.1) shrank it a lot. The round-specific branches must sit behind a `roundBased` flag so Deathmatch, TDM and Duel keep taking exactly the path they take today — a regression here breaks every mode at once.
- **The mode is unplayable if roles are backwards** and the failure is silent in code (§4.1). The load-time assertion is not optional.
- **Bots will look worst here first.** That is the point of building it, but expect the first playtest to expose gaps in *movement* and *combat* rather than in goal selection — the goal layer is the best-tested part of the bot.
- **Timings are all first guesses.** They are reasoned from measured map geometry rather than copied, which makes them better starting points, not correct ones.
- **No channelled-action system exists**, for players or bots. S4 and S6 are more than they look.
