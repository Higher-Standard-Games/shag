# Bot Weights and Goals

> Gametype-defined behavioural weights, a common goal currency, and the road to objective modes bots can actually play.

**Date:** 2026-07-28
**Status:** Phases 1–4 landed (see §13); Phases 5–6 are design research. Phase 6 (Search & Destroy) is the next slice.
**Scope:** `src/bot`, `src/shared/server/gametype`, `src/games/fps/server/gametypes`

**Stated requirement:** the eventual Search & Destroy mode must be **compatible with Warsow's Bomb rules and entity contract** (`trigger_capture_area` + `misc_capture_area_indicator`), so the shipped `wbomb*` maps work unmodified. See §2.6 for the surveyed map data and §11.3 for the extraction contract.

## Relationship to existing docs

This document does **not** restart bot design. `docs/research/BOT_IMPROVEMENT.md` already specifies:

- §4 — the `BotGoal` record and the goal planner
- §4.1 — arbitration order and the "hard invariants are not scored" rule
- §4.2 — `AgentDirective`, the gametype hook, and the per-client transport
- §8.1 — replacing hardcoded item ordering with a utility score
- §12 — `HybridBrain` integration, including "generalize through candidate features, not map identity"
- Phase 5 — the implementation slice for the directive work

**All of that remains the plan.** Phase 5 is entirely unimplemented: there is no `AgentDirective` file, no `getAgentDirectives` hook, and no reference to either anywhere in `src/`.

This document adds one idea BOT_IMPROVEMENT does not contain, and then follows its consequences all the way into implementation:

> A gametype should define a **generic set of behavioural weights** — how much it values staying near teammates, protecting a carrier, pushing an objective — separately from issuing specific orders.

Taking that seriously changes four things: it splits gametype input into two different kinds of data (§4), it forces the arbitration decision §4.1 leaves open (§6), it makes the machine-learning path *better* rather than merely compatible (§10), and it exposes a reward-function gap that would otherwise silently undo the whole layer (§10.1).

---

## 1. The constraint everything follows from

**Bots are separate OS processes that connect as ordinary network clients.**

`BotServer` runs a control API on port 9100 and spawns `BotClient` instances, each opening a WebSocket to the game server and speaking the normal client protocol ([`src/bot/BotServer.ts`](../../src/bot/BotServer.ts), [`src/bot/BotClient.ts`](../../src/bot/BotClient.ts)). A bot's entire perception is the snapshot stream plus locally derived BSP knowledge.

The gametype runs *inside* the server with full `WorldState` access.

Therefore **bot decision code cannot live in the gametype.** This is not a limitation to engineer around — it is load-bearing:

- It keeps bots honest. A bot cannot see anything a human client could not, which makes bot behaviour a genuine test of what the protocol actually replicates.
- It forces objectives to be **data**. "Plant at site A" must be a fact on the wire, not a function call — which is what a bot in another process, a demo recording, and a test fixture all independently need.

Everything below follows from that boundary.

---

## 2. Verified current state

Measured against the code on `0.9.21-qa-improvements`.

### 2.1 Item selection has no notion of value

```typescript
// src/bot/BotGameState.ts
getNearestPickup(maxDistance: number = Infinity): VisiblePickup | null {
  return this.pickups.find((p) => p.distance <= maxDistance) || null;
}

export interface VisiblePickup {
  entityId: string;
  type: string;      // "weapon" | "health" | ... — no kind
  position: Vec3;
  distance: number;
}
```

Nearest wins, always, and the record cannot distinguish Red Armor from an armor shard. A bot between a 5 HP bubble and a Mega takes whichever is one unit closer. Quad Damage — now implemented, on 25 of 38 shipping maps, exactly once per map — is invisible as anything but "a pickup".

This is why a quad-specific special case is the wrong fix: **there is no ranking to insert quad into.**

### 2.2 The state ladder has precedence, not currency

`StateMachineBrain._evaluateState()` is ordered boolean tests:

```text
recently damaged        -> FIGHT | DODGE | RETREAT
enemy visible < 2000u   -> FIGHT
tracking a lost enemy   -> CHASE
health < 40 && pickup   -> RETREAT
should seek items       -> ITEM_RUN
otherwise               -> HUNT
```

No score exists anywhere, so **there is nothing for a weight to multiply**. This is the crux of §6.

### 2.3 Bots receive match state and discard it

`match_state` is event code 2, encoded as JSON once per snapshot, already carrying `gametypeName`, `phase`, `teamScores`, `playerTeams`. Grepping `src/bot` for `matchSnapshot` / `match_state` / `MatchState` returns **nothing**.

The gametype→bot channel physically exists and is simply unconsumed.

### 2.4 Per-client injection is already possible

`SnapshotBroadcaster` builds a per-client copy of every snapshot unconditionally (each client needs its own `ackedInputSeq`) and already supports per-client PVS filtering. The transport BOT_IMPROVEMENT §4.2 prefers for directives needs no new machinery.

### 2.5 The RL reward function is deathmatch-shaped

```typescript
// src/bot/BotRewardComputer.ts
export const DEFAULT_REWARDS: RewardConfig = {
  killReward: 1.0, deathPenalty: -1.0,
  damageDealtReward: 0.3, damageTakenPenalty: -0.2,
  itemPickupReward: 0.2, healthGainReward: 0.001, survivalBonus: 0.001, ...
};
```

No objective term; a module-level constant with no gametype awareness. **A bot trained under this learns to frag, in every gametype.** See §10.1.

### 2.6 Warsow Bomb map support already exists in shipped data

**Design constraint: S&D must be compatible with Warsow's Bomb rules and entity contract**, so existing `wbomb*` maps work unmodified. Parsed from the BSP entity lumps of all 38 shipping map pk3s:

| Map | `misc_capture_area_indicator` | `trigger_capture_area` | Indicator `targetname` | alpha/beta spawns | flags |
|---|---|---|---|---|---|
| wbomb1 | 2 | 2 (1 per site) | `misc_capture_area_indicator1/2` | 9 / 7 | yes |
| wbomb2 | 2 | **0** | **none** | 8 / 16 | yes |
| wbomb3 | 2 | **0** | **none** | 6 / 6 | yes |
| wbomb4 | 2 | **0** | **none** | 6 / 9 | yes |
| wbomb5 | 2 | 6 (4 / 2) | `bombsitea0` / `bombsiteb0` | 8 / 8 | yes |
| wbomb6 | 2 | 7 (3 / 4) | `misc_capture_area_indicator1/2` | 4 / 6 | **no** |
| wdm4, wdm9 | 3 | 3 | — | none | no |

The full contract, from wbomb1:

```text
{ "classname" "misc_capture_area_indicator"
  "targetname" "misc_capture_area_indicator1"
  "target"     "smallexplosions_a"        // cosmetic: fires target_explosion
  "origin"     "-528 -448 360" }

{ "classname" "trigger_capture_area"
  "model"      "*3"                       // brush volume
  "target"     "misc_capture_area_indicator1" }   // -> indicator targetname
```

Team spawns reuse the CTF entities — `team_CTF_alphaspawn` (attackers) and `team_CTF_betaspawn` (defenders) — present on all six bomb maps.

**Four gotchas that must shape the extractor, not be discovered during implementation:**

1. **Exactly 2 indicators on every bomb map.** This is the reliable invariant; site count is not variable. (wdm4/wdm9 have 3 indicators and *no* team spawns — they are not bomb maps and must not be detected as such. Presence of `team_CTF_alphaspawn` + 2 indicators is the correct bomb-map test.)
2. **Half the maps have no `trigger_capture_area` at all** (wbomb2/3/4). A radius fallback around the indicator origin is therefore **mandatory**, not a nicety. Volumes refine a site; they do not define it.
3. **Half the maps have no `targetname`** (wbomb2/3/4), and naming is inconsistent where it exists (`misc_capture_area_indicator1` vs `bombsitea0`). Site identity therefore **cannot** depend on `targetname`.
4. **Entity order does not match site letter.** wbomb6 lists `indicator2` before `indicator1`. Since the label is cosmetic, what actually matters is that server and bots derive the *same* ids from the *same* BSP — the identical guarantee `extractPickups()` already provides for pickup ids. Assign deterministically from BSP order and treat "A"/"B" as a display concern.

Volumes link **many-to-one** via `trigger_capture_area.target` → indicator `targetname` (wbomb5: 4 volumes on site A, 2 on B).

So the objective *position* is a point-entity origin (directly navigable) and the *plant region* is either a union of brush volumes or a radius. **All six `wbomb*` maps are ready-made two-site S&D maps requiring no authoring** — only a shared extractor, which is exactly what `TriggerTable` already does for other trigger classes.

---

## 3. The three-way split

The weights idea separates things BOT_IMPROVEMENT §4.2 treats as one channel:

| | What it is | Example | Lives in | Changes |
|---|---|---|---|---|
| **Weights** | Policy — how much this gametype values a *kind* of behaviour | `carrierProtect: 0.8` | `src/shared/` module, keyed by gametype+role | Per gametype, static |
| **Directives** | Live facts and orders, positional and expiring | "plant at site A, 22s left" | Wire, per-client event | Constantly |
| **Considerations** | Skill — functions scoring the current situation | "how far am I from my nearest ally *right now*" | `src/bot/`, bot-side code | Improves over time |

The gametype owns **policy**. The bot owns **skill**. The wire carries **facts**.

This delivers the property that motivated the idea — *"each of these skills can develop better on the background per function"* — because a consideration is a pure function `(ctx) => number` with no dependency on arbitration, on other considerations, or on any gametype. Improving "stay near teammates" from a distance falloff into something that understands sightlines is a change to **one function and its test**, with no ripple.

---

## 4. Weights

### 4.1 Shape

```typescript
/** Behavioural policy for one gametype role. All values 0..1. */
interface BotWeightProfile {
  itemGreed: number;       // value an item for your OWN use
  itemDenial: number;      // value it purely for the enemy not having it
  objectivePush: number;   // advance and complete the objective
  teamCohesion: number;    // stay within supporting distance of allies
  carrierProtect: number;  // guard whoever holds the flag/bomb
  mapControl: number;      // hold strong ground rather than roam
  aggression: number;      // seek out and finish enemies
  /**
   * How far the above push through danger. High = "advance to the bomb spot
   * blindly". Scales DOWN the danger consideration's suppression; it is a
   * modifier, not a goal of its own.
   */
  riskTolerance: number;
}
```

### 4.2 Profiles are data

```typescript
// Shipped (Phase 2)
deathmatch      { itemGreed: 1.0, itemDenial: 0.3, mapControl: 0.3, aggression: 0.8, riskTolerance: 0.5 }
team_deathmatch { itemGreed: 0.9, itemDenial: 0.4, mapControl: 0.4, aggression: 0.7, riskTolerance: 0.4, teamCohesion: 0.5 }
duel            { itemGreed: 1.0, itemDenial: 0.9, mapControl: 0.9, aggression: 0.5, riskTolerance: 0.3 }

// Illustrative (Phase 6)
snd_attacker    { itemGreed: 0.2, itemDenial: 0.1, objectivePush: 0.9, teamCohesion: 0.6, carrierProtect: 0.8, riskTolerance: 0.7 }
snd_defender    { itemGreed: 0.2, itemDenial: 0.1, objectivePush: 0.1, teamCohesion: 0.4, mapControl: 0.9, riskTolerance: 0.3 }
```

Duel's signature is `itemDenial: 0.9` — in a 1v1, taking the Mega your opponent needs is worth nearly as much as needing it yourself. That is the whole difference between a duel bot and a deathmatch bot, and it is expressed entirely in data.

Behaviour that falls out rather than being coded:

- **Duel bots play map control** (`mapControl 0.9`, `aggression 0.5`) — timing items and holding ground, which is what duel is.
- **"Advance to the bomb spot blindly"** is `objectivePush 0.9` + `riskTolerance 0.7`. No special state, no scripted rush.

**Profile selection key.** Not just gametype name — a mode can change what it wants mid-round (post-plant defenders must *defuse*, which inverts their profile). Proposed lookup:

```typescript
profileKey = `${gametypeName}:${role ?? "all"}:${roundState ?? "default"}`
// "snd:defender:post_plant" -> high objectivePush, high riskTolerance
```

with fallback `gametype:role:default` → `gametype:all:default` → `deathmatch`. Missing keys must never throw; an unknown gametype gets sane DM behaviour.

### 4.3 Protocol cost

For DM, TDM and Duel: **zero protocol change.** `gametypeName` is already on the wire; the bot just has to start parsing the `match_state` event it currently discards (§2.3).

For alternating-role modes, the bot needs its round role and the round state. Both are *public* information — everyone in an S&D round knows who is attacking and whether the bomb is planted — so they belong in broadcast `match_state`, not in per-client directives:

```typescript
interface MatchStateSnapshot {
  // ...existing...
  teamRoles?: Record<TeamId, string>;  // { udon: "attacker", soba: "defender" }
  roundState?: string;                 // "pre_plant" | "post_plant" | ...
}
```

Tactical *orders* stay per-client. Publishing "bot 3 should flank left" to everyone would be a genuine information leak; publishing "Udon is attacking" is not.

### 4.4 Weights are not difficulty

