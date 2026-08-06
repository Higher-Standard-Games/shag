# Weapon Values Audit (v0.9.21)

Actual, as-shipped weapon timings — not the nominal `fireRate`. The server quantizes
fire cadence to **125 Hz ticks** (8 ms each): refire interval = `round(125 / fireRate)`
ticks (unless `fireIntervalTicks` is set), and reload = `ceil(reloadTime × 125)` ticks.
A `fireRate` that doesn't divide 125 therefore can't be hit exactly.

Source of truth: `src/shared/entities/definitions/weapons/*.ts`; timing model:
`WeaponSystem.fireIntervalTicks` + `startReload`.

## Timings & DPS

| Weapon | Dmg/shot | Nominal | Refire (ticks) | Actual refire | Actual RPS | Sustained DPS | Reload | Eff. DPS¹ |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Blade (melee) | 80 | 500ms | 63 | 504ms | 1.98 | 159 | — (none) | — |
| Gunblade (blast)² | 35 | 600ms | 75 | 600ms | 1.67 | 58 | — (pool) | — |
| Machinegun | 10 | 100ms | 13 | 104ms | 9.62 | 96 | 136ms | 93 |
| Riotgun | 100 (20×5) | 800ms | 100 | 800ms | 1.25 | 125 | 832ms | 111 |
| Grenade Launcher | 80 | 800ms | 100 | 800ms | 1.25 | 100 | — (pool) | — |
| Rocket Launcher | 80 | 800ms | 100 | 800ms | 1.25 | 100 | — (pool) | — |
| Plasmagun | 15 | 80ms | 10 | 80ms | 12.50 | 188 | 1304ms | 141 |
| Voltaic (beam) | 7 | 50ms | 6 | 48ms | 20.83 | 146 | 500ms³ | 134³ |
| Electrobolt | 75 | 1250ms | 156 | 1248ms | 0.80 | 60 | — (pool) | — |
| Instagun | 200 | 1300ms | 162 | 1296ms | 0.77 | 154 | — (pool) | — |

¹ **Eff. DPS** = sustained DPS including the clip-reload gap (clip weapons only). Pool/none
weapons never reload, so sustained = effective. Sustained assumes every shot/pellet connects.

² Gunblade is the legacy default (Blade replaced it); no shipping loadout grants it. `maxAmmo:1`
pool means it fires once then is dry. Kept only as a valid default id.

³ **Changed in v0.9.21** — see below.

## Findings & actions

**Fixed this cycle (docs + one gameplay wart):**

1. **Voltaic beam reload** *(gameplay)* — was a 60-cell clip (burned in 2.88s) + 1.3s reload =
   **~31% downtime** on a "continuous beam." Restructured to **clip 120 / reserve 60 / reload
   0.5s** — same 180-cell total, but the beam runs ~5.8s between brief 0.5s reloads (downtime
   ~8%, effective DPS 100 → 134). Left as a clip weapon (not a Warsow-style pool) so the client
   beam-presentation and reload paths are untouched.
2. **Comment/data accuracy** *(no gameplay change)* — plasmagun's reload comment claimed "1.0
   seconds" for a `1.3` value; machinegun/blade/voltaic/gunblade timing comments claimed exact
   ms the tick quantization doesn't deliver; `reloadTime` on pool weapons is dead data. Fixed the
   comments and documented on `WeaponDef.reloadTime` that only the `clip` model reads it.

**Also actioned since this audit was written:**

3. **Machinegun magazine** *(gameplay)* — the near-free 40-round / 136ms reload is gone; it is now
   a real magazine at **clip 30 / reserve 120 / reload 1.5s**, so running dry is a decision rather
   than a cosmetic hitch.
4. **Gunblade removed** — it was vestigial (see note ²) and is now deleted from the weapon table,
   projectile/ammo defs and every reference. Blade is the sole default.

5. **Plasmagun rate cut** *(gameplay)* — was `fireRate 12.5` (exactly 10 ticks @125Hz → 12.5
   shots/s, **187.5 DPS**, the highest sustained in the game). Target was 10 shots/s / 150 DPS.
   125Hz cannot express 10/s exactly (125/10 = 12.5 ticks), so it now authors `fireRate 10` and
   quantizes to **13 ticks = 9.62 shots/s = 144 DPS**. 12 ticks would overshoot to 10.42/s
   (156 DPS); 13 is nearer both the rate and the DPS target. Bump `damage` 15 → 16 if 150 DPS
   matters more than the rate (→ 153.8).
6. **Riotgun blast cut to 90** *(gameplay)* — was 5 damage × 20 pellets = 100. Pellet damage is
   `Math.round`ed per hit in `CombatSystem`, so trimming via fractional damage does nothing (4.5
   rounds straight back to 5). Reduced the pellet COUNT instead: **5 × 18 = 90**, which also
   slightly loosens consistency at range — a normal shotgun nerf.

**Quantization note (125Hz server tick):** a weapon's real rate is `125 / round(125 / fireRate)`.
Rates that divide 125 evenly (25, 12.5, 5, 2.5, 1.25) are exact; others are not. Current
non-exact cases: plasmagun 10 → 9.62/s, lasergun 20 → 20.83/s (145.8 DPS at 7/cell, against a
140 target — 6 ticks is as close as 125Hz allows; 7 ticks would drop it to 125 DPS).

**Still flagged, not changed (needs a design call):**

- Nothing outstanding. Plasmagun was the last open balance item and is actioned above.
