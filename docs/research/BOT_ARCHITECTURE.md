# Bot server architecture: review and refactor plan

Written 2026-11-13, at the end of the `bot/strategy-layer` work, and reviewed
again 2026-11-16 with a CPU profile and memory measurements of a 10-bot S&D
match. It describes how a bot runs, the weak points, what a match costs, the
process model ahead, and the approved plan with its implementation matrix.

Measurements and tuning history are in [BOT_STRATEGY_LAYER.md](BOT_STRATEGY_LAYER.md).
Code paths below are under `src/games/fps/bot/`.

## How a bot runs

**Process.** `BotServer.ts` runs every bot in one Node process. Each bot is a
`BotClient`, a WebSocket client of the game server like a player's. Per map the
server loads collision (`BotVision`) and the nav graph once: `BotNavGraph`,
cached on disk by `BotNavCache`, with learned routes from `config/bot-routes`
added after the cache is read. Bots on the same map share both.

**Each snapshot** (`BotClient._handleSnapshot`; the server sends one every two
ticks, about 62 a second):

1. `BotGameState.update` takes the full server state.
2. `BotPerception.perceive` narrows it to what this bot would know: enemies in
   sight, sounds in hearing range, and its belief about each item (seen go,
   heard taken, or timed).
3. `brain.observe`, then, while alive, `BotVision.getVisibleState` traces
   sight lines to enemies.
4. `brain.decide` returns the wanted input; `applyFriendlyFireSafety` filters
   it. The input, and a script if it carries one, is cached.

**The send loop** (`_startInputLoop`): one 8 ms timer per bot sends one command
per server tick. `BotAimController` turns the view a step toward the wanted
angles each tick and holds fire until the view is on the aim. Scripts (learned
routes) are sent command by command.

**The brain** (`StateMachineBrain.decide`):

1. `MatchRead.update`, then `Strategist.update`: diagnoses from the read
   choose a strategy, which is a set of multipliers on the gametype's weight
   profile (`shared/bot/WeightProfiles.ts`) and a stance (when to retreat, how
   readily to shop, whether to chase).
2. Mandatory goals (gametype orders) come first.
3. `_evaluateState` picks a state by a fixed priority list: hurt by an enemy
   in sight → FIGHT, hurt otherwise → DODGE or RETREAT, enemy in sight →
   FIGHT, tracking one → CHASE, an item worth having → ITEM_RUN or RETREAT,
   else HUNT.
4. An active sequence (`BotSequence.ts`, `sequences/`: learned routes, jump
   pads, slides, strafe jumps) runs instead of the state while it lasts.
5. The state's executor runs. ITEM_RUN asks `goals/ItemGoalPlanner`, whose
   `GoalArbiter` scores each candidate item: gates, then the strongest
   attractor plus a share of the others, times the product of the discounts
   (route cost, danger).
6. After-steps, in order, each able to rewrite the input or return early:
   stall recovery, wall feelers, keeping the high ground, readying a weapon
   for a heard enemy, ledge-slide, item-slide, crouch-slide and strafe-jump
   starts, looking into open space, and the calm view in `decide`.

## Weak points

### 1. One class holds the brain

`StateMachineBrain.ts` is 3,807 lines with 61 private fields, 124 constants and
47 imports (2,923 lines, 58 fields, 87 constants and 41 imports on 2026-11-13:
the S&D coach, steering, cover and unstick work of the three days between
added 916 lines through it). On death `_decide` resets about 20 of those fields
by hand; a field added later and not reset carries over into the next life.

### 2. Two decision systems with no common scale

Which state to be in is the priority list, with fixed thresholds
(`FIGHT_RANGE`, retreat health, and in `_shouldSeekItems` an item's desire
against `SEEK_DESIRE_BASE + SEEK_DESIRE_PER_AGGRESSION × aggression`). Which
item to take is the scored arbiter. Fighting, hunting and holding ground are
never scored against items, so a strategy steers through two channels, weight
multipliers and stance flags. Two fixes in this round show the cost:

- Hunting when stacked had to be a strategist diagnosis (`stacked` →
  Pressure), because hunting is not something the arbiter can choose.
- The Red Armor up a climb lost to any nearer item: one route-cost discount
  (half at 1,200 units) applied to every item, and in Duel the major-item bias
  capped every major item at the same value.

### 3. After-steps override one another in order

