# Known Bugs

One entry, and it is old. Read the note on its status before acting on it.

## Unconfirmed: walljump collision/rendering desync

- **Reported**: 2025-03-03
- **Status as of 2026-09-22**: unverified in either direction. The report
  predates the v0.9.23 networking audit, and nobody has walljumped in
  multiplayer since to confirm or close it.
- **Reported behaviour**: after a walljump in multiplayer, the player's
  position sinks further into the map with each use. Collision still works but
  no longer matches the rendered position.
- **Reported cause**: client prediction of the walljump diverging from the
  server, with reconciliation and visual smoothing failing to pull it back, so
  the offset accumulates.

### What changed underneath it since

Read from the code on 2026-09-22, not from memory:

- Client and server run the same `MovementProfile` through `FPSSimulation`, so
  a walljump is not two implementations that can drift apart.
- Reconciliation was reworked in v0.9.23 and now has direct coverage in
  `src/games/fps/client/__tests__/V2NetworkClient.test.ts`: reconciling against
  the newest tick rather than the last to arrive, ignoring a stale snapshot
  that lands a frame late, suppressing a small correction but giving up after a
  bounded time, adopting a hard discontinuity immediately, and replaying a
  backlog only while it fits in the budget.
- Visual smoothing accumulates a reported correction debt rather than an
  unbounded offset.

None of that is proof the symptom is gone. It is a reason to re-test before
investigating: the mechanism the report blames is no longer the mechanism in
the code.

### What would settle it

Two clients on a dedicated server, one of them walljumping repeatedly, watching
whether rendered position and collision diverge. `cl_netgraph 2` during, and
the correction-debt figure the client reports, would say whether reconciliation
is the culprit if it recurs.

Files it would touch today: `src/games/fps/client/V2NetworkClient.ts`
(prediction and reconciliation), `src/games/fps/simulation/MovementProfile.ts`
(walljump rules — the 2025 report called this `FPSMovementProfile.ts`, which is
the imported alias, not the filename), and
`src/engine/camera/controllers/FPSController.ts` (visual smoothing).

---

Deeper investigation notes on older issues live in
`docs/research/KNOWN_BUGS.md`, which carries the same caution: it is a record
of what was believed at the time, not a current list.
