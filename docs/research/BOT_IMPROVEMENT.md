# Bot Improvement Investigation

> Deliberate combat sequences, movement skill, map memory, team safety, human-like behavior, and gametype-directed goals.

**Date:** 2026-07-21
**Status:** Phase 0–3 foundation merged to `main`; implementation deliberately paused at this checkpoint
**Scope:** Headless bots in `src/bot`, FPS gametypes in `src/games/fps`, and the minimum shared network contracts needed to connect them

### Current pause point

The first generalized-map milestone is complete and work is paused here for playtesting and prioritization. Nothing in this slice hardcodes `wdm2` coordinates: bots derive typed navigation, trigger metadata, pickup identities, and bounded movement opportunities from the loaded BSP, then persist only versioned static results. `wdm2` is a repeatable validation map, not authored bot knowledge.

Landed at this checkpoint:

- team-safe per-bot perception, pickup-mask reasoning, and a final friendly-fire gate;
- typed A* navigation with exact teleporter/jumppad steps, validated falls and ordinary jumps, failed-edge cooldowns, and replanning;
- BSP-hashed/schema-versioned static map caches plus the reproducible `bot:analyze` report path;
- deterministic, snapshot-verified sequences for ordinary jumps, route crouchslides, conservative strafe jumps, trigger traversal, and final-edge slides into active items;
- authoritative FPS movement defaults/fingerprints shared with bot analysis so cached opportunities invalidate when physics changes.

Resume from the remaining unchecked work below. The next coherent milestone is richer arbitrary-surface discovery and speed/wall/ledge movement analysis, followed by blade-slide and rocket-drop combat choreography. Gametype directives, humanization, empirical traversal memory, and neural training remain later phases; online gradient updates should not begin until attempt/outcome attribution and safety evaluation are versioned and testable.

### Implementation progress

Phase 0 landed as the correctness foundation before advanced movement and combat sequences:

- [x] Create matching root and FPS-submodule feature branches.
- [x] Keep BSP collision/map knowledge shared while forking LOS cache and enemy memory per bot.
- [x] Derive explicit `ally`/`enemy` relations from replicated player teams; empty FFA teams remain enemies.
- [x] Prevent allies from entering enemy vision, hearing memory, nearest-enemy fallbacks, recorder labels, and neural fallbacks.
- [x] Build bot static pickup knowledge from canonical `extractPickups()` entries, including ammo and stable IDs.
- [x] Join item queries and item paths with the authoritative `pickupActiveMask`.
- [x] Apply one final ally-in-line-of-fire gate after both state-machine and hybrid-brain decisions.
- [x] Add periodic enemy/ally, active-pickup, trace, and friendly-fire-suppression counters.
- [x] Add deterministic tests for team parsing, perception isolation, enemy filtering, pickup masks, ammo discovery, and direct-fire suppression.
- [ ] Filter global weapon-fire events into human-scale hearing information.
- [ ] Add splash-risk safety and teammate-aware movement occupancy.
- [ ] Expose explicit gametype `teamBased` metadata rather than relying only on playable team IDs.

The first Phase 1 navigation foundation is complete; its richer discovery and learning layers remain deferred:

- [x] Preserve A* edge semantics in per-bot `NavStep[]` paths with a stateful cursor.
- [x] Execute jump, fall, teleporter, jumppad, and precise item approaches differently.
- [x] Validate fall hull clearance and standable landing geometry before committing.
- [x] Hash BSP bytes and persist immutable graphs under `.cache/bots/maps`.
- [x] Reject cache entries on schema, BSP, trigger-resolver, or movement-fingerprint mismatch.
- [x] Report cache hit/miss/rejection and active traversal step in bot diagnostics.
- [x] Replace medium-height visibility-derived jump edges with bounded 125 Hz `MovementProfile` rollouts.
- [x] Make jump validation directional and cache takeoff speed, input, timing, landing, and success-margin annotations.
- [x] Add `npm run bot:analyze` for reproducible uncached analysis, cache-hit checks, and JSON reports.
- [ ] Discover and validate speed-jump, wall-jump, ledge-grab, and richer drop opportunities.
- [ ] Expand candidate discovery from existing strategic node pairs to arbitrary standable ledges/surfaces.
- [x] Put failed fall/jump edges on a bounded per-bot five-second cooldown and replan around them.
- [ ] Add multi-goal strategic distance caching and learned unreliable-edge penalties.

The first movement rollout slice is complete. On the current `wdm2` BSP an uncached deterministic build analyzes 14 directional candidates, accepts 12, rejects 2 outside the bounded envelope, and performs 14 rollouts in roughly 52-61 ms on the development machine. A cache hit performs zero new rollouts. These are observations, not CI budgets.

The first Phase 2 runtime slice is complete:

- [x] Add a deterministic sequence registry with applicability scoring and stable tie-breaking.
- [x] Track phase state, authoritative-tick timeouts, short commitment windows, terminal results, and abort reasons.
- [x] Execute cached ordinary-jump opportunities through approach, speed build, takeoff, airborne, and landing phases.
- [x] Confirm actual airborne/landing state and report `takeoff_not_confirmed`, `missed_landing`, or timeout failures.
- [x] Allow high-priority state changes to interrupt setup while protecting the short launch commitment.
- [x] Prevent `HybridBrain` inference from modifying any active authored sequence.
- [x] Cool down failed traversal edges and ask A* for an alternate route instead of idling on the same failure.
- [x] Convert generic crouchslide behavior to a registered, authoritative-state-verified sequence.
- [x] Add a pickup-ID-aware `item_slide_approach` with authoritative collection confirmation and missed-pickup suppression.
- [x] Convert teleporter and jumppad trigger traversal to registered, authoritative-state-verified sequences.
- [x] Persist exact trigger ID/AABB/destination/exit-yaw metadata and reject pre-schema-3 cache entries.
- [ ] Feed sequence outcomes into bounded per-edge traversal memory.

`route_crouchslide` now takes over a safe forward-sprint intent rather than decorating arbitrary output with crouch. It requires authoritative ground state and slide speed, rejects firing/alt-fire, precision steps, triggers, jumps, falls, short approaches, and upcoming turns sharper than 45 degrees. It confirms replicated `isSliding`, holds the selected route yaw, chooses a natural exit or difficulty-gated jump-cancel, and confirms the real exit. A missed optional slide falls back to walking and does not invalidate the underlying walk edge.

`nav_traverse_teleporter` now approaches the cached trigger AABB center, commits after authoritative hull overlap, and succeeds only after a snapshot appears inside the lifted destination envelope. `nav_traverse_jumppad` likewise centers the pad, confirms a real upward airborne launch, commits through the flight, and succeeds only on reaching the authored ballistic-target envelope. Missing confirmation, short landing, or timeout fails the sequence; the owning edge is cooled down for five seconds and A* replans around it.

Sequence decisions still update from replicated snapshots while `BotClient` resends the selected input at 125 Hz. Durations therefore use authoritative `BotGameState.tick`; there is not yet a separate 125 Hz local phase predictor. On resume, the next slices expand arbitrary-surface discovery and movement templates.

Live validation used two 12-second headless `wdm2` duel runs (750 recorded frames each). The first exposed an old repeated-fall-edge idle loop; after the cooldown/replan change, the same deterministic spawns stayed mobile through the full repeat run. This is smoke coverage rather than a committed behavior fixture.

A follow-up 12-second `wdm2` run after the authored slide conversion recorded 751 frames, completed without server/runtime errors, and exposed `sequence=route_crouchslide phase=engage` in live bot diagnostics. That confirms real snapshot-driven selection; the unit fixtures remain the deterministic coverage for slide confirmation, jump-cancel, exit, and failure behavior.

A 30-second two-bot `wdm12` smoke after `item_slide_approach` recorded 1,875 frames, completed without bot/server/runtime errors, and exposed `sequence=item_slide_approach phase=slide remaining=1` in live diagnostics. The npm recorder invocation used its positional defaults despite named arguments, so this is deliberately recorded as `wdm12` evidence; deterministic fixtures remain authoritative for collection, remote consumption, overshoot, and suppressed-pickup replanning.

The trigger-sequence slice rebuilt `wdm2` as schema 3 with five metadata-complete trigger edges, then restored it with zero rollouts. A 12-second live duel recorded 752 frames and completed without bot/server/runtime errors. The stochastic smoke run did not select a trigger edge, so deterministic fixtures remain the evidence for teleporter activation/exit, jumppad launch/target, false-launch rejection, and failure cooldown behavior.

## 1. Recommendation

Do not keep expanding `StateMachineBrain` with more random button decisions. Add two layers between high-level intent and final `BotInput`:

1. A **goal planner** chooses what the bot is trying to accomplish: fight a target, acquire an item, defend an area, follow a gametype directive, retreat, or explore.
2. A **sequence director** performs a short, committed maneuver: strafe-jump a route segment, crouchslide into a blade hit, slide to an item, traverse a teleporter, take a jumppad, or drop from a ledge with the rocket launcher.

A final **fire-safety gate** must run after every state-machine, sequence, or ML decision. It is responsible for the invariant that a bot does not intentionally target or shoot a teammate.

The right ownership split is:

```text
snapshot + BSP
      |
      v
per-bot perception + memory
      |
      v
goal planner <----- serializable gametype directives
      |
      v
sequence director -----> typed navigation steps
      |
      v
movement / aim controllers
      |
      v
team + splash + line-of-fire safety
      |
      v
BotInput
```

The sequence layer should be deterministic and code-driven first. `HybridBrain` can later score candidate goals or sequences, but it should not be allowed to bypass movement preconditions or safety invariants.

## 2. Desired outcomes