Movement, view and buttons have no owner; each after-step may rewrite any of
them. Flags such as `_suppressTraversalAutomation` and `_onRouteLine` are
cleared at the start of `_decide` and set as side effects inside path
following. The crouch flicker fixed in this round was a sequence's push and
coast disagreeing about the crouch button.

### 4. No decision trace

Solved 2026-11-14 (`DecisionTrace.ts`, `bot:motion --trace`); kept for the record.

There is no per-decision record of state, strategy, chosen goal and the top
candidates with their scores, path step, sequence phase and position. Finding
why the bot stood still at learned-route links, why it bobbed, and why it left
the Red Armor each took temporary logging patched into the brain and
`bot:motion`, removed afterwards.

### 5. A/B tests cannot switch code paths

Solved for tuning 2026-11-14 (`BotOptions.weights`); named switches for code paths are still to come.

`bot:ab` arms differ only by `BotOptions` (`difficulty`, `strategy`,
`strategies`, `habitItem`, `goalArbiter`, and `routesRoot`). A scoring or
tuning change applies to both arms, so comparing it meant an environment
variable read in the code and two runs at once, sharing the machine.

### 6. Learned routes bypass the graph's checks

`buildFromVision` tests each walk edge with `BotVision.isWalkable`.
`addLearnedRoutes` attaches routes afterwards with its own linking. Until this
round it linked a new landing node to every floor node within 256 units at the
same height, through walls; it now takes a walk test, but the two paths still
build edges differently and nothing reports a bad edge.

### 7. One event loop for all bots

Each bot has its own 8 ms timer, and its traces and `decide` run in the same
event loop as every other bot's. On Windows the timers fire about every
15.6 ms (the send loop catches up by the clock). A slow `decide` delays every
bot's commands, and decide time is not measured. The 9-second nav build
measured below stalled every bot at once.

### 8. Leftovers

- The neural-network path (`HybridBrain`, `TFBackend`, `BotTrainer` and the
  training files, about 3,500 lines) loads when the bot server gets
  `--models <dir>`. The production launcher in the repository
  (`scripts/deployment/run-server.sh`) passes no arguments of its own; the
  service unit on the host is the place to confirm it is unused.
- Duel behaviour is chosen by `gametypeName.toLowerCase()` comparisons in four
  places in the brain, where the weight profiles mean gametypes to differ by
  data.

### 9. Everything runs at the snapshot rate

Each bot perceives, traces and decides on every snapshot, about 62 a second.
Item beliefs, goal choice and route costs do not change that fast, and a
person reacts in 150–250 ms.

### 10. Map memory is render data

`createBotVision` keeps what the renderer needs. A bot server with several maps
in use holds about 450 MB per map, and a process per bot would hold it per bot.

## What a match costs

Measured 2026-11-16: one `bot:ab` match on washoi_snd1, Search & Destroy, five
bots a side, 90 seconds, under `NODE_OPTIONS=--cpu-prof`. The `bot:ab` worker
process holds the game server and both bot servers, so the profile splits them
by source file.

| | |
| --- | --- |
| Busy CPU of the worker process | 46.4 s of 113 s |
| Bots (`bot/` and what they call) | 37.6 s, 81% |
| Game server | 3.2 s, 7% |
| One bot's snapshot handled (`_handleSnapshot`, steady state) | about 0.47 ms |
| Nav graph build at match start (`buildFromVision`) | 9.0 s, synchronous |

A snapshot's handling, inclusive:

| Part | Time | Share |
| --- | --- | --- |
| `decide` | 12.2 s | 46% |
| of it, choosing an item goal (`ItemGoalPlanner.select`) | 5.2 s | |
| of that, route costs (`estimateTravelCost`, `_findStandingNode` scanning every node) | 4.2 s | |
| `BotPerception.perceive` | 5.3 s | 20% |
| of it, item beliefs (`_believeItems`, a sight line to items each snapshot) | 3.5 s | |
| `BotVision.getVisibleState` (sight lines to enemies) | 3.5 s | 13% |
| Decoding the snapshot (`shared/net`, pako, `BotGameState.update`) | about 4.3 s | 16% |

Sight lines (`canSee`) are 7.6 s of collision time and the nav graph's flood
fill 7.2 s, most of it in the start-up build.

The nav graph cache missed in this run (a recent change altered what it is
keyed on), so the graph was built in the bot server's only event loop: the game
server logged every bot silent for 10.5 s. In production that happens on the
first match of each map after a deploy that changes the key, to every bot in
every match the process runs.

