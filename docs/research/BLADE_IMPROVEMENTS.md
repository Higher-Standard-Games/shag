# Blade Improvements

Date: 2026-07-09
Status: implementation in progress, uncommitted for review

## Intent

The blade should be more than the fallback weapon. It is Washoi's unique default weapon, so it should read as a movement/combat tool: fast, visible, server-authoritative, and expressive without becoming a free escape button.

## Implemented This Pass

- Server-authoritative primary swing dash:
  - `WeaponDef.meleeDashDistance` is authored per weapon.
  - Blade primary fire currently uses `meleeDashDistance: 48`.
  - `WeaponSystem` queues the dash only when the server accepts a primary swing edge and refire cooldown passes.
  - `FPSMovementSubsystem` applies the queued dash on the next movement tick as a horizontal yaw-based displacement.
  - The dash is not knockback: it does not mark the player airborne, add vertical lift, or feed knockback air-drag.
  - BSP collision traces clamp the dash with player-sized bounds so the lunge does not intentionally push through world geometry.

- Remote third-person blade visibility fix:
  - Remote weapon attachment now distinguishes GLB weapons from legacy MD3-style weapon models.
  - GLB weapons use the authored `viewModel.scale` as their third-person visual scale source.
  - The blade was previously using `scale: 1.0`, which made it effectively invisible compared to MD3 weapons.

- Tests:
  - Added WeaponSystem coverage for queueing one blade dash per accepted swing.
  - Added FPSMovementSubsystem coverage for applying and collision-clamping queued melee dashes.

## Current Gameplay Tuning

- Dash distance: 48 units.
- Direction: horizontal facing/yaw direction only. Pitch is ignored so looking up or down never launches the player vertically.
- Timing: queued by WeaponSystem, applied by MovementSubsystem on the next 125 Hz server movement tick.
- Cooldown: inherits blade primary fire cadence (`fireRate: 2.0`, 500 ms between accepted swings).
- Damage timing: unchanged. The visual/dash happens immediately, while melee damage still respects `meleeDamageDelay` for the dodge window.

## Design Ideas For The Best Default Weapon

- Step-in slash: implemented. Gives the blade a tiny commitment and lets players close the last gap.
- Dash readability: add a subtle first-person/third-person slash trail tied to accepted server fire events. The dash should feel authored, not like net jitter.
- Air carry: future idea. Preserve a small amount of existing air momentum through a swing, but avoid adding vertical lift by default.
- Wall tap flourish: future idea. A blade swing near a wall could make a small spark/sound or micro-stall, but should not replace walljump movement.
- Clash/parry window: future idea. A perfectly timed blade primary could soften another blade hit or charged blade blast. Needs strong audio/visual tells.
- Charge identity: future idea. Make alt-fire charge visually obvious on remote players with blade glow intensity, so opponents can read the threat.
- Kill confirm reward: future idea. A blade frag could refund a small charge meter or play a unique trail burst. Avoid reset mechanics until duel balance is tested.
- Default weapon promise: the blade should always give a broke player agency: movement pressure, close-range burst, and a risky ranged charge.

## Validation Log

- `npx vitest run src/games/fps/server/systems/__tests__/WeaponSystem.test.ts src/games/fps/server/systems/__tests__/FPSMovementSubsystem.test.ts`
  - Pass: 2 files, 26 tests.
- `npm run test:simulation`
  - Pass.
- `npm run server:tick`
  - Pass, determinism matched.
- `npm run server:fuzz -- --ticks 1000`
  - Pass. Note: current script output still ran 10000 ticks.
- `npm run test:run`
  - Pass: 89 files, 1218 tests.
- `npm run build`
  - Sandbox attempt failed with Vite/esbuild `spawn EPERM`.
  - Unsandboxed rerun passed: `tsc && vite build` completed.
- `npm run test:physics`
  - Blocked by legacy map lookup: `Could not find BSP for map: wdm7`.
- `npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"`
  - Blocked by legacy headless initialization/asset lookup: missing `public/engine.json`, then `PK3 not found in any search path: map_wdm2.pk3 (searched: data/)` instead of using the pk3 index path.

## Needs Playtest

Official online path to verify:

```bash
npm run lobby:server
npm run bot:server
npm run dev
```

Then enter the duel server through the actual online flow with a bot and inspect:

- Blade primary swing moves the player forward roughly 48 units server-side.
- Dash does not feel like a teleport under interpolation.
- Dash does not pass through walls, thin map details, or playerclip.
- Remote players and bots visibly hold the blade when swinging.
- Blade slash animation, hand attachment, and GLB scale look correct from enemy POV.

