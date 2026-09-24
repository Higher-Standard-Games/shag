# Bots that learn from people — audit and plan

**Opened:** 2026-09-23, during the v0.9.24 QA cycle
**Branch:** `0.9.24-qa-improvements`
**Status:** audited, nothing rebuilt yet

## The goal

Demos of humans playing become training data, so bots move from hand-written
rules toward human-like play as more matches are recorded. That is **behaviour
cloning** — the network learns to answer "what would a person do here?" — with
self-play reinforcement as a separate, later tool for sharpening, not the
mechanism for learning to play like a person.

Two things follow from that sentence, and most of this document is consequences
of them:

1. The training label must be **what the human actually did**.
2. The training data must be **humans**, not our own bots.

Today the stack satisfies neither, and the trained result cannot reach a bot in
a real match. Those are three separate breaks, and they are the plan.

## How it works today

```
match → DemoRecorder ──► .shagdemo (state snapshots, no inputs)
                            │
                            ▼
                DemoTrainingExtractor  (infers buttons from velocity)
                            │
                            ▼
              bot-train --demo  (targets built from reward, not behaviour)
                            │
                            ▼
                   models/{tactical,combat}/model.json
                            │
                            ✗  never loaded by a bot a player adds
```

| Piece | File | State |
| --- | --- | --- |
| Recording | `src/games/fps/server/DemoRecorder.ts` | Full snapshot frames, match phase only |
| Reading | `src/shared/demo/DemoReader.ts` | v1 and v2; v2 carries verified `accountId` per player |
| Extraction | `src/bot/DemoTrainingExtractor.ts` | State → inputs by heuristic; no human filter |
| Features | `src/bot/BotInputNormalizer.ts` | 25 tactical, 18 combat, all in [0,1] |
| Reward | `src/bot/BotRewardComputer.ts` | Used as the training label; see F3 |
| Training | `src/cli/bot-train.ts`, `src/bot/BotTrainer.ts` | Demo mode and live self-play |
| Network | `src/bot/HybridBrain.ts` | 8 tactical outputs, 6 combat; overlays the rules |
| Backend | `src/bot/TFBackend.ts` | `tfjs-node` → `tfjs` → none, no crash |
| Live bot | `src/bot/BotClient.ts`, `BotServer.ts` | Loads models only when given `modelDir` |

## Findings

Ordered by what blocks the goal, not by size.

### F1 — A bot a player adds can never use a trained model *(blocker)*

`BotClient` constructs `HybridBrain` only when `options.modelDir` is set.
`bot-server.ts --models` reaches bots the server spawns itself at startup
(`--auto`, `--lobby`), but `BotServer` holds no default, and a bot requested
over the control socket takes its options from the message — where the lobby
sends `{ difficulty }` and nothing else. **Every bot added from a room runs the
plain state machine**, whatever has been trained.

### F2 — Demos do not record what a person pressed *(blocker)*

`DemoRecorder` writes `BinaryProtocol.encodeSnapshot()` frames: state. The
snapshot carries `ackedInputSeq` and no buttons or aim input. The extractor
says so itself and reconstructs:

| Label | Rule today | Why it is wrong |
| --- | --- | --- |
| Forward/back/strafe | velocity direction, threshold 0.3 | In air-strafing, input direction deliberately differs from velocity — the one technique worth learning is taught backwards |
| Sprint | `speed > 1` | Almost any moving player is labelled sprinting |
| Jump | `vy > 50` | Labels the whole ascent as held, not the press |
| Weapon slot | hardcoded `0` | Weapon choice is never learned, though the network has an output for it |
| Aim | view angles from state | **Correct** — angles are recorded, and they are what the human aimed |

### F3 — The targets encode reward, not behaviour *(blocker)*

In `bot-train.ts`, every target is built from `rewardScale = (reward + 1) / 2`:

```ts
target[0] = rewardScale;                                  // MODE_FIGHT
target[1] = 1 - rewardScale;                              // MODE_RETREAT
target[3] = sprint ? rewardScale : 1 - rewardScale;        // SPRINT
target[5] = jump   ? rewardScale : 1 - rewardScale;        // JUMP
```

- With a neutral reward — most frames — `rewardScale` is 0.5, so **every target
  becomes 0.5 whatever the human did**. The label carries no information.
- `MODE_FIGHT` is literally the reward, and `MODE_RETREAT` its inverse. The
  head is trained to predict "were things going well", then read at inference
  as "should I stay in FIGHT".
