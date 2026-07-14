# Single-Match Servers + Lobby Return Flow

**Status:** design locked, implementation planned (WO table below)
**Branch:** `feature/post-game-screen`
**Related:** `docs/research/post_game_screen.md` (the post-game screen this flow extends)

## 1. Goal

Make **per-match game servers** the default flow: a match server exists for
exactly one match. When the match ends, the post-game screen becomes the
terminal state — players chat, then **return to their lobby** (same lobby,
same invite URL), the empty server process exits, and the lobby is the staging
ground for the next match (map vote already lives there).

Why:
- **Flow legibility** — the confusing "silent new warmup" loop disappears. The
  lobby IS the rematch screen; map voting already exists there.
- **Operational safety (alpha)** — servers are per-match, so memory
  leaks/drift can't accumulate: every match starts on a fresh process, and
  ended servers reap themselves. "Auto cleanup" by architecture.
- Long-running servers remain possible: the old warmup-loop behavior stays
  available behind a flag (`continuous`) for dev CLI servers and any future
  dedicated-server hosting.

## 2. Locked decisions (agreed 2026-07-14)

1. **Same-lobby return** — "new lobby" = the *same* lobby object/URL, reset to
   waiting. Players regroup where they started; the invite link stays alive.
2. **Default `single`** for lobby-spawned matches during alpha;
   `continuous` for standalone/dev CLI servers.
3. **Open-up beat at ~6s** after match end: the celebration (slam → board →
   winner showcase) plays first with aim locked; then pointer lock releases
   (mouse cursor), chat input opens, and a **RETURN TO LOBBY** button appears.
4. **No rematch vote** on the post-game screen — returning to the lobby *is*
   the rematch, and the lobby already has map voting.
5. **Bots leave at T+10s** after match end so they never hold a server open.

## 3. Verified codebase facts (what's already built)

| Fact | Where | Consequence |
|---|---|---|
| Spawned servers auto-exit when the last client disconnects | `GameServerSpawner.SpawnConfig.shutdown` (default true) → `--shutdown` → `GameServerConfig.shutdownOnEmpty` | Per-match cleanup is free once clients leave |
| Spawner monitors child exit and notifies | `GameServerSpawner` `child.on("exit")` → `onServerExit(matchId, code)` | Lobby learns the match is over reliably |
| **Lobby already resets on server exit** | `LobbyServer.handleServerExit` (~line 1131): state→`waiting`, `matchMap=""`, all `ready=false`, players→`in_lobby`, broadcasts `match:ended` + matches update | WO-4 is mostly done; only gaps below |
| Lobby persists through the match | `lobby.state="playing"`, destroyed only when empty | There is always a lobby to return to |
| Map voting exists | `voteMap` / `getWinningMap` (LobbyServer); `LobbyClient.voteMap` | "Vote next map" needs zero new code |
| Bots quit lobbies without humans | `evictBotsIfNoHumans` + `lobby:kicked` (BotLobbyClient disconnects) | Bot lifecycle pattern established |
| Server can close a client connection | `ClientConnection.close(reason)` (WebSocketTransport.ts:56) | Bot kick + grace force-close are one-liners |
| CLI flag pattern | `headless-netserver-v2.ts` `--shutdown` parsing (~line 88) | `--single-match` copies it |
| Established "leave server" client action | PauseMenu Disconnect → `window.location.reload()` | v1 Return-to-Lobby reuses it |
| Post-game screen (phase-terminal UI) | PostGame phase + input freeze + winner board + showcase (see post_game_screen.md) | The terminal state already looks right |
| Pause menu suppressed while scoreboard open | `FPSHud` pointer-lock handler checks `_scoreboard.isVisible()` | Releasing pointer lock at the open-up beat won't pop the pause menu |
| Chat works in PostGame | Chat is not phase-gated server-side | Post-game banter works as-is |

**Known lobby-reset gaps in `handleServerExit`** (to fix in WO-4):
`lobby.isStarting` is not reset to `false` (blocks `findWaitingLobby` and
re-ready), `lobby.serverUrl` is not cleared, and per-lobby **map votes are not
reset** for the next round.

## 4. Target flow (single mode)

```
Match ends (score/time limit)
  T+0s   PostGame: input freeze, winner slam, gold board, showcase model
         (exactly the existing post-game screen)
  T+6s   OPEN-UP BEAT (client): pointer lock released → mouse cursor,
         chat input opens, RETURN TO LOBBY button appears on the board
  T+10s  server disconnects bot clients (bot server reaps them)
  ...    players banter, then click RETURN TO LOBBY (or Esc→Disconnect)
         → client leaves → lobby page → same lobby, reset to waiting
  last client gone → shutdownOnEmpty exits the process
  T+120s grace: server force-closes any AFK stragglers with a message,
         then exits (guarantees the process always dies)

LobbyServer (on child exit): handleServerExit → lobby back to waiting,
ready flags cleared, votes reset → players ready up / vote map → new match
on a FRESH server process.
```

`continuous` mode = exactly today's behavior: PostGame counts down
`postGameDuration` and restarts to Warmup. No client open-up beat, no bot
kick, no grace close.

## 5. Work orders

Convention: fps submodule commits first, outer repo re-pins. Every WO lands
with tests + tsc + biome + determinism gate (`npm run server:tick`,
checksum `2768943778`).

### WO-1 — Server: `single` match flow mode ~~(difficulty: M)~~
**Files (fps):** `server/Client.ts` (GameServerConfig), `server/GameServer.ts`,
`server/gametypes/GametypeController.ts`, `server/gametypes/MatchState.ts`
**Files (outer):** `src/shared/server/gametype/GametypeTypes.ts`,
`src/cli/headless-netserver-v2.ts`, `src/lobby/GameServerSpawner.ts`