- Bots use recognizable, powerful arena-FPS plays instead of continuously aiming, strafing, and firing.
- Bots can execute proper strafe-jump, bunny-hop, crouchslide, jump-cancel, teleporter, jumppad, and fall sequences.
- Bots understand item value, active state, respawn timing, route cost, and what a teleporter or jumppad leads toward.
- Team relations are explicit. Teammates are not selected as enemies, remembered as enemies, chased, prefired, or deliberately caught in splash.
- Gametype code can issue short-lived objectives without importing bot implementation code into the server.
- Bots feel human because they have attention, uncertainty, commitments, route habits, corrections, and readable intent - not because they roll random failures every tick.
- Expensive static map analysis is cached. Mutable perception and current match state remain per bot or per match.

## 3. Verified current state

This section describes the code as it exists on 2026-07-20, not the older research documents.

| Area | Existing foundation | Important gap |
| --- | --- | --- |
| Process model | `BotServer` manages external `BotClient` instances that connect as ordinary network clients. | Gametype code cannot directly call a bot object; instructions must cross a serializable protocol boundary. |
| Input cadence | `BotClient` decides on snapshots and resends the cached command at 125 Hz. | A decision can persist across several server ticks, so one-tick button assumptions are unsafe. |
| State machine | `StateMachineBrain` supports `FIGHT`, `CHASE`, `HUNT`, `ITEM_RUN`, `DODGE`, `RETREAT`, and `SPAWN`. | There is no general multi-phase maneuver contract or commitment/interrupt policy. |
| Combat | Weapon profiles, projectile lead, charged blade alt-fire, distance-based weapon selection, aiming, and fight strafing exist. | Fire is mostly a per-decision boolean. There is no setup, timing window, recovery, friendly-fire gate, or tactical sequence selection. |
| Movement | The real movement simulation supports Q3/Warsow-style air acceleration, autohop, wall jump, ledge grab, crouchslide, slide jump-cancel, teleporters, and jumppads. | The bot mostly moves directly toward waypoints and jumps randomly. It does not calculate a strafe-jump wish direction or execute typed traversal steps. |
| Crouchslide | `_applyCrouchslide()` starts slides during navigation and dodge states and has tests for slide continuation and jump-cancel. | `FIGHT` is excluded, so crouchslide-to-blade cannot happen. Slides are not based on corridor length, stopping distance, corner angle, target intercept, or item overshoot. |
| Static movement profiles | `BotMovementProfile.ts` describes mechanics and contains `getEscapeSequence()` and `getHeightSequence()`. | Those helpers are not consumed by `StateMachineBrain`; they are isolated arrays rather than a reusable runtime sequence system. |
| Navigation | `BotNavGraph` builds nodes and `walk`, `jump`, `fall`, `teleporter`, and `jumppad` edges, then performs A*. | `NavPath` returns nodes only, losing the edge type and traversal metadata the executor needs. |
| Triggers | `TriggerTable.extractTriggerVolumes()` resolves brush trigger AABBs to exact teleporter exits or jumppad ballistic targets. | The bot does not explicitly align with, enter, wait for, or recover from a trigger traversal. |
| Items | BSP item positions and item-pickup timestamps exist. The wire snapshot includes an authoritative `pickupActiveMask`. | Bot item planning ignores the active mask. `extractMapData()` omits `ammo_*`, while the brain tries to route to `"ammo"`. Item choice is a hardcoded first-match order, not utility. |
| Teams | Snapshot player records contain team strings; `MatchState` already owns whether a gametype is team-based. | `VisiblePlayer` has no team/relation. `getNearestEnemy()` returns the nearest living player. Vision and enemy memory therefore treat teammates as enemies. |
| Server damage | Weapon/projectile/combat systems do not filter same-team damage; the controller penalizes a team kill after it occurs. | Bot awareness is essential even if a future gametype disables friendly damage. Splash and corridor safety need explicit bot logic. |
| Perception | `BotVision` supplies BSP LOS, reachability, cover, hearing tracks, and enemy memory. | `BotServer` shares one mutable `BotVision` per map. Its LOS cache and enemy tracks are viewpoint-specific, so bots can contaminate one another's perception. |
| Network information | Entities are PVS-filtered per client. | `SnapshotBroadcaster` currently copies all events to every client. Treating every global `weapon_fire` event as hearing is more information than a human receives. |
| Difficulty | Aim, tracking, prediction, item timing, strafe-jump, dodge, mistake, and look-around settings exist. | `reactionTimeMs`, `itemTimingSkill`, and `mistakeRate` are not used by the rule brain. Some timing assumes 60 Hz while decisions arrive at snapshot cadence and commands run at 125 Hz. |
| Hybrid brain | `HybridBrain` overlays tactical/combat network output on state-machine input. | Its input assumes `state.players[0]` is an enemy and does not represent goals, typed route steps, uncertainty, or active sequences. |

### 3.1 Existing documentation drift

`docs/research/BOT_MOVEMENT.md` still says navigation is not wired into the brain. Current `StateMachineBrain` does use `BotNavGraph` for item, hunt, chase, and retreat movement. This new plan should be implemented against source, and the older document should later receive a short status correction rather than being treated as current ground truth.

### 3.2 Immediate correctness prerequisites

Before adding spectacular maneuvers:

1. Split map-static vision data from per-bot perception state.
   - Share the collision world, BSP-derived map data, and immutable graph.
   - Give every bot its own LOS cache, enemy tracks, attention state, and short-term memory.
   - A bot death must clear only that bot's perception, not every bot on the map.
2. Add explicit player relations.
   - Replicate or expose `teamBased` in the JSON `match_state`.
   - Store `team` and `relation: "self" | "ally" | "enemy" | "neutral"` in bot state.
   - In FFA, equal empty/spectator team strings must not make everyone an ally.
3. Build static pickup knowledge from `extractPickups()`, not the looser `startsWith("weapon_") || startsWith("item_")` extraction.
   - Preserve stable pickup ID, type, kind, classname, and position.
   - Join it with `snapshot.pickupActiveMask`.
4. Stop treating unbounded global events as human hearing.
   - Prefer server-side spatial/PVS filtering for sound-like events, or apply a conservative bot-side distance/area rule.
   - Damage to the bot remains valid awareness even without visual confirmation.

## 4. Goal planner

The existing enum states are useful execution modes, but they are too coarse to express why a bot is acting. Introduce a serializable goal record:

```typescript
type BotGoalKind =
  | "eliminate"
  | "acquire_item"
  | "move_to"
  | "hold_area"
  | "defend"
  | "escort"
  | "intercept"
  | "retreat"
  | "explore";

interface BotGoal {
  id: string;
  kind: BotGoalKind;
  source: "survival" | "combat" | "resource" | "gametype" | "team" | "exploration";
  priority: number;
  target:
    | { type: "player"; playerId: string }
    | { type: "pickup"; pickupId: number }
    | { type: "position"; position: Vec3; radius: number }
    | { type: "area"; areaId: string };
  issuedAtTick: number;
  expiresAtTick: number;
  interrupt: "never" | "danger" | "enemy_visible" | "higher_priority";
  constraints?: {
    preferredWeapons?: string[];
    avoidItems?: number[];
    maxRouteCost?: number;
    regroupDistance?: number;
  };
}
```

The record is data, not a callback. It can cross process boundaries, be recorded in demos, inspected in tests, and safely ignored by human clients.

### 4.1 Arbitration order

Hard invariants are not scored:

1. Dead/respawn handling.
2. Never intentionally fire at an ally.
3. Do not execute an invalid movement mechanic.

Valid goal candidates are scored next:

```text
score =
  source priority
  + urgency
  + expected reward
  - route time
  - exposure risk
  - opportunity cost
  - uncertainty
  - commitment-break penalty
```

Suggested policy:

- Survival can interrupt ordinary combat when health is critically low and a plausible escape exists.
- A high-priority gametype directive can outrank item collection and roaming.
- A nearby immediate kill opportunity may briefly interrupt a route, unless the directive says `interrupt: "never"`.
- A goal is sticky for a minimum commitment window. Small score fluctuations do not cause indecisive goal thrashing.
- Failed goals receive a short cooldown and a reason (`path_failed`, `item_gone`, `target_lost`, `unsafe`, `timeout`) before reconsideration.

### 4.2 Gametype-provided directives

Gametype code runs in the authoritative server while bots run in a separate process. The server must emit directives as data.

Put a game-agnostic contract below both sides, for example:

```text
src/shared/server/gametype/AgentDirective.ts
```

Use `AgentDirective`, rather than importing `src/bot` from the server. An optional hook can live on `BaseGametype`:

```typescript
interface AgentDirectiveContext {
  tick: number;
  playerId: PlayerId;
  teamId: TeamId;
  position: Vec3;
  alive: boolean;
}

getAgentDirectives(
  context: AgentDirectiveContext,
  state: WorldState,
): readonly AgentDirective[] {
  return [];
}
```

Examples:

- CTF: `capture` the enemy flag, `return` our flag, or `escort` the carrier.
- TDM: `hold_area` near red armor, `regroup` with a teammate, or `intercept` an enemy route.
- Duel: `deny_item` at megahealth or `hold_area` near a teleporter exit.
- Race: `move_to` the next checkpoint with combat interruption disabled.

Preferred transport:

1. `GametypeController` asks the gametype for directives per player.
2. `SnapshotBroadcaster` injects an `agent_directives` JSON event into that client's per-client state.
3. `BotGameState` accepts only directives addressed to `selfPlayerId`.
4. The goal planner validates expiry and maps them to local `BotGoal` candidates.

This keeps tactics private to the addressed client and preserves the bot's ordinary-client architecture. An MVP could add a `directivesByPlayer` record to the existing JSON `match_state`, but it broadcasts every player's orders and is less clean.