- `MODE_HUNT`, `SLIDE`, `WEAPON_SWITCH` and `WEAPON_SLOT` are left at 0.5 for
  every frame, so the model is actively trained to be permanently undecided
  about them.
- In the combat head, `AIM_YAW_ADJUST` and `AIM_PITCH_ADJUST` are never set —
  the one label that is genuinely human and reliable is discarded.

### F4 — Training data includes our own bots *(blocker for the goal)*

`extractFromFile` walks `header.players` and extracts every one. Demo v2 gives
each player a verified `accountId` from its game seat, and **bots have none** —
the information needed to keep humans and drop bots is right there, unused. A
demo of a bot match trains the network on the state machine it is meant to
grow beyond.

### F5 — The output space is the bot's vocabulary, not the human's

Even with perfect labels, `MODE_FIGHT` / `MODE_HUNT` / `MODE_RETREAT` cannot be
supervised from a human demo: a person never emits "my mode is HUNT". Cloning
needs heads that predict *actions* — movement, jump, fire, aim delta, weapon —
with the mode heads either dropped or trained separately from self-play, where
the mode is known because our own bot chose it.

### F6 — No validation, no split, no early stopping

`fit()` runs with `shuffle: true` and a fixed epoch count, reporting training
loss only. Nothing measures generalisation, so "final loss 0.0001" says the
network memorised the frames, not that a bot will play better.

### F7 — Nothing in the pipeline is tested

Nineteen test files cover the bot's rules, navigation, sequences and goals.
None cover `DemoTrainingExtractor`, `BotTrainer`, `bot-train`, or the
normalizer's contract with the model shapes. The shapes agree today
(`TACTICAL_INPUT_SIZE` 25 → `inputShape: [25]`), and nothing would catch them
drifting apart.

### F8 — Inference cost is unmeasured

`HybridBrain.decide()` runs the state machine, then up to two `predict()` calls
per decision, per bot. Nobody has measured what that costs with eight bots on a
125 Hz server, or what happens when `tfjs-node` is absent and it falls back to
pure JS.

## Is the architecture good? — an honest read

Separating three things that deserve different verdicts.

### Keep

- **The overlay.** `HybridBrain` runs the rules and lets the network adjust,
  so a bad model degrades to a competent bot rather than a broken one. This is
  how shipped game AI works; nobody fields a pure-network opponent.
- **Inference at snapshot rate.** `decide()` runs per snapshot, and the result
  is cached and re-sent by the 125 Hz input loop. That is the right cadence and
  it was chosen deliberately.
- **Hand-engineered features.** 25 and 18 scalars suit the data budget. Raw
  world state would need orders of magnitude more matches than this project
  will have.
- **Backend degradation**, and the goal/consideration layer kept apart from the
  brain.

### Dated

1. **No temporal context.** Frame-independent MLPs for an entirely sequential
   problem — strafe-jump chains, tracking across 300 ms, peek rhythm. Cheapest
   fix: frame stacking, concatenating the last N feature vectors. Proper fix: a
   small GRU. Stacking is nearly free and would matter more than any other
   modelling change here.
2. **Lossy output encoding.** Aim adjustment is squashed into [0,1] with 0.5 as
   "no change", which wastes half the range and makes a small correction
   indistinguishable from noise. Aim wants a linear head on the angle delta or
   discretised buckets; modes want a softmax; buttons want independent sigmoids
   with binary cross-entropy. Everything is currently sigmoid against
   MSE-shaped targets.
3. **Two models, no shared trunk**, over overlapping features, two forward
   passes per decision. One trunk with typed heads is cheaper and learns better
   representations.
4. **A deterministic policy.** The same state gives the same action, which
   reads as robotic — and human-likeness is partly variance. Sampling with a
   temperature is the fix.
5. **Cloning and reward share one path.** The standard recipe is two stages:
   behaviour-clone on human data, then use that as the initialisation for
   self-play RL. Today they are tangled in one target-building block.

### The weakest part is not the model

There is **no dataset layer**. `bot-train --demo` takes a single file: no
corpus, no train/validation split, no stored normalisation statistics, no
dedup, no incremental accumulation. Nothing is saved beside the weights either
— no input size, no feature version, no provenance — so changing
`BotInputNormalizer` silently invalidates every existing model with no error to
catch it.

