# Bot server architecture: review and refactor plan

Written 2026-11-13, at the end of the `bot/strategy-layer` work. It describes
how a bot runs now, the weak points that work ran into, and the refactors to
make in the next cycle, in order. None of these changes what a bot does; the
last item is marked where it would.

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

`StateMachineBrain.ts` is 2,923 lines with 58 private fields, 87 constants and
41 imports. On death `_decide` resets about 20 of those fields by hand; a field
added later and not reset carries over into the next life.

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

There is no per-decision record of state, strategy, chosen goal and the top
candidates with their scores, path step, sequence phase and position. Finding
why the bot stood still at learned-route links, why it bobbed, and why it left
the Red Armor each took temporary logging patched into the brain and
`bot:motion`, removed afterwards.

### 5. A/B tests cannot switch code paths

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
bot's commands, and decide time is not measured.

### 8. Leftovers

- The neural-network path (`HybridBrain`, `TFBackend`, `BotTrainer` and the
  training files, about 3,500 lines) loads when the bot server gets
  `--models <dir>`. The production launcher in the repository
  (`scripts/deployment/run-server.sh`) passes no arguments of its own; the
  service unit on the host is the place to confirm it is unused.
- Duel behaviour is chosen by `gametypeName.toLowerCase()` comparisons in four
  places in the brain, where the weight profiles mean gametypes to differ by
  data.

## Plan for the next cycle

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
