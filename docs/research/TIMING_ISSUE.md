# Timing Issue Investigation

Date: 2026-05-31

## Resolution (2026-05-31) — FIXED

Root cause **confirmed** in `GameServer.scheduleNextTick()`: it was called with
the current tick's *start* time, then measured `elapsed = now - lastTickTime`
*after* `tick()` ran — so `elapsed` was the tick's work duration (~1ms), not the
inter-tick interval. The drift math then scheduled `tickMs - drift = 8 - (1-8) =
15ms` after tick end → **~16ms start-to-start at 125Hz = ~62.5Hz = half
real-time**. Match timer (`_timeRemaining -= 1/125` per tick) and all
tick-count timers (respawn/weapon/projectile/pickup) ran ~2× slow. Matches the
"1 game second ≈ 2 real seconds" report.

**Fix** (`src/games/fps/server/GameServer.ts`):
- Replaced the scheduler with an **absolute wall-clock deadline** (`nextTickAt`):
  each fire runs every tick whose deadline has passed (bounded catch-up, cap 5,
  resync on real stalls to avoid a spiral of death), then advances `nextTickAt`
  by `tickMs`. The sim now tracks real time regardless of setTimeout jitter or
  tick work time.
- Added a **tick-rate diagnostic** logged every ~5s: actual Hz vs target, ticks,
  wall seconds, max tick-work ms.

**Regression:** `src/games/fps/server/__tests__/GameServerTickRate.test.ts` runs
the real scheduler over ~480ms wall-clock (no-op transport, no port) and asserts
~125Hz, not ~62.5Hz.

**Verification:** full suite 1078/1078; `server:tick` + `server:fuzz` determinism
pass; `test:simulation` passes. (`server:tick`/`fuzz` exercise `Simulation.tick()`
math, which was never wrong — the bug was purely the wall-clock scheduler.)

The secondary risks below remain accurate notes (subsystem multi-rate has no
catch-up loop; only relevant if `--tickrate` < a subsystem's rate — out of scope
here since both default to 125Hz, and GameServer-level catch-up now drives
`Simulation.tick()` at the correct rate).

---


## Problem Statement

Observed symptom: the internal game timer does not feel like real time. A displayed or simulated game second appears to take roughly 2-3 real seconds.

Investigation scope:

- Dedicated FPS server timing.
- Server simulation and subsystem timing.
- Match timers, respawn timers, pickups, weapons, projectiles, and snapshot cadence.
- Client FPS game/input timing where it interacts with server time.

No runtime code changes were made for this investigation.

## Short Answer

The most likely primary cause is the dedicated server tick scheduler in `src/games/fps/server/GameServer.ts`.

The server is configured for 125 Hz, which means one tick every 8 ms. However, `scheduleNextTick()` schedules the next callback using the current tick start time as the previous timestamp. Because scheduling is done after the tick has already run, the formula effectively targets about 16 ms between tick starts instead of 8 ms.

Practical effect: a nominal 125 Hz server runs close to 62.5 Hz under normal conditions. Anything that subtracts `1 / 125` seconds per server tick, or uses `tickNum + seconds * 125`, will run at about half real-time speed.

This matches the user's report closely: a "1 second" internal timer can feel like about 2 real seconds. Additional load or timer jitter can push it toward 2-3 seconds.

## Key Evidence

### 1. Dedicated Server Defaults To 125 Hz

`src/cli/headless-netserver-v2.ts` defaults to:

```ts
tickRate: 125,
snapshotRate: 60,
```

The manual also documents 125 Hz ticks and 8 ms per tick in `docs/manual/guides/networking.md`.

### 2. GameServer Constructs An 8 ms Simulation

`src/games/fps/server/GameServer.ts` creates the server simulation with:

```ts
this.simulation = new Simulation({
  tickMs: 1000 / config.tickRate,
});
```

With the default `config.tickRate = 125`, `tickMs` is 8 ms.

### 3. GameServer Tick Scheduler Doubles The Intended Interval

Relevant code in `GameServer.scheduleNextTick()`:

```ts
private scheduleNextTick(lastTickTime: number): void {
  const tickMs = 1000 / this.config.tickRate;
  const now = performance.now();
  const elapsed = now - lastTickTime;
  const drift = elapsed - tickMs;
  const nextDelay = Math.max(1, Math.min(tickMs * 2, tickMs - drift));

  this.tickTimer = setTimeout(() => {
    const tickStart = performance.now();
    this.tick();
    this.scheduleNextTick(tickStart);
  }, nextDelay);
}
```

At startup, `server.start()` calls:

```ts
this.scheduleNextTick(performance.now());
```

For a 125 Hz server:

- `tickMs = 8`
- initial `elapsed` is near `0`
- `drift = 0 - 8 = -8`
- `nextDelay = tickMs - drift = 8 - (-8) = 16`

So the first tick is scheduled after about 16 ms, not 8 ms.

After each tick, `scheduleNextTick(tickStart)` is called. Suppose the tick itself takes 1 ms:

- `elapsed = now - tickStart = 1`
- `drift = 1 - 8 = -7`
- `nextDelay = 8 - (-7) = 15`
- next tick start is roughly `1 + 15 = 16 ms` after the previous tick start

This means the scheduler does not compensate toward an 8 ms start-to-start cadence. It repeatedly schedules toward about `2 * tickMs`.

Expected rate: 125 ticks/s.

Likely actual rate: about 62.5 ticks/s before additional load.

### 4. Match Timer Uses Fixed dt Per Tick

`GameServer.tick()` computes:

```ts
const dt = 1 / this.config.tickRate;
```

and passes it into:

```ts
this.gametypeController.postTick(state, dt, this.simulation.currentTick);
```

`src/games/fps/server/gametypes/MatchState.ts` subtracts this `dt` each tick:

```ts
this._timeRemaining -= dt;
```

If only ~62.5 ticks happen per wall second, the match timer only subtracts:

```text
62.5 * (1 / 125) = 0.5 seconds per real second
```

So a displayed game second takes about 2 real seconds.

### 5. Tick-Based Timers Inherit The Same Slowdown

Several server systems convert seconds to ticks assuming 125 real ticks per second:

- `GametypeController`: respawn windows use `config.respawnDelay * 125`.
- `PickupSystem`: pickup respawn times use `seconds * TICK_RATE`, where `TICK_RATE = 125`.
- `WeaponSystem`: fire intervals, charge timing, ADS timing, reload timing, and delayed melee checks use `125`.
- `DroppedWeaponSystem`: despawn and ballistic physics assume 125 Hz.
- `FPSMovementSubsystem`: knockback drag constants are documented as tick durations at 125 Hz.

If the wall-clock tick rate is actually about 62.5 Hz, all tick-count timers are about 2x slow in real time.

## Secondary Timing Risks

### Subsystem Tick Rates Are Hard-Coded To 125

Most FPS server subsystems set `tickRate: 125` internally. Examples:

- `FPSMovementSubsystem`
- `PickupSystem`
- `WeaponSystem`
- `ProjectileSystem`
- `DroppedWeaponSystem`
- `CombatSystem`

The central `Simulation` supports subsystem rates, but the implementation only runs a multi-rate subsystem once when its accumulator crosses the threshold:

```ts
if (acc >= subDt) {
  subsystem.update(this.state, subDt, tickNum);
  this.tickAccumulators.set(subsystem, acc - subDt);
}
```

There is no `while (acc >= subDt)` catch-up loop.

With the current default, base tick and subsystem tick rate both intend to be 125 Hz, so this is not the main bug. But if `--tickrate` is changed below 125, 125 Hz subsystems cannot catch up. They will run at most once per server tick while receiving `dt = 1 / 125`, producing additional slow simulation behavior.

### Snapshot Cadence Is Also Slowed

Snapshots are sent every:

```ts
Math.round(config.tickRate / snapshotRate)
```

At defaults, `125 / 60` rounds to 2. If the server actually ticks around 62.5 Hz, snapshots are sent around 31.25 Hz, not 60 Hz.

The snapshot timestamp itself is real wall-clock time (`Date.now()` in `BinaryProtocol.encodeSnapshot()`), so interpolation timing uses real timestamps, but authoritative state updates arrive less often than expected.

### Client Input Timing Looks Mostly Correct In The FPSController Path

`FPSController.update()` uses a `commandAccumulator` and sends commands at 125 Hz:

```ts
this.commandAccumulator += deltaTime;
while (this.commandAccumulator >= 1 / 125) {
  this.gameManager.sendInput(...);
  this.commandAccumulator -= 1 / 125;
}
```

This is good. It prevents the older "one prediction per render frame" bug.

However, `Game.sendInput()` and `V2NetworkClient.processInput()` still process exactly one fixed 8 ms prediction per call. Any direct caller that invokes `sendInput()` at render frame rate, test rate, or irregular cadence instead of through the FPSController accumulator can create slow or fast client-side prediction.

### Local Game Mode Defaults To 20 Hz

`Game.initializeLocal()` defaults to:

```ts
const tickRate = config.tickRate ?? 20;
```

`LocalGameHost` only advances when commands are sent and uses a fixed-timestep accumulator. This path appears older and is not the dedicated server path, but it is another source of inconsistent timing if local mode is used for gameplay validation.

## Systems Affected By The Primary Server Scheduler Bug

High confidence affected:

- HUD match timer, because it displays `match_state.timeRemaining` from server snapshots.
- Warmup, countdown, active match limit, and post-game duration.
- Respawn min/max windows.
- Pickup first spawn, respawn, and mega-health decay cadence.
- Weapon fire rate, charge time, ADS gating, reload timing, and delayed melee.
- Projectile lifetime, gravity integration, and movement speed over wall time.
- Dropped weapon despawn and ballistic movement.
- Snapshot rate and demo frame rate.

Lower confidence / indirect effects:

- Client reconciliation frequency and perceived movement smoothness, due to slower snapshot cadence.
- Bot logic comments and tick assumptions, especially files that mention 60 Hz while server docs say 125 Hz.

## Recommended Fix Direction

### Fix The Dedicated Server Scheduler First

Use an absolute next-tick deadline or an accumulator. The scheduler should target 8 ms start-to-start at 125 Hz, not 16 ms.

One direction:

```ts
private nextTickAt = 0;

async start(): Promise<void> {
  ...
  this.nextTickAt = performance.now() + 1000 / this.config.tickRate;
  this.scheduleNextTick();
}

private scheduleNextTick(): void {
  if (!this.running) return;
  const delay = Math.max(0, this.nextTickAt - performance.now());
  this.tickTimer = setTimeout(() => {
    this.tick();
    this.nextTickAt += 1000 / this.config.tickRate;
    this.scheduleNextTick();
  }, delay);
}
```

A more robust version should include:

- Catch-up for short stalls.
- A max catch-up cap to avoid spiral of death.
- Tick-rate diagnostics logging actual ticks per wall second.
- No silent loss of elapsed game time under normal load.

### Add A Runtime Tick Rate Diagnostic

The server should log actual tick rate using wall-clock time, for example every 2-5 seconds:

- current tick
- ticks elapsed
- wall seconds elapsed
- actual Hz
- average tick work ms
- max tick work ms

This would make the bug immediately visible.

### Replace Hard-Coded 125 Constants With Config Where Practical

Many systems use literal `125` or local `TICK_RATE = 125`. If server tick rate remains fixed by design, document that it is fixed and reject unsupported `--tickrate` values. If configurable tick rate is intended, those constants need to flow from `GameServerConfig` or shared timing config.

### Add A Focused Regression

Add a test or CLI diagnostic that runs the real `GameServer` scheduler for wall-clock time and asserts the tick count is close to the configured rate. Existing `server:tick` only calls `Simulation.tick()` in a tight loop and does not validate the wall-clock server loop.

Example target:

- Start a minimal server at 125 Hz.
- Let it run for 2 seconds.
- Assert tick delta is roughly 250 ticks, allowing timer jitter.
- Fail if it is around 125 ticks.

## Verification Commands To Run After A Fix

Because this touches server timing and networking-sensitive code, run:

```bash
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
```

Also run a manual dedicated server smoke test and compare real wall time against HUD timer changes:

```bash
npm run net:server -- --map wdm2 --gametype duel
```

Expected after fix:

- 10 seconds of real time should reduce the match/countdown timer by about 10 seconds.
- Server logs should show actual tick rate close to 125 Hz.
- Snapshot rate should be close to configured snapshot rate.

## Open Questions

- Is `--tickrate` intended to be genuinely configurable, or should FPS server timing be fixed to 125 Hz?
- Are bots expected to reason in server ticks at 125 Hz or snapshot ticks at 60 Hz? Several bot comments still mention 60 Hz assumptions.
- Should match timers use fixed simulation time, wall-clock time, or fixed time with catch-up? For deterministic server gameplay, fixed simulation time is fine, but the scheduler must keep simulation time aligned with wall time.

## Validation Run During Investigation

Commands run:

```bash
npm run server:tick
npm run test:simulation
npm run test:physics
```

Results:

- `npm run server:tick` passed. Important caveat: it runs `Simulation.tick()` in a tight loop, so it validates deterministic simulation math but does not exercise `GameServer.scheduleNextTick()`.
- `npm run test:simulation` passed. It verified `FPSSimulation` initialization, player spawn, and a short gravity tick sequence.
- `npm run test:physics` started successfully but could not find `wdm7` BSP data, so the map-backed physics portion was not verified in this environment.

## Files Inspected

- `package.json`
- `docs/manual/guides/networking.md`
- `docs/manual/guides/headless-mode.md`
- `docs/manual/guides/movement-system.md`
- `src/cli/headless-netserver-v2.ts`
- `src/games/fps/server/GameServer.ts`
- `src/engine/server/core/Simulation.ts`
- `src/engine/server/core/Subsystem.ts`
- `src/games/fps/server/gametypes/MatchState.ts`
- `src/games/fps/server/gametypes/GametypeController.ts`
- `src/games/fps/server/systems/FPSMovementSubsystem.ts`
- `src/games/fps/server/systems/PickupSystem.ts`
- `src/games/fps/server/systems/WeaponSystem.ts`
- `src/games/fps/server/systems/ProjectileSystem.ts`
- `src/games/fps/server/systems/DroppedWeaponSystem.ts`
- `src/games/fps/server/SnapshotBroadcaster.ts`
- `src/games/fps/server/SnapshotBuilder.ts`
- `src/games/fps/client/MatchStateManager.ts`
- `src/games/fps/client/hud/widgets/Timer.ts`
- `src/engine/camera/controllers/FPSController.ts`
- `src/games/fps/Game.ts`
- `src/games/fps/client/V2NetworkClient.ts`
- `src/engine/network/client/hosts/NetworkGameHost.ts`
- `src/engine/network/client/hosts/LocalGameHost.ts`
- `src/engine/network/protocol/BinaryProtocol.ts`
- `src/bot/BotClient.ts`