Gametype instructions never bypass fire safety, navigation feasibility, or survival checks. The hook describes intent; the bot decides how to perform it.

## 5. Sequence director

A sequence is a small state machine with explicit phases, preconditions, success/failure, and interruption rules.

```typescript
interface BotSequence {
  readonly id: string;
  readonly tags: readonly string[];

  score(context: SequenceContext): number | null;
  start(context: SequenceContext): SequenceState;
  tick(context: SequenceContext, state: SequenceState): SequenceTick;
  abort?(context: SequenceContext, state: SequenceState, reason: string): void;
}

interface SequenceTick {
  input: BotInput;
  status: "running" | "succeeded" | "failed";
  phase: string;
  reason?: string;
}
```

Every phase should specify:

- entry conditions;
- desired weapon and whether the server has confirmed the switch;
- movement controller and aim target;
- fire window, if any;
- maximum duration;
- abort conditions;
- next phase and recovery behavior.

Sequences are selected by applicability and score, not random chance. Difficulty changes eligibility, precision, anticipation horizon, allowed concurrent aiming, and recovery quality.

### 5.1 Commitment and interruption

Good bots should commit without becoming suicidal:

- **Uninterruptible for a few ticks:** weapon-switch confirmation, crossing a trigger brush, and the instant of a slide jump-cancel.
- **Danger-interruptible:** route acceleration, item approach, and setup phases.
- **Target-loss tolerant:** keep the last reasonable aim/route for a short reaction window rather than snapping to a new target.
- **Always abort:** teammate becomes the target, pickup becomes inactive with no timing plan, route edge becomes invalid, required ammo disappears, or splash risk becomes unacceptable.

## 6. Proposed combat sequences

### 6.1 Crouchslide + blade hit

Sequence ID: `blade_slide_engage`

| Phase | Action | Transition / abort |
| --- | --- | --- |
| Acquire | Select a visible enemy relation=`enemy`; require a mostly clear, straight intercept corridor. | Abort for ally, no route, excessive height difference, or another player blocking the corridor. |
| Equip | Request blade and wait for `currentWeapon === "blade"`. | Timeout if switch is not confirmed. |
| Build speed | Aim movement yaw along the intercept, hold pure forward+sprint, and do not fire because firing disables sprint. | Continue when horizontal speed reaches slide threshold; abort if target leaves the corridor. |
| Slide | Press crouch+forward. Track target with view yaw while preserving the slide trajectory. | Predict closest approach from relative position/velocity. |
| Strike | Press primary fire only inside the melee/lunge timing window. | Fire safety revalidates target relation on this exact tick. |
| Exit | Jump-cancel if it improves escape/re-engagement; otherwise finish slide and turn. | Succeed on hit/target death; fail on overshoot or blocked path. |

Important details:

- The existing generic crouchslide decorator excludes `FIGHT`; this sequence should own the slide instead of weakening that guard globally.
- Charged blade alt-fire is a different sequence and should not overlap this one.
- Fire must start after speed has been built. The movement simulation explicitly disables sprint while firing or aiming.
- The bot should aim the body/view independently from the movement corridor while sliding, within a maximum yaw error. A hard 90-degree turn should abort rather than produce a fake-looking sideways slide.
- Add a short miss recovery: continue past the enemy, turn toward cover, or jump-cancel. Do not instantly reverse direction.

### 6.2 Rocket drop from a ledge

Sequence ID: `rocket_drop_attack`

This is a drop attack, not a rocket jump.

| Phase | Action | Transition / abort |
| --- | --- | --- |
| Detect | Find an enemy below with confirmed LOS and a valid `fall` edge or forward drop probe. | Require RL, ammo, sufficient self health, and a plausible landing/recovery area. |
| Stage | Equip `rlauncher`; approach a safe takeoff point without accidentally falling early. | Abort if enemy is lost beyond the anticipation window or an ally enters the impact area. |
| Commit | Step or jump from the ledge while keeping the enemy/ground impact point in view. | Once airborne, the sequence is committed unless fire becomes unsafe. |
| Aim | Predict enemy feet/nearby floor at projectile arrival, including bot fall time and enemy velocity. | Prefer ground splash over center mass when the floor is visible. |
| Fire | Shoot only when the ray to predicted impact is clear and self/ally splash risk is acceptable. | Suppress the shot if safety fails; still complete the fall safely. |
| Recover | Air-control toward a safe landing, switch weapon if the enemy closes, and reacquire. | Succeed after landing or confirmed damage. |

Required new perception:

- a forward ledge/drop probe using player bounds;
- drop height and estimated fall time;
- landing point and landing safety;
- a link from `NavPath` to the actual `fall` edge;
- predicted explosion center and ally distances.

The engine's `ledgeGrabState` describes grabbing a ledge while falling; it is not the same as detecting that the bot is standing beside a drop.

### 6.3 Future attack library

After the first two sequences work:

- `rocket_corner_peek`: expose, fire at a predicted floor corner, return to cover;
- `rocket_jump_reposition`: self-launch to a known tactical node when health permits;
- `blade_ambush_exit`: wait near a teleporter exit, then melee an enemy arrival;
- `jumppad_air_shot`: take a pad and fire RL/EB during the known arc;
- `charged_blade_release`: build and release alt-fire around a peek window;
- `hitscan_finish`: switch to reliable hitscan when estimated enemy health is low;
- `deny_power_item`: pre-aim a timed item as it respawns;
- `retreating_splash`: fire at a pursuit corner while continuing an escape route.

These should remain authored, inspectable building blocks. The planner chooses among them; it does not invent arbitrary button combinations.

## 7. Movement sequences

### 7.1 Proper strafe-jump chain

Current movement code has distinct acceleration paths:

- forward-only air acceleration;
- strafe-only `A`/`D` acceleration;
- normal acceleration for combined forward+strafe.

The bot controller should use the real horizontal velocity, not a fixed alternating timer.

Sequence ID: `route_strafe_jump`

1. Select a sufficiently long, clear route segment with no immediate sharp corner, trigger brush, item stop, or unsafe ledge.
2. On the ground, establish route-aligned speed.
3. Jump/autohop.
4. In air, calculate a desired acceleration wish direction relative to the current velocity and route tangent.
5. Select left or right strafe and derive view yaw so the resulting world-space wish direction matches it.
6. Turn by a capped angular rate. Excessive turn demand means this segment is not suitable for speed-building.
7. Predict the landing and upcoming graph step. Stop accelerating early for a trigger entrance, item pickup, tight corner, teammate, or drop.
8. Alternate sides when it improves alignment, not merely every N ticks.

Two useful modes:

- **Route bunny-hop:** forward-only hops for gentle curves and readable travel.
- **Speed strafe chain:** pure side acceleration with coordinated yaw for long straights/open rooms.

Success metrics:

- speed gained per hop;
- route cross-track error;
- collision count;
- missed waypoint count;
- safe landing rate;
- time saved versus pure sprint.

Difficulty should affect target speed, angular error, look-ahead distance, and how many hops the bot can chain. Easy bots should still use a coherent technique, just less efficiently.

Implemented first slice: `route_strafe_jump` is an optional, one-verified-hop sequence. Safe reselection after landing forms a chain while giving route planning a veto before every hop. The brain tries the existing crouchslide first, then considers a strafe hop when all of these gates pass:

- current state is non-firing route travel (`HUNT`, `ITEM_RUN`, `RETREAT`, or `CHASE`);
- the current edge is a non-precision `walk` with at least 640 units remaining, raised to 800 for the terminal item approach;
- current horizontal velocity is within 30 degrees of the route;
- any next step inside 900 units is also a non-precision walk and turns no more than 30 degrees;
- no live ally occupies an 80-unit route corridor in the next 600 units;
- difficulty has at least `0.35` strafe-jump skill and authoritative speed is between 220 u/s and the difficulty target.

The sequence then:

1. sends forward+sprint+jump and allows 18 authoritative ticks for takeoff confirmation, with only a 10-tick non-interruptible commitment;
2. switches in air to pure `LEFT` or `RIGHT` with no forward flag, selecting the side that corrects velocity toward the route;
3. derives view yaw from current velocity, `maxAirSpeed`, the exported authoritative strafe acceleration, and its high-speed falloff, leaving one acceleration step below the projection cap instead of saturating it;
4. caps view turning at `2.5 + 4.5 * skill` radians/second;
5. exits on confirmed landing, route endpoint proximity (260 units), or the difficulty target speed;
6. fails safely on lost momentum, more than `96 + 64 * skill` units of cross-track error, or timeout. Because it is optional, failure resumes the walk route and does not cool down or poison that nav edge.

Focused tests pass the produced command through the real `MovementProfile` at 125 Hz and verify that it gains horizontal speed. They also cover route-error side selection, landing, loss of control, attack/precision/skill gates, sharp turns, and ally occupancy.

Still deliberately unimplemented: collision/landing occupancy prediction throughout the arc, persisted hop metrics, dynamic item-active cancellation during a hop, and a deterministic full-map chain benchmark/overlay. Those are the next tuning layer; the current slice is conservative enough to compose with typed trigger traversal and precise item approaches.

### 7.2 Crouchslide traversal

Sequence ID: `route_crouchslide`

Use a slide when:

- horizontal speed is above `slideMinSpeed`;
- cooldown is ready;
- the next route segment is straight and clear for the estimated slide distance;
- the next corner is not too sharp;
- the destination is far enough that the bot will not overshoot it;
- there is no trigger entrance, unsafe drop, blocking teammate, or required precision stop in the slide envelope.

Good contexts:

- accelerating toward an item along a straight corridor;
- breaking line of sight during retreat;
- passing under incoming fire;
- committing to the blade sequence;
- preserving speed down a favorable slope.

Bad contexts:

- immediately before picking up a nearby item;
- narrow teleporter entrance requiring alignment;
- jumppad trigger requiring a controlled center hit;
- sharp route turn;
- close-range splash fight;
- charging blade alt-fire;
- uncertain ledge.

The slide sequence should choose one of three exits:

- natural finish for a precise stop;
- jump-cancel into a strafe-jump chain;
- early abort only when collision/safety demands it.

### 7.3 Slide to item

Sequence ID: `item_slide_approach`

This is a specialization of route crouchslide:

1. Goal planner selects a specific active pickup by ID.
2. Route planner estimates arrival time and slide stopping/exit distance.
3. Build speed only if the expected time saving is meaningful.
4. Enter slide on a straight final or penultimate segment.
5. Jump-cancel before overshoot if the pickup radius and next route permit it.
6. Confirm pickup through active-mask transition or pickup event.
7. Continue into a preselected exit route instead of stopping to reconsider.

If an item is inactive, a skilled bot may still route there only when predicted respawn occurs near arrival. It must not repeatedly collide with an empty spawn.

Implemented first slice: the sequence is restricted to the final straight `walk` edge of `ITEM_RUN` or health `RETREAT`, requires an active stable pickup ID, authoritative slide readiness, aligned velocity, a simulation-derived distance envelope, and an ally-free lane. It confirms slide entry from replicated `isSliding`, releases crouch at 190 units for a precise 128-unit-radius collection, and succeeds only when that exact pickup's authoritative mask bit clears after a near pass. A mask transition far from the target is classified as another player's pickup; passing an active target is a miss, temporarily suppresses that pickup ID for five seconds, and forces item replanning.

This first slice deliberately excludes penultimate-corner entry and jump-cancel continuation. Those require a validated post-pickup route and exit occupancy check; otherwise the speed trick would recreate the overshoot problem it is meant to solve.

### 7.4 Teleporter traversal

Sequence ID: `traverse_teleporter`

The exact source AABB, destination, and exit yaw are already available from `TriggerTable`.

1. Approach the trigger center using a typed `teleporter` path step.
2. Check exit occupancy, known enemy threat, ally blocking, and telefrag opportunity.
3. Align entry momentum with the desired post-exit route, accounting for the configured full-momentum redirect.
4. Commit through the trigger; do not let feelers steer away at the brush boundary.
5. Detect the position/yaw discontinuity and clear stale local path-following error.
6. Reacquire the destination-side waypoint, enemy memory, and next movement sequence.

A human-like bot can glance/aim toward the expected exit threat before entering, but should not see current exit-side enemies unless ordinary snapshot/PVS information permits it.
Implemented first slice: schema-3 nav edges retain the exact trigger metadata even when node deduplication reuses a nearby strategic node. The sequence steers to the AABB center, uses the same standing/crouched hull-overlap dimensions as authoritative movement, suppresses generic traversal automation during activation, and verifies the `dest + 25u` exit snapshot. Exit occupancy, threat pre-aim, and telefrag planning remain future tactical layers.


### 7.5 Jumppad traversal

Sequence ID: `traverse_jumppad`

1. Approach the pad's source AABB near its useful center.
2. Avoid jumping or sliding over the trigger volume.
3. Commit to the pad and detect launch.
4. Use the known ballistic target and current launch state to predict the arc.
5. During flight, look toward likely threats, prepare a weapon, and use only air control that does not ruin the landing.
6. Cross the authored ballistic-target envelope, then transition into fight, item pickup, or the next route step.

The bot can later learn safe mid-air fire windows and whether a pad is commonly camped.

Implemented first slice: the sequence centers the exact pad AABB, forbids jump/slide/sprint input, confirms an upward airborne snapshot, commits through the expected flight, and verifies passage through the `target_position` envelope. That target is the arc target/apex rather than a guaranteed standable landing. Surface-aware landing prediction and safe post-apex route continuation remain deliberately future work.

### 7.6 Movement opportunity analysis

`BotVision` should grow a query that answers a more useful question than "is there geometry nearby?":

> From my current position, velocity, cooldowns, and view direction, which nearby standing surfaces can I reach, with which maneuver, and how much execution margin remains?

This can support ordinary jumps, speed-assisted jumps, wall jumps, ledge grabs, drop attacks, and route shortcuts without hand-authored map waypoints.

Suggested result:

```typescript
type TraversalKind =
  | "jump"
  | "strafe_jump"
  | "slide_jump"
  | "wall_jump"
  | "wall_jump_ledge_grab";

interface MovementOpportunity {
  id: string;
  kind: TraversalKind;
  takeoff: {
    position: Vec3;
    radius: number;
    minSpeed: number;
    maxSpeed: number;
    yawRange: [number, number];
  };
  landing: {
    position: Vec3;
    radius: number;
    surfaceNormal: Vec3;
  };
  wall?: {
    point: Vec3;
    normal: Vec3;
    contactTick: number;
  };
  inputPlan: SequencePhase[];
  expectedTicks: number;
  successMargin: number;
  risk: {
    fallDamage: number;
    failureLanding?: Vec3;
    requiresLedgeGrab: boolean;
  };
}
```

#### Discovering jumpable surfaces

Use BSP collision in two stages:

1. **Candidate discovery**
   - Cast a horizontal/radial fan near the bot and around nearby nav nodes.
   - Trace downward behind detected lips/edges to find top surfaces.
   - Accept floor-like normals (`normal.y >= 0.7`, matching current walkable/ledge logic).
   - Test the full standing hull at the landing point and along the required vertical clearance.
   - Record a landing region, not just one point, so execution margin is measurable.
2. **Reachability validation**
   - Reject candidates outside a cheap ballistic/height/distance envelope.
   - Generate a small set of maneuver templates.
   - Roll each template forward at fixed 125 Hz against the same collision world and movement configuration.
   - Accept only rollouts that enter the landing region with a valid hull, survivable velocity, and stable ground contact or a valid ledge grab.

The analytical pass keeps queries cheap. The rollout makes the answer agree with actual friction, acceleration, collision clipping, slopes, gravity, slide state, and input timing.

Do not mutate the live `MovementProfile`. Use an isolated probe profile/state or extract a pure rollout helper that accepts a snapshot of the movement state.

Implemented v1 deliberately starts with the strategic node pairs already produced by `BotNavGraph`. `BotMovementAnalyzer` normalizes each hint to a walkable standing origin, applies a cheap height/distance envelope, searches a small ordered initial-speed set, and runs each direction through a fresh feature-restricted `MovementProfile` at 125 Hz until stable landing or a 150-tick horizon. It caps a map build at 512 rollouts and retains at most 256 rejection samples. This removes fake medium-height jump edges now; arbitrary ledge discovery, full trajectory samples, perturbation testing, and advanced movement templates remain the next layer.

#### Speed-assisted special jumps

Some surfaces are reachable only after building speed and converting it at the right point:

```text
strafe-jump chain
  -> reach required horizontal speed band
  -> align with takeoff corridor
  -> crouchslide entry boost
  -> hold trajectory
  -> jump-cancel boost
  -> air-control correction
  -> land / wall-contact / ledge-grab
```

The analyzer should search over:

- number of approach hops;
- left/right strafe pattern and capped yaw curve;
- slide entry speed and takeoff position;
- jump-cancel tick;
- air-control direction;
- optional wall-contact point;
- acceptable landing region.

Store the minimum required speed and a safe target speed. A bot should not attempt a jump merely because the theoretical maximum reaches it. `successMargin` should account for snapshot delay, turn error, route obstruction, and difficulty. Medium bots can require a wider landing region; hard bots can use narrower opportunities.

Use the real simulation configuration. The implemented baseline is now exported as `DEFAULT_FPS_MOVEMENT_CONFIG`; both `MovementProfile` and `BotMovementProfile.PHYSICS` consume it. This removed stale bot assumptions including a `1.2` slide-entry multiplier when authoritative simulation uses `1.4`, plus outdated wall-jump and ledge-pull values. A physics-backed test confirms that the exported slide baseline actually enters a slide and applies the expected boost.

#### Wall-jump reachability

The current `WallJump` implementation provides concrete validation rules:

- the player is airborne and has at least `wallJumpMinHeight` ground clearance;
- a wall is within `wallJumpReach`;
- the surface is near vertical (`abs(normal.y) <= 0.3`);
- the wall continues to eye height;
- velocity is not already strongly away from the wall;
- cooldown is ready and jump was freshly pressed;
- slide and ledge-grab states are not active;
- horizontal velocity reflects across the wall normal and is multiplied by `wallJumpBounce`;
- vertical velocity becomes `wallJumpHeight` (plus configured boost for charged behavior).

For "can I reach that platform with a wall jump?":

1. Discover a valid wall-contact strip near the route to the platform.
2. Check that a normal jump/strafe/slide-jump rollout can reach that strip with a valid approach velocity.
3. Apply the exact reflection/vertical boost at candidate contact ticks.
4. Roll forward with air control toward the platform.
5. Test direct landing first, then `wall_jump_ledge_grab` if the platform lip satisfies the existing ledge rules and standing-hull checks.
6. Return the best plan plus its takeoff/contact/landing tolerances.

This creates genuinely useful multi-stage edges:

```text
nav node A
  -- strafe/slide approach -->
wall contact
  -- wall jump -->
platform landing or ledge grab
  --> nav node B
```

These should be cached as traversal opportunities only after exact validation. Runtime still checks current speed, cooldown, health/risk, obstruction, and goal value before committing.

#### Runtime and offline budgets

- **Map-build/offline:** broadly sample strategic nodes, ledges, item areas, walls, and platform pairs; run many rollouts; persist successful opportunities.
- **Runtime:** query only a local radius and a few goal-relevant landing surfaces; start from the bot's actual velocity/state; cap rollout count and tick horizon.
- **Learning:** record attempts, contact error, landing error, success, and actual ticks. Adjust confidence, not the underlying physical truth.

