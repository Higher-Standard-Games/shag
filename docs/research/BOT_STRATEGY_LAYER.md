# Bots that play to win, like people: strategy layer and roadmap

Started 2026-11-12 on `bot/strategy-layer` (both repositories, from `staging`
at `02bfef15` / fps `c3a3ff6`). Research and discussion only: nothing here is
built yet.

This document does two things:

1. Collects every idea for better, more human bots: the open phases of
   [BOT_HUMAN_PLAY_PLAN.md](BOT_HUMAN_PLAY_PLAN.md), the brainstorm of
   2026-11-12, the options for local AI models, and the strategy layer below.
   It ranks them in one matrix by gain for effort.
2. Designs the **strategy layer**: an AI layer above the rule-based bot that
   answers "what do I need to do to win this match against this player?". It
   does not take over the playing.

## Scope

- **The rules keep playing.** Movement, aim, fighting, navigation, the S&D
  logic and the safety checks stay rule-based. They are good and they are
  understood.
- **Learned models are layers, not full control.** Each one sits at a point
  where it beats a rule and hands its output to the rules: a plan, a weight
  change, a mouse curve, a hop chain.
- **No model plays the whole match.** The data does not support it: the
  corpus is about 31 human training demos, and whole-match behaviour cloning
  needs 10⁵–10⁶ frames (see [BOT_TF_IMPROVEMENTS.md](BOT_TF_IMPROVEMENTS.md)).
- **Language models do not drive a bot.** A bot decides about 30 times a
  second and its client sends 125 commands a second. A language model answers
  in 100 ms or more and needs a GPU the production bot server does not have.

## Decisions (owner, 2026-11-12)

1. **Duel and FFA first.** The same things apply in FFA, against several
   opponents at once. Team play for Search and Destroy is the next design
   round, and a large one (see "Search and Destroy: next design round").
2. **The strategist goes into the existing presets**, scaled by difficulty.
3. **Hard and Insane bots exploit players' habits.**
4. **Habits are learned inside a match.** A bot adapts to what this player
   does in this match (always times the Red Armor, always leaves spawn one
   way) and the strategist plans round it. Nothing about a person is carried
   into the next match. Bots cannot know accounts; if per-player memory is
   ever needed, it is keyed by a hash of the player name and kept 90 days.
5. **Everything stored aims at a baseline.** Data from matches is distilled
   into generic, per-map knowledge that is exported and checked in, so every
   bot has a floor that does not change with the database. The database is
   where data accumulates, in the server data directory.
6. **Bots hear as players hear.** Bots already make footsteps like any
   player; their hearing has to match what a person hears.
7. **Damage dealt feeds the estimate and the weapon combos.**
8. **Node only.** No Python: training runs in the existing TensorFlow.js
   pipeline and in TypeScript, against the simulation as it is.

## What exists to build on

Checked in the source on 2026-11-12.

| Piece | Where | What it gives the strategy layer |
| --- | --- | --- |
| Goal arbiter | `bot/goals/GoalArbiter.ts` | Scores candidate goals as gate × attraction × discount and picks one. Every decision has a readable trace, meant as a training signal. A goal holds for 188 ticks (1.5 s). |
| Considerations | `bot/goals/considerations/` | `ItemValue`, `ItemDenial`, `Danger`, `RouteCost`, `ObjectivePush`, `ObjectiveUrgency`, `TeamCohesion`, `CarrierProtect`. Each is pure, returns 0–1 and is scaled by a weight. |
| Weight profiles | `shared/bot/WeightProfiles.ts` | Per-gametype policy as plain data: `itemGreed`, `itemDenial`, `majorItemBias`, `itemTiming`, `objectivePush`, `teamCohesion`, `carrierProtect`, `mapControl`, `aggression`, `riskTolerance`. |
| Brain states | `bot/BotBrain.ts` | `SPAWN`, `FIGHT`, `CHASE`, `HUNT`, `ITEM_RUN`, `DODGE`, `RETREAT`, `IDLE`. Retreat starts under 25 health (`RETREAT_HEALTH_THRESHOLD`), moved by mood. |
| Perception | `bot/BotPerception.ts` | The bot knows only what a player in its place would: enemies in line of sight inside a 110° cone (140° for a moving one), sounds within set ranges, item state as believed. |
| Mood and mistakes | `bot/BotMood.ts` | Calm, confident, tilted, cautious; occasional mistakes scaled by `mistakeRate`. |
| Network overlay | `bot/HybridBrain.ts`, `bot/DenseForward.ts` | Learned models adjust the rule-based decision; dense networks run in plain JS with no TensorFlow call while playing. |
| Learned routes | `bot/LearnedRoutes.ts`, `config/bot-routes/*.json` | Tricks recorded by people, checked by re-simulation, replayed as exact per-tick scripts from a standstill. |
| Route lines | `bot/RouteLine.ts` | A smoothed line for each walking stretch, planned once per path. It halved wall-hugging. |
| Match state | `bot/BotGameState.ts` `BotMatchState` | Gametype, phase, team roles, round state, `timeRemaining`. No scores: a bot has to count frags from kill events. |

Findings that matter here:

- **`mapControl` and `aggression` are set in every profile and read by no
  code.** Only `riskTolerance` is used, in `Danger`. Two of the levers a
  strategy needs exist in the data and do nothing.