**Memory.** One Node process with the bot modules loaded holds 160 MB (a bare
Node process 39 MB). Loading one map's vision (`createBotVision`) takes it to
612 MB: the BSP file is 92 MB, its parse is 220 MB of heap, and buffers hold
about 280 MB after it. Most of that is render data (lightmaps, draw vertices,
faces) that bots never read; collision needs brushes, planes, patches and
models. Ten `BotClient`s sharing the vision add 33 MB.

## Process model and a compiled core

Worked out 2026-11-16 and taken into the plan (steps 8 and 9): a bot runner
per match, started by the lobby, and a collision-core prototype.

### What one process costs

Measured with vite-node (the bundled server's baseline is lower and not yet
measured):

| One Node process | RSS |
| --- | --- |
| Bare | 39 MB |
| With the bot modules | 160 MB |
| Plus one map's vision (washoi_snd1) | 612 MB |
| Plus ten `BotClient`s sharing it | 645 MB |

### A process per bot

Memory would grow with the bot count: every process loads its own map, so ten
bots would hold about 6 GB where one process holds 0.65 GB. With collision-only
map data (plan step 4) a process might hold 100–150 MB (an estimate), still
several times one shared process. CPU would barely grow, since every bot
decodes its own snapshot already. What it buys is cores and isolation, and a
process per match buys both too.

### A bot runner per match

The bot server becomes a supervisor, as the lobby is for game servers: when a
match with bots starts, a runner process starts for it with that match's bots
(up to ten), loads the map once, and exits when the game server does (its
sockets close) or when the supervisor ends it.

For it:

- Two people's matches never share a runner: one match's slow decision, nav
  build or crash touches only that match.
- The process count follows the matches, and the OS spreads them over cores.
- A runner's lifetime is its match's; nothing outlives the match.
- Memory and CPU are measurable per match.

Against it, or still to settle:

- Each runner loads its map. At today's 450 MB per map that is too much;
  collision-only map data (plan step 4) comes first.
- Start-up: a runner loads collision (about 0.4 s for washoi_snd1's collision
  world in the profile) and reads the nav cache; a missed cache is built in
  the runner, which stalls only that match's bots.
- Who starts it: the lobby, beside the game server (below).
- Process or worker thread (below: processes). Worker threads share memory
  (`SharedArrayBuffer`, shared `WebAssembly.Memory`), so a map could be loaded
  once for every runner on it; a process has OS isolation, its own memory
  limit, and can be killed outright. A process is the simpler first step, as
  the game servers already are.

### The room before the match, and who starts a runner

A bot in a room is a `BotLobbyClient`: a WebSocket to the lobby, authenticated
with the bot secret. In the room it joins by id, readies itself, sends its
rating identity (`bot:reference`: preset, goal arbiter, model) and ignores the
rest; on `lobby:connect` it makes the `BotClient` that plays. Nothing it does in
the room needs a process of its own: the lobby knows the bot's name,
difficulty and team when it invites it, and the preset and arbiter are what
its rating identity carries once the neural-network path is gone.

So the always-running bot server could go:

- **In the room,** a bot is a seat the lobby holds itself (name, difficulty,
  team, rating identity), always ready, with no connection behind it.
- **At match start,** `GameServerSpawner` starts the game server and, when the
  match has bots, a bot runner beside it with the bots' admission tickets and
  options, as it passes a game server its admission manifest. The runner exits
  with its game server.
- **`bot:server`** becomes the runner: one match, started by the lobby on
  demand, or by hand against a game server for development. The bot tools
  (`bot:ab`, `bot:motion`) keep running bots in their own process, as they do.

The lobby asks for bots only while a room waits (a player's invite, and
`fillCampaignBots` seating a mission's bots one at a time, each a round trip
through the bot server), so a runner's bots are all known when it starts, and
a campaign room would seat its bots at once.

To settle before building it:

- The bot secret and the `bot:` messages the lobby accepts from bot
  connections, which a lobby holding bot seats no longer needs.
- What a bot says in the room chat, if anything is wanted there.

### Shared map memory: worth it?

Two bot matches at once share a map only if they play the same one. With the
lobby's pools in `config/maps.json`, two matches of one gametype pick the same
map with odds of 1 in 3 (S&D, Amphi: three maps each), 1 in 8 (Duel) and 1 in
11 (FFA), and less across gametypes; each campaign mission has its own map.
The collision world itself adds about 40 MB to the parsed BSP (measured on
washoi_snd1); with collision-only map data a runner's map is tens of
megabytes, so sharing it would rarely happen and save little. Processes, then,
not threads: OS isolation, a memory limit per match, and a runner the lobby
can kill like a game server.

### A compiled collision core (Rust to WebAssembly)

Collision traces (`SweepCollisionBackend`: `traceBrush`, `traceNode`,
`traceLeaf`, `traceFacet`, `traceFaceMesh`, and `CollisionSpatialIndex`) are
the largest share of the bots' CPU in the profile. A Rust implementation
compiled to WebAssembly could serve the game server, the bot runners and the
browser client alike, so there is still one implementation of collision.

Porting the whole bot to Rust was weighed and set aside: a bot uses the
server's collision, movement simulation (its jump and steering rollouts),
snapshot protocol, BSP loading and weapon and item tables, and each would
become a second copy that has to match the TypeScript server exactly.

Questions to investigate:

- **Speed:** the trace kernel in Rust/WebAssembly against V8 on the same
  traces. Time it on traces recorded from a bot match.
- **Boundary:** a call per trace costs little; the trace's vectors and result
  should pass through a buffer in WebAssembly memory, not as objects.
- **Exactness:** the server's movement is the authority, so a WebAssembly
  trace must give the same results as the TypeScript one, compared bit for
  bit on the recorded traces.
- **Memory:** the collision world in WebAssembly memory, compact and shareable
  between worker threads.
- **Reuse:** whether the `shagger` and `wash-fps-rust` repositories (the
  native clients) already have a BSP collision implementation to start from.
- **Toolchain:** cargo and wasm-pack in the build and CI, and the browser
  bundle's size.

A first investigation: record a few thousand traces with inputs and results
from a bot match, port the trace kernel, and compare exactness and time.

#### Results (2026-11-16)

The prototype is in `prototypes/collision-wasm/` (its README has the
commands). It ports the world part of `SweepCollisionBackend.trace` (the node
walk, leaf brushes with containment pruning, the clip fallback and patch
facets; not the movers) and reads the TypeScript backend's own prepared
tables. 400,000 traces per map were recorded from 40 s matches with six bots
(the game server's and the bots' alike) and replayed through both.

| Map | Differ | TypeScript | WebAssembly | A call per trace | World tables |
| --- | --- | --- | --- | --- | --- |
| washoi_dm2 | 0 of 400,000 | 2.47 µs | 1.25 µs (1.98×) | 1.28 µs (1.93×) | 5.2 MB |
| washoi_snd1 | 0 of 400,000 | 1.69 µs | 0.90 µs (1.87×) | 0.99 µs (1.71×) | 12.2 MB |

- **Exact:** every field (fraction, end, normal, solid flags, contents, hit
  brush, surface flags) matches bit for bit. Rust's f64 arithmetic in the same
  order gives the same answers; Math.max and Math.min need their signed-zero
  rule copied.
- **Speed:** about twice as fast. A call per trace through a buffer in
  WebAssembly memory costs 3-9% over one batch, so the boundary is cheap.
  With traces about half of the bots' time, that is roughly a quarter off a
  bot's CPU, before any change to how often bots trace.
- **Memory:** the world's tables are 5-12 MB. Today they would sit beside the
  TypeScript backend's copy; a backend that traced only through WebAssembly
  could drop most of that copy.
- **Found on the way:** on washoi_snd1 the full trace costs 1.74× its world
  part, because the five switchable brush models are swept brush by brush with
  no model-level bounds check (lifts have one). A bounds check there is exact
  and cheap, in TypeScript, whatever comes of the port.
- **Left:** the movers; making it the backend for the bot runners, the game
  server and the browser (one implementation, so all three at once); cargo in
  the build and CI; and whether the native clients' repositories already have
  a BSP collision to share, which was not checked.

## Plan (approved 2026-11-16)

Work happens on `bot/architecture`, branched from `staging` in both
repositories. Each step is its own commit with the bot tests, and a step that
should not change what a bot does gets a `bot:ab` run against the step before
showing no difference. Steps that change behaviour are measured like any tuning
change, against people as well as bots. This matrix is kept up to date as the
steps land.

### Implementation matrix