The arithmetic says this is the priority. A three-minute duel at snapshot rate
is roughly 10k frames per player; behaviour cloning wants 10⁵–10⁶. **Tens of
matches are needed before any modelling work pays off**, so the pipeline's real
job is to make demos accumulate — which it cannot do today.

### Why recording inputs is the keystone

Beyond giving cloning its labels: the simulation is deterministic, so a demo
that carries the applied commands is **re-simulatable**. Every derived feature
can be regenerated later without re-recording, which means the corpus survives
every future change to the feature vector. Without inputs, each change to the
normalizer throws the dataset away. That is the difference between recordings
worth keeping forever and recordings worth deleting.

### What not to do

No decision transformer, no fashionable sequence model. At this data volume it
would underperform a well-fed small network and add a second system to
maintain. Fix the data, stack some frames, give each head a loss that matches
its job, and sample.

## Work orders

Difficulty 1 (mechanical) to 5 (deep). Model: a suggestion for whoever picks it
up.

| WO | What | Depends on | Diff | Model | Status |
| --- | --- | --- | --- | --- | --- |
| TF-1 | Record inputs in demos | — | 3 | Opus 5 | **done 2026-09-23** |
| TF-2 | Close the model path | — | 2 | Sonnet 5 | **done 2026-09-23** |
| TF-3 | Keep humans, drop bots | — | 2 | Sonnet 5 | **done 2026-09-23** |
| TF-4 | Rebuild the labels as behaviour cloning | TF-1, TF-3 | 4 | Opus 5 | **done 2026-09-23** |
| TF-5 | Reshape the heads so every output has a label a demo can supply, and move the mode heads to self-play or drop them | TF-4 | 4 | Opus 5 | **done 2026-09-23** |
| TF-6 | Early stopping, and metrics per output rather than one mean-squared number (the held-out split itself now works — see TF-7) | TF-4 | 3 | Sonnet 5 | **done 2026-09-23** |
| TF-7 | Tests: extractor on a fixture demo, shape contract between normalizer and models, target construction, and a training smoke run | TF-4 | 3 | Sonnet 5 | **done 2026-09-23** |
| TF-8 | Measure inference: per-decision cost with models loaded, eight bots, native and pure-JS backends | TF-2 | 2 | Haiku 4.5 | **done 2026-09-23** |
| TF-10 | A dataset layer | TF-1 | 3 | Sonnet 5 | **done 2026-09-23** |
| TF-11 | Frame stacking: the last N feature vectors concatenated, so the network can see a movement in progress rather than a still | TF-10 | 3 | Opus 5 | **done 2026-09-23** |
| TF-14 | Record the snapshot rate a corpus was recorded at, and have a bot say so when it plays at a different one — a stack of three frames only spans the same time on both sides at the same rate | TF-11 | 2 | Sonnet 5 | **done 2026-09-24** |
| TF-13 | Batch inference across bots: one predict call for the whole fleet instead of one per bot, since the measured cost is the round trip into TF and not the arithmetic | TF-8 | 3 | Sonnet 5 | todo |
| TF-12 | One trunk, typed heads: independent sigmoids with binary cross-entropy for the buttons, a linear head for aim delta, and sampling with a temperature so two bots in the same spot do not do the same thing | TF-5, TF-11 | 4 | Opus 5 | todo |
| TF-9 | Document the pipeline in the manual — there is no page for any of this today | TF-1…TF-5 | 2 | Sonnet 5 | **done 2026-09-23** |

**Order.** TF-1, TF-2 and TF-3 are independent and each worth doing alone: one
makes the data real, one makes the result reachable, one makes the data human.
TF-4 needs all three before it means anything. TF-5 follows from what TF-4
learns. TF-6 and TF-7 harden it; TF-8 tells us what it costs; TF-9 writes it
down.

## Notes for whoever picks this up

- **Old demos are disposable.** Their owner confirmed they are local test
  recordings only, so a format change need not carry v2 compatibility — though
  `DemoReader` still reads v1 and v2 for playback, which is a separate concern
  from training.
- **The reward computer is not wasted.** Rewards are the right signal for
  self-play sharpening, which is the second half of the plan. They are simply
  the wrong thing to hand a cloning objective.
- **The state machine is the floor, not the enemy.** `HybridBrain` overlays the
  network on the rules rather than replacing them, so a bad model degrades to a
  competent bot instead of a broken one. Keep that.

## Progress log

### 2026-09-24 — TF-14 done: frames spaced the way training spaced them

A stack of three frames means "the last two snapshot intervals", which is the
same stretch of time in training and in a match only at the same snapshot rate.
Both sides now measure it the same way, in ticks between consecutive frames,
leaving out gaps long enough to be deaths: the corpus from the recorded frame
ticks, a bot from the ticks of the snapshots it decides on. Measured rather than
read from the header, because the header's rate is rounded — the real recordings
say 63 for an effective 62.5 — and a bot is never told the rate at all.

The trainer warns about a match recorded at a different spacing from the rest of
its corpus and writes the spacing into the metadata (`frameIntervalTicks`; the
real wdm12 corpus records 2). A bot compares its own after 64 decisions and warns
once if they differ by more than a quarter. Nothing is refused: the bot still
plays, but a stack spanning three times the time it did in training reads every
movement three times as fast, and nobody would otherwise know why.

### 2026-09-24 — the first real recording: three bugs that no fixture could see

Everything up to TF-11 was verified against a scripted fixture. `demo:record`
records a real match with AI bots, and `--include-bots` lets training read it, so
the whole loop could be run on real data without anyone playing. It failed at
three separate links, each invisible to every test so far.

**Demo training had never extracted a frame from a real recording.** One person
has three names in a real demo: the roster and the recorded commands say `"1"`,
while the snapshot keys players by the wire key, `player_1`. The extractor looked
snapshots up by the roster id, found nobody in any frame, and reported the match
as holding no verified player. The fixture used `"1"` for all three, so every
test passed. The extractor now looks players up by the wire key through the
game's own `ensureClientKey`, sets `selfPlayerId` to it as a bot's join accept
does — which is also how a bot finds its own team, so teammates would otherwise
all have read as enemies — and warns loudly if a kept player appears in none of
the snapshots. The fixture now names identities exactly as the server does, with
entity numbers that differ from player numbers, and ten tests failed against the
old extractor before the fix.

**The trainer never exited.** vite-node keeps a filesystem watcher open for the
life of the process, so a finished run — weights saved, metadata written — sat
there until killed. Every other long-running CLI here exits explicitly for this
reason. Nobody had noticed because the first bug always ended the run early with
"No training frames": one bug was hiding the other.

**Trained weights could not reach a bot.** A bot looked for its weights in
`<models>/<difficulty>`, and was meant to fall back to `<models>` itself, which is
where demo training writes them. The fallback ran only if loading *rejected*, and
loading never rejects — it logs "using state machine" and resolves. So a bot
pointed at demo-trained weights looked in `<models>/medium`, found nothing, and
played the state machine. TF-2's test checked that the directory reached the bot,
not that anything was found in it. `resolveModelDir` now picks the difficulty's
own weights when self-play left some and the base set otherwise, and
`loadModels` says whether it loaded anything.

**After the fixes, on real data.** Extraction with line of sight traced against
the real map is fast — about six seconds for a 2,800-frame match with its BSP
load. `demo:record` gained `--models`, and two bots loaded both trained heads and
played a full match with no inference errors: record, train, load, play, the loop
closed. A two-match run split by match, stopped early on both heads (19 and 11 of
60 epochs) and printed the per-output report, which said, correctly, that nothing
was learned: every output no better than a fixed answer.

**And a fact about the data.** Neither 45-second duel on wdm12 contained a shot:
no fire in any command, no damage, the one kill a self-kill. Two bots on a large
map spend that long collecting items. A self-play or bot-demo dataset needs longer
matches or a smaller map before its combat head has anything to learn, and the
report is what makes that visible rather than a loss that looks fine.

### 2026-09-23 — TF-11 done: three frames, built one way

The network now sees the last three frames, oldest first, instead of one. A
single vector is a still; whether a player is starting a strafe-jump or ending
one is invisible in it and plain in three.

**Before stacking anything, the vectors had to be built the same way on both
sides, and they were not.** There were three copies of the input-building code —
the demo extractor, the self-play episode recorder and `HybridBrain` — and each
disagreed with the others:

- The extractor had no map, so the distances to the nearest health and armour
  (features 22–23) were `1`, "far", in every training frame. A bot in a match
  fed real distances. The network would have been handed values it had never
  seen, on exactly the features that say where to go next.
- The extractor aimed the combat vector at the *nearest* enemy; the brain at the
  first one in *line of sight*. A demo frame is a full server-side snapshot, so
  the nearest enemy is often someone behind a wall the person never saw — the
  aim labels described them tracking one player while the inputs described
  another.
- The self-play recorder used the map for tactical and the nearest enemy for
  combat: a third combination, matching neither.

All three now call one function, `buildModelInputs` in `ModelInputs.ts`. The
extractor loads each demo's map through the same `createBotVision` the bot
server uses, once per map, and gives every player their own `fork()` of it as
the server gives every bot — the line-of-sight cache is keyed by the target, so
a shared one would answer one player's question with another's view. A map that
will not load is reported and its matches read blind, which is still consistent
with a blind bot, just weaker.

**The death gap, again, at inference this time.** A bot's `decide()` is never
called while it is dead, so nothing tells the brain a death happened: the next
call is the respawn, and a naive history would stack it on top of the last
frames before dying — the same bug as the training-side gap, on the other side.
`FeatureHistory` applies the tick-gap rule itself, and training and the brain
both use it, with the same constant.

**The test this all rests on.** `TrainInferenceParity.test.ts` walks a
`HybridBrain` through the same recorded match the training pipeline reads,
snapshot by snapshot, skipping the dead frames as a bot would, and compares the
stack it would feed each network with the training input for that frame. Eight
living frames, both heads, identical. Given a history whose gap rule never
fires, it fails at exactly tick 126 — the respawn.

Old weights are refused: the metadata records the stacked width and the depth,
and the brain now also checks the width a loaded model actually declares, so
weights without metadata cannot slip through and then throw on every decision.

**Cost, as TF-8 predicted.** Tripling the input width changed nothing measurable
— 0.47 ms a decision against 0.52 ms before — because the cost is the call, not
the arithmetic. Weights went from 4 to 9 KiB a bot.

### 2026-09-23 — TF-8 done: 0.52 ms a decision, and the reason is not the maths

`npm run bot:bench` measures the overlay against a synthetic fight state, so the
number is the difference training makes to a decision and not a whole bot's
frame — there is no BSP, vision raycast or navigation in it, and those costs are
the state machine's either way.

On this machine, native backend (`tensorflow`), hard difficulty, eight bots:

| | |
| --- | --- |
| Network per decision | **0.52 ms** |
| State machine alone, same state | 0.004 ms |
| Weights in memory | 4.2 KiB per bot, 128 tensors for eight |
| Eight bots, 20 Hz snapshots | 4.2 ms of a 50 ms interval — 8% |
| Eight bots, 30 Hz snapshots | 4.2 ms of a 33 ms interval — 13% |
| Eight bots, 60 Hz snapshots | 4.2 ms of a 17 ms interval — 25% |

A bot decides when a snapshot arrives, not every tick: the 125 Hz input loop
re-sends the last decision. The first draft of the bench reported the cost as a
share of a 125 Hz tick and made it look twice as bad as it is; the share that
matters is of a snapshot interval, on one thread, because the whole fleet lives
in one process.

**The interesting part is the ratio.** These networks are tiny — 16 and 12 hidden
units — so half a millisecond is not arithmetic. It is the round trip: building a
tensor, calling predict, reading the result back synchronously, twice per
decision. Eight bots in one process each pay that separately, which is why
batching the fleet into one call is now TF-13 and is worth roughly the whole cost.
It also changes what frame stacking costs: widening the input vector will barely
move a number dominated by call overhead.

Affordable today at 20–30 Hz. Worth fixing before a server runs more than eight.

### 2026-09-23 — TF-6 done: a number that can say "learned nothing"

Training ran a fixed number of epochs and printed one mean-squared loss per
head. Both halves of that are misleading. It now stops when the held-out loss
stops improving — `--patience`, five epochs by default, and only when there is a
held-out match to watch, since stopping on the training loss would just be
stopping when it had finished memorising.

And the loss is reported per output against a floor. The floor is the error of
the best answer that ignores the input entirely, which for mean absolute error is
the column's median — not its mean, because for an output that is on one frame in
ten "never" beats "a tenth", and scoring against the weaker constant would
flatter a network that learned nothing. That is not a hypothetical: three buttons
and a weapon switch are all rare, and a network answering "no" to all of them
scores a respectable 0.1 while being useless. Each line now says `error / floor`
and whether the output was learned at all.

The floor was wrong in the first draft — mean rather than median — and the test
written for the rare-output case caught it immediately, which is the argument for
writing that test before believing the metric.

TF.js has no callback for restoring the best weights, so patience is the whole of
the protection: a stopped run keeps the last epoch's weights, not the best ones.
Worth knowing before tuning it down to 1.

### 2026-09-23 — TF-9 done: the pipeline has a page

`docs/manual/tools/bot-training.md` in the game submodule, beside the bot server
page, which had a Training Pipeline section describing a scheme that no longer
exists — rewards updating weights, no mention of where a human comes into it. The
new page follows one chain: a match records itself, a directory of recordings is
a corpus, labels are what the person did, weights carry their provenance, and a
bot in a room inherits the directory they live in. It states what each output is
answerable from, why runs and time gaps matter, and what the thing still cannot
do.

Writing it turned up a flag that lied. `--lr` was parsed, stored in the trainer
config, and then never read: both models were compiled with a hard-coded
`adam(0.001)`, so every run anyone tuned had the same step size as every other.
The rate is now the caller's, defaulting to the same 0.001, on both the demo and
self-play paths. Documenting a pipeline is a good way to find the parts of it
that were never wired up.

### 2026-09-23 — TF-5 done: every output is something a person pressed

The tactical head had eight outputs and three of them were unanswerable. FIGHT,
RETREAT and HUNT were derived from behaviour — firing meant fighting, backing
away hurt meant retreating — because a player never emits a mode. Two of those
three were then never read at inference at all, and the third overrode the state
machine's decision on the strength of "hurt and walking backwards". The head is
now five outputs wide: sprint, slide, jump, switch, slot. Which mode to be in
stays the state machine's call, and sharpening it belongs to self-play, where
the bot knows its own mode and does not have to be told.

**A weapon output meant two different things.** The label encoded the slot as
`slot / 9`; inference decoded it as `floor(output × inventory size)`. A person
pressing slot 2 was labelled 0.22, which with four weapons in hand decoded to
slot 1 — and the mapping moved every time the bot picked something up, so the
same number meant a different weapon from one moment to the next. Nothing could
learn that. There is now one encode/decode pair, inverses of each other, and the
pipeline test round-trips every slot.

**Self-play was still training the old way.** `BotTrainer` — the live
`bot:train` path, no demos involved — was still building eight-wide targets from
`(reward + 1) / 2`, which would now simply be rejected by a five-output model.
It builds the same labels as the demo path, through the same builder, so an
output cannot come to mean one thing in self-play and another when cloning a
person. Reward enters where it belongs: as a sample weight, so the best frames
of a round pull hardest and the worst pull not at all, rather than being written
into the target as though the player had half-pressed a key. It also flattened
every bot's episode into one array before building labels — the run-boundary bug
again, still live there — and now hands over runs.

**The compatibility guard covers output widths too.** A width is what fixes the
meaning of an index, so weights that predict eight numbers read through a
five-output map are not a little wrong: index 0 is a different question. Older
metadata without the field is still accepted, since nothing trained exists yet.

### 2026-09-23 — TF-7 done: the pipeline has a test that plays a match

A scripted match is now recorded to a real `.shagdemo` and read back through
the corpus builder, and the labels that come out the far end are checked against
the script. The body in the fixture never moves — zero velocity in every
snapshot — so any label claiming the player walked, sprinted or jumped can only
have come from a recorded command. Both boundary bugs found by reading fail this
test: the death-gap flick saturates to 1 instead of 0.5, and a cross-player
label shows up as a turn nobody made. Verified by breaking each fix in turn and
watching the assertion catch it.

A second test does one real fit on two recorded matches, because tensor widths
and `validationData` are only proved by TensorFlow accepting them.

Writing it turned up three more defects, all of the same family — something
that is true between two frames being read as something a person did:

**A weapon carried through silence looked like a switch.** On a frame with no
command the action was built with slot 0, so the next real command read as a
deliberate weapon change, and the slot-identity label read zero for the whole
idle stretch. The slot a player was last seen holding is now carried across
those frames. Pressing nothing is not the same as holding nothing.

**The held-out matches were built and then thrown away.** The trainer passed
Keras a `validationSplit`, which slices the tail off the *training* tensor frame
by frame — the exact leak the match-level split exists to prevent, since frames
seconds apart in one match are nearly the same frame. Meanwhile `corpus.valid`
sat unused. The held-out matches are now passed as `validationData`, so the
number printed after a run is measured on a match the network has never seen.

**The model's provenance counted runs as frames.** `corpus.train.length` is the
number of runs, not frames, and it was written into `metadata.json` as
`trainFrames`. A model trained on forty thousand frames recorded that it had
seen four.

And one in the recorder, found because the fixture writes two demos in a row:
the filename is accurate to a second, so two matches finishing inside the same
one — a lobby starting two rooms at once — silently overwrote the first
recording. It now takes the next free name.

### 2026-09-23 — second review round: the same bug one level deeper

Asked whether one review was enough. It was not, and the reason is worth
keeping: the first round read the code written this week, so the second went
looking underneath it, at the older parts that feed it.

**A run has holes in it.** The extractor skips every frame where a player is
dead or missing from the roster, so a run jumps from the moment of death to the
moment of respawn — hundreds of ticks — while the array makes those two frames
look adjacent. The turn label across that jump is a flick made while staring at
a respawn screen, and the weapon label is a loadout mistaken for a switch. This
is the *same* class as the boundary bug found in the first round, one level
down: the first fix stopped labels crossing between players, this one stops
them crossing a gap in time. `adjacentOrNothing` requires frames to be within
`MAX_LABEL_GAP_TICKS`, which is roomy for real adjacency at any snapshot rate
and far below a respawn delay.

**Nothing checked that a feature was a number.** A single NaN anywhere in a
training tensor turns the loss to NaN and takes the weights with it, silently
and unrecoverably. Frames are now dropped if any feature or label is not
finite, and the count is reported — alongside frames dropped for the wrong
feature width, which were being discarded silently, the way a training set
quietly becomes a tenth of what the operator believes it is.

**Checked and sound, for the record:** reward normalisation guards its
divide-by-zero; `BotInputNormalizer` clamps every feature and guards its one
risky `atan2`; the death-transition bookkeeping in the extractor updates its
previous-health correctly on both paths.

**The stopping rule from here:** review again when the code changes shape, not
on a schedule. The next round belongs after TF-5 and TF-11, which both change
what a label means.

### 2026-09-23 — data-flow review: two bugs, both mine, both invisible to play

Reading the chain end to end — `handleInput` → recorder → file → reader →
extractor → corpus → targets → `fit` — rather than testing the pieces again.
Each part was right on its own; both defects lived in what one part assumed
about another, and neither would have surfaced in a playtest. A bot trained on
subtly wrong labels just plays subtly badly, and nobody can tell you why.

**A run is one player in one match, and a turn is a difference.** TF-4 built
each target from the frame and *the previous element of the array*, and the
array was every player of every match concatenated. At each seam the "previous
frame" belonged to somebody else, so the label claimed a flick nobody made and
a weapon switch nobody performed — once per player per match, silently. The
corpus now keeps runs apart all the way through the split, `buildRunPairs`
builds labels inside a run, and the first frame of every run gets a neutral
turn because it genuinely has no predecessor. A test pins what the old shape
would have produced.

**On a version-3 demo, no command means no input.** TF-1 left the old velocity
inference as the fallback for a frame with no recorded command — reasonable for
an old recording, wrong for a new one, where silence is information: the player
sent nothing, so they pressed nothing. As written, a falling or sliding player
would have been labelled as holding forward. `chooseAction` now decides by
format version: recorded command, else nothing on a v3 demo, else the guess on
an older one.

**Also noticed, and left alone:** the filter on feature width used to run before
pairing, so a dropped frame made its neighbour's delta span a gap. Pairing now
takes the previous frame before filtering.

### 2026-09-23 — TF-4 done: the label is what the person did

`src/bot/CloningTargets.ts` replaces the reward-scaled targets. Every label now
comes from the recorded action:

| Output | Label |
| --- | --- |
| Sprint, crouch, jump | The button, held or not |
| Weapon switch, slot | Whether the slot changed from the previous frame, and which |
| Fire, alt-fire | The button |
| Aim yaw, aim pitch | **The turn the person made between frames** |
| Dodge left/right | The *wish* direction they gave |

The aim labels are the ones worth the trouble. View angles have been in every
demo since the format existed, they are the one signal in this pipeline that
was never a guess, and the previous scheme left both outputs at 0.5 on every
single frame. Strafe labels come from the recorded wish direction rather than
velocity, which in an air-strafe points somewhere the player never pressed.

**Still honest about the weak spot.** The three mode outputs cannot be observed
— nobody presses "hunt" — so they are derived: firing is fighting, backing away
hurt is retreating, neither is hunting. They are proxies, marked as proxies in
the source, and TF-5 takes them out of the cloning objective and leaves modes
to self-play, where the bot knows its own mode because it chose it.