- **Bots are deafer than people.** The client plays a footstep for every
  player, bots included, on the ground above 70 u/s and not sliding
  (`FPSMovementAudio`). A bot hears footsteps only above 250 u/s, within
  500 u (`RUNNING_SPEED`, `HEARING_RANGE.footsteps`). So a person walking
  slowly is silent to a bot but a bot is never silent to a person. A person
  has no hard cut-off: spatial sounds use an inverse falloff, full volume
  inside 125 u and `125 / distance` beyond (`AudioV2Sfx`, rolloff 1 for
  normal sounds). A footstep plays at volume 0.5, so it is a quarter of full
  volume at 250 u, an eighth at 500 u and a sixteenth at 1000 u. Bot hearing
  should come from the same formula: one "noticed" gain per difficulty, which
  gives every sound its range from its own volume.
- **A bot never sees an enemy's health or armor** (`VisiblePlayer` has
  neither). It knows the damage it takes (`recentDamage`) and the damage it
  deals: `recentHits` holds victim, weapon, damage and tick for each hit it
  lands, from the server's damage events, and `BotWeaponCombos` already uses
  it for rocket follow-ups. That damage is the whole hit, before armor: armor
  absorbs 66% of it while it lasts (`BASE_ARMOR_ABSORPTION`, less for
  armor-piercing weapons) and health takes the rest. Every damage event also
  carries the victim's pain tier after the hit (health 20 or less, 35, 60,
  above), which picks the pain sound a person hears. So the stack estimate
  has three sources, all fair: hits dealt split by the armor rule, the pain
  tier heard, and items seen or heard taken.
- **Bot presets play at fixed strengths.** Since beta.11 each preset is
  rated at a fixed value from the rating policy (Easy 16.7, Medium 25, Hard
  33.3, Insane 41.7, sigma 2.8) and only people's ratings move.
  `BotRatingIdentity` records a fingerprint of the whole `src` tree, the
  dependencies and the route libraries with each result, so which behaviour
  played is kept, but it does not move the strength. A much stronger Hard
  bot would still count as 33.3 when a person beats or loses to it.

## The strategy layer

### What it answers

A good duel player asks the same few questions all match:

- Why am I losing? Am I understacked all the time? Is the opponent taking the
  armors I should be taking? Do I lose fights in the open and win them at the
  doors?
- What does this player do? Where do they go after spawning? Which items do
  they time? Do they chase a weak enemy?
- So what do I have to do? Take armor control back, hit them and leave by a
  route they can't follow, wait where they will come, protect the lead.

The layer is built to answer them in that order: **read the match, diagnose,
choose a strategy, run tactics.** The rules execute.

```
 every ~0.5 s        every ~2 s            held 5–20 s          per decision (~30 Hz)
┌────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────────────┐
│ Match read │ →  │  Diagnosis   │ →  │    Strategy     │ →  │ Tactics + rules      │
│ ledgers    │    │ why losing / │    │ weight profile, │    │ GoalArbiter, brain   │
│ opp. model │    │ why winning  │    │ stance, tactics │    │ states, sequences    │
└────────────┘    └──────────────┘    └─────────────────┘    └──────────────────────┘
```

### Layer 1: the match read

Plain bookkeeping from what the bot perceives. No model.

- **Stack ledger.** Own health and armor over time. An *estimate* of the
  opponent's: start at spawn values, add items seen or heard taken, subtract
  damage it dealt, reset on their death. Carry an uncertainty that grows
  while they are out of sight.
- **Item-control ledger.** For each major item (armors, Mega Health,
  powerups): who took it each time, how early or late against its respawn,
  and who arrived first when both went for it.
- **Fight ledger.** Each engagement: where, the weapons on both sides, the
  range, who saw whom first, the stacks at the start, damage traded and the
  result (kill, death, disengage).
- **Score and time.** Frags from kill events, `timeRemaining` from match
  state.
- **Opponent model.** Built from the ledgers, per opponent, per match:
  - where they go in the first 10 s after spawning;
  - which items they time and how accurately;
  - accuracy and damage per weapon;
  - aggression: do they chase a weak enemy, do they retreat to health;
  - favourite fight areas, as map cells.

  Counts and averages only, for this match. These are what a human
  remembers about an opponent, and they are what lets the strategist work
  round a habit: an opponent who times the Red Armor gets ambushed on the
  way out of the armor room, or starved of the Mega on the other side of the
  map while they wait.

### Layer 2: diagnosis

Turns the read into a few named findings, each with evidence and a strength
from 0 to 1. Written as rules first: they need to be explainable and testable
with fixtures, like considerations.

| Diagnosis | Evidence | What it calls for |
| --- | --- | --- |
| **Understacked** | Own average stack below the opponent estimate over the last 60 s; deaths at low stack | Armor control: time the armors, avoid even fights until stacked |
| **Losing item control** | The opponent took most recent major items, or arrives first when both go | Lead earlier; deny; or give the item up and ambush the route out of it |
| **Losing open fights** | Damage ratio in open areas well below that at doors and corners | Fight at chokepoints and corners; avoid open rooms |
| **Losing the weapon matchup** | Damage ratio by weapon and range | Change range; pick up the weapon that counters theirs; deny theirs |
| **Seen first** | Fights where the opponent saw the bot first | Change routes; walk the last stretch (silent); check watch points |
| **Predictable** | Opponent appears where the bot goes, repeatedly | More varied routes and item order |
| **Spawn-trapped** | Deaths soon after spawning, in the same area | Leave the spawn by a different exit; go to health or armor first |
| **Ahead, time running out** | Frag lead with little time left | Protect the lead: control, no risky fights |
| **Behind, time running out** | Frag deficit with little time left | Pressure: hunt, take risks, contest everything |
| **Winning** | None of the above | Keep doing what works; no change |