| # | Step | Changes behaviour | Status | Commits (fps / outer) | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | Nav graphs built off the bots' event loop (`BotNavWorker` in a worker thread) | No | Done | `3a4ce59` / `bad81189` | washoi_snd1 built in 10.1 s; the main thread's worst stall 11 ms (was 9 s for every bot) |
| 2 | Cost per bot measured: snapshot and decision percentiles (`BotClient.timings`) in `bot:motion` and `bot:ab` | No | Done | `f54d87a` / `bdaae4ce` | Snapshot p50 0.36 ms, p99 up to 4.1 ms, max 44 ms (10-bot S&D) |
| 3 | Hot spots, exact: nearest-node and standing-node lookups remembered until the nodes change; one item sight trace per spot per snapshot | No (same answers) | Done | `0e14db7` / `685d5af0` | Goal choice 5.2 → 1.9 s and `decide` 12.2 → 9.5 s per match; snapshot p50 0.36 → 0.22–0.30 ms. Left: sight traces are half the bots' time (steps 9, 10); the slowest decisions (43–46 ms) are a graph's first, building its distance table |
| 4 | Collision-only map data: `createBotVision` parses with `BspLoader.loadCollision` through a transient pk3 loader; the PVS is copied out of the file buffer | No (traces identical) | Done | `0277ba7` / `93080432` | One map's vision about 60 MB live in a bundled process (was about 450 MB); 0 of 60,000 traces differ on three maps. A bundled process with the bot code: 54 MB RSS |
| 5 | Brain split: (a) a life object made new on spawn, (b) the body's per-life fields in it too, (c) navigation, (d) after-steps, (e) one owner per input channel, (f) each state's executor and the S&D coach as modules | No, except (b) at a respawn's first moments | Done | `989019d`, `e43f9de`, `e3fe9ed`, `0f36109`, `b35f6ae`, `4ee20e5`, `c54d814`, `4a76063` / `e7aee480`, `1a08c5c7`, `48ceb9ec`, `6dd5da58` | `BotLife`: 25 fields, made new at each death (15 cleared by hand before, 10 never cleared); a test checks a death leaves a fresh life; (c) route following in `navigation/BotNavigator` (429 lines) and traversal sequences in `navigation/BotTraversal` (538), each behind a typed host interface; (d) steering in `movement/BotSteering` (363) and the roaming look in `view/BotLook` (226), the after-steps run from `_afterSteps` in a listed order; (e) `InputClaims`: who holds movement and how (exactly, or open to corrections), checked by corrections and takeovers, in the trace and `bot:motion --trace`; (f) `states/BotFight` (666), `states/BotRoam` (384) and `orders/BotOrders` (246, the bot side of the coach's orders): `StateMachineBrain` 3,807 → 1,508 lines, deciding the state and running its executor and the after-steps. The coach itself is in `server/gametypes/SearchAndDestroy.ts` |
| 6 | One route pipeline: learned routes through the base graph's edge checks; `bot:routes --check` | Slightly: a learned landing's links get the wall cost and the walk flood's way round; walk edges only the way they walk | Done | `2938f58`, `4d34832` / `662658bd`, (this commit) | `_walkEdges` builds the graph's walk edges and learned landings' links through one `WalkTest`; `checkEdges` and `bot:routes --check` report what fails. Found: walk edges whose straight sweep goes only the other way (dm2 4, snd1 39, dm16 17: tested one way, added both) and 1-2 learned routes per map whose start walks to none of its 8 nearest nodes. Fixed after (`4d34832`): each way is tested on its own, nav cache schema 5; the check finds none on the three maps |
| 7 | The neural-network path removed (after confirming the host passes no `--models`); the Duel string checks moved into the weight profiles | No | Half done: the Duel checks | `65d1592` / `662658bd` | `GametypeHabits` beside the weight profiles (territory, height, lead handicap) replace five gametype-name checks. The neural-network path waits for the owner: the host's service unit is the place to confirm no `--models`, and the manual documents training (`tools/bot-training.md`) |
| 8 | A bot runner per match: the lobby holds room bots as seats, `GameServerSpawner` starts a runner beside the game server, `bot:server` becomes the runner | No (bots play as now) | Done | `697d1c6`, `806010a` / `662658bd`, (this commit) | `bot:server --match-runners`: seats stay in the bot server (lobby protocol, secret and rating identities unchanged); each match's bots play in a child process per game server (`MatchRunnerPool`, `cli/bot-runner.ts`) that exits with its last bot. 10 bots on snd1 in a bundled runner: 240-290 MB. Checked through a real lobby (3 invited bots, one runner, exit when the game server stopped). Then `lobby:server --bot-seats`: the lobby seats bots itself (`LobbyBotSeats`), each a `BotLobbyClient` on an in-process `LocalSocket`, so admission, rooms and ratings take the same path; the rating identity comes from the bot's options (preset, goal arbiter, behaviour digest of the same checkout), with no brain built in the lobby; the runner starts with the match's first bot rather than from `GameServerSpawner`, to the same effect. Checked with no bot server: a private FFA with three bots and campaign mission 1; the lobby holding seats 63 MB |
| 9 | Collision core prototype in Rust compiled to WebAssembly, against recorded traces: exactness and speed | No (investigation) | Done | — / `1e177a5f` | `prototypes/collision-wasm`: the world trace, 0 of 800,000 recorded traces differ on dm2 and snd1, 1.9-2.0× faster (1.7-1.9× with a call per trace), tables 5-12 MB. See Results under the compiled core |
| 10 | One scheduler; decisions staggered, below the snapshot rate, aim and steering at the tick rate | Yes (the rate, behind a switch) | Done, default waits | `81fa813` / `14f9da4f` | `BotScheduler`: one 125 Hz timer for every bot in a process (commands unchanged). `decideEvery` (default 1) decides on every n-th snapshot while roaming, bots taking turns; fights, dodges and sequences decide every snapshot; aim turns every tick. `bot:ab` with 2 against 1: Duel dm2 12 matches, frag gap -0.42 (-1.20 to 0.36), decisions -17%; S&D snd1 6 matches, rounds 9-10, kills per death 1.03 against 0.97, decisions -34%, snapshot p95 1.7 → 1.2 ms. Steering still runs in the decision, not every tick. The default stays 1 until measured against people |
| 11 | Fight, hunt and hold-ground scored as goals beside the items | Yes (behind a switch) | Hunt and hold done, default waits; fight not scored | `81fa813` / `14f9da4f` | `scoredGoals`: roaming chooses the item arbiter's best goal, the freshest sighting (the seek bar when just seen, falling over its window) or the territory (half of mapControl, in modes that keep one) by desire (`goals/RoamChoice.ts`). `bot:ab` on against off: Duel dm2 12 matches, frag gap -0.17 (-1.44 to 1.11); FFA dm2 8 matches, -0.75 (-3.14 to 1.64): no difference shown. A fight stays a rule: scoring it beside items needs an item run that fights under fire |