`BotDifficulty` ([`src/bot/BotConfig.ts`](../../src/bot/BotConfig.ts)) is `aimAccuracy`, `reactionTimeMs`, `trackingSpeed`, `predictionSkill`, `itemTimingSkill`, `strafeJumpSkill`, `dodgeSkill`, `mistakeRate`, `lookAroundInterval` — every one a **capability**. Every weight is a **priority**.

Keep them orthogonal:

- A low-skill bot that plays the objective correctly is valid and desirable (a beginner who understands the mode).
- A high-skill bot that ignores the objective to farm frags is also valid — and is exactly what today's bots would do in S&D.

Collapsing them is the classic mistake that makes "hard" bots merely *reckless*.

---

## 5. Considerations

```typescript
interface ConsiderationContext {
  self: BotSelf;
  goal: BotGoal;              // the candidate being scored
  state: BotGameState;
  routeCost: number | null;   // null = unreachable
  weights: BotWeightProfile;
}

interface Consideration {
  readonly id: string;                        // "team_cohesion"
  readonly weightKey: keyof BotWeightProfile | null;  // null = ungated by policy
  /** Pure. Returns 0..1. No side effects, no randomness, no clock reads. */
  score(ctx: ConsiderationContext): number;
}
```

| Consideration | Weight key | Shape |
|---|---|---|
| `item_value` | `itemGreed` | grant value × current need, minus overcap waste |
| `item_denial` | `itemDenial` | enemy would benefit; scales with tier |
| `objective_push` | `objectivePush` | progress toward an active directive |
| `objective_urgency` | `objectivePush` | time pressure (bomb timer, round clock) |
| `team_cohesion` | `teamCohesion` | falloff from nearest-ally distance |
| `carrier_protect` | `carrierProtect` | proximity to carrier, weighted by their exposure |
| `map_control` | `mapControl` | node strength (height, choke, item neighborhood) |
| `target_opportunity` | `aggression` | enemy reachable, weak, or isolated |
| `route_cost` | *(null, **discount**)* | inverse of travel cost — physics, not policy |
| `danger` | *(null, **discount**)* | exposure + damage heat, suppressed by `riskTolerance` |

Everything above except the last two rows is an **attractor**; those two are **discounts** (§6.3). Neither is gametype-weighted: route cost is physics, and danger is a suppressor scaled by `riskTolerance` rather than a peer goal — otherwise "avoid danger" competes with "push objective" as an equal, which is the wrong relationship.

### 5.1 Normalization is part of the contract

Considerations must return `0..1` or the combination rule is meaningless. Unbounded inputs need explicit falloffs with named constants:

```typescript
const ROUTE_SCALE = 1200;   // world units at which route score halves
routeScore  = routeCost === null ? 0 : 1 / (1 + routeCost / ROUTE_SCALE);

const DANGER_HALF_LIFE = 250;  // ticks
dangerScore = clamp01(exposure * 0.6 + recentDamageHeat * 0.4);
suppression = 1 - dangerScore * (1 - weights.riskTolerance);
```

Every consideration ships with its constants named and its curve documented. "Returns 0..1" is a testable contract, and every consideration's unit test should assert the bounds over randomized contexts.

---

## 6. Arbitration

### 6.1 A ladder cannot take weights

The current `_evaluateState()` is ordered booleans (§2.2) — there is nothing to scale. And weights touch things a ladder cannot express: `teamCohesion` and `carrierProtect` are not item targets, they are positioning pressures that compete with *fighting*. "Hang back and guard the carrier instead of chasing that guy" is unrepresentable in a ladder whose second rung is `enemy visible -> FIGHT`.

So adopting weights necessarily means adopting scored arbitration for anything a weight touches.

### 6.2 Three layers, only one of them scored

| Layer | Contents | Mechanism |
|---|---|---|
| **Invariants** | dead/respawn; never fire at an ally; no invalid movement mechanic | Not scored. Unchanged from §4.1. |
| **Reflex** | being damaged; enemy inside close range; projectile dodge | Not scored. Fixed responses gated by `BotDifficulty.reactionTimeMs`. |
| **Deliberation** | items, objectives, map control, team positioning, hunting, breaking off a fight | Fully scored. Weights apply here. |

Reaction is a **capability** property and `BotDifficulty` already models it. If `riskTolerance` could suppress flinching when shot, "reckless" and "low-skill" collapse into one knob and you lose the ability to build a bot that is both aggressive and sharp — which §4.4 requires.

### 6.3 The combination rule

Where weighted-consideration systems usually fail, so it needs an explicit decision.

- **Weighted sum `Σ wᵢcᵢ`** — the common choice and the common failure. A goal scoring 0.4 on five considerations totals 2.0 and beats a goal scoring 0.95 on the one consideration that matters. *Mediocre-at-everything wins*, and decisions become unexplainable.
- **Weighted max `max(wᵢcᵢ)`** — no additive pathology, but nothing compounds.
- **Multiplicative `Π cᵢ^wᵢ`** — any zero vetoes everything (right for gates, wrong for soft pulls), and with many terms the product decays toward zero regardless of quality.

**Adopted — gated weighted max over ATTRACTORS, multiplied by DISCOUNTS:**

```text
desire(goal) = gate × attraction × discount

attraction = max_i(wᵢ·cᵢ) + β · mean_{i≠argmax}(wᵢ·cᵢ)   over attractors only
discount   = Π(discount considerations)                   each 0..1

gate ∈ {0,1}   reachable? alive? correct phase? not on cooldown? server will allow it?
β ≈ 0.15       secondaries nudge ties, never dominate
```

**The attractor/discount split is load-bearing, and an earlier draft of this
document got it wrong.** Listing `route_cost` and `danger` as ordinary
considerations inside the max means proximity becomes a *reason* to want
something: a 5 HP bubble two steps away scores ~1.0 on route and beats a Mega
across the room. Being close is not a reason to want a thing — it only makes a
thing you already want cheaper. So considerations declare a role:

- **attractor** — a reason to pursue the goal (`item_value`, `item_denial`,
  later `objective_push`, `team_cohesion`). These compete for the maximum.
- **discount** — a reason it is expensive or unwise (`route_cost`, `danger`).
  These multiply, and can only ever scale down a reason that already exists.

Discounts are never gametype-weighted: route cost is physics, and danger is
scaled by `riskTolerance` inside its own curve rather than by a policy weight.

plus the stickiness §4.1 already calls for:

```text
if goal.id == currentGoal.id and tick < commitmentUntil:
    desire += HYSTERESIS      // ≈ 0.10
```

The dominant consideration drives the decision, secondaries break ties, gates are honest binary vetoes (an unreachable route scores 0, not 0.05), and hysteresis stops thrashing.

### 6.4 Goal identity must be stable

Hysteresis and cooldowns are keyed on `goal.id`, so ids must be **stable across ticks and derived from the target, never from the ranking**:

```text
good:  item:pickup:37        objective:plant_a        combat:target:player_4
bad:   item:nearest          objective:current        combat:best_target
```

An id that means "whatever is nearest right now" silently defeats hysteresis: the bot appears committed while the underlying target swaps every tick.

### 6.5 Every decision must explain itself

Non-negotiable, and cheap if built in from the start. Seven weights across four-plus gametypes is an opaque surface within a week otherwise.

```text
goal=objective:plant_a desire=0.72 via=objective_push(0.80×0.90) β=+0.04
  runner-up=item:pickup:37(armor_ra) 0.41
  gated-out=combat:target:player_4 [no_los]
```

`BotBrain.getNavigationDebug()` is existing precedent for exactly this kind of per-bot diagnostic, and `npm run bot:analyze` is an existing reproducible report path. Reuse both rather than inventing a channel.

---

## 7. Implementation design

The part §11 of round one was missing.

### 7.1 Where it sits in the tick

`StateMachineBrain.decide()` currently runs: dead-check → `_evaluateState()` → sequence tick → execute state → feelers → opportunistic sequences. The goal layer replaces exactly one of those steps:

```text
decide(state, vision, visionResult, navGraph):
    if dead                          -> respawn input            [invariant]
    if sequenceRuntime.isActive      -> tick sequence            [unchanged]
    reflex = evaluateReflex(state)                               [reflex layer]
    if reflex                        -> execute(reflex)
    goal = goalArbiter.select(state, weights, directives)        [NEW]
    mode = executionModeFor(goal)                                [BotState]
    input = execute(mode, goal.target)                           [existing executors]
    input = applyFeelers(input, ...)                             [unchanged]
    input = tryOpportunisticSequences(input, ...)                [unchanged]
    return fireSafetyGate(input)                                 [invariant]
```

Everything below `executionModeFor` is existing, tested code. The arbiter chooses *what and where*; the existing executors still decide *how*.

### 7.2 `BotState` survives as an execution mode

BOT_IMPROVEMENT §4 already says the enum states "are useful execution modes, but too coarse to express why a bot is acting." That is exactly the split:

| Goal kind | Execution mode | Target |
|---|---|---|
| `acquire_item` | `ITEM_RUN` | pickup id |
| `eliminate` | `FIGHT` / `CHASE` | player id |
| `move_to`, `hold_area` | `ITEM_RUN` navigation path | position |
| `retreat` | `RETREAT` | position |
| `explore` | `HUNT` | patrol target |

So `_executeItemRun`, `_executeFight`, `_navigateTo` and friends are kept verbatim. No behaviour is rewritten in Phase 1 — only the *choice* of what to feed them.

### 7.3 Goals vs the sequence director

Two commitment mechanisms now exist, and they must not fight. The rule:

> **Sequences are inside goals.** A goal may be re-evaluated at any decision point; a *running sequence* may not be interrupted except by a reflex or an invariant.

The existing runtime already implements interruption-with-a-protected-launch-window (`route_crouchslide` protects its takeoff; `nav_traverse_jumppad` commits through flight). Goal changes map onto the existing `_interruptSequence(state, reason)` path with `reason = "goal:<newGoalId>"`, which also means sequence-abort telemetry keeps working unchanged.

Ordering constraint: hysteresis window ≥ typical sequence duration, or a bot will abandon goals mid-traversal. Sequences observed so far run well under a second; a commitment window of ~1.5 s is a safe starting point.

### 7.4 The route-cost problem, and how to stage around it

**This is the real implementation blocker, and round one glossed over it.**

`route_cost` needs a travel estimate *per candidate*. Running A* (`navGraph.findPath`) against every candidate every decision is infeasible: a map with ~25 active pickups plus enemies and objectives, times eight bots, is hundreds of A* runs per second.

BOT_IMPROVEMENT §8.2 already identifies the eventual fix and Phase 1 lists it as an **unchecked** item: *"Add multi-goal strategic distance caching and learned unreliable-edge penalties."*

Staging that avoids blocking on it:

1. **Phase 1 — Euclidean × detour factor.** `estimate = |Δ| × DETOUR_FACTOR` (≈1.35), with a vertical penalty. Cheap, wrong by a constant, and *good enough for ranking* because every candidate is wrong in the same direction. Exact A* runs **once**, for the winner only.
2. **Phase 3 — exact all-pairs graph distance.** ✅ Landed, and simpler than the landmark scheme sketched here: the graphs are 34–58 strategic nodes, so all-pairs Dijkstra is exact, costs 0.04–0.42 ms to build and ~1 µs to query, and needs no cache schema change at all. See §13 Phase 3.
3. **Later — measured traversal times** feeding back from sequence outcomes.

The `Consideration` interface does not change across those steps, so this is a pure accuracy upgrade behind a stable seam. **`routeCost` must be an injected value on the context, never something a consideration computes itself** — otherwise the estimator cannot be swapped.

### 7.5 Decision cadence and budget

Bots decide at snapshot rate while `BotClient` resends the chosen input at 125 Hz (BOT_IMPROVEMENT records this). The arbiter should not run even that often:

- Re-arbitrate on: goal completion, goal failure, hysteresis window expiry, a reflex ending, a new directive, or a **relevance event** (target pickup deactivated in `pickupActiveMask`, target enemy died, objective state changed).
- Otherwise re-arbitrate at a fixed interval (~4 Hz is ample for deliberative choices).

Candidate generation should also be bounded: nearest N pickups by estimate (N ≈ 12), visible/remembered enemies, and active directives. With ten considerations that is ~250 pure function calls at 4 Hz per bot — trivial.

### 7.6 Determinism and testing

Considerations are pure by contract, so arbitration is deterministic given a context. That makes the whole layer testable in a way the current ladder is not:

**Per-consideration unit tests** — bounds (`0..1` over randomized contexts), monotonicity (closer is never worse), and the specific curve shape at named points.

**Golden-scenario arbitration fixtures** — a hand-built `BotGameState`, a profile, an expected winning goal, and *an expected explanation*:

```typescript
scenario("prefers red armor over a closer health bubble at 95hp/0ap", {
  self:    { health: 95, armor: 0 },
  pickups: [ bubble(dist: 200), redArmor(dist: 450) ],
  profile: "deathmatch",
  expect:  { goalId: "item:pickup:2", via: "item_value" },
});
```

These are cheap, readable, and they are the regression net for weight tuning — the thing that tells you a weight change broke something three gametypes away. They belong next to the existing bot fixtures in `src/bot/__tests__`.

**Live smoke** stays what it is today: short headless runs (the existing `wdm2`/`wdm12` recorder path), used as smoke, not as behavioural truth.

### 7.7 Rollout and rollback

Ship the arbiter behind a switch so old and new behaviour exist in the same build:

```text
bot_goal_arbiter  0 = legacy ladder (default at first)
                  1 = arbiter
                  2 = arbiter + verbose decision log
```