### Layer 3: strategies

A strategy is chosen from the diagnoses and held for 5–20 s, so the bot
shows intent and does not flip-flop. Each strategy is data:

- an **override of the weight profile** (the same fields as
  `BotWeightProfile`, including the unused `mapControl` and `aggression`,
  which get readers);
- a **stance** for the brain: retreat health, preferred fight range, how long
  to chase, whether to take even fights;
- the **tactics** it allows.

| Strategy | In short | Main levers |
| --- | --- | --- |
| **Control** | Time and take the armors and Mega; stay on the item cycle | `itemTiming`, `majorItemBias` up; `aggression` down |
| **Deny** | Take or block what the opponent needs, even items the bot doesn't need | `itemDenial` up; ambush the item route |
| **Recover** | Understacked: avoid fights, collect health and armor, come back stacked | Retreat health up; `riskTolerance` down; chase off |
| **Pressure** | Hunt the opponent and keep them from stacking | `aggression` up; chase longer; follow sounds |
| **Ambush** | Wait unseen where the opponent will come: item exits, their spawn routes | Hold position; silent walk; pre-aim |
| **Poke and fade** | Deal damage from cover and leave by a route that breaks sight, never take the even fight | Short fights; planned escape route |
| **Protect lead** | Ahead late: control without risk | Control plus low `riskTolerance` |

### Layer 4: tactics

New rule-based behaviours that strategies switch on. Each needs a little map
knowledge built with the nav graph and cached with it.

- **Escape routes.** For a position: routes that break the opponent's line of
  sight fastest, ending at health or armor where possible. Built from the nav
  graph plus line-of-sight tests between nodes.
- **Poke and fade.** Engage only from a spot with an escape route. After a set
  amount of damage dealt, or on the first serious damage taken, leave by it.
  Rockets and grenades around corners while leaving.
- **Trap and ambush.** Use the opponent model to predict their route: after a
  pickup, after spawning, toward the next timed item. Wait at a chokepoint
  along it, out of sight, with the shot pre-aimed. Give up after a time limit.
- **Quiet approach.** Footsteps carry to people above 70 u/s, so a quiet
  approach is slow. It is worth it only for the last stretch to an ambush
  spot, and only on Hard and above.
- **Item bait.** Show at an item and fall back through a chokepoint the bot
  controls.
- **Pre-aim at watch points.** Shared with phase 3 of the human-play plan.
- **Chokepoints and high ground**, marked per map at nav-graph build time.

### FFA: the same layer, against several opponents

The ledgers and the opponent model are kept per opponent. The diagnoses
mostly carry over, read against whoever is the threat at the moment. FFA
adds a few of its own:

| Diagnosis | Evidence | What it calls for |
| --- | --- | --- |
| **Third party chance** | Two opponents heard or seen fighting each other | Wait out of sight, then finish the winner (Ambush on the fight) |
| **Focused** | Several opponents keep engaging this bot | Avoid crowded areas; Recover; fight at chokepoints |
| **Race for first** | Score against the leader, time left | Behind the leader late: Pressure on the leader; leading: Protect lead |
| **Item crowd** | Several opponents time the same item | Take a quieter item cycle, or ambush the crowded one |

### Where it runs, and how strong it is by difficulty

One strategist, inside the existing presets. Difficulty sets how well it
reads the match, as it sets how well a bot aims:

| Preset | Match read | Strategy | Habits |
| --- | --- | --- | --- |
| Easy | None: plays the gametype profile | — | — |
| Medium | Own stack and score only | Recover and Protect lead | — |
| Hard | Full ledgers, opponent stack estimated with noise | All strategies, rules and bandit | Exploited within a match |
| Insane | Full ledgers, closer estimates | All strategies, bandit with a learned prior | Exploited sooner, from less evidence |

Reasons for the existing presets over new ones:

- Players pick an opponent by difficulty. Hard should be the best Hard, not
  one of two Hards.
- The strengths are fixed per preset, so there is no rating history to
  protect, and the fingerprint already records which behaviour played.
- Automatic bot choice by rating keeps working with no change.

The cost: the fixed strengths were set for today's bots. A Hard bot that
reads the match may play well above 33.3. So after the strategist lands,
measure people's results against each preset, and if one has moved, change
its fixed strength as a ranking change (the `ranking-change` skill, tested
on a copy of `players.db`).

### How it adapts

1. **Rules first.** Hand-written diagnoses mapped to strategies. That proves
   the layer, gives a baseline and makes every choice explainable.
2. **A bandit over strategies.** For each diagnosis, keep a running estimate
   of how each allowed strategy has paid off *against this opponent in this
   match*: net frags, stack change and item control over the next 30 s.
   Choose by Thompson sampling: mostly the best so far, sometimes another.
   A player who always wins the Mega fight stops being offered one; the bot
   starts ambushing their way out of the Mega room. Within one match, with no
   training, this is what makes the bot adapt.
3. **A learned prior.** A small model predicts each strategy's payoff from
   the match read, and ships in the baseline. Trained on:
   - headless bot-vs-bot games with strategies chosen at random: unlimited
     and cheap;
   - human demos, by inferring which strategy the person was following;
   - matches against people, recorded in the database: the most valuable
     data.

   The prior gives the bandit a sensible start before it knows the opponent.
   The baseline's strategy payoff tables are the first prior; a model comes
   only if the tables stop being enough.