## Known Risks

- The dash is a position step, not a velocity impulse. That is intentional for a tougher, committed swing, but playtest may prefer a short velocity impulse for smoother interpolation.
- Remote GLB weapon attachment still shares the older hand-bone orientation path. Scale should now be visible, but rotation/offset may need per-weapon tuning after browser playtest.
- Server movement tests cover authoritative behavior, not browser interpolation or the full lobby/bot/dev online path yet.

## Code Review Findings (2026-07-10)

Reviewed the uncommitted blade dash + fire-origin + remote-visibility + UI-restyle batch across both repos. Verdict: implementation is clean and type-safe; `tsc --noEmit` clean, `test:run` 1221/1221, `server:tick` determinism matched (checksum 2768943778). Three findings; one fixed, two are notes/design items.

| ID | Severity | Location | State |
| --- | --- | --- | --- |
| B1 | High (feel) | `FPSMovementSubsystem.queueMeleeDash` / dash drain | OPEN — design, not auto-fixed |
| B2 | Minor (UX) | `client/hud/widgets/PauseMenu.ts` ctor | FIXED |
| B3 | Note (behavior) | `WeaponSystem.getFireViewOrigin` | CONFIRM INTENT — not a bug |

### B1 — Blade dash is server-authoritative only; the client does not predict it (OPEN)

The dash mutates the server entity position directly during the movement tick, but it is **not** part of the shared `MovementProfile` the client runs for prediction/reconciliation. On every accepted swing the local player's predicted position will lag the server by up to `meleeDashDistance` (48u), so reconciliation will correct/snap the local player forward ~48u each swing (~every 500ms while swinging). This is the same issue flagged under "Known Risks" as the interpolation risk — confirming it is real, not merely cosmetic.

Tasks to fix (pick one):
- **Preferred:** fold the dash into the shared movement path so it is seq-derived and client-predicted (client applies the same dash when it accepts the same primary-swing edge), matching how knockback/slide are handled. This makes it reconciliation-idempotent.
- **Alternative:** convert the dash to a short forward velocity impulse the client can also predict, instead of a one-frame position teleport (smoother under interpolation, per the existing Known Risk note).
- Until then: expect visible local-player snap on blade swings during the browser playtest; treat that as expected, not a new bug.

### B2 — Pause menu could be dismissed by backdrop click without resuming (FIXED)

`FPSPauseMenu` migrated from full-screen `GamePanel` to the new compact `GameDialogPanel`, which defaults `closeOnBackdrop: true`. The pause menu mirrors pointer-lock state (unlocked = shown, Resume re-locks the pointer). Clicking the dimmed area around the compact dialog called `close()` and hid the menu **without** re-locking the pointer or firing resume, stranding the player with a free cursor and no menu. Fixed by passing `closeOnBackdrop: false` in the constructor. (ESC-close was already present in `GamePanel` and shares the "close ≠ resume" quirk; left as-is to match prior behavior. The header `X` shares it too — consider hiding it for the pause menu if playtest finds it confusing.)

### B3 — Fire origins now include `crouchViewOffset` (confirm intent, not a bug)

The refactor to `getFireViewOrigin()` adds `physics.crouchViewOffset` to the Y of hitscan starts, projectile spawns, and network fire events. Previously these used standing eye height (`position.y + DEFAULT_VIEWHEIGHT`) regardless of crouch. The server maintains `crouchViewOffset`, so crouched shots now originate from the lowered eye position — matching the client crosshair, i.e. a correctness improvement. Standing players are unaffected (offset 0). Not a bug, but it is an unmentioned gameplay change bundled into this batch; confirm it is intended (it should tighten crouched hit registration, not loosen it).

### Checked and OK

- Fall-damage floor-to-floor rework (`fallStartY`/`lastGroundY`) is correct: normal jump arcs no longer inflate a short-ledge drop, spawn drops stay free (arming preserved), and the new "jump arc" regression test passes.
- `weaponDef.viewModel` deref in `RemotePlayerRenderer` is safe — `viewModel` is a required field and `viewModelFormat` is optional-but-`=== "glb"`-guarded.
- Melee dash collision clamp handles start-solid / immediate-hit (fraction floors at 0) and normalizes/caps distance (`MAX_MELEE_DASH_DISTANCE`).
- Determinism intact: `server:tick` checksum unchanged, full suite green.