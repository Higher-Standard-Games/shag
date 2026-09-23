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

## Work orders

Difficulty 1 (mechanical) to 5 (deep). Model: a suggestion for whoever picks it
up.

| WO | What | Depends on | Diff | Model | Status |
| --- | --- | --- | --- | --- | --- |
| TF-1 | Record inputs in demos: a v3 frame carrying the applied command per player per tick — buttons, view angles, weapon slot. The server already has them. Old demos are disposable, so v3 may break v2 rather than carry both | — | 3 | Opus 5 | todo |
| TF-2 | Close the model path: a default model directory on `BotServer` that control-spawned bots inherit, and a lobby that can ask for a tier | — | 2 | Sonnet 5 | todo |
| TF-3 | Keep humans, drop bots: filter extraction by verified `accountId`, and report how many frames each side contributed | — | 2 | Sonnet 5 | todo |
| TF-4 | Rebuild the labels as behaviour cloning: targets are what the human did, not the reward. Aim deltas included | TF-1, TF-3 | 4 | Opus 5 | todo |
| TF-5 | Reshape the heads so every output has a label a demo can supply, and move the mode heads to self-play or drop them | TF-4 | 4 | Opus 5 | todo |
| TF-6 | Train/validation split, early stopping, and a metric that means something on held-out frames | TF-4 | 3 | Sonnet 5 | todo |
| TF-7 | Tests: extractor on a fixture demo, shape contract between normalizer and models, target construction, and a training smoke run | TF-4 | 3 | Sonnet 5 | todo |
| TF-8 | Measure inference: per-decision cost with models loaded, eight bots, native and pure-JS backends | TF-2 | 2 | Haiku 4.5 | todo |
| TF-9 | Document the pipeline in the manual — there is no page for any of this today | TF-1…TF-5 | 2 | Sonnet 5 | todo |

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

### 2026-09-23 — audited

Read `DemoRecorder`, `DemoReader`, `DemoTrainingExtractor`,
`BotInputNormalizer`, `HybridBrain`, `TFBackend`, `BotTrainer`, `bot-train`,
`BotClient` and `BotServer` against the goal above. Eight findings, three of
them blockers. Nothing changed yet beyond one documentation correction: the
demo page claimed a demo's per-tick contents included "all player inputs", and
it records state.