The model never sees more than the ledgers, so the bot never knows more than
a human would.

### Memory: a baseline, and a database to build it

Two layers of knowledge, like the learned routes:

- **The baseline**, checked in: `config/bot-intel/<map>.json`, beside
  `config/bot-routes/`. Generic, per map, about no one in particular. Every
  bot loads it, so every bot has the same floor, and it changes only when a
  new export is reviewed and committed. Like the route libraries, it should be
  part of the behaviour fingerprint in `BotRatingIdentity`.
- **The database**, where data accumulates: `<data-dir>/bot-intel.db`, a
  `node:sqlite` file of the bot service's own beside `players.db` (the bot
  server already resolves the data directory: `--data-dir`, else
  `SERVER_DATA_DIR`, else `./server-data`). A separate file, so nothing the
  bots write can touch accounts, results or ratings, and it can be deleted at
  any time.

Live bots play from the baseline and what they learn in the match. The
database is not read during play; an export command (`bot:intel`, by analogy
with `bot:learn`) distils it into a new baseline. That keeps play
reproducible and keeps data from getting lost in single games: anything
recorded is either part of a generic aggregate or it expires.

What the baseline holds, per map and gametype:

| Knowledge | Built from | Used by |
| --- | --- | --- |
| Fight outcomes by area and weapon pairing | Engagements | Where to fight and where not (Danger, positions) |
| Item contests: who wins when both arrive, by arrival gap | Engagements and item ledgers | Control vs Deny vs Ambush |
| Escape routes that broke sight and survived | Engagements | Poke and fade |
| Ambush spots that paid off, and their give-up times | Strategy outcomes | Trap and ambush |
| How people move: spawn exits, item order, timing accuracy, in aggregate | Matches with people | Priors for the in-match opponent model before it has evidence |
| Strategy payoffs by diagnosis | Strategy outcomes | The bandit's starting estimates; the learned prior |

What the database holds:

| Table | Written | Kept |
| --- | --- | --- |
| `matches`: map, gametype, presets, fingerprint, result | Match end | Until exported and past retention |
| `engagements`: area, weapons, range, who saw first, stacks, damage, result | Match end, one transaction | 90 days |
| `strategy_outcomes`: diagnosis, strategy, duration, payoff over 30 s | Match end | 90 days |
| `decision_traces`: sampled arbiter and strategist traces | Match end | 90 days |

Nothing is written during play: ledgers live in memory and go to disk in one
transaction at match end, so the 125 Hz loop never waits on disk. Rows carry
no player names or keys: an opponent is "human" or a preset. Per-player
memory across matches is not planned (decision 4).

### Guardrails

- **Perception only.** Every input comes from `BotPerception` and the ledgers
  built from it, never from server state.
- **Commitment.** Strategies hold for seconds, goals hold for their 1.5 s
  window, and both show up in the arbiter's trace.
- **Explainable.** `verbose` arbiter mode prints the diagnosis, the strategy
  and why, beside the goal trace.
- **Skill-gated.** See the table by preset above.
- **Ratings.** Re-check the fixed preset strengths after it lands.

### Testing it

- **Fixtures** for diagnoses and strategy choice, like the goal arbiter's
  golden scenarios: a ledger in, a diagnosis and a strategy out.
- **Habit opponents.** Scripted bots with one fixed habit: always takes the
  Mega at the same time, always leaves spawn the same way, always chases.
  The test passes when the strategist exploits the habit and beats a plain
  bot's result against the same opponent.
- **A/B in headless matches.** A strategist bot against a plain bot of the
  same preset, many matches: frag gap, item control share, average stack.
- **Blind demos.** The owner watches unlabelled demos and says which bot
  plays the better duel.

## Search and Destroy: next design round

A design round of its own, after Duel and FFA. What it starts from: bots
already get team roles and round state from match state, objective goals
from gametype directives (`DirectiveGoalSource`), and `TeamCohesion` and
`CarrierProtect` considerations.

Themes to work out then:

- **A team read and a team strategist.** One strategist per team, picking a
  round plan (site, split or together, fast or slow) that each bot's own
  layer carries out.
- **Roles in a round.** Entry, support, lurker; anchor and rotator on
  defence.
- **Information.** Calling where enemies were seen or heard, and rotating on
  it.
- **Trades.** Moving in pairs so a death is traded at once.
- **After the plant.** Positions that cover the bomb; retakes together, not
  one at a time.
- **Adapting across rounds.** The same bandit idea, over round plans against
  this team, with the rounds of a match as its evidence.
- **Humans in the team.** Bots follow a human's lead where they can see it.

## Local AI models: where each fits

| Option | Speed | Data | Role here |
| --- | --- | --- | --- |
| Payoff tables, then a small network or gradient-boosted trees | Microseconds, plain JS | Thousands of examples | **Strategy prior**; other choices (fight or leave) |
| Contextual bandit | Microseconds | None: learns in the match | **Adapting to one opponent** |
| Small MLP or GRU (existing pipeline) | Microseconds, `DenseForward` | Dense data only | **Aim humanizer** from human mouse movement |
| RL (PPO) in the headless sim | Small network, fast | None: practice | **Hop chains and air strafe** |
| Decision Transformer | 1–5 ms CPU | Hundreds of matches | Later: one model with a skill dial |
| Human-vs-bot classifier | Offline | Demo clips | **A number for "plays like a person"** |
| Small language models | 100 ms+, GPU | — | Chat line banks, generated offline only |
| Diffusion policies, world models | Slow or complex | Lots | Not for us |