`wdm2` should be the first benchmark map. Build a small named catalogue of expected opportunities on it:

- basic jumpable ledges;
- a speed-assisted gap;
- a crouchslide jump;
- a wall-jump platform reach;
- a wall-jump followed by ledge grab;
- at least one attractive-looking but invalid surface.

The catalogue gives deterministic regression targets while the general analyzer remains procedural.

## 8. Item reasoning and map memory

### 8.1 Replace hardcoded item ordering with utility

Current `ITEM_RUN` tries `weapon`, then `health`, then `armor`, then `ammo`, returning the first path found. Score a specific pickup instead:

```text
item utility =
  effective grant value
  + denial value
  + loadout synergy
  + gametype value
  + route continuation value
  - travel time
  - exposure/danger
  - respawn wait
  - overcap/waste
  - opportunity cost
```

Examples:

- Megahealth may justify a longer or riskier route, especially as denial.
- A 5 HP bubble should not outrank nearby red armor at 95 health and 0 armor.
- Rockets are highly valuable when the bot owns RL and has low rocket ammo.
- A weapon already owned may still be useful for ammo, but not like a missing weapon.
- An inactive pickup can be a timing goal if the predicted wait is short.

### 8.2 What can be cached

Yes, map knowledge should be cached, but it must be split by ownership.

#### Share and persist per map

- collision-world/BSP parse result in process memory;
- immutable pickup table with stable IDs;
- trigger source AABBs, destinations, exit yaw, and type;
- navigation nodes and typed edges;
- all-pairs or landmark route-distance estimates between strategic nodes;
- ledge/drop annotations and estimated landing areas;
- validated movement opportunities with takeoff, wall-contact, landing, and speed envelopes;
- cover, choke, height, and sightline annotations;
- item neighborhoods reachable after each teleporter/jumppad;
- nominal trigger traversal time and movement envelope.

Suggested disk location:

```text
.cache/bots/maps/<cache-key>.json
```

The current Phase 1 implementation writes `.cache/bots/maps/<sanitized-map>.json`. The filename is only a lookup key; every load validates the BSP SHA-256, graph schema, trigger-resolver version, and movement fingerprint stored inside the payload. A mismatch is a cache miss and causes a deterministic rebuild. `BOT_NAV_CACHE_DIR` can redirect the cache for tests or deployments. Schema 3 persists nodes, typed edges, exact trigger ID/AABB/destination/exit-yaw metadata, validated ordinary-jump opportunities, edge execution metadata, and the deterministic analysis summary. Richer tactical annotations and empirical experience remain planned and must use separately versioned data.

The graph is generated once per BSP in a bot-server process, restored from disk on later runs, and then shared read-only by bots. Each computed `NavPath` owns its own mutable cursor, so one bot's teleporter progress cannot affect another bot.

The root `.gitignore` already ignores `.cache/`.

The cache key should include:

```text
BSP content hash
+ nav schema version
+ trigger extraction version
+ movement-config fingerprint
+ coordinate-system/version marker
```

If any component changes, rebuild instead of attempting a partial migration.

#### Share only for the current match or team

- authoritative pickup active state;
- observed pickup timestamps and respawn estimates;
- aggregate route congestion;
- optional team callouts/directives;
- recent danger heat.

#### Keep per bot

- LOS cache;
- enemy tracks and last-known positions;
- attention/focus target;
- route failures and confidence;
- personal route preferences;
- active goal and sequence;
- reaction delays;
- personality;
- uncertainty about unseen item/enemy state.

Never persist current enemy positions, current pickup active state, or a live sequence into the static map cache.

### 8.3 Learning what triggers lead to

The bot does not need to rediscover the geometric destination: BSP data already provides it. It can precompute a **destination neighborhood**:

```typescript
interface TriggerKnowledge {
  triggerId: number;
  type: "teleporter" | "jumppad";
  sourceNodeId: number;
  destinationNodeId: number;
  exitYaw?: number;
  nearbyPickups: Array<{
    pickupId: number;
    routeCost: number;
  }>;
  nearbyAreas: string[];
  nominalTravelTicks: number;
}
```

Runtime experience can augment this with:

- actual traversal success rate;
- mean/variance of travel ticks;
- approach directions that miss the brush;
- landing error;
- post-exit damage/death rate;
- common enemy sightings;
- best continuation toward mega, armor, RL, or a gametype objective.

Static facts are cacheable. Tactical risk decays over time and should not become permanent superstition after one bad match.

## 9. Team awareness and fire safety

“Do not shoot teammates” should be an invariant, not a low-priority preference.

### 9.1 Relation pipeline

1. Parse `match_state.teamBased`.
2. Read self and other player teams from snapshot player records.
3. Classify relations:
   - non-team gametype: every other active player is `enemy`;
   - team gametype, same playable team: `ally`;
   - team gametype, different playable team: `enemy`;
   - spectator/unknown: `neutral` until resolved.
4. Filter allies before LOS enemy lists, hearing tracks, last-known enemy memory, target selection, chase, and ML inputs.
5. Revalidate the selected target immediately before outputting fire.

### 9.2 Final fire gate

`BotFireSafety.evaluate()` should be the final authority:

- target still has relation=`enemy`;
- hitscan/melee line does not encounter an ally first;
- projectile launch corridor is not blocked by a nearby ally;
- predicted splash impact keeps allies outside a weapon-specific safety radius;
- self-splash is acceptable for the maneuver and current health;
- charged fire is released safely or cancelled;
- suppress speculative corner prefire if an ally is likely to cross.

This gate should remove `FIRE`/`ALT_FIRE`; it should not silently replace the goal. The planner can react to repeated suppression by repositioning.

### 9.3 Server policy is separate

The current server can apply same-team damage and later score it as a team kill. Whether a gametype should disable or scale friendly fire is a game-rule decision outside this bot investigation. Bots should avoid allies regardless of that policy so they do not waste shots, knock teammates around, obscure vision, or behave maliciously.

## 10. Human-like behavior

Human-like should mean bounded information and coherent behavior, not arbitrary incompetence.

### 10.1 Attention and reaction

- Maintain one focus target and a small peripheral threat set.
- Apply `reactionTimeMs` to newly perceived enemies, item disappearance, and unexpected damage.
- Allow immediate continuation against an already tracked target; do not re-pay reaction delay every snapshot.
- Turn the view toward likely danger, route corners, item spawn points, and trigger exits before arrival.
- After a surprise, briefly over-focus the attacker before returning to the main goal.

### 10.2 Memory with uncertainty

- Store last seen position, velocity, route direction, and confidence.
- Decay confidence with time, occlusion, teleport possibilities, and branching routes.
- Remember an item pickup approximately according to `itemTimingSkill`.
- Infer likely enemy destinations from nearby items and trigger links without reading hidden state.
- Search two or three plausible exits when a target is lost, then abandon the chase.
- Forget or mis-time through controlled uncertainty, not fresh random rolls each tick.

### 10.3 Readable movement

- Look where the bot is going before a sharp turn.
- Brake or widen a line before corners.
- Make small corrective inputs after landing instead of snapping to the path center.
- Preserve momentum when the route allows and deliberately sacrifice it for precision.
- Occasionally choose a familiar route over a mathematically tiny improvement.
- Avoid repeating the identical dodge side or item loop forever.
- Yield or reroute around teammates rather than vibrating against them.

### 10.4 Combat habits

- Preselect the likely next weapon before entering a room.
- Aim at likely floor/corner positions with splash weapons and at exposed body lines with hitscan.
- Respect reload, switch, charge, and projectile timing.
- Commit to a peek, burst, or melee pass, then recover.
- Stop firing when LOS is lost unless performing an authored, safety-checked prefire.
- React to enemy weapon/range: avoid close RL splash, close on long-range specialists, and deny predictable landings.
- Estimate enemy health from observed damage, but retain uncertainty.

### 10.5 Item and map-control habits

- Time major items with imperfect clocks based on difficulty.
- Arrive slightly early, take a defensible position, and listen/look for contest.
- Chain pickups into a route rather than selecting one after every arrival.
- Recognize denial value: taking armor can matter even at good stack if the enemy is weak.
- Abandon an item when contest risk exceeds its value.
- Use teleporter/jumppad destination knowledge to plan two-step routes.

### 10.6 Social/team behavior

- Do not block a teammate's trigger entrance or narrow corridor.
- Spread out when splash weapons threaten the group.
- Regroup for a gametype directive and maintain a loose formation.
- Cover an ally collecting a major item instead of racing them for it.
- Share a short-lived team blackboard for “enemy last seen,” “item taken,” and assigned roles, with realistic delay.
- Avoid perfect hive-mind knowledge: only share explicit observations at a bounded rate.

### 10.7 Personality without breaking competence

Personality can bias valid choices:

| Trait | Behavioral effect |
| --- | --- |
| Aggression | Lower threshold for attack sequences and contested items. |
| Discipline | Longer goal commitment, less speculative fire, safer splash. |
| Mobility | Higher preference for trigger routes, strafe chains, and slide exits. |
| Control | Higher value for major-item timing and defensible areas. |
| Curiosity | More route exploration when no urgent goal exists. |
| Teamwork | Stronger regroup, escort, spacing, and item-yield behavior. |

Difficulty controls execution quality and information handling. Personality controls style among reasonable actions.

## 11. Navigation changes required

### 11.1 Return typed steps

Replace node-only paths with:

```typescript
interface NavStep {
  from: NavNode;
  to: NavNode;
  type: "walk" | "jump" | "fall" | "jumppad" | "teleporter";
  cost: number;
  horizontalDistance: number;
  heightDelta: number;
  requiresPreciseApproach: boolean;
}

interface NavPath {
  nodes: NavNode[];
  steps: NavStep[];
  totalCost: number;
  // Per-bot runtime progress; never part of the static graph cache.
  cursor: number;
}
```

This is necessary for sequence selection. Inferring the edge later from node types is unreliable because nearby node deduplication can reuse a node with another semantic type.

### 11.2 Validate graph construction

Current graph probing is a useful prototype, but:

- “can see high node from low node” is not proof that a jump or fall is traversable;
- large drops need landing/fall-damage validation;
- jump edges are marked bidirectional despite different launch requirements;
- trigger traversal cost should use expected time, not only distance;
- Euclidean A* heuristic can overestimate routes containing cheap teleport edges and return a suboptimal path when the goal is popped;
- floor sampling finds one visible floor per X/Z column from above and may miss stacked levels;
- item-path search runs A* separately for every matching target;
- path following uses a 100-unit arrival threshold that can skip small trigger brushes or precise item approaches.

Recommended progression:

1. Preserve current graph as a fallback.
2. Add edge-level traversal validation and metadata.
3. Use Dijkstra (`h = 0`) until a trigger-aware admissible heuristic is proven.
4. Add strategic multi-source distance caches for item queries.
5. Record runtime traversal failures and temporarily penalize unreliable edges.

## 12. Integration with `HybridBrain`

Keep authored mechanics outside the neural output:

- state machine/goal planner proposes valid goals;
- sequence registry proposes valid sequences;
- ML may score those candidates or tune aim/movement within bounded parameters;
- sequence executor validates every phase;
- fire safety runs last.

Adding team relations, active goals, route-step types, and active sequence phase changes the fixed neural input shapes. Existing TF.js models would be incompatible if those arrays are expanded. Treat this as a model schema version:

- retain the rule-based path while new models are absent;
- version model directories/metadata;
- reject mismatched input schemas clearly;
- record goal/sequence IDs in new training episodes so later models learn intent-conditioned behavior.

### 12.1 Learning any map: three different kinds of knowledge

The goal is not to teach a network the coordinates of every map. The goal is to give it a universal language for movement opportunities, then let deterministic analysis translate any BSP into that language.

```text
unknown BSP + movement configuration
  -> deterministic map compiler
     -> static graph / surfaces / triggers / validated maneuvers
     -> versioned file cache
  -> goal and sequence candidate generation
  -> general neural candidate scorer
  -> deterministic sequence executor + safety gates
  -> observed outcome
     -> immediate small map-stat update
     -> replay record for later neural training
```

Keep three stores separate:

| Store | Examples | Scope | Update policy |
| --- | --- | --- | --- |
| Static map truth | Nav nodes/typed edges, pickup locations, trigger links, standable regions, validated maneuver envelopes | Shared by every bot on that BSP | Generated from physics; file-cached; replaced when fingerprints change |
| Map experience | Attempts, successes, traversal time, entry/landing error, damage exposure, congestion, tactical value | Per map, optionally shared across matches | Cheap online updates; decay/version empirical data |
| General neural weights | How to value a candidate given local geometry, goal, inventory, enemy pressure, and uncertainty | Shared across all maps | Train asynchronously from mixed replay; promote only after evaluation |

The static file cache is extremely useful. Most map learning is geometry compilation whose answer becomes static once the BSP and movement rules are fixed. A cache key should include at least BSP hash, cache schema, movement fingerprint, trigger resolver version, and analyzer version.

Do not put current enemy positions, live item availability, or match danger into the static cache. Those belong to live state. Empirical danger and traversal statistics can live in a separate small cache so static truth remains deterministic and easily rebuilt.

### 12.2 Generalize through candidate features, not map identity

The existing tactical model receives one fixed 25-float vector and emits generic jump/slide buttons. That cannot express "choose wall-jump opportunity 17 over the walk route" and will require a new versioned schema.

A map-independent `OpportunityScorer` should evaluate one candidate at a time using relative/normalized features:

- maneuver kind and phase count;
- relative takeoff direction, height delta, path distance, and expected ticks;
- required speed versus current speed;
- yaw, timing, takeoff, wall-contact, and landing tolerances;
- success margin and validated failure risk;
- route progress/time saved versus the safe route;
- health/armor, cooldowns, weapon constraints, and current goal;
- enemy exposure, ally occupancy, item timing, and escape-route value;
- empirical attempts, success confidence, mean traversal time, and uncertainty.

It returns values such as predicted success, tactical utility, risk, and expected time. The ordinary planner can score any number of candidates by calling the same network for each one. No map name or absolute world coordinate should be an input; otherwise the model memorizes maps instead of learning movement concepts.

The sequence executor still owns the exact buttons and validation. A later residual model may adjust takeoff yaw or jump-cancel timing, but only inside the analyzer's proven envelope.

### 12.3 Learn immediately without fitting TensorFlow every tick

Bots can improve during a match without mutating neural weights:

```typescript
interface TraversalExperience {
  mapKey: string;
  opportunityId: string;
  kind: TraversalKind;
  featureSchema: number;
  candidateFeatures: number[];
  chosenPlan: SequencePhase[];
  startTick: number;
  endTick: number;
  success: boolean;
  abortReason?: string;
  expectedTicks: number;
  actualTicks: number;
  takeoffError: number;
  contactError?: number;
  landingError: number;
  speedBefore: number;
  speedAfter: number;
  healthCost: number;
  routeProgress: number;
}
```

On every completed or aborted attempt:

1. Update a bounded per-opportunity record: attempts, successes, recent failures, mean/variance of time, and entry/contact/landing error.
2. Adjust confidence, not physical validity. A collision caused by a player does not prove the jump geometry is invalid.
3. Temporarily penalize repeated failures and prefer a safe fallback.
4. Append the transition to a bounded replay store.
5. Persist empirical map memory periodically or at match end when enabled.

A beta-style success estimate or similarly simple confidence model is enough initially. It gives sensible uncertainty with few attempts and is far cheaper and more explainable than live gradient descent.

### 12.4 Safe exploration

To discover which valid routes work well in real play, the candidate scorer needs limited exploration:

- explore uncertain but physically validated opportunities when the bot has health, time, and a safe failure landing;
- prefer exploration during warmup, unranked/self-play, large leads, or low-pressure traversal;
- do not experiment with high fall risk, team-objective abandonment, or a critical low-health escape;
- let difficulty and personality change the exploration budget, not bypass safety;
- distinguish execution failure, dynamic obstruction, enemy interruption, and analyzer error;
- share static truth globally, but avoid instant hive-mind sharing of private live observations.

This is naturally a contextual-bandit problem before it needs full reinforcement learning: choose among already-safe candidates, observe success/time/value, and improve the choice.

### 12.5 Neural training while play continues

Do not call `model.fit()` in the bot decision loop. It can stall inference, make behavior nondeterministic, and corrupt a good model through one bad match. Use a champion/challenger pipeline:

1. Active bots run a frozen champion model.
2. Gameplay, procedural analyzer labels, self-play, and human demos feed a versioned replay buffer.
3. A worker or separate process trains a challenger on a mixture of new data and older maps.
4. Evaluate it on fixed seeds, unseen maps, team-safety tests, and previous-map regression scenarios.
5. Promote only if it improves target metrics without safety or old-map regression.
6. Swap models atomically between matches/map loads; retain instant rollback.

Mixing older replay is essential to prevent catastrophic forgetting. Training only on the current map would create a brilliant `wdm2` specialist that becomes worse elsewhere.

### 12.6 Procedural analysis and player demos teach different things

The movement analyzer can generate essentially free supervised labels:

- reachable versus unreachable;
- maneuver class;
- minimum/safe speed;
- successful timing/yaw envelope;
- predicted ticks and landing margin.

This can train a fast reachability/prior model that proposes or ranks likely maneuvers, while exact fixed-tick rollout remains the authority. The model reduces search cost; it never overrules collision truth.

Human demos supply what simulation cannot:

- which route a strong player notices;
- when a shortcut is worth its execution risk;
- how movement and combat are combined;
- item-control habits, feints, retreat choices, and readable imperfections.

Self-play then explores beyond the demo distribution and tests tactics against resistance. A sensible curriculum is:

1. procedural supervision for movement feasibility;
2. behavior cloning from player and strong scripted-bot decisions;
3. self-play/contextual-bandit tuning for tactical value;
4. tightly gated reinforcement learning only after rewards and evaluation are trustworthy.

The existing `DemoTrainingExtractor` is a useful bridge, but it infers buttons from snapshots rather than reading exact user commands. Preserve exact usercmd/sequence labels in future demos if player movement timing is meant to supervise advanced sequences.

### 12.7 Current training gaps to fix first

The repository does not currently train "while the bot goes":

- `HybridBrain` performs inference during play; fitting occurs in `BotTrainer` after a round.
- Decisions and recorder frames occur on snapshot receipt (roughly 30 Hz); the 125 Hz loop only resends the cached input.
- The existing flat models output generic modes/buttons, not goal or sequence candidate scores.
- Training targets are reward-weighted copies of recorded actions, not a standard policy/value reinforcement-learning objective.
- Outgoing damage is not fully observed; a kill is approximated as 100 damage.
- Item pickup recording infers health/armor increases and does not identify the exact pickup/goal.
- Training data lacks opportunity ID, sequence phase, abort reason, typed path step, team relation, and fire-safety outcome.

These gaps do not invalidate the plan, but online gradient updates should wait until the experience schema and reward attribution can distinguish what the bot attempted and why it succeeded.

## 13. Implementation plan

### Phase 0: Correctness and observability

- Split `BotVision` into shared immutable `BotMapContext` and per-bot `BotPerception`.
- Add `teamBased`, player team, and relation parsing.
- Filter allies before all enemy/memory/ML paths.
- Add final `BotFireSafety`.
- Consume stable pickup table IDs and `pickupActiveMask`.
- Add structured debug output: current goal, sequence/phase, target relation, path step, and fire-suppression reason.

This phase should land before new attacks.

### Phase 1: Typed navigation and cache

- [x] Return `NavStep[]` with edge metadata and per-path progress.
- [x] Add explicit trigger, fall, jump, and precise-item approach executors.
- [x] Add geometric drop probes and landing validation.
- [x] Add a bounded 125 Hz movement rollout probe using a fresh authoritative `MovementProfile` per trial.
- [x] Precompute directional ordinary-jump opportunities between existing strategic node pairs.
- [ ] Add radial/ledge surface discovery beyond existing node pairs.
- [ ] Add strafe/slide speed-jump, wall-jump, and ledge-grab templates.
- [x] Serialize immutable ordinary-jump annotations under `.cache/bots/maps`; richer tactical annotations remain planned.
- [x] Invalidate by BSP hash, schema, trigger version, and movement fingerprint.
- [ ] Add multi-goal route-distance caching.

### Phase 2: Generic sequence runtime

- [x] Add sequence registry, deterministic candidate scoring, phase state, timeouts, and abort reasons.
- [x] Execute validated ordinary-jump annotations and verify takeoff/landing outcomes.
- [x] Move the existing generic route/dodge slide into a real sequence.
- [ ] Move the static escape/height concepts into real sequences.
- [x] Execute and verify authored teleporter and jumppad trigger traversals.
- [x] Keep the old state machine as fallback when no sequence applies.
- [x] Ensure `HybridBrain` cannot overwrite an active authored sequence.
- [x] Cool down failed traversal edges temporarily and replan.
- [ ] Record sequence success/failure into longer-lived traversal statistics.

### Phase 3: Movement skill

- Extend the initial `route_crouchslide` with collision/occupancy prediction and item-specific stopping-distance policy.
- [x] Implement the first `traverse_teleporter` and `traverse_jumppad` executors.
- [x] Implement the first conservative `route_strafe_jump` executor.
- [x] Implement the first conservative final-edge `item_slide_approach`.
- Implement opportunity executors for speed-assisted jump, wall jump, and wall-jump-to-ledge-grab plans.
- [x] Export the authoritative FPS movement baseline and derive bot physics knowledge from it.
- Add route look-ahead, stopping distance, corner angle, trigger entry, and teammate occupancy checks.

### Phase 4: Combat choreography

- Implement `blade_slide_engage`.
- Implement ledge/drop detection and `rocket_drop_attack`.
- Remove unsafe blind chase prefire or convert it to an authored sequence.
- Add weapon switch confirmation, impact prediction, splash envelopes, and recovery phases.

### Phase 5: Gametype directives

- Add shared `AgentDirective` types.
- Add optional pure `BaseGametype.getAgentDirectives()`.
- Inject per-client directive events in snapshot broadcasting.
- Parse directives into sticky, expiring goals.
- Add one example in TDM and one objective-mode test fixture before broad adoption.

### Phase 6: Humanization and team play

- Wire reaction time, item-timing skill, mistake rate, and attention state.
- Add uncertainty decay, route habits, teammate spacing, and limited team callouts.
- Add personality biases over valid goal/sequence scores.
- Tune from telemetry and demos, not subjective random constants alone.

### Phase 7: Lifelong map learning

- Add separate static-map and empirical-experience caches.
- Record opportunity/sequence transitions with exact outcome attribution.
- Add a map-independent candidate scorer with a versioned feature schema.
- Update simple per-map confidence online; keep TensorFlow weights frozen during matches.
- Build replay mixing across maps, procedural labels, self-play, and player demos.
- Train challengers asynchronously and gate promotion against safety, unseen-map, and regression suites.

## 14. Likely file changes

Names are proposals; exact splits can be adjusted during implementation.

| File | Planned responsibility |
| --- | --- |
| `src/bot/BotGameState.ts` | Player relation, match/gametype context, directives, stable pickup active state. |
| `src/bot/BotVision.ts` | Split immutable map context from mutable per-bot perception; add drop/landing queries. |
| `src/bot/BotServer.ts` | Cache map context/nav graph, create one perception instance per bot, load/save map cache. |
| `src/bot/BotNavGraph.ts` | Typed path steps, trigger metadata, safer costs/heuristic, strategic distance cache. |
| `src/bot/BotMovementAnalyzer.ts` | Discover standable surfaces, prune candidates, and validate maneuver rollouts. |
| `src/bot/BotTraversalMemory.ts` | Bounded empirical success/time/error statistics separate from static geometry. |
| `src/bot/BotExperienceRecorder.ts` | Record goal, candidate, sequence phase, outcome, and attribution for replay. |
| `src/bot/BotReplayStore.ts` | Versioned bounded replay across maps, bots, analyzer labels, and player demos. |
| `src/bot/BotOpportunityScorer.ts` | Map-independent neural scoring of structured movement/route candidates. |
| `src/bot/BotModelEvaluator.ts` | Champion/challenger safety and generalization gates before model promotion. |
| `src/cli/bot-analyze.ts` | Implemented deterministic map-analysis CLI; writes reports/caches without starting a match. |
| `src/bot/BotGoalPlanner.ts` | Candidate goals, utility, stickiness, interruption, failure cooldowns. |
| `src/bot/BotSequence.ts` | Implemented sequence registry/runtime; owns scoring, authoritative-tick phase state, commitments, timeouts, and aborts. |
| `src/bot/sequences/*` | `ValidatedJumpSequence`, `RouteCrouchslideSequence`, `RouteStrafeJumpSequence`, `ItemSlideApproachSequence`, `TraverseTeleporterSequence`, and `TraverseJumppadSequence` are implemented; richer movement and combat sequences remain incremental. |
| `src/bot/BotFireSafety.ts` | Relation, line-of-fire, projectile, splash, and self-risk checks. |
| `src/bot/StateMachineBrain.ts` | Become fallback/proposal logic; remove generic random actions replaced by sequences. |
| `src/bot/HybridBrain.ts` | Score valid goals/sequences later; preserve rule fallback. |
| `src/shared/bsp/PickupTable.ts` | Reuse existing stable pickup truth; likely no semantic change needed. |
| `src/shared/server/gametype/AgentDirective.ts` | Serializable game-agnostic directive contract. |
| `src/shared/server/gametype/GametypeTypes.ts` | Expose `teamBased` and directive event types as needed. |
| `src/games/fps/server/gametypes/BaseGametype.ts` | Optional directive hook. |
| `src/games/fps/server/gametypes/GametypeController.ts` | Resolve directives for a player. |
| `src/games/fps/server/SnapshotBroadcaster.ts` | Inject addressed directives; spatialize relevant events if chosen. |
| `src/games/fps/client/debug/BotMovementDebugRenderer.ts` | Proposed map-owned 3D renderer for nav nodes, candidate surfaces, and validated trajectories. |
| `src/games/fps/console/commands/BotNavCommand.ts` | Proposed developer command for loading, filtering, and inspecting an analysis report. |

Network edits are high-risk under the repository rules. If directive transport or event filtering changes, the full renderer/network regression set from `AGENTS.md` is required even though most bot work is headless.

## 15. Validation plan

### Unit tests

- FFA players with equal/empty team strings remain enemies.
- Same-team players never enter visible enemy, audible enemy, chase, or attack target lists.
- Fire gate suppresses direct, corridor, projectile, and splash-risk shots involving an ally.
- One bot dying/clearing perception does not modify another bot's memory.
- Pickup table joins correctly with the active mask, including health, armor, ammo, and weapons.
- Item utility changes with stack, ammo, active state, wait time, and denial value.
- Path reconstruction preserves every edge type.
- Cache rejects a changed BSP hash, movement fingerprint, or schema.
- Directives expire, remain addressed to one player, and cannot bypass safety.
- Static map truth is reproducible and unaffected by empirical failures.
- Empirical traversal memory updates without changing neural weights or blocking decisions.
- Candidate features contain no map name or absolute coordinate.
- Replay schema rejects mismatched feature/model versions.
- Challenger promotion rejects team-safety regressions and improvements that overfit one map.
- Training on a new map retains an agreed performance floor on older holdout maps.

### Sequence tests

- Blade sequence builds speed before fire, enters slide, fires inside intercept range, and performs recovery.
- Blade sequence aborts when the target becomes an ally or leaves the corridor.
- Strafe-jump chain gains speed across a known simulated route without exceeding cross-track tolerance.
- Surface analysis rejects steep/blocked/non-standable landings and returns stable landing regions.
- Speed-assisted jump succeeds only after its measured speed/takeoff envelope is satisfied.
- Wall-jump analysis honors surface normal, reach, ground clearance, approach velocity, cooldown, and full-hull landing.
- A wall-jump-to-ledge-grab opportunity completes both state transitions and rejects insufficient clearance.
- Item slide does not overshoot a pickup and aborts when its active bit clears.
- Teleporter sequence enters the trigger and resets path state at the expected destination.
- Jumppad sequence preserves a safe landing and transitions at the target.
- Rocket-drop fires at valid ground impact, suppresses ally/self-unsafe splash, and lands safely.
- Sequence timeouts cannot leave attack/crouch/jump buttons latched.

### Headless integration

Add a deterministic bot scenario harness rather than judging only from a live browser:

- fixed map (initially `wdm2`), seed, bot count, teams, difficulty, and tick budget;
- report goals selected, sequence attempts/successes, team-fire suppressions, path failures, item pickups, speed per route, and damage;
- fail on friendly targeting, NaN input, stuck sequence, stale directive, or invalid cache use.

Existing baseline commands to retain:

```bash
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
```

