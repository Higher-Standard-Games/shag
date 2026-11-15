# Bot strafe jumping

How people strafe-jump in Washoi, what the movement code rewards, and how far
the bots are from it. Measured 2026-11-15 on fps branch `bot/snd-team`.

## The movement code

Washoi's air movement (`simulation/MovementProfile.ts`, `simulation/Acceleration.ts`)
uses only the world wish direction and the movement keys held; the view does
not enter it. The keys choose one of three air modes:

| Keys in the air | Mode | What it does |
| --- | --- | --- |
| Forward alone | `airAccelerateForward` | Pulls the velocity round toward the wish at about 10 u/s a tick, with a small bunny gain. Lossless only when the wish leads the velocity by a few degrees. |
| Forward and a side key | `normalAirAccelerate` | Adds up to 2.56 u/s a tick (air acceleration 1 × max speed 320 / 125 Hz, falling off past 400 u/s) toward the wish, until the speed along the wish reaches 320. |
| A side key alone | `strafeBunnyAccelerate` | Adds up to 12 u/s a tick, but only until the speed along the wish reaches 30 (`maxAirSpeed`), so the wish has to be nearly square to the velocity. |

Holding jump hops again on the tick of landing (autohop). Each tick on the
ground loses about 5% of the speed to friction (6 × 1/125).

## What gains most

A flat-ground harness drove `MovementProfile.simulate` with each policy for
6 seconds from a standstill (scripts kept outside the repository):

| Policy | Speed after 6 s | Distance |
| --- | --- | --- |
| Sprint | 400 | 2,376 |
| Sprint, jump held | 547 | 2,540 |
| Side key alone at the A/D formula angle, jump held | 648 | 2,338 (the path curves) |
| The same with 6 ticks on the ground each landing | 329 | 911 |
| Forward and side, wish at acos((320 − step) / speed) off the velocity | 868 | 3,979 |

So the best straight-line gain is forward and a side key, the wish at the
angle where the whole acceleration step is still added (about 37° at 400 u/s,
58° at 600), with jump held through every landing. Over 4,000 units on a
straight line that is 6.0 s against 10.1 s sprinting.

Turning the velocity 30° in the air:

| Method | 450 u/s | 600 u/s | 800 u/s |
| --- | --- | --- | --- |
| Forward alone, wish 10° ahead | 0.19 s, −3% | 0.26 s, −3% | 0.34 s, −3% |
| Forward alone, wish 60° ahead | 0.20 s, −21% | 0.26 s, −22% | 0.34 s, −21% |
| A side key alone, wish square to the velocity | 0.19 s, ±0 | 0.43 s, ±0 | 0.65 s, ±0 |

## People and bots

`bot:demo-motion` over 14 production duel demos (2026-11-01 to 11-14), and
over duels the bots played against each other (`bot:motion --keep-demo`, dm2, Insane):

| Measure | People | Bots before | Bots after |
| --- | --- | --- | --- |
| Running over 450 u/s | 34% | 15% | 16% |
| Running over 600 u/s | 11% | 3% | 3% |
| Running airborne | 54% | 33% | 46% |
| Take-offs chained from a landing | 40% | 38% | 50% |
| Ground before a chained hop (median) | 32 ms | 80 ms | 48 ms |
| Speed gained per chained hop (median) | +12 | +1 | −20 |
| In the air at speed: forward and side | 50% | 19% | 33% |
| In the air at speed: side alone | 15% | 24% | 19% |
| In the air at speed: forward alone | 34% | 55% | 45% |

People strafe-jump mostly with forward and a side key, chain off the
landing within two to four ticks, and gain about 12 u/s a hop.

## What the bots do now

`RouteStrafeJumpSequence` on `bot/snd-team`:

- accelerates with forward and a side key at `strafeGainAngle(speed)`, and
  turns with a side key alone at `sideTurnAngle(speed)` when the heading is
  more than 20° off the route; forward alone, at most 10° ahead, holds the
  speed at the skill's target and lines up the end of a stretch;
- keeps jump held, and on each landing asks the brain for the route ahead
  (`routeStrafeNext`, which first brings the path up to date) and hops again;
- sets the wish with `moveYaw`, so the view follows the route smoothly while
  the keys change side.

The brain starts a chain from 320 u/s on a route line whose next 640 units turn
at most 120° in all, with at least 240 left, or on a straight lane 96 wide.

## Why bots still fall short

In dm2 duels the bots navigate half the time, and are on the ground on a walk
step at 320 u/s or more in 22% of all decisions; strafe chains run in 2%. Of
the starts turned down for want of route: 729 had no route line and no straight
lane, 670 had a route line ending within 240 units (a learned jump, a teleporter
or an item next), 59 turned too much, and 500 were allowed. A path on dm2 is
mostly short walk stretches between learned jumps, so a chain rarely has room.
Most of the bots' air time is still their other jumps (learned routes, jump
steps, fights), which is why forward-alone air time stays high and the gain
per chained hop is negative in the measure above.

Next steps, in order of expected effect:

1. Carry a chain across a line's end: hop into a learned jump's run-up and
   through item pickups instead of handing back.
2. Strafe-jump in fights and chases, where people spend much of their air time.
3. Hold jump on the landing of other jumps when the route ahead is walkable.