Stack: Node only. Nothing here needs Python.

- **Networks** train in the existing TensorFlow.js pipeline
  (`@tensorflow/tfjs-node`, `npm run bot:train`) and play through
  `DenseForward` in plain JS.
- **Reinforcement learning** runs in TypeScript against `MovementProfile`
  directly, the same deterministic step the bots and the server use, so there
  is no bridge and no port of the movement code. PPO for a small network is a
  few hundred lines on top of TensorFlow.js. Networks this small train fine
  on the CPU; the simulation steps, not the network, set the pace.
- **Trees**, if a prior ever needs them: a small gradient-boosting trainer
  in TypeScript is enough for a few thousand rows. No library is needed to run
  them.
- Python would bring LightGBM and Stable-Baselines3, nothing we can't do
  without.

## The matrix

Every idea, ranked by gain for effort. **Human** is how much more like a
person the bot plays. **Win** is how much harder it is for a good player to
beat. Gain: 0 none to 3 large. Effort: S under a day, M a few days, L a
week or two, XL more. Risk is the chance it makes bots worse or breaks
something.

### Measurement (enables everything)

| ID | Idea | Human | Win | Effort | Risk | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| X1 | Human baseline: run human demos through the `bot:motion` analysis, so targets come from people, not guesses | enables | enables | S | low | — |
| X2 | Strategy A/B harness: strategist vs plain bot, habit opponents, many headless matches | — | enables | M | low | — |
| X3 | Human-vs-bot classifier: a score for "plays like a person" | enables | — | M | low | X1 |
| X4 | Blind demo review by the owner | enables | enables | S | low | — |

### Movement and tricks

| ID | Idea | Human | Win | Effort | Risk | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | Running-start tricks: verify each learned route from a range of entry speeds and headings; enter without stopping. About 15% of dm1 time is bots standing on trick marks | 3 | 1 | M | med | — |
| M2 | Strafe-jump chains on route-line straights, analytic air-strafe angle, skill sets accuracy (human-play phase 2) | 3 | 2 | M–L | med | — |
| M3 | Player keys on route lines: rebase `bot/player-keys-wip` onto `RouteLine` steering | 2 | 0 | M | med | — |
| M4 | Tricks fail by skill: late jump, short landing, recovery | 2 | −1 | S | low | M1 |
| M5 | Tricks follow the recorded path with correction instead of replaying commands | 1 | 1 | M | med | M1 |
| M6 | RL hop-chain controller trained against `MovementProfile` in TypeScript | 3 | 2 | L | high | M2 |
| M7 | Trick miner: simulator search finds jumps no recording has | 1 | 2 | L | med | — |

### Aim and looking

| ID | Idea | Human | Win | Effort | Risk | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Flicks overshoot or undershoot, then correct | 2 | 0 | S | low | — |
| A2 | Long-tailed reaction times instead of ±20% | 1 | 0 | S | low | — |
| A3 | Watch points and pre-aim at corners and doors (human-play phase 3) | 2 | 2 | M | low | — |
| A4 | Turn toward heard enemies before seeing them. A heard enemy already makes the bot ready a weapon for the distance (`_readyForHeard`) and enters `audibleEnemies` in `BotVision`; whether the view turns is not checked yet | 2 | 1 | S | low | — |
| A5 | Learned aim humanizer from human mouse movement | 3 | 0 | M–L | med | X1 |
| A6 | Hear as people hear: footsteps from 70 u/s, not sliding, at a range matching the audio falloff | 1 | 1 | S | low | — |

### Decisions and strategy

| ID | Idea | Human | Win | Effort | Risk | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Hunt instead of always shopping: `armor < 25` sends every respawned bot shopping (human-play phase 4) | 2 | 1 | S | low | — |
| D2 | Readers for `mapControl` and `aggression`, set in every profile and used nowhere | 1 | 1 | S–M | low | — |
| D3 | Match read: stack, item, fight ledgers and score | — | enables | M | low | — |
| D4 | Opponent model from the ledgers | — | enables | M | low | D3 |
| D5 | Diagnoses and strategies by rules, held for seconds | 2 | 3 | M | med | D2, D3 |
| D6 | Escape routes and poke-and-fade | 2 | 3 | M–L | med | D5 |
| D7 | Trap, ambush and silent approach on predicted routes | 2 | 3 | L | med | D4, D5, A3 |
| D8 | Bandit over strategies against this opponent | 1 | 3 | M | low | D5, X2 |
| D9 | Learned strategy prior (a small network, or trees) beyond the baseline tables | 1 | 2 | M–L | low | D8, D13 |
| D10 | Styles per bot: mover, holder, hunter (human-play phase 5) | 2 | 0 | S | low | D5 |
| D11 | Human position and route priors from demos, as route costs | 2 | 1 | M | low | X1 |
| D12 | FFA diagnoses: third party, focused, race for first, item crowd | 2 | 2 | M | low | D5 |
| D13 | `bot-intel.db` written at match end, `bot:intel` export, `config/bot-intel/<map>.json` baseline | — | enables | M | low | D3 |
| D14 | Baseline priors in play: fight areas, item contests, escape routes, ambush spots, how people move | 1 | 2 | M | low | D13 |
| D16 | Damage-aware combos and finishing: switch to the sure kill when the estimated stack is below the next shot | 2 | 2 | S–M | low | D3 |
| D15 | Re-check the fixed preset strengths against people's results | — | — | S | med | D5 live |
| S1 | Search and Destroy team strategist: its own design round | 3 | 3 | XL | med | D5 |

Item timing with error already exists: `itemTimingSkill` in `BotPerception`
sets how often a heard pickup is noted and how far off the remembered time is.

### Later or not at all

| ID | Idea | Why not now |
| --- | --- | --- |
| L1 | Decision Transformer as a skill dial | Needs hundreds of matches of data |
| L2 | Language-model chat, generated offline into line banks | Small gameplay gain; worth a side session |
| L3 | A model playing the whole match | Out of scope by decision |
| L4 | A language model making calls during play | Too slow, needs a GPU, and the strategy layer does the job better |
| L5 | Per-player memory across matches, by a hash of the name, 90 days | Habits are learned inside a match (decision 4); only if that proves not enough |

## Proposed order

**Tier 1: largest gain for effort.**

1. X1 human baseline. Every target in the human-play plan is a guess until
   this exists.
2. D1 hunting and D2 the unused weights. Small, visible, and they build the
   levers the strategy layer needs.
3. M1 running-start tricks. Removes the single most robotic thing bots do.
4. A1, A2 and A6. Small, local, human, fair.
5. D3 and D5 with a handful of rule-based diagnoses and strategies (Recover,
   Control, Pressure, Protect lead), plus X2 to measure them. Duel first,
   then D12 for FFA.

**Tier 2: the big features.**

6. M2 strafe-jump chains, then M4 tricks failing by skill.
7. D6 poke and fade with escape routes.
8. D4 opponent model and D8 the bandit: adapting to the player.
9. A3 watch points, then D7 traps and ambushes, which use them.
10. D16 damage-aware combos; D13 the database and baseline export, then
    D14 baseline priors in play.
11. M3 player keys on route lines; D10 styles.
12. D15 re-check preset strengths once the strategist is live.

**Tier 3: learned layers.**

13. D9 tree prior, A5 aim humanizer, X3 classifier, M6 RL hop chains, M7
    trick miner, D11 human route priors.

**Next design round:** S1, Search and Destroy team play, once D5 shows the
layer works for one bot.

Tier 1 and the strategy parts of tier 2 are bot code only: no networking,
renderer or protocol change.

## Answered (owner, 2026-11-12)

1. **Hearing range:** matched by formula, from the audio falloff (A6).
2. **Damage and armor:** the event carries the whole hit; armor absorbs 66%
   of it, confirmed in `CombatSystem`.
3. **Export cadence:** on demand, like the route libraries.
4. **People in the database:** a match row records the skill band of the
   people in it, with no identity, so what strong players teach can be
   weighted.

## Implementation plan

Work orders in build order. IDs in brackets are the matrix rows each one
covers. Gains and effort as in the matrix. Each phase is merged to `staging`
when its work orders pass; every work order runs the gates and is measured
with `bot:motion` or the A/B harness against the code before it, and must not
lower pickups or raise stuck time.

