# Loadouts in more modes, and the loadout key in the Esc menu

**Status:** built 2026-10-09 on `v0.9.27-assorted`; see section 5 for the decisions and what changed from the plan.
**Ask (Tarmo):** offer the S&D / Amphi kit picker in free-for-all too, to make it
easier; put "change loadout" in the Esc menu right under Resume, as a general
place for gametype keys; and in any mode with a picker, weapons do not spawn on
the ground (other items do). Duel stays as it is.

## 1. How it works today

| Part | Today | Where |
|---|---|---|
| Kit table | Blade + one primary (Rocket Launcher, Voltaic, Electrobolt) + one secondary (Riotgun, Plasmagun, Grenade Launcher, Machinegun), spawn ammo, 100 armor. Default Rocket Launcher + Machinegun | `src/shared/server/gametype/Loadout.ts` |
| Who has kits | S&D and Amphi (`setPlayerLoadout`, `getSpawnLoadout`, `hasChosenLoadout`). Every other mode ignores a choice | `server/gametypes/*.ts`, `BaseGametype.ts` |
| When a choice applies | The first choice at once; later ones at the next round | `Amphi.ts`, `SearchAndDestroy.ts` |
| Join gate | The server refuses `JoinGame` from a human with no choice yet ("Choose a loadout before joining.") | `GameServer.ts` ~1489 |
| Picker | A blocking full-screen dialog, opened by `Game.joinGame()` before the first join | `client/hud/widgets/LoadoutPicker.ts`, `Game.ts` ~850 |
| Which modes show it | The **client** decides by the mode's display name: `"search & destroy"` or `"amphi"` | `MatchStateManager.requiresLoadoutSelection` |
| Changing kit later | Only the `loadout` console command; nothing in the menus | `console/commands/LoadoutCommand.ts` |
| Esc menu | Resume, Join (spectators), Settings, Spectate, then Leave at the foot | `client/hud/widgets/PauseMenu.ts` |
| Map weapons | Spawn in every mode, deliberately in S&D and Amphi ("the map decides what you can do if you take ground") | `getItemSpawnRules`, `Loadout.ts` comments |
| Excluding items | `ItemSpawnRules.excludeClassnames` already drops pickups by classname (S&D drops the Quad) | `GameServer.setPickupItems` |
| Bots | Never choose; they get the default kit | — |

## 2. Plan

### 2.1 One server-side description of a mode's kit rules

Replace the client's name check with what the server says. `match_state` (JSON,
so no binary layout change) gains:

```ts
loadouts?: "round" | "respawn";   // absent: the mode has no kits
```

- `round` (S&D, Amphi): a change applies at the next round, as today.
- `respawn` (Deathmatch, and Team Deathmatch if wanted): a change applies at your
  next spawn. Changing kit while alive does nothing to the fight you are in.

`BaseGametype` gets `loadoutMode(): "round" | "respawn" | null` (default null).
The kit storage that Amphi and S&D each carry today (active + pending maps,
`setPlayerLoadout`, `getSpawnLoadout`, `hasChosenLoadout`, `onPlayerLeave`)
moves into one shared helper (`PlayerLoadouts`), used by every mode with kits,
so the rules cannot drift between modes.

### 2.2 Map weapons off where kits are on

A mode with kits excludes every `weapon_*` pickup through the existing
`excludeClassnames`, computed from the pickup table rather than listed by hand
(so a new weapon is covered without remembering this rule). Ammo, armor, health,
the Mega and the Quad spawn as before. Duel keeps its map weapons.

This reverses a deliberate S&D and Amphi choice (`Loadout.ts`: "We keep the map
items"); the comments there change with it.

Dropped weapons are a separate thing: a player still drops what they carried
when they die, so a frag can still hand you the other player's gun. (See
decision 3.)

### 2.3 The picker

- **Joining S&D or Amphi:** unchanged, blocking before the first spawn (a round
  has no respawn to correct a wrong kit).
- **Joining Deathmatch:** not blocking. You join at once with the kit you last
  chose in this mode (remembered in the browser, sent with the join), or the
  default the first time. A respawn corrects any kit within seconds, so a
  dialog in the way of the first frag would be friction, not safety.
- **The picker says when the kit applies:** "From the next round" or "From your
  next spawn". It already takes the mode's name.