## 16. Success criteria

The feature is ready for live tuning when:

- zero intentional ally target/fire decisions occur in deterministic team tests;
- two bots on one map have isolated perception/memory;
- paths explicitly traverse tested teleporter and jumppad edges;
- a hard bot completes a measured strafe-jump chain and item slide more often than the medium bot;
- blade-slide and rocket-drop have observable setup, commit, fire, and recovery phases;
- `wdm2` movement-opportunity fixtures validate ordinary, speed-assisted, wall-jump, and wall-jump-to-ledge routes;
- bots stop routing to inactive items unless timing predicts a worthwhile arrival;
- gametype code can issue an expiring objective that reaches only the intended bot;
- cache hits avoid rebuilding static map analysis and cache invalidation is proven;
- telemetry explains every sequence start, abort, and suppressed shot;
- an unseen BSP becomes navigable from deterministic analysis without training a map-specific model;
- repeated play improves route confidence/timing while the static cache remains unchanged;
- neural candidate scoring beats a non-neural baseline on held-out maps, not only its training maps.

## 17. Open decisions

1. Should tactical cache learning be global, per difficulty, per personality, or per named bot? Recommendation: static geometry global; empirical traversal global with confidence; tactical preferences per personality; live danger per match.
2. Should spatial event filtering be fixed server-side for every client, or conservatively approximated only in bot perception first? Server-side is more correct but is a higher-risk network change.
3. Should gametype directives be bot-specific or generic “agent objectives” exposed to all clients? Generic data contracts are cleaner, but only bots need to consume them initially.
4. Should TDM permit friendly damage? This does not change bot safety, but it changes splash-risk tuning and server tests.
5. Which exact `wdm2` takeoff/contact/landing regions should form the initial named regression catalogue? Capture them from developer visualization, then freeze them as fixtures.
6. Should runtime learned map statistics persist by default, or only when a `bot_learning` option is enabled? Recommendation: cache static analysis always; persist learned statistics behind an explicit option until decay/versioning is proven.

## 18. Developer visualization and `wdm2` capture

This is the missing bridge between a plausible analyzer and trustworthy special jumps. The repository has generic console registration, Babylon line/sphere primitives, and map-owned cleanup, but it does not currently have a bot/nav spatial overlay. `DebugOverlay` and `DeveloperBar` are text-only and should remain so.

### 18.1 One report, two consumers

The headless analyzer should be the source of truth. It writes a versioned `MovementAnalysisReport`; both bots and the browser debug renderer read that report. The browser must not independently recalculate whether a jump works, because a second physics approximation would make the picture disagree with bot behavior.

```typescript
interface MovementAnalysisReport {
  schemaVersion: number;
  mapName: string;
  bspHash: string;
  movementFingerprint: string;
  generatedAt: string;
  nav: {
    nodes: NavNode[];
    edges: NavEdge[];
  };
  opportunities: MovementOpportunity[];
  rejected: Array<{
    id: string;
    kind: TraversalKind;
    takeoff: Vec3;
    landing?: Vec3;
    reason:
      | "blocked_clearance"
      | "unstandable_landing"
      | "outside_envelope"
      | "missed_wall"
      | "missed_landing"
      | "unsafe_fall"
      | "unstable_result";
  }>;
  metrics: {
    traceCount: number;
    candidateCount: number;
    rolloutCount: number;
    acceptedCount: number;
    discoveryMs: number;
    rolloutMs: number;
  };
}
```

The persistent cache may contain more compact data, but a developer report should retain sampled trajectory points and rejection reasons. Cache/report loading must reject mismatched BSP hashes, schema versions, or movement fingerprints.

### 18.2 3D visual language

Use a dedicated `BotMovementDebugRenderer`, not additions to the console DOM:

| Visual | Meaning |
| --- | --- |
| Small white sphere | Navigation node or analyzer seed. |
| Translucent cyan disc/patch | Valid standing or landing region. |
| Green polyline | Ordinary jump. |
| Blue polyline | Strafe-jump or speed-assisted jump. |
| Yellow polyline | Crouchslide-to-jump plan. |
| Magenta polyline and normal | Wall-jump trajectory and wall contact. |
| Orange continuation | Ledge-grab phase after wall contact. |
| Red dashed line/marker | Rejected or unsafe candidate. |
| Wire box at takeoff | Allowed takeoff corridor and yaw/speed envelope. |
| Wire cylinder/disc at landing | Landing tolerance; size makes execution margin visible. |

Selecting an opportunity should highlight only its takeoff, per-tick rollout path, wall contact, landing region, and failure landing. The text console can print ID, kind, required speed range, input phases, expected ticks, margin, risk, and rejection reason.

Create meshes in batches where practical (`CreateLineSystem` for static groups rather than one mesh per segment). Tag all overlay meshes `metadata.mapOwned = true`, explicitly dispose shared debug materials, and remove any render observer on clear/map change. Do not render every rejected rollout by default; that can be thousands of lines.

### 18.3 Proposed developer commands

These commands do **not** exist today; they are the proposed interface:

```text
botnav load <report.json>
botnav show nodes|edges|jump|strafe|slide|wall|rejected|all
botnav hide <filter>
botnav near [radius]
botnav inspect <opportunity-id>
botnav next
botnav previous
botnav clear
```

A headless entry point now keeps analysis reproducible. The shortest cache-aware form is:

```bash
npm run bot:analyze -- wdm2
```

To force a fresh build and write a report with this repository's Windows/npm argument forwarding:

```powershell
$env:GAME_PATH = "./public/data"
npm run bot:analyze -- -- --map wdm2 --rebuild --out .cache/bots/reports/wdm2.json
```

The current command prints cache status, node/edge counts, performed rollout counts, acceptance counts, and elapsed analysis time. Its JSON report includes the BSP/movement fingerprints, compact opportunities, bounded rejection records, and metrics. It returns non-zero on an invalid map. Repeated-result comparison, sampled trajectory points, trace/stage timing splits, and fixture verification remain to be added; a cache-hit report intentionally has no rebuild-only rejection samples and performs zero rollouts.

The first browser workflow can load a local report explicitly. A later developer-only transport may stream a report from the external bot process, but this must not become gameplay networking or ship analysis internals in snapshots.

### 18.4 Capturing the first `wdm2` catalogue

For every named opportunity:

1. Run headless analysis twice with the same BSP, movement configuration, seed, and 125 Hz step.
2. Require stable opportunity IDs and equivalent takeoff/contact/landing envelopes.
3. Load `wdm2` in developer/freefly mode and load the report into the 3D overlay.
4. Inspect the candidate from several angles; verify full-hull clearance rather than only the center trajectory.
5. Replay the exact input phases from the recorded start state.
6. Perturb speed, yaw, takeoff position, and input tick by small controlled amounts to measure the success envelope.
7. Freeze a human-readable fixture only after the rollout succeeds at its advertised center and fails or degrades outside its advertised margin.

The committed fixture should store compact semantic truth, not a giant generated report:

```typescript
interface MovementOpportunityFixture {
  name: string;
  kind: TraversalKind;
  takeoffRegion: Aabb;
  landingRegion: Aabb;
  wallContactRegion?: Aabb;
  minSuccessMargin: number;
  expectedResult: "reachable" | "unreachable";
}
```

Suggested fixture location: `src/bot/__tests__/fixtures/wdm2MovementOpportunities.ts`. Include at least one deliberately tempting but impossible jump so a more permissive future analyzer cannot silently inflate reachability.

### 18.5 Work budgets

Avoid a single magic time limit before measuring `wdm2`. Budget explicit units and report elapsed time:

- Candidate discovery is map-build work seeded from strategic nodes, item areas, trigger exits, platform lips, and nearby wall strips; it is not a dense whole-map voxel search.
- Apply cheap height, distance, surface-normal, hull-clearance, and ballistic tests before simulation.
- A rollout has a bounded tick horizon derived from the maneuver; never run until an arbitrary landing happens.
- Search coarse speed/yaw/timing samples first, then refine only around successful samples.
- Deduplicate geometrically equivalent candidates before rollouts.
- At runtime, query only local or goal-relevant cached opportunities and validate current obstruction/state; do not rebuild the map catalogue per bot.
- Amortize any uncached local probes across decision snapshots and cap both traces and rollouts per update.
- Record p50/p95 build time, rollout count, cache size, and runtime query cost on `wdm2` before setting CI thresholds.

The performance contract should first be qualitative: no missed 125 Hz input deadline, no browser-frame dependency, deterministic output, bounded work, and a cache hit that performs no rollouts. Numeric CI limits should come from measured baseline data rather than guesses in this document.

### 18.6 Tests enabled by the overlay/report

- Report serialization round-trips without changing opportunity IDs or envelopes.
- Changed movement configuration invalidates the report.
- Two identical `wdm2` analyses produce the same accepted catalogue and rejection counts.
- Every accepted fixture has a visible takeoff, trajectory, and landing representation.
- Every rejected fixture exposes a stable rejection reason.
- Clearing the overlay disposes its meshes/materials/observer, and map changes leave no old markers.
- Filter and selection commands do not modify the report or analyzer result.
- Headless fixture validation remains authoritative; screenshots are diagnostic evidence, not pass/fail truth.

## 19. Final direction

The strongest path is:

1. fix team/perception/item correctness;
2. make navigation return meaningful actions instead of anonymous points;
3. add a generic sequence runtime;
4. teach movement sequences;
5. layer combat choreography on top;
6. let gametypes supply goals as data;
7. humanize attention, memory, and style after competence is measurable.

That produces bots whose plays are powerful and understandable. A player can recognize what the bot attempted, punish its commitment, learn its habits, and still be surprised by a well-chosen sequence. That is much closer to a convincing arena opponent than continuous random jump/strafe/fire output.