| WO | Phase | What | Covers | Human | Win | Effort | Risk | Needs | Done when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BS-1 | A: ground | Human baseline: human demos through the `bot:motion` analysis | X1 | enables | enables | S | low | — | Bot and human numbers side by side for dm1, dm2 |
| BS-2 | A | Hearing by the audio formula: footsteps from 70 u/s, not sliding, range from volume and falloff | A6 | 1 | 1 | S | low | — | Perception tests; a person walking is heard as a person would hear it |
| BS-3 | A | Hunt instead of always shopping | D1 | 2 | 1 | S | low | — | ITEM_RUN share down, HUNT up; deaths and pickups level |
| BS-4 | A | Readers for `mapControl` and `aggression` | D2 | 1 | 1 | S–M | low | — | Each weight changes behaviour in a fixture |
| BS-5 | A | Flick overshoot and correction; long-tailed reaction times | A1, A2 | 2 | 0 | S | low | — | Aim tests; flick curves compared with BS-1 |
| BS-6 | A | Running-start tricks: entry envelopes in `bot:learn`; tricks fail by skill | M1, M4 | 3 | 1 | M | med | — | Still time on dm1 down from ~15%; trick success by preset as intended |
| BS-7 | A | A/B harness and habit opponents | X2 | — | enables | M | low | — | Strategist vs plain bot, many headless matches, one report |
| BS-8 | B: strategy | Match read: stack, item, fight ledgers; stack estimate from hits, the armor rule, pain tiers and items | D3 | — | enables | M | low | — | Estimate within a set error of server truth in recorded matches |
| BS-9 | B | Diagnoses and strategies by rules, Duel: Recover, Control, Pressure, Protect lead; verbose traces; fixtures | D5 | 2 | 3 | M | med | BS-4, BS-8 | Hard strategist beats plain Hard in the A/B harness |
| BS-10 | B | Damage-aware combos and finishing | D16 | 2 | 2 | S–M | low | BS-8 | Kill time after a big hit down in the harness |
| BS-11 | B | Opponent model and bandit: habits learned inside a match | D4, D8 | 1 | 3 | M | low | BS-9 | Each habit opponent exploited within one match |
| BS-12 | C: tactics | Escape routes in the nav graph (cached), poke and fade | D6 | 2 | 3 | M–L | med | BS-9 | Disengages survive more often; frag gap up |
| BS-13 | C | Strafe-jump chains on route lines | M2 | 3 | 2 | M–L | med | — | Median roaming speed toward the BS-1 human numbers |
| BS-14 | C | Watch points and pre-aim | A3 | 2 | 2 | M | low | — | Enemies first seen nearer the view centre |
| BS-15 | C | Traps and ambushes on predicted routes; quiet approach | D7 | 2 | 3 | L | med | BS-11, BS-14 | Ambush strategy pays off against habit opponents |
| BS-16 | C | FFA diagnoses: third party, focused, race for first, item crowd | D12 | 2 | 2 | M | low | BS-9 | Strategist wins more FFA matches than plain bots |
| BS-17 | D: memory | `bot-intel.db` at match end, `bot:intel` export, `config/bot-intel/<map>.json`, fingerprint | D13 | — | enables | M | low | BS-8 | Export from a set of matches reproduces the same baseline |
| BS-18 | D | Baseline priors in play | D14 | 1 | 2 | M | low | BS-17 | Strategist with baseline beats it without in the harness |
| BS-19 | D | Styles per bot | D10 | 2 | 0 | S | low | BS-9 | Styles visibly differ in `bot:motion` |
| BS-20 | D | Player keys on route lines | M3 | 2 | 0 | M | med | — | Hugging and flip-backs at or below the baseline |
| BS-21 | D | Re-check fixed preset strengths against people's results (`ranking-change`) | D15 | — | — | S | med | BS-9 live | Preset strengths match measured results, or changed |
| BS-22 | E: learned | Learned strategy prior beyond baseline tables | D9 | 1 | 2 | M–L | low | BS-17 | Beats the tables in the harness |
| BS-23 | E | Aim humanizer from human mouse movement | A5 | 3 | 0 | M–L | med | BS-1 | Classifier (BS-24) scores aim as more human |
| BS-24 | E | Human-vs-bot classifier | X3 | enables | — | M | low | BS-1 | Separates current bots from people on held-out clips |
| BS-25 | E | RL hop chains against `MovementProfile` | M6 | 3 | 2 | L | high | BS-13 | Faster than BS-13 with no more missed landings |
| BS-26 | E | Trick miner | M7 | 1 | 2 | L | med | BS-6 | New verified routes beyond the recorded ones |
| BS-27 | E | Human route priors from demos | D11 | 2 | 1 | M | low | BS-1 | Routes nearer people's in `bot:motion` |
| — | Next round | Search and Destroy team play, its own design document | S1 | 3 | 3 | XL | med | BS-11 | — |

Phase A is independent work and can be done in any order; BS-1 first so that
the rest has targets. Phases B and C are the strategy layer for Duel, then
FFA. BS-13 and BS-14 do not depend on the strategy layer and can be taken
whenever there is room.

## Progress

### 2026-11-12 — BS-1: people measured

`bot:demo-motion` (fps `bot/MotionStats.ts`, `cli/bot-demo-motion.ts`)
measures every player in a demo by one code path; `bot:motion --keep-demo`
keeps a headless match's demo for it.

People: 121 minutes alive from 45 recorded matches with recorded inputs,
mostly people against bots in Duel on dm5 and dm11 (old names `wfdm5`,
`wfdm11`), October and November. Bots now: 180 s headless runs on the
committed code, `washoi_dm5` Duel at medium and hard, `washoi_dm2` FFA with 4
medium bots.

| Measure | People | Bots: dm5 Duel medium | dm5 Duel hard | dm2 FFA medium |
| --- | --- | --- | --- | --- |
| Running speed, median | 399 u/s | 390 | 400 | 406 |
| Running over 450 u/s | 17% | 9% | 12% | 15% |
| Running airborne | 42% | 22% | 26% | 28% |
| Within 24 u of a wall, running | 10% | 7% | 12% | 14% |
| Within 8 u of a wall, running | 4% | 3% | 6% | 5% |
| Pitch running, median | 11.1° | 0.3° | 0.1° | 0.7° |
| View turning out of a fight | 35°/s | 110 | 145 | 115 |
| Turn reversals per minute | 21 | 49 | 62 | 41 |
| Flicks per minute | 14 | 41 | 67 | 44 |
| Flick size, median | 49° | 46° | 87° | 55° |
| Flicks ending in a correction | 18% | 19% | 21% | 10% |
| Take-offs per running minute | 76 | 57 | 53 | 77 |
| Take-offs chained from a landing | 42% | 40% | 36% | 26% |

What it says:

- **The view is the biggest tell.** Out of a fight bots turn three to four
  times as fast as people, reverse two to three times as often and flick three
  to five times as often. People mostly look where they go and turn when they
  have a reason. This moves BS-5 (aim) and the glance work up: calming the
  view out of a fight is the largest single gap.
- **Bots run with the view dead level; people look about 11° down** (pitch
  positive is down). People watch the floor ahead and the item they run to.
- **People are in the air more while running** (42% against 22–28%) and
  reach over 450 u/s more often: hop chains and strafe jumps (BS-13).
- **Walls are solved.** Bots run within 24 u of a wall as often as people do
  (7–14% against 10%), so the old target of under 8% would have been less
  than people manage. No more wall work is needed.
- **Speed in a straight line is already human**: the medians match.