- `GameServerConfig.singleMatch?: boolean` (next to `shutdownOnEmpty`).
- GameServer → `gametypeController.setMatchFlow(singleMatch ? "single" : "continuous")`
  → stored on MatchState.
- `MatchState.update` PostGame case, single mode: **never `restart()`** —
  clamp `_timeRemaining` at 0 and hold the phase.
- Shared `MatchStateSnapshot.flow?: "single" | "continuous"` so the client
  picks the right ending UI; include in `toSnapshot()`.
- CLI: `--single-match` flag (copy `--shutdown` pattern) → config.
- Spawner: `SpawnConfig.singleMatch ?? true` → pushes `--single-match`
  (lobby + dev spawns default single per decision #2).
- **Tests:** single holds PostGame past `postGameDuration`; continuous still
  restarts; snapshot carries `flow`.

### WO-2 — Server: bot kick at T+10s + grace force-close (difficulty: S/M)
**Files (fps):** `server/GameServer.ts`

- On phase transition into PostGame (GameServer already watches transitions
  for demo auto-record), record `postGameEnterTick` (single mode only).
- At `+10s` (1250 ticks): `connection.close("match over")` every `isBot`
  client, once. BotClient's disconnect handling reaps bot-side state.
- At `+120s`: force-close ALL remaining connections with a friendly reason
  ("match over — returning to lobby"), letting `shutdownOnEmpty` exit the
  process. Guarantees no zombie servers even with AFK humans.
- **Tests:** bot connections closed after threshold; humans untouched at
  +10s; everything closed at +120s (mock connections).

### WO-3 — Client: open-up beat + RETURN TO LOBBY (difficulty: M)
**Files (fps):** `client/MatchStateManager.ts`, `client/FPSHud.ts`,
`client/hud/widgets/Scoreboard.ts`, `client/hud/widgets/PhaseMessage.ts`
**Files (outer):** `src/engine/ui/hud/styles/WashikiTheme.css`

- MatchStateManager parses `flow`.
- FPSHud PostGame handler, single mode: `setTimeout(6000)` →
  `document.exitPointerLock()` (pause menu already suppressed while the board
  is up) + `this._chat.openInput()` + `scoreboard.setReturnButton(onReturn)`.
  Timer cleared if the phase changes first (safety for continuous mode /
  early disconnect).
- Scoreboard: a `RETURN TO LOBBY` button in the post-game board footer.
  The overlay is `pointer-events: none` — the button (and only it) gets
  `pointer-events: auto`. Washoi cut-slab styling, keycap-style hint
  optional.
- `onReturn` (Game.ts): reuse the PauseMenu Disconnect path
  (`window.location.reload()`) — v1; a seamless in-page lobby return can
  come later.
- PhaseMessage subtitle in single mode: "GG — return to lobby for the next
  one" instead of "next match starting soon...".
- **Tests:** none UI-automatable cheaply; verified in browser. Logic-level:
  MatchStateManager flow parsing.

### WO-4 — LobbyServer: close the reset gaps (difficulty: S)
**Files (outer):** `src/lobby/LobbyServer.ts`

`handleServerExit` already does 90% (state→waiting, ready cleared, statuses,
broadcasts). Add:
- `lobby.isStarting = false` and `lobby.serverUrl = ""`.
- Reset the lobby's **map votes** so the next round votes fresh.
- (Optional, later) result line into lobby chat — needs the game server to
  report scores before exit; out of scope here.
- **Tests:** if LobbyServer has test coverage, extend; else manual (two
  browsers: finish match → both return → lobby waiting, re-ready works,
  votes fresh).

### WO-5 — Docs + changelog (difficulty: S)
- Update `post_game_screen.md` §4 handoff row (page-turn → lobby in single
  mode) + cross-link this doc.
- v0.9.18 changelog: single-match flow entry under the post-game section
  (branch-state marker until merged).

### WO-6 — End-to-end verification (manual, with user)
1. Lobby duel vs bot, `SHAG_SCORELIMIT=1`: frag → celebration → at ~6s cursor
   + chat + button → bot leaves at ~10s (server log) → RETURN → same lobby,
   waiting, votes fresh → server process gone (`[Spawner] Server exited`).
2. Re-ready from the same lobby → new match on a new port/process.
3. AFK path: don't click anything for 2 min → server closes you out → lobby.
4. `continuous` mode via dev CLI: old warmup loop still works.

## 6. Edge cases & decisions on record

- **Draw/overtime interplay**: overtime prevents duel draws (already live);
  single-mode terminal PostGame applies to whatever result ends the match.
- **Player closes the tab instead of clicking Return**: same effect —
  disconnect → shutdownOnEmpty. The button is UX, not a requirement.
- **Spectators**: get the same open-up beat + button (they're clients too).
- **Demo recording**: DemoRecorder finalizes on match end already
  (auto-record watches phase transitions); process exit after grace is fine.
- **Reconnect-to-dead-server**: the lobby's `serverUrl` is cleared on exit
  (WO-4), so stale connect attempts can't be offered.
- **Why not kill the server right at T+10s?** The post-game screen (chat,
  showcase) is server-fed; killing early would cut the social beat. The
  server dies when its people leave — or at +120s, whichever first.

## 7. Progress log

| WO | State | Notes |
|---|---|---|
| WO-1 server flow mode | pending | — |
| WO-2 bot kick + grace | pending | — |
| WO-3 client open-up + return | pending | — |
| WO-4 lobby reset gaps | pending | — |
| WO-5 docs/changelog | pending | this doc written (plan); changelog + cross-link with implementation |
| WO-6 e2e verification | pending | manual pass with user (checklist §5/WO-6) |
