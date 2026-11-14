# Search & Destroy bots: team play

Started 2026-11-14 on `bot/snd-tactics`. Goal: bots good enough for a
single-player campaign of one person and four bots against five bots on the
launch maps `washoi_snd1`, `snd4` and `snd6`. Bots on the person's team play
around them; the five opponents are the challenge. Fighting stays as strong
as in Duel: every change here decides where a bot goes, with whom and when,
never how it aims or fights, and every head-to-head run reports kills per
death to show it.

The rule the mode was built on holds: the gametype gives orders as data
(`AgentDirective`), the bot brain carries out orders and knows nothing of
bombs. Team decisions live in the gametype (`SearchAndDestroy.ts`), which
sees the whole team; information the bots share travels as team chat, the
way it reaches a person.

## What was broken first

A 5-vs-5 Hard match on snd1 had 3 deaths in 7 minutes and no plant.

| Cause | Fix |
| --- | --- |
| The bomb maps' spawn points float up to 136 units over the floor; the nav graph used them as waypoints, and a bot under one never counted as there, so the carrier and its escort ran circles at spawn. | A spawn waypoint floating more than 64 units goes onto its floor (snd1 14 of 31, snd4 27/30, snd6 10/33; dm7 6, dm11 4). |
| A site's point floats too: a carrier sent there never arrived, and ran through the site too fast to plant. | Site orders point at a standing spot on the site's floor inside it. |
| The target site was re-chosen every tick as the site nearest the bomb, so it followed the carrier. | Chosen once a round. |
| The plant order was discounted for distance like an item: a site across the map lost to any pickup by the carrier (found with `bot:motion --trace`). | An order's route half cost grows with its priority. |

After these, plants per round in about seven minutes went from none (snd1)
and 2 of 5 (snd4) to 1 of 7, 5 of 6 and 6 of 7.

## Tools

- `BotOptions.trace` and `bot:motion --trace / --trace-out`: one record per
  decision (state, strategy, orders, goal and top candidates, path step,
  sequence, block reason, position, speed, crouch).
- `bot:ab --gametype snd`: team against team, arms change teams each match,
  rounds won attacking and defending, plants, round ends, kills per death.
  Arm option `"coach"`: `false`, or a list of the coach's parts to keep.
- `bot:lanes`: the ways into each site (`config/bot-lanes/<map>.json`).

## The coach

Parts, each switchable per team (`COACH_PARTS`):

- `lanes`: the carrier and two bots on the shortest lane, a pair on another,
  each group to its staging point; in when the carrier's group and one more
  are staged, 8 s after the carrier's group is, 25 s after the plan, or when
  an attacker falls.
- `cover`: after a carrier falls, one attacker fetches, two cover; the two
  nearest defenders guard the bomb.
- `defence`: an anchor a site; the others rotate to the carrier's site when
  a defender sees it (line of sight within 2,500 units); the split leans to
  the site attacked more; an armed bomb is retaken together from the defend
  lanes' staging points (go at two there or 14 s left).
- `memory`: the attack site by its plant record against this defence.
- `crossfire`: after a plant, attackers hold part way to each way in.

Outside the parts: callouts in team chat by place name, read back by the
team's bots; a person's site call; a person carrying is not staged.

## Measurements

12 matches of 300 s, 5 a side, Hard, coach (A) against no coach (B) unless
noted. Rounds won are by the arm attacking or defending in that round.

| Run | Rounds won attacking A–B | Defending A–B | Kills per death A–B | Plants |
| --- | --- | --- | --- | --- |
| snd1, first coach (2+2+1, wait for all, 35 s) | 6–13 | 16–12 | 1.05–0.96 | 0 of 47 |
| snd4, first coach | 5–11 | 13–11 | 0.97–1.03 | 18 of 40 |
| snd1, coach with defence, memory, crossfire, go at two groups / 25 s | 4–6 | 17–14 | 1.13–0.89 | 7 of 41 |
| snd4, full coach, attack 3 + 2 | 13–11 | 15–5 | 0.98–1.02 | 33 of 44 |
| snd4, defence and cover only | 11–17 | 11–10 | 0.80–1.26 | 34 of 49 |
| snd6, full coach, attack 3 + 2 | 14–30 | 3–4 | 0.67–1.49 | 46 of 51 |
| snd6, defence and cover only | 24–25 | 5–1 | 0.76–1.32 | 54 of 55 |

Counts mislead where one side's attacks end fast, because that side plays
more attack rounds; `bot:ab` now reports win rates by role. As rates:

| Run | Attacking, A / B | Defending, A / B |
| --- | --- | --- |
| snd4, full coach | 72% / 42% | 58% / 28% |
| snd4, defence and cover only | 39% / 61% | 39% / 48% |
| snd6, full coach | 78% / 91% | 9% / 22% |
| snd6, defence and cover only | 96% / 83% | 17% / 4% |

So on snd4 the whole coach wins both sides and its parts need each other;
on snd6 the defence helps but the lane attack hurts. snd6's two lanes per
site staged only 250–500 units apart: one way in split in two, costing time
on the most attacker-sided map. Lanes now need staging points 500 apart, and
an attack with one lane goes together without a plan (snd6 both sites; snd1
and snd4 keep two lanes a site). Defenders regroup about 900 units out on
their own lanes, away from where attackers stage: on snd6 the defend lanes'
staging points were the attackers' own.

The first coach lost attack rounds: waiting for the farthest lane gave the
defence time, and 18 of 47 snd1 rounds ran out. Splitting five into 2+2+1 also
gives up the numbers bots win fights with. The defence parts won rounds from
the start.

### Final, with lanes 500 apart and the regroup moved

| Run | Rounds won A–B | Attacking, A / B | Defending, A / B | Kills per death A–B | Plants |
| --- | --- | --- | --- | --- | --- |
| snd1 | 28–17 (matches 8–3) | 47% / 27% | 73% / 53% | 1.21–0.83 | 2 of 45 |
| snd6 | 23–30 (matches 5–6) | 92% / 97% | 3% / 8% | 0.77–1.30 | 47 of 53 |

With snd4's full-coach run above (72% / 42% attacking, 58% / 28% defending),
the coach wins both sides on snd1 and snd4 and is level on snd6. Kills per
death follow the rounds: on snd6 the side that defends more rounds dies more.

## Open

- snd6 is all but undefendable for bots on either side (attacks win 92–97%).
  The map's attack routes reach the sites in about 20 s; the round and fuse
  times, or a defence that holds forward of the sites, are the places to
  look.
- snd1 sees few plants (2 of 45 rounds): rounds are decided by fights or the
  clock. The attack there wins by killing, not planting.
- A person on the team is covered by tests and the rules (not grouped, not
  staged when carrying, site calls), not yet by a played match.
- Fakes, a lurker and callouts read for more than hunting are not built.