Caveats: the people are a few players against bots, on two maps; "still" for
people includes warmup and countdown, so it is left out of the table. The
October demos were recorded against older bots, which do not enter the
people column.

### 2026-11-13 — BS-5 first part: a calm view out of a fight

Moved ahead of BS-2 to BS-4 because BS-1 put the view first. Two runs each of
`washoi_dm2` FFA (4 medium, 150 s) and `washoi_dm5` Duel (2 medium, 180 s),
against the BS-1 runs of the code before:

| Measure | FFA before → after | Duel before → after | People |
| --- | --- | --- | --- |
| Turning out of a fight | 115 → 102°/s | 110 → 96 | 35 |
| Turn reversals per minute | 41 → 30 | 49 → 28 | 21 |
| Flicks per minute | 44 → 40 | 41 → 38 | 14 |
| Pitch running | 0.7° → 9.0° | 0.3° → 9.2° | 11.1° |
| Running within 24 u of a wall | 14% → 12% | 7% → 8% | 10% |

Health and armor picked up and deaths stayed within run-to-run spread.

What was found on the way, with a probe splitting the turning into the
brain's wanted view, its travel heading, the view sent and the actual
movement direction:

- **People's movement weaves more than their view.** Their movement direction
  turns 93°/s while running (air strafing); their view 35°/s. The view is a
  steady intent with movement under it, not the movement.
- **Bots' wanted view swings 150–500°/s out of a fight** while their actual
  movement turns 65–110°/s. Turning off the open-space lean or the route
  look-ahead changed little: most of it is the route itself (the route-line
  steering point is 64 u ahead), replans after pickups, and in Duel goals
  flipping between two items, which turned the bot back and forth on the
  spot (130 view reversals a minute in Duel ITEM_RUN).
- **Easing alone cannot hide a swinging goal.** With the goal eased at 0.6 s
  and capped at 120°/s, the view sent still turned 66°/s in ITEM_RUN.
- **Easing a turnaround is wrong.** With every turn eased, a bot whose new
  route pointed behind it ran backwards for over a second while its view came
  round. Turns over 90° now go the ordinary way (reaction, then a fast turn),
  as people flick round.
- Glances instead of a held lean made no measurable difference; they are
  kept because watch points (BS-14) build on them.

What is left, for later work orders: goals that flip between items (the
strategy layer's commitment, BS-9), replans that turn the bot round, and
flicks when an enemy comes into sight, which are reactions and partly right.

### 2026-11-13 — BS-2 and BS-3

**BS-2, hearing.** Footsteps are heard from 70 u/s on the ground and not
sliding, jumps from 60 u/s up, as the client plays them; ranges from the
falloff formula and the sound's volume (footsteps 500 units, jumps 720), and
landings are no longer heard. A person walking is no longer silent to bots.

**BS-3, hunting.** `_shouldSeekItems` no longer sends every bot under 25
armor shopping. Under 25 armor with a fresh enemy position (`_getHuntTarget`,
2.4 s), it shops only for an item goal whose arbiter desire reaches
`0.2 + 0.25 × aggression`; with no enemy known, it still shops. This is the
first reader of the profile's `aggression` (part of BS-4).

Measured with the view probe's time per brain state, 4 medium bots on
washoi_dm2, 120 s: ITEM_RUN 95 s → 57–75 s, HUNT 2 s → 19–26 s, CHASE 26 s
→ 39–50 s. Deaths and health and armor picked up stayed within spread.

Typical desire, for a bot with 50+ health under 25 armor: median 0.33 in
Deathmatch and 0.48 in Duel (p90 0.45 and 0.67).

Two things found on the way:

- A first version also sent armoured bots after very good items. In Duel
  that cut fights (deaths a minute 5.7–6.0 → 3.7–4.0), against the point of
  the change, and was dropped.
- **Two-bot Duel results cannot be judged from single runs.** Two runs of
  the same code gave 154 and 99 health and armor a minute, or 2.7 and 9.7
  deaths. BS-7's harness, many matches per arm, is what Duel changes need.

### 2026-11-13 — BS-7: head to head

`bot:ab` (fps `cli/bot-ab.ts`, `bot/AbStats.ts`) plays arm A against arm B
over many matches in worker processes and reports wins, the frag gap with a
95% interval, and a two-sided sign test on wins.

First use, Hard against Easy, `washoi_dm5` Duel, 16 matches of 150 s: wins
10–3 (3 drawn), frags 62–49, deaths 58–71, p = 0.09. **Even the largest skill
difference barely shows in two-bot Duel on dm5.** Bots meet rarely and the
first to see the other usually wins, so most of a match is not decided by
skill. Two things follow: Duel changes need 30 or more matches to judge, and
there is room for the strategy layer, which is about meeting on your own
terms. The habit opponents move to BS-11, which they exist to test.

### 2026-11-13 — BS-5 second part: reactions and flicks

Reaction waits are log-normal (σ 0.25 of the logarithm) round the preset's
time, drawn through a logistic approximation of the normal quantile so a fixed
random source still gives the preset's time. Reactive turns overshoot by
4–12% with odds 0.15 + 0.35 × (1 − aimAccuracy) and correct once the view
arrives (at most 1 s). Two FFA runs: deaths 25–27 a minute as before; flicks
out of a fight ending in a correction stayed at 11% (people 18%), because the
flicks out of a fight are mostly turnarounds and a small overshoot comes back
slower than the measure's 45°/s. The change is in fights, which that measure
leaves out by design.