This makes A/B possible in one process, makes bisecting a behaviour regression trivial, and means a bad tuning pass is a config change rather than a revert. Remove the flag once the arbiter has been the default for a full release cycle.

---

## 8. Difficulty and mistakes

`BotDifficulty.mistakeRate` is currently "random dumb decisions per minute (forgetting to pick up items)". With scored goals there is a much better model:

```text
mistake = occasionally select the runner-up goal instead of the winner,
          or apply bounded noise to desire before argmax
```

That produces *plausible* mistakes — taking the second-best item, over-committing to a fight that was marginal — rather than visibly broken ones. It also unifies a knob that currently has no principled meaning, and it keeps the explanation string honest (`via=… [mistake: took runner-up]`).

`itemTimingSkill` similarly becomes a modifier on how accurately `item_value` may use predicted respawn timing, rather than a separate code path.

---

## 9. Quad as the first acceptance test

Quad is the smallest honest test of the design and it is available now.

Under this design it needs **no special case**:

- `VisiblePickup` gains `kind` — the shared `PickupTable` already carries it; the data is discarded at the bot boundary today.
- `item_value` scores quad high (4× damage, 30 s, one per map, 120 s respawn).
- `item_denial` scores it high independently — the enemy holding it is worse than most outcomes.
- `route_cost` and `danger` still apply, so a bot will not cross the map through three enemies for a quad with 4 s left.
- `itemGreed` scales the whole thing, so an S&D bot correctly ignores quad while planting.

> **If quad falls out of the general mechanism with no quad-specific branch, the mechanism is right. If it needs a special case, the scoring shape is wrong.**

---

## 10. Machine learning: what must be decided now

The user question this section answers: *do we have to plan the TensorFlow / demo-training parameters now?*

**No implementation is needed now. Three decisions are, because they are expensive to retrofit and free to adopt.**

### 10.1 Reward must derive from the weight profile

`DEFAULT_REWARDS` (§2.5) rewards kills, damage, pickups and survival — nothing else. Train or fine-tune `HybridBrain` in an objective mode and it learns that **planting the bomb is worth zero and fragging is worth 1.0**. The neural path would then actively fight the deliberative layer, and it would look like "bots just aren't good at S&D" rather than like a bug.

```typescript
interface RewardConfig {
  // ...existing...
  objectiveReward: number;       // advancing/completing the objective
  objectiveLossPenalty: number;  // losing one the team held
}

/** One source of policy, consumed by both the planner and the trainer. */
function rewardsForProfile(p: BotWeightProfile): RewardConfig;
```

**Rule to record: any gametype that publishes directives must also publish weights, and the reward function must be derived from those weights.** BOT_IMPROVEMENT §12.7 already flags "current training gaps to fix first"; this belongs on that list.

### 10.2 Considerations must emit a named feature vector, not just a scalar

Cheap now, invasive later. Have the arbiter retain, per decision, the full per-candidate vector rather than only the winner:

```typescript
interface GoalScoreTrace {
  goalId: string;
  goalKind: BotGoalKind;
  gate: 0 | 1;
  gateReason?: string;
  features: Record<string, number>;  // consideration id -> raw 0..1
  weighted: Record<string, number>;  // consideration id -> wᵢ·cᵢ
  desire: number;
}
```

Two things follow immediately:

- **Ordinary play becomes training data for free.** Every decision emits a labelled candidate set; the outcome (did the goal succeed, did the bot die, did the team win the round) is the label. No special data collection mode.
- **The NN's job changes from control to scoring.** Today `HybridBrain` would have to learn `raw state → buttons`: poor sample efficiency, no cross-map generalization, and it can violate movement preconditions. With this trace it learns `candidate features → desire` — which is **map-independent by construction**, because every feature is relative (route cost, tier value, danger, ally distance) and none is an absolute coordinate. This is precisely BOT_IMPROVEMENT §12.2's "generalize through candidate features, not map identity", and the goal layer is what makes it achievable.

The hand-written considerations then serve as the **prior**: the NN learns a bounded correction to a working baseline rather than learning to play from scratch. That is safe (fall back to the prior any time), debuggable (compare NN desire against hand-scored desire per candidate), and it satisfies §12.4's "safe exploration" requirement without new machinery.

### 10.3 The feature schema needs its own version, tied to the consideration set

Adding, removing or re-curving a consideration changes the meaning of the vector. Without a version, an old model silently consumes a new schema and misbehaves in ways that look like tuning problems.

```text
featureSchemaVersion = hash(ordered consideration ids + their curve constants)
```

Stored alongside model weights; a mismatch **rejects the model and falls back to hand scoring**, exactly as the nav cache already rejects on BSP hash / schema / movement-fingerprint mismatch. That precedent exists and works; reuse it.

### 10.4 Demo training gets qualitatively better, and needs nothing now

`DemoTrainingExtractor` currently faces the imitation problem: human button streams are a weak signal, since identical inputs mean different things in different contexts.

With goals there is a far richer supervision target: **infer the goal a human pursued** — which pickup did they path to and collect, which area did they hold, when did they break off a fight — and train the *scorer* on human choices. "What does a good player value" is exactly what a weight-and-consideration system encodes, so human demos become direct supervision for the thing we actually want to learn.

This needs **no work now**. It is listed so that §10.2's trace format is designed to be the same shape demos will be labelled into, rather than a second format later.

### 10.5 What is explicitly deferred

Online gradient updates, challenger promotion, replay mixing, and self-play all remain BOT_IMPROVEMENT Phase 7 and are untouched by this document. Its §12.7 constraint stands: **no online updates until attempt/outcome attribution and safety evaluation are versioned and testable.** The trace format in §10.2 is a prerequisite for that attribution, which is another reason to adopt it early.

---

## 11. Worked example: Search & Destroy

### 11.1 What the gametype publishes

**Broadcast (`match_state`)** — public facts:

```json
{ "phase": 2, "gametypeName": "snd",
  "teamRoles": { "udon": "attacker", "soba": "defender" },
  "roundState": "pre_plant", "roundTimeRemaining": 84 }
```

**Per-client (`agent_directives`)** — this bot's orders:

```json
[{ "id": "snd_plant_a", "kind": "move_to", "source": "gametype", "priority": 0.9,
   "target": { "type": "position", "position": {…}, "radius": 180 },
   "expiresAtTick": 12500, "interrupt": "danger" }]
```

Objective positions come straight from `misc_capture_area_indicator.origin` (§2.6) — no map authoring needed.

### 11.2 What the bot does with it

Nothing in the bot is S&D-aware. Behaviour is entirely `weights × considerations × directives`:

| Situation | Winning consideration | Behaviour |
|---|---|---|
| Attacker, pre-plant, far from site | `objective_push` (0.9 × high) | Moves to site A; `itemGreed 0.2` means it ignores an armor it would have taken in DM |
| Attacker, teammate carrying, contact | `carrier_protect` (0.8) | Holds near the carrier instead of chasing the enemy who broke LOS — **impossible under today's ladder** |
| Defender, pre-plant | `map_control` (0.9) | Takes and holds angles on the sites rather than roaming |
| Defender, post-plant, 8 s left | `snd:defender:post_plant` profile, `riskTolerance 0.9` | Walks into fire to reach the bomb; `danger` is suppressed and nothing else scores |
| Either, enemy at 200u | *reflex layer* | Fights. Unscored, unchanged, correct. |

The last row is the point of the hybrid split: an S&D bot still needs to shoot the person in front of it without deliberating.

### 11.3 The Warsow Bomb extraction contract

Compatibility with Warsow Bomb is a requirement, so the extractor is specified here rather than left to implementation. It belongs beside `PickupTable`/`TriggerTable` in `src/shared/bsp/` — **shared by server and bots**, so both derive identical site ids from identical BSP bytes, exactly as pickup ids work today.

```typescript
/** One bombsite, derived from BSP entities. Shared server+bot identity. */
interface BombSite {
  /** Stable index in BSP entity order. THE authoritative id on both sides. */
  id: number;
  /** Cosmetic label ("A"/"B"), from targetname when parseable, else by id. */
  label: string;
  /** misc_capture_area_indicator origin, Q3->Babylon swapped. Navigation target. */
  position: Vec3;
  /** Brush volumes targeting this indicator. Empty on wbomb2/3/4. */
  volumeModels: string[];         // ["*3", "*4"]
  /** Fallback plant radius when volumeModels is empty. */
  radius: number;                 // DEFAULT_BOMBSITE_RADIUS
}

/** True when this BSP is a Warsow Bomb map. */
function isBombMap(entities): boolean;   // 2 indicators AND team_CTF_alphaspawn present
function extractBombSites(entities): BombSite[];
```

Rules, following directly from the four gotchas in §2.6:

1. Collect `misc_capture_area_indicator` in BSP order; assign `id = 0..n-1`. Never reorder.
2. Label from `targetname` if it matches `/bombsite([ab])/i` or `/indicator([12])/i`; otherwise `String.fromCharCode(65 + id)`. Label is display-only and never used for matching.
3. Index `trigger_capture_area` by `target`; attach to the indicator whose `targetname` matches. Unmatched volumes are ignored, unmatched indicators keep an empty list.
4. When `volumeModels` is empty, plant detection uses `radius` around `position`. **`DEFAULT_BOMBSITE_RADIUS = 384`**, and it must be a CYLINDER, not a sphere — see §11.3.1.
5. Attacker/defender spawns come from `team_CTF_alphaspawn` / `team_CTF_betaspawn`. **Do not depend on `team_CTF_alphaflag`/`betaflag`** — wbomb6 has neither.

For bots this is nearly free: the objective is a point with an origin, which the nav graph can target like any other position, and `route_cost` gates it if unreachable.

#### 11.3.1 The default bombsite radius

Warsow's bomb gametype applied a default radius so a mapper could drop a bare
`misc_capture_area_indicator` and be done — which is exactly why half the shipped
bomb maps have no `trigger_capture_area` at all. The remembered figure is ~384
units, and measuring the maps that *did* author volumes corroborates it.

Circumscribed radius of the union of each site's brush volumes, read from the
BSP models lump:

| Map | Site | Size (x×y×z) | Circumscribed radius |
|---|---|---|---|
| wbomb1 | 1 | 456×280×56 | 268 |
| wbomb1 | 2 | 800×280×264 | 424 |
| wbomb5 | A | 704×640×320 | 476 |
| wbomb5 | B | 544×544×192 | 385 |
| wbomb6 | 1 | 480×384×224 | 307 |
| wbomb6 | 2 | 672×448×224 | 404 |

Mean 377, median 394. `384` sits in the middle of the distribution, matches
wbomb5's B site to within a unit, and is `3 × 128` — three squares of the
standard Quake mapping grid, which is both what a default would plausibly be set
to and what mappers would then size brushes against.

**It must be a cylinder.** Site heights run 56 → 320, so a spherical 384 test
would allow planting from far above wbomb1's flat site 1. Use a horizontal
radius plus a separate vertical band, the same shape `PickupSystem` already uses
(`PICKUP_RADIUS_SQ` with `VERTICAL_RANGE_MIN`/`MAX`).

Where volumes *are* authored they remain authoritative — the default is a
fallback for bare indicators, not a replacement.

### 11.4 What S&D still needs beyond this document

Round lifecycle and win conditions, bomb carry/plant/defuse mechanics and their timers, per-round team spawns and freeze time, and side-swapping at halftime. This document covers only how bots understand such a mode once it exists — though §2.6 and §11.3 show the map data and its extraction are fully specified.

---

## 12. Definition of done

What "perfected" means, in testable terms rather than vibes:

1. **No gametype-specific code exists in `src/bot`.** Adding a gametype is a weight profile plus a directive emitter, both outside the bot.
2. **Quad, Mega and Red Armor rank correctly with zero item-specific branches** (§9).
3. **Every decision emits a human-readable explanation, and a human reviewing a random sample agrees with the pick.** This is the real quality bar and the reason §6.5 is non-negotiable.
4. **Weight changes produce predictable behaviour changes.** Raising `mapControl` visibly increases area-holding and nothing else. If it does not, the considerations are entangled and need splitting.
5. **Golden scenarios cover every consideration** and fail loudly when a weight change breaks a distant gametype.
6. **Bots do not thrash.** Goal changes per minute stay within a sane band; sequences complete rather than being abandoned mid-traversal (§7.3).
7. **The legacy ladder can still be selected** (§7.7) until the arbiter has shipped as default for a full cycle.
8. **The ML path is opt-in and bounded**: a rejected/absent model falls back to hand scoring with no behaviour cliff (§10.3).

---

## 13. Phases

Each phase is independently shippable and independently valuable. Dependencies are explicit.

### Phase 1 — Goal currency and item desire ✅ LANDED
*No gametype involvement. No protocol change. Fixes today's bots including quad.*

- `BotGoal` record with stable ids (§6.4); `GoalArbiter` with the §6.3 rule + hysteresis.
- `Consideration` interface with the attractor/discount role split and the 0..1 contract (§5.1).
- Four considerations: `item_value`, `item_denial`, `route_cost`, `danger`.
- Euclidean × detour route estimate, injected into the context (§7.4 step 1).
- `_selectItemGoal()` feeding the existing `_navigateTo`. **No executor rewritten**, ladder untouched.
- Decision explanation string (§6.5) surfaced through `getNavigationDebug()`.
- Golden-scenario fixtures + per-consideration contract tests (§7.6).

