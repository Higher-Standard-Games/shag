# Bots that play like people — investigation and plan

Started 2026-11-11 on `bot/human-movement`. Measurements are headless 4-bot FFA,
medium difficulty, 90 s, from a probe that samples every fourth command a bot
sends (`BotClient.observeCommands`). "Roaming" is HUNT, ITEM_RUN or RETREAT
while moving faster than 150 u/s. Clearance is the gap from the player hull to
the nearest wall, from 16 level rays at the bot's origin.

## What the bots do now

| Measure | washoi_dm2 | washoi_dm1 |
| --- | --- | --- |
| Roaming time within 24 u of a wall | 16% | 23% |
| Roaming time within 8 u (touching) | 5% | 13% |
| Median clearance while roaming | 58 u | 60 u |
| Navigation decisions where the feelers steer | 42% | 59% |
| Median roaming speed | 400 u/s | 400 u/s |
| Roaming time faster than 450 u/s | 7% | 9% |
| Roaming time airborne / sliding | 16% / 7% | 13% / 9% |
| Share of roaming time in ITEM_RUN | 83% | 86% |

Nav graph clearance (cached graphs):

| Nodes | dm2: median clearance, share within 24 u | dm1 |
| --- | --- | --- |
| floor (256 u grid) | 52 u, 38% | 27 u, 50% |
| item | 66 u, 17% | 72 u, 8% |
| spawn | 9 u, 83% | 8 u, 83% |

Walk edges: median length 326 u (dm2), 416 u (dm1).

On dm1 one 128 u cell around (-640, -640) holds 254 of its 322 roaming samples
within 24 u of a wall: one place, not the whole map.

## Why

**Wall hugging.**

- `_extractNodes` samples floor nodes on a 256 u grid and keeps any point
  that stands on floor, however close to a wall. Spawn points sit against
  walls by design.
- A walk edge is a straight hull sweep between two nodes. A* costs it by
  length only, so the shortest route takes the inside of every corner.
- `_followCurrentPath` runs straight at `step.to.position`. `_lookAlongRoute`
  turns only the view, not the movement.
- The feelers (`_applyFeelers`: a 300 u forward ray and two 200 u side rays)
  push the heading off a wall once it is close. Firing on half of all
  decisions, they are the turning the user sees as "rotating round the wall":
  the route aims into the corner and the feelers pull away from it, decision
  after decision.

**Running at sprint speed.**

- `_tryStartRouteStrafeJump` needs the current waypoint 640 u away (800 u on
  the last step to an item), and the next one within 30° of the same line.
- With walk edges of 330–420 u that almost never holds. Route slides had the
  same limit until `_slideLaneOpen` replaced it with a check of the open
  stretch of route ahead.
- Nothing chains hops: each strafe jump is one sequence followed by a
  cooldown.

**Looking.**

- Out of a fight the view follows the route (`_lookAlongRoute`, 250 u ahead),
  leaned toward open space by `_lookIntoOpenSpace`.
- Nothing looks at where enemies come from. `_watchEntrances` does that, but
  only while waiting for a timed item.
- `lookAroundInterval` in the difficulty presets feeds `_updateLookAround`, a
  random ±14° look used only by the patrol code.

**Always shopping.** `_shouldSeekItems` returns true whenever armor is under 25,
which is every respawn, so ITEM_RUN dominates. HUNT, roaming toward where
enemies were, is about 1–2% of roaming time.

## Plan

Ordered by expected gain for effort. Each phase is measured with `bot:motion`
against runs of the code before it, and must not lower deaths per minute or
pickups.

### Phase 0 — measure it (small)

Add to `bot:motion`:

- body clearance while roaming: the median, and the share within 8 u and
  24 u, by brain state;
- the feeler steering rate;
- speed while roaming: the median, and the share faster than 450 u/s;
- the five hugging hotspots, as map cells.

These are the probe's numbers above, made permanent, so every later phase has
a baseline and a target.

### Phase 1 — keep off walls, take corners wide (medium; biggest gain for hugging)

1. **Nodes off walls.** After floor sampling, move each floor node up to 64 u
   along the direction of most clearance until it has 48 u where the space
   allows. Item, spawn, teleporter and pad nodes stay where they are (they
   are destinations); the walk edges from them carry the clearance cost
   below. This bumps `BOT_NAV_GRAPH_SCHEMA_VERSION`, so caches rebuild once.
2. **Clearance in route cost.** Sample clearance along each walk edge at build
   time and add cost for every stretch under 48 u. A* then prefers the middle
   of a room and the outside of a corner. This is cached with the graph.