### Order

Steps 3 and 4 first (both done): they cut the cost the runner would pay per match and
give the numbers to judge it by. Then the brain split (5), routes (6) and the
leftovers (7). The runner (8) follows step 4; the collision prototype (9) can
run beside it. Steps 10 and 11 change how bots play and come last.

## Plan of 2026-11-13

On a fresh branch from `staging`, each step its own commit with the bot tests
and a `bot:ab` run of the result against the step before showing no
difference.

1. **Decision trace and test switches.** One structured record per decision
   behind a flag (state, strategy and diagnosis, goal and top three
   candidates with gates and scores, path step and edge kind, sequence and
   phase, position, speed, crouch). `bot:motion` and `bot:ab` summarise it:
   time still by cause, time a major item stood up with no one going for it,
   crouch changes. A test-only `BotOptions.weights` override (and named
   switches where weights are not enough) so `bot:ab` compares tuning in one
   run.
2. **Split the brain.** Everything reset on death into one life object made
   new on spawn. Each state's executor, the after-steps and navigation into
   their own modules, with `StateMachineBrain` keeping the order.
3. **One owner per input channel.** Movement, view and buttons each set by
   one owner per tick, chosen explicitly, instead of the after-steps'
   overrides.
4. **One route pipeline.** Learned routes built through the same edge checks
   as the base graph, and a `bot:routes --check` report of edges that fail
   them.
5. **One scheduler** for all bots, with decide time measured per bot and
   reported by `bot:motion`.
6. **The neural-network path** removed, or moved out of `bot/`, once the host
   is confirmed not to use it; the Duel string checks moved into the weight
   profiles.
7. **Changes behaviour:** fight, hunt and hold-ground scored as goals in the
   arbiter beside the items, so a strategy steers one system. Measured like
   any tuning change, against people as well as bots.