**Deviations from the plan above, discovered while implementing:**

- **`target_opportunity` deferred.** Phase 1 was scoped to items only, so combat never enters the arbiter and the reflex boundary (D3) stays unforced.
- **`VisiblePickup` did NOT need `kind`.** The static pickup table reaching the bot (`BotVision.mapKnowledge.pickupPositions`) is already a full `PickupEntry[]` carrying `id`/`type`/`kind`/`amount`; the identity was being discarded by `findNearestItem()`, not missing from the data. Only dropped weapons lack a kind, and they are weapons by construction.
- **No cvar.** `Cvar` does not exist in the bot process (it is a Node process). The toggle is `BotOptions.goalArbiter` defaulting from `BOT_GOAL_ARBITER`, following the `BOT_NAV_CACHE_DIR` precedent — and it is better, because `BotServer`'s control API can then A/B two bots inside one match.
- **`executionModeFor()` was unnecessary.** Item goals map onto the existing `_navigateTo(position)`, which already caches paths and handles target changes. The mapping table only becomes useful when non-item goal kinds exist.
- **RETREAT keeps a `health`-only candidate filter.** Without it the arbiter correctly ranks Yellow Armor above a medium health at 20 HP (50 armor is ~59 effective HP vs 45), which is a fine deathmatch judgement and the wrong answer for a bot that is fleeing. Filtering the candidate set is honest; distorting `item_value` to fake it would not be.
- **`POINTS_FULL_VALUE` is 150, not 100.** Normalizing health/armor gain against 100 let a Mega saturate at 1.0, so nothing — including Quad — could outrank it. Headroom above the largest ordinary pickup is required for the top of the scale to mean anything.
- **Health urgency ramps from 50 HP, not from 100.** Ramping from full health made a 60 HP bot value a Mega as highly as a Quad.

**Acceptance met:** quad/mega/red armor rank correctly over a 5 HP bubble with no item-specific branch anywhere in the scoring path; overcap items are gated rather than merely unattractive; no goal thrashing (commitment fixture); every decision explains itself; legacy ladder selectable via `BOT_GOAL_ARBITER=legacy`.

### Phase 2 — Weights ✅ LANDED
*No protocol change.*

- `BotWeightProfile` + profiles for DM/TDM/Duel in `src/shared/bot/WeightProfiles.ts`.
- `BotGameState` parses `match_state` (previously discarded) into `matchState`; `getOwnRole()` derives the bot's round role from `teamRoles` + its team.
- `selectWeightProfile()` with the `gametype:role:roundState → gametype:role → gametype → DEFAULT` fallback chain. Total: never throws, never returns undefined.
- Considerations carry their weight keys; `riskTolerance` scales the danger discount.
- `mistakeRate` re-expressed as runner-up selection (§8).

**Deviations from the plan, discovered while implementing:**

- **`itemGreed` had to be split into `itemGreed` + `itemDenial`.** A single weight over both item attractors scales every candidate by the same factor, so the *ranking among items is unchanged* — the weight degenerates into an on/off switch and can express nothing else. Splitting them is what lets duel (contest everything, `itemDenial 0.9`) differ from deathmatch (take what you need, `0.3`) with no code difference. Any future weight must be checked against this: a weight that scales all candidates in a category uniformly does nothing.
- **The acceptance criterion as written was untestable at this phase.** It asked for "more map control and less roaming", but `map_control` is a Phase 3+ consideration and Phase 1 was scoped to items only. Restated below to what weights can actually demonstrate today.
- **Mistakes are rolled only on a goal *switch*, never per tick.** A per-tick roll makes a bot oscillate — which reads as malfunction, not fallibility. Rolling at switch time and then committing normally makes the bot look like it misjudged. The RNG is injectable so fixtures stay deterministic.
- **`mistakeRate` had never been implemented at all.** It is declared on every difficulty preset (easy 8 → expert 0.2) and was read by nothing; "random dumb decisions per minute" had no behaviour behind it. Goal selection is its natural home — taking the second-best item is a mistake a human plausibly makes, unlike random button noise.

**Acceptance met:** a duel bot demonstrably values contesting an item it cannot use more than a deathmatch bot, from weights alone with identical code; an `itemGreed: 0` profile makes a bot ignore items entirely (the Clan Arena / Instagib shape); `riskTolerance` visibly changes willingness to fetch items while under threat; and profile selection is driven end-to-end by the gametype the server already reports.

### Phase 3 — Route accuracy ✅ LANDED
*Pure upgrade behind the §7.4 seam. No `Consideration` changed.*

- `BotNavGraph.estimateTravelCost(from, to)` — exact all-pairs graph distance plus off-node approach/arrival, `null` when no route exists.
- Distance matrix computed lazily from the adjacency list and invalidated whenever the graph is rebuilt or reloaded.
- `ItemGoalPlanner` takes an optional `RouteCostSource`; the brain passes its nav graph. Euclidean remains the fallback when no graph is loaded.

**Deviations from the plan, discovered while implementing:**

- **All-pairs, not landmarks, and nothing persisted.** The plan assumed the graph was large enough to need landmark distances and a new cache schema field. Measured, the shipped graphs are 34–58 *strategic* nodes with 44–88 edges, so exact all-pairs is both simpler and cheaper to reason about. Measured cost: matrix build **0.04–0.42 ms** once per map, query **0.6–1.3 µs**. At ~12 candidates × 8 bots × 4 Hz that is well under a millisecond per second of play. Persisting it would buy nothing and add a schema version to invalidate, so the matrix is memory-only and **the nav cache format is unchanged**.
- **The real win was reachability, not accuracy.** This was listed under Risks rather than as the phase's purpose: the Phase 1 estimator *could never fail*, so the arbiter's `unreachable` gate could never fire and a bot could commit to an item on the far side of a wall. Graph distance answers that honestly, including across disconnected components. A regression test pins the old behaviour so the difference stays visible.

**Acceptance met:** an item in a disconnected component is gated `unreachable` even when it is physically nearer than a reachable rival; a detour item is priced by walking distance rather than straight line; the matrix invalidates on reload; and with no nav graph the pre-Phase-3 behaviour is reproduced exactly (documented by test).

### Phase 4 — Directives ✅ LANDED
*BOT_IMPROVEMENT Phase 5, finally implemented. The first phase to touch server code and the wire.*