- **Bots** pick a random kit from the table per match (seeded, so demos and the
  re-sim agree), instead of everyone running the default.

### 2.4 The Esc menu's mode keys

`FPSPauseMenu` gets a slot right under Resume for keys the mode brings:

```ts
setModeKeys(keys: Array<{ id: string; label: string; hint: string; onClick: () => void }>)
```

`FPSHud` fills it when the menu opens, from `match_state`. Today that is one key:

- **Loadout** — hint shows the kit in force, e.g. "Rocket Launcher + Machinegun",
  or what is waiting, "Next: Electrobolt + Riotgun". Opening it closes the menu
  and opens the picker; confirming sends the choice and puts you back in the
  game (pointer re-locked); Esc in the picker returns to the menu.

The slot is generic so a later mode key (a team switch in TDM, a vote) needs no
new layout. It is hidden when the mode brings no keys, so Duel's menu does not
change.

### 2.5 Wire, demos, tests

- No new message: `SetLoadout` already exists. `match_state` gains one optional
  field; older demos simply read as "no kits".
- Tests: kit timing per mode (`round` waits for the round, `respawn` waits for
  the spawn), the join gate only where a mode requires a choice, weapon pickups
  excluded in kit modes and kept in Duel, the Esc menu key (shown, hint, opens
  the picker), the picker's "applies" line, bots' seeded pick.
- Networking regression set (`AGENTS.md`), since the server's join and spawn
  paths change.

## 3. Decisions needed

1. **Team Deathmatch:** kits like Deathmatch (and no map weapons), or keep map
   weapons like Duel?
2. **Deathmatch join:** non-blocking with the last-chosen kit (recommended), or
   the same blocking picker as S&D?
3. **Dropped weapons** in kit modes: keep (recommended; a frag hands you their
   gun), or remove so only kits exist?
4. **Kit changes in Deathmatch:** at your next spawn (recommended), or at once
   when chosen while dead (the respawn screen)?

## 4. Also on this branch

**Amphi: the Quad followed you into the next round.** The server was right: a
round start respawns every player alive and takes powerups away
(`respawnPlayer`), and resets the map's items with the Quad back 15 s into the
round (`resetForRound`). The client was not: it dropped its own powerup timers
only on death, so a carrier respawned alive kept the HUD timer and the Quad fire
sound on the old countdown. Fixed: a snapshot that arrives without a powerup's
`powerup_state` now ends it on the client (`keepOnlyLocalPowerups`). Tests:
`AmphiRoundReset.test.ts` (server) and `LocalPowerupState.test.ts` (client).

## 5. Decisions and as built (2026-10-09)

**Decisions (Tarmo):** Team Deathmatch keeps its map weapons and has no kits
(only S&D, Amphi and Deathmatch have kits; Duel and TDM spawn weapons). The
Deathmatch picker blocks the join, as S&D's does. Dropped weapons stay. A
Deathmatch kit change applies at the next spawn.

**As built:**

- `MatchConfig.loadouts` (`"round"` or `"respawn"`) names a mode's kit rule;
  `match_state` carries it (only where set, so other modes' snapshots are
  unchanged), and the client's `MatchStateManager.loadoutMode` /
  `requiresLoadoutSelection` read it instead of the mode's name.
- `PlayerLoadouts` (server) is the one kit store: first choice at once, later
  ones at the next round or spawn. S&D and Amphi moved onto it; Deathmatch uses
  it with its own spawn armor (none), where the round modes spawn with 100.
- **Join gate:** the server refuses a kit-less join only in the round modes. In
  Deathmatch the game client's picker blocks the join; a client that never
  chooses (headless, older) spawns with the default kit. Gating Deathmatch on
  the server broke every client that joins without the picker.
- Map weapons are excluded in kit modes from `WEAPON_PICKUP_CLASSNAMES` (the
  pickup table's weapon classnames). Excluded pickups now stay registered and
  permanently inactive (`PickupSystem`): dropped from the list, one whose id lay
  past the end of the active mask was never hidden on the client.
- Bots get a kit picked by their player id (`botLoadout`) in any kit mode.
- The match menu has a mode-key slot under Resume (`FPSPauseMenu.setModeKeys`);
  in a kit mode it holds Loadout, hinted with the kit you chose. The picker,
  opened from it, says when the change applies and has Back (and Esc). The last
  kit chosen in a mode is remembered in the browser and pre-selected.