The aim encoding is a sigmoid with 0.5 as "no turn" and a radian per frame as
the edge, which is the existing head's shape rather than a good one. TF-12
replaces it with a linear head; until then the constant is named and explained
rather than buried.

Nine tests cover each mapping, including the case the old scheme got wrong: a
neutral reward no longer erases what the human did.

### 2026-09-23 — TF-10 done: matches accumulate

`--demo` now takes a **directory** as readily as a file, and reads it as one
corpus: every `.shagdemo` in it, matches already counted skipped by match id, a
demo that cannot be read skipped with a reason rather than failing the run.

**The validation split is by match, not by frame**, and that is the part worth
keeping. Frames inside one match are seconds apart, same player, same map — a
random frame split puts the answer on both sides and reports a number that
means nothing. Whole matches go one way or the other, the split prefers holding
back the smaller ones, and it undershoots the requested share rather than
overshooting it. A test caught that last rule getting it wrong: asking for 10%
of three matches held back half the corpus, because the loop kept adding until
it passed the target instead of stopping before it.

With one match there is no validation, and the trainer says so rather than
printing a training loss that only proves memorisation. Where there is
validation, the loss line reports held-out loss beside it.

**Weights now carry their provenance.** `metadata.json` beside the models
records the feature vector sizes, when they were trained, on how many matches
and frames, whether bots were included, and the match ids — so a later run can
skip what it already counted. `HybridBrain.loadModels` checks it and **refuses
weights built for a different feature vector**, which until now loaded happily
and read nonsense, because a dense layer accepts any vector of the right
length.

### 2026-09-23 — TF-1 done: demos record what a person did

Format version 3. Each frame now carries, after its snapshot, the commands the
server applied over the interval that frame covers: buttons, view angles, wish
direction and weapon slot, per player.

**Where it is taken.** `GameServer.handleInput` hands the recorder the
*sanitised* command at the moment it is accepted into the input queue — the
same value the simulation is about to apply, after anti-warp and clamping. Not
what the client claimed; what the server did.

**How several commands become one frame.** Commands arrive at tick rate and
frames are written at snapshot rate, so `aggregateCommand` folds them: buttons
are OR-ed, so a jump pressed between two snapshots survives; the analogue
fields keep the value they ended on; and the record says how many commands it
covers.

**What reads it.** `DemoReader` exposes `frame.inputs`, empty for older
recordings. `DemoTrainingExtractor` prefers a recorded command when the frame
has one and falls back to the old inference when it does not, so a version-2
demo still yields something while a version-3 demo yields the truth.

The shared encoding lives in `src/shared/demo/DemoInputs.ts` so the writer and
the reader cannot drift apart, and is round-tripped end to end in the
recorder's own test — record two commands, flush a frame, read the file back,
and check the fold.

### 2026-09-23 — TF-2 and TF-3 done

**TF-2 — trained models can now reach a bot in a match.** `BotServer` takes a
`modelDir` and every bot it spawns inherits it unless the request names another
one, so a bot added from a room gets whatever the server was started with.
`bot-server.ts` passes `--models` into the server itself rather than only into
the bots it spawns at startup.

The audit under-reported this one: `addLobbyBot` also dropped `modelDir` when
constructing the `BotLobbyClient`, so even `--models --lobby` lost it on the
way. Both paths carry it now. Four tests.

**TF-3 — training learns from people.** `selectPlayers()` keeps only players
with a verified `accountId`, which comes from a lobby seat ticket that only a
person holds. Extraction reports how many players it kept and how many it
dropped. `--include-bots` takes everyone, for self-play datasets where our own
bot's behaviour is the point.

A consequence worth stating: **version-1 demos are now unusable for training**,
because nothing in them can be proven human. That is correct rather than
unfortunate — a v1 demo of a bot match is exactly the data that would teach the
network to imitate the state machine.

### 2026-09-23 — audited

Read `DemoRecorder`, `DemoReader`, `DemoTrainingExtractor`,
`BotInputNormalizer`, `HybridBrain`, `TFBackend`, `BotTrainer`, `bot-train`,
`BotClient` and `BotServer` against the goal above. Eight findings, three of
them blockers. Nothing changed yet beyond one documentation correction: the
demo page claimed a demo's per-tick contents included "all player inputs", and
it records state.
