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

## Progress

### 2026-11-12 — phase 0 and phase 1.1–1.2 done

- `bot:motion` reports, out of a fight and running: clearance from walls
  (median, within 8 u and 24 u, by brain state), how often wall avoidance
  steers, running speed, and the map cells where bots run closest to walls.
- Floor nodes are moved up to 64 u off walls toward 48 u of clearance, staying
  on their floor and walkable from where they were sampled. Straight walk
  edges cost up to 0.6 extra per unit of run that touches a wall. Both are in
  `BOT_NAV_MOVEMENT_FINGERPRINT`, so caches rebuild.

Two 120 s runs each, 4 medium bots:

| | dm1 within 24 u | dm2 within 24 u | dm2 wall avoidance steering |
| --- | --- | --- | --- |
| Before | 21–25% | 19–20% | 24–27% |
| After | 19–22% | 17% | 20–23% |

A small gain, as expected: the bot still runs straight at each waypoint and
turns for the next one 100 u before it, so it still takes the inside of the
corner. Speed, pickups and deaths did not change.

The dm1 cell at (-640, -640) is a plasmagun in an alcove with a spawn point
and a teleporter exit beside it. Running close to walls there is the room's
shape, not a fault.

### 2026-11-12 — player keys and steering by view: tried, not yet better

Kept out of the branch on the local fps branch `bot/player-keys-wip` until
it beats the numbers above. What it does:

- `PlayerKeys.asPlayerKeys` turns each decision into the keys a player could
  press for the view sent. A bot running where it looks holds forward while
  the wanted heading is within 67.5° of the view, and moves along the view.
  A bot with a heading of its own presses the nearest of eight directions and
  loses sprint off plain forward. Scripts stay exact.
- Route steering aims the view, and with it the movement, at a point 200,
  100 or 50 u along the route from the bot's projection onto it, pushed off
  walls closer than 48 u, with a wide-lane sweep first.
- The open-space look became glances: about every 2 s, 0.32 s, at most 45°.
- Route turns out of a fight skip the aim's reaction wait (`planned` in
  `BotAimController.step`).

Last measurement (two 120 s runs each):

| | dm1 within 24 u | dm2 within 24 u | flip-backs dm1 / dm2 | speed dm1 / dm2 |
| --- | --- | --- | --- | --- |
| Phase 1.1–1.2 | 19–22% | 17% | about 13–17 | 400 / 402 |
| Player keys + steering | 27–28% | 20–23% | 31–34 / 18–19 | 376–388 / 403 |

What went wrong along the way:

1. Snapping to eight directions while the view trails a turn pressed
   diagonals and cost sprint: speed fell to about 340 u/s. Holding forward
   for a bot running where it looks brought it back.
2. Measuring the steer point from the next waypoint pulled a bot that had run
   past it back round. Measuring from the bot's projection onto the route
   fixed that.
3. About 35–41% of roaming commands wanted a view more than 67° from the one
   sent. The reaction wait on route turns was much of it; skipping it brought
   that to about 22%.
4. Pursuing a point ahead still cuts inside corners, and the wanted view still
   jumps when the steer point falls back to a shorter distance. Hugging and
   flip-backs stay above the baseline.

Next: record paths near the worst cells (position, wanted and sent view,
keys, steer distance chosen) to see where the view jumps and how corners are
cut, then design corner handling: slow the look-ahead into a turn and pick
the turn-in point, instead of a fixed distance.

### 2026-11-12 — path recording, second round on `bot/player-keys-wip`

A probe recorded, for every command, what changed when the wanted view
jumped more than 45°, and what steering was in use whenever a bot ran within
24 u of a wall with room to keep 40 u from both sides ("avoidable"; nearly
all of it was).

Found and fixed on the branch:

- Wall avoidance was on in over 70% of the samples close to walls: it saw
  the wall beyond the lane steering had cleared and turned the bot off the
  lane toward the other wall. It is skipped when steering found a clear
  target.
- A bot within 24 u of a wall could never clear the 40 u lane sweep, whose
  box starts in the wall, so it fell back to the waypoint; it now uses the
  hull sweep.
- Most "no clear point" cases are a bot on the inside of a corner with
  every point ahead behind the wall. A fan of headings round it, held to
  one side for 0.4 s, takes it round.
- What hugging remains with no route steering is mostly precise approaches
  (jump and trick starts sit at walls by design) and stuck recovery.

Still worse than 6287396 (2 × 120 s):

| | dm1 within 24 u | dm2 within 24 u | flip-backs dm1 / dm2 |
| --- | --- | --- | --- |
| 6287396 | 19–22% | 17% | about 13–17 |
| Branch `80ccc9e` | 25–30% | 25–26% | 42–60 / 16–23 |

Why: the heading is chosen afresh each decision from a ladder of fallbacks
(wide lane, hull, fan, hold, waypoint), and each switch between rungs is a
jump in the wanted view. A player does not do this; the line through a
room is decided before entering it.

**Proposed instead: smooth the route when it is planned.** When A* returns
a path, build the line to run along once:

1. Pull the string: drop waypoints the hull can run past in a straight line.
2. Round each remaining corner on its outside, keeping 48 u from walls where
   the room allows, checking each piece with the hull sweep.
3. Keep precise approaches and jump, pad and trick starts exact.

Steering then pursues a point a fixed distance along that one line, which
moves smoothly as the bot moves. There are no fallbacks, except re-planning
when the bot is knocked off it. The view leads along the line and the keys
follow as now. The work is in the path planner, not in each decision, and
can be tested offline: draw the smoothed lines for every spawn-to-item route
on a map and check their clearance before any match is run.

### 2026-11-12 — route lines planned once: done, and better

Built on `bot/human-movement` with the committed movement (not the player
keys), so it could be measured against the same baseline.

Found on the way, with the offline check (`bot:routes`):

- **About 40% of walk edges were not straight.** 192 of 487 on dm2, 288 of
  711 on dm1: walks the graph's flood found round a doorway or down a ledge,
  kept as two nodes, which bots ran straight between into the wall. The flood
  now records the way it walked (`FloodPosition.previous`) and the edge keeps
  its string-pulled corners (`NavEdge.via`), which a path expands into plain
  walk steps.
- **The straight walk test passed ledges.** It swept the hull along the line
  between the two ends, which rises over a 30-unit ledge; it now also needs
  the floor under the line to rise a step (18) at a time.
- Lines built once per walking stretch (`RouteLine`) with those corners:
  within 24 u of a wall on 4–5% of their length, against 22–25% node to
  node. Followed 64 u ahead at 300°/s by a runner using the game's movement:
  6–10%, against 22–28%.
- In the brain: the line ends only when the bot stands at its end on the
  same floor. Measuring flat let a bot on the floor above the end take the
  next step, an exact approach to the dm1 plasmagun below, and run at it
  through the upper floor's walls.

Two 120 s runs each, 4 medium bots:

| | dm1 within 24 u | dm1 within 8 u | dm2 within 24 u | dm2 within 8 u | wall avoidance steering |
| --- | --- | --- | --- | --- | --- |
| 6287396 | 19–22% | 11–13% | 17–20% | 7–8% | 23–37% |
| Route lines | 11% | 5–6% | 9–12% | 4–5% | 2–4% |

Flip-backs, speed, pickups and deaths stayed level; view turning and
reversals were slightly lower. dm1 still time is about 15% (12–13%
before), most of it bots settling on learned trick marks.

Next: the player keys on `bot/player-keys-wip` can now steer the view along
these lines instead of the per-decision fallbacks that failed; then phase 2
(strafe jumps on open stretches) can use the lines' straight runs.