- `shared/server/gametype/AgentDirective.ts`: kinds (`move_to`/`hold_area`/`defend`/`escort`), targets (position or player), priority, urgency, expiry, interrupt policy.
- Pure `BaseGametype.getAgentDirectives(context, state)`, default `[]`.
- `GametypeController.collectAgentDirectives()` — once per snapshot per living player, wrapped so a throwing gametype cannot take the server down mid-snapshot.
- Per-client injection in `SnapshotBroadcaster`: event code 20, JSON payload, appended only to the addressed client's snapshot.
- `BotGameState.directives` + `collectDirectiveGoals()`; directive goals compete with item goals through the same arbiter and currency.
- Four new considerations: `objective_push`, `objective_urgency`, `team_cohesion`, `carrier_protect`.
- TDM regroup order as the proving case.

**Deviations from the plan, discovered while implementing:**

- **The proving case is regroup, not "hold red armor".** A directive at an item position needs the gametype to know where items are, which it does not — pickups are not entities and `PickupSystem` owns the table. Regroup needs only positions and teams, so it works on every map with no authoring, and it exercises `team_cohesion` directly.
- **`AgentDirectiveContext` needed a `teamOf(playerId)` resolver.** Team membership lives in `MatchState`, not on the entity, so a team-based mode reasoning about "my teammates" could not get there from `WorldState` alone. The first draft faked it by reading a `teamId` field off the entity that does not exist. S&D would have hit this immediately.
- **Goal selection had to be memoized per decision.** `_executeItemRun` falls through to `_executeHunt`, and both now ask for a goal — so the arbiter would run twice per decision. Not merely wasteful: `select()` advances the commitment window and rolls the mistake dice, so the second call could commit to a different goal than the one just returned.
- **`BotGoal.item` became optional**, which forced every item consideration to abstain explicitly on directive goals. That abstention (`return 0`) is exactly how the shared-currency design is supposed to work, and it is now load-bearing rather than incidental.
- **RETREAT ignores directives entirely.** An objective order must not drag a bot at 20 HP back into the fight it is fleeing. Same reasoning as the Phase 1 `typeFilter`: bound the candidate set for a specific intent rather than distort scores.
- **A live directive is now reason enough to leave HUNT.** Without that the ladder would only consult the arbiter when `_shouldSeekItems` happened to be true, and a bot with orders and full health would stand around patrolling.

**Acceptance met:** a TDM regroup directive changes which goal a bot pursues; the same directive is ignored entirely by a deathmatch profile (`objectivePush: 0`) and taken by an objective profile, from weights alone; directives are dropped when addressed to another player, expired, malformed, or naming a dead escort subject; a re-issued directive keeps its commitment because its id is stable; and RETREAT is unreachable by any order.

### Phase 5 — Reward and trace alignment
*Prerequisite for any future ML work; no ML shipped here.*

- `GoalScoreTrace` emitted and retained (§10.2).
- `objectiveReward` / `objectiveLossPenalty` in `RewardConfig`; `rewardsForProfile()` (§10.1).
- `featureSchemaVersion` with reject-and-fallback (§10.3).

**Acceptance:** training in an objective mode does not regress objective play; a stale model is rejected rather than silently used.

### Phase 6 — Search & Destroy (Warsow Bomb compatible)
*The gametype itself, consuming everything above.*

- `src/shared/bsp/BombSiteTable.ts` per the §11.3 contract, shared server+bot, with fixtures covering all three authoring styles: volumes + targetname (wbomb1), volumes + `bombsite[ab]` naming (wbomb5), and **bare indicators with neither** (wbomb2/3/4).
- Round lifecycle, plant/defuse mechanics, halftime side swap; `teamRoles` + `roundState` in `match_state` (§4.3).
- Team spawns from `team_CTF_alphaspawn` / `team_CTF_betaspawn` via the existing `SpawnPointStrategy` `team` mode (currently a documented no-op fallback in `TeamDeathmatch`).
- `snd:*` weight profiles (§4.2) and a directive emitter targeting `BombSite.position`.
- Validation on **wbomb1** (volumes + names) and **wbomb3** (neither) — the two extremes of the contract.

**Acceptance:** bots plant, defend and defuse with **zero S&D-specific code in `src/bot`**; all six `wbomb*` maps load and produce exactly two navigable sites; radius fallback is exercised by the wbomb3 path.

**Phases 1–2 are worth doing regardless of whether S&D is ever built** — they fix item behaviour and quad today. Phase 4 is where the gametype boundary is finally exercised.

---

## 14. Decisions needed

| | Decision | Recommendation |
|---|---|---|
| **D1** | Consideration list — is §5 right? Missing: suppressing fire, holding angles, retreat-and-heal, rotating on callouts. | Ship the ten in §5; add only with a consumer |
| **D2** | Combination rule (§6.3) | Gated weighted max, β ≈ 0.15, hysteresis ≈ 0.10 |
| **D3** | Reflex/deliberation boundary — `CLOSE_RANGE` is 400u today | Start at 400u, make it difficulty-scaled, tune from telemetry |
| **D4** | Does `aggression` exist, or is combat purely reflex + `target_opportunity`? | Keep it — duel and S&D need different hunt appetite |
| **D5** | Weights inside `BotDifficulty`, or separate? | Separate (§4.4) |
| **D6** | Does RL reward derive from weights? | Yes (§10.1) — one source of policy |
| **D7** | Commitment window length vs sequence duration (§7.3) | Start 1.5 s; must exceed typical sequence duration |
| **D8** | Is Phase 3 (route accuracy) before or after Phase 4 (directives)? | Either; Phase 4 is more visible, Phase 3 is more correct |
| **D9** | ~~`DEFAULT_BOMBSITE_RADIUS`~~ **RESOLVED** — 384 units, cylindrical (§11.3.1) | Corroborated against authored volumes: mean 377, median 394 |
| **D10** | Do `wdm4`/`wdm9` (3 capture areas, no team spawns) get a mode later? | Out of scope; ensure `isBombMap()` excludes them |

---

## 15. Risks

- **Weight surfaces are hard to tune.** Seven weights × N gametypes is a large opaque space. §6.5 explanation strings and §7.6 golden scenarios are the mitigation and are not optional extras.
- **Considerations can be individually correct and collectively wrong.** Ten well-tested pure functions still combine into nonsense; arbitration-level fixtures are the only net that catches this.
- **Hysteresis fights responsiveness.** Too sticky and a bot ignores a quad spawning beside it; too loose and it thrashes. Expect per-goal-kind windows, not one global constant.
- **Route estimate error changes rankings, not just timings.** A Euclidean estimate through a wall makes an unreachable item look attractive; the gate (`routeCost === null → 0`) must be driven by real reachability, not by the estimate.
- **The design assumes objectives are reachable by ordinary navigation.** If an S&D site needs a mechanic the nav graph does not model, `route_cost` gates it to 0 and the bot silently never goes. Gate failures must appear in diagnostics (§6.5) for exactly this reason.
- **Phase 1 changes bot behaviour wholesale.** Item choice is the most visible thing bots do. The `bot_goal_arbiter` cvar (§7.7) is what makes that safe to land.