3. **Steer to a point on the route, not to the waypoint.** Pursue a point about
   200 u along the route polyline, the same walk `_lookAlongRoute` does, and
   push it away from walls closer than 64 u. Corners are then cut on the
   outside line and a passed waypoint is never aimed at. Precise approaches
   (`requiresPreciseApproach`, jump take-offs, learned-route starts, the last
   stretch to an item) keep steering exactly as now.
4. The feelers become the safety net they were meant to be; their trigger
   distances may need lowering once the route keeps off walls.
5. Look at dm1 (-640, -640) on its own: one cell with 80% hugging is a
   geometry or graph fault, not a style.

Targets: roaming time within 24 u of a wall under 8% on both maps; feeler
steering under 15% of decisions; no rise in still time (stuck) or fall in
pickups.

Risks: routes through narrow doors must still be found, so a clearance cost
must never make an edge unusable, only dearer. Learned and validated jumps
start from exact spots.

### Phase 2 — move at Warsow speed (medium-large; biggest gain overall)

1. **Strafe jumps on open stretches.** Replace the 640 u single-waypoint rule
   in `_tryStartRouteStrafeJump` with a lane check like `_slideLaneOpen`:
   waypoints within the lane, walkable ground, no jump, drop or precise step
   inside it.
2. **Chains.** Keep hopping while the lane stays open, steering with air
   strafe along the route, instead of one jump and a cooldown. Slide into
   corners and jump out of the slide.
3. **Check by simulation.** `MovementProfile` is deterministic and the ledge
   boost already rolls a crossing out before sending it. Roll a chain out the
   same way over the lane, and refuse it when it would leave the lane or land
   short.
4. Skill scales it: `strafeJumpSkill` gates the chain length and how tight the
   air strafe is. Easy stays mostly on foot.

Targets on dm2 and dm1: median roaming speed over 450 u/s for medium, over
550 for hard; airborne share up from 13–16%; no rise in missed landings
(`missed_landing` cooldowns) or deaths from falls.

Phase 1 comes first because wide lines give chains room: a hop chain into a
wall-hugging corner is the one thing worse than running into it.

### Phase 3 — look where enemies come from (medium)

1. **Watch points per node, built with the graph.** For each node: the nodes
   it can see 400–1500 u away that lie on routes into its area (doorways,
   stair tops, teleporter exits), weighted by how many spawn-to-item routes
   pass them.
2. **While roaming,** glance at the strongest watch point in view of the route
   every second or two, within the angle movement allows (the speed rule
   below). Rounding a corner, look at where the sight line opens first.
3. Fold `_lookIntoOpenSpace` and `_updateLookAround` into this one choice.

Measure: add to `bot:motion` how far from the view centre an enemy is when a
bot first sees them. Players see most enemies in front of them; a bot
glancing well sees more of them first and is surprised from behind less.

### Phase 4 — when to shop, when to hunt (small to start)

`armor < 25` sends every respawned bot shopping. Let the item planner's score
decide, and hunt otherwise (toward the last place enemies were heard, or
through the map's busy routes). This changes how fights start, so it is
measured on deaths, frags and pickups together, not on movement.

### Phase 5 — personalities (small)

A style per bot, drawn at join: mover (long chains, routes past items), holder
(keeps high ground and timings), hunter (follows sounds). Each is a small set
of weights over phases 2–4, so it waits for them.

### Phase 6 — movement learned from people (large, later)

The training pipeline and learned trick routes exist, but learning general
movement needs many demos recorded by people. It waits until phases 1–3 show
what the rules cannot reach.

## Expected gain

| Phase | Effort | What a spectator sees |
| --- | --- | --- |
| 1 Wide lines | M | No wall rubbing, no left-right fighting with corners; the clearest single fix for the complaint |
| 2 Speed | M–L | Bots move like Warsow players instead of joggers; the biggest overall change |
| 3 Watch points | M | Bots look ready, check doors and corners, react less from behind |
| 4 Hunting | S | Less identical shopping; more meeting in the middle of the map |
| 5 Styles | S | Bots differ from each other |
| 6 Learned | L | Unknown until tried |

Recommended order: 0, 1, 2, 3, then 4 and 5. Phase 0 and phase 1.1–1.2 are one
working session; phase 1.3 is the delicate part.

## Decisions (owner, 2026-11-12)

1. **Bots move exactly as a player's keys allow.** A player has eight key
   directions relative to the view and loses sprint on anything but plain
   forward. Bots will do the same: the client turns the wanted movement into
   the nearest key combination for the view sent, and moves the way those
   keys move. Looking aside becomes a short glance, after which the view
   comes back to where the bot runs. While moving, the view leads the
   movement, so steering along the route (phase 1.3) is done by turning the
   view, as a player does. This replaces the independent `moveYaw` heading
   for everything but scripted sequences, which already send exact
   commands.
2. **Nav caches may rebuild** once when node positions and costs change.
3. **Speed scales with difficulty.**
