# Post-Game Screen — Research & Design

**Status:** research / design — not yet implemented
**Goal:** make the *end* of a match feel like an event. Today the match ends and a
new warmup silently begins; there is no post-game scoreboard moment showing who
won, who topped the frags, or the final duel score. This doc maps the full
match-flow codepaths as they exist, identifies the gaps, and brainstorms the
post-game experience — from a minimum-viable version to the "best in the world".

---

## 1. Current match-flow codepaths (as-is)

### 1.1 The phase machine (server)

`MatchPhase` — `src/shared/server/gametype/GametypeTypes.ts`:

```
Warmup (0) → Countdown (1) → Active (2) → PostGame (3) → restart → Warmup
```

`MatchState` — `src/games/fps/server/gametypes/MatchState.ts` — owns the lifecycle:

- **Warmup**: `warmupTimeout` (default **120s**). Free-fight, no scoring. `F4`
  readies up. Advances to Countdown when `allReady()` or the timeout elapses.
  With 0 players the timer resets (waits for someone).
- **Countdown**: `countdownDuration` (default **3s**) → `3-2-1` → Active. Reverts
  to Warmup if everyone leaves.
- **Active**: `timeLimit`. Scoring + win conditions live. Advances to PostGame on
  time-out (`MatchState.update`) or when a score/frag limit is hit
  (`GametypeController` line ~373 → `matchState.endMatch()`).
- **PostGame**: `postGameDuration` (default **10s**, comment already says
  *"scoreboard duration"*) → `restart()` → Warmup. Score/deaths/team-scores reset
  on the *next* transition into Active.

Config lives per gametype: `Deathmatch.ts`, `Duel.ts`, `TeamDeathmatch.ts`
(`warmupTimeout`, `countdownDuration`, `timeLimit`, `postGameDuration`).

**The server already has a real PostGame phase and holds it for 10s.** The gap is
almost entirely presentation + input-lock, not lifecycle.

### 1.2 Snapshot → client

`MatchState.getSnapshot()` → `match_state` event → `MatchStateManager.processEvent()`
(`src/games/fps/client/MatchStateManager.ts`). The snapshot
(`MatchStateSnapshot`) carries: `phase`, `timeRemaining`, `readyCount`,
`totalPlayers`, `gametypeName`, `scoreLimit`, `teamScores`, `playerTeams`,
`teamNames`, `spectators`.

Per-player scores are **not** in this snapshot — they ride on `PlayerState.score`
in the game state (`src/engine/network/core/GameState.ts`; recently fixed to
signed int32 so selfkills read `-1`). The scoreboard widget reads those.

**Missing from the snapshot for a post-game screen:** an explicit `winner`
(player id / team) and any match summary (MVP, most frags, accuracy…). These can
be derived client-side from scores, but an authoritative `winner` is cleaner.

### 1.3 Phase-driven HUD (client)

- `MatchStateManager` fires `onPhaseChange(new, old)`.
- `FPSPhaseMessage` (`hud/widgets/PhaseMessage.ts`) — the center-screen
  announcements the user likes:
  - Warmup → "Warmup" + gametype subtitle
  - Countdown → `3 / 2 / 1` (pulse)
  - Active → "Fight!" (blood-plate slam, auto-hide 2s)
  - **PostGame → "Match Over" / "Next match starting soon…"** ← the whole
    post-game experience today is these two lines of text.
- `FPSScoreboard` (`hud/widgets/Scoreboard.ts`) — **TAB-toggle only**
  (`FPS.SCOREBOARD`, default `Tab`). It is *not* auto-shown on PostGame. It
  already renders per-team columns (Soba/Udon) with per-player score/ping rows.
- `Timer`, `ReadyBar`, `GametypeBadge` — phase-driven chrome.

### 1.4 Gameplay is NOT frozen in PostGame

Scoring + kill-tracking are gated to `MatchPhase.Active` (GametypeController
~268/345/352). But movement and weapons (`FPSMovementSubsystem`, `WeaponSystem`)
have **no phase gating** — the sim processes input every tick regardless of
phase. So during the 10s PostGame, players keep running and shooting; it just
doesn't count. There is no "lock the match, look at the board" moment.

### 1.5 Audio — the endgame track exists but is unwired

- `public/data/endgame.playlist.json` → `Endgame_Udon.mp3` (`"name": "Endgame"`).
- `AudioManager` has a full playlist system (`startPlaylist`, crossfade, etc.).
- Playlists are currently started **only from map entities**
  (`MapRenderer.ts` ~232 reads `entity.properties.playlist`). **Nothing triggers
  the Endgame playlist on PostGame** — the asset is ready, the wire is missing.

### 1.6 Existing "juice" we can reuse

- **Blood-plate slam** (`w-fight-stamp` keyframe, Washoi print-slab tokens) — the
  "FIGHT!" / "YOU GOT FRAGGED" look. A "VICTORY/DEFEAT" slam is a direct reuse.
- **DeathCamera** (`src/games/fps/client/DeathCamera.ts`) — smoothed
  corpse-follow. Reusable for a killcam / winner-orbit.
- **Scoreboard** rendering + team palette (Soba cyan / Udon pink).
- **Player-model outline + team tint** (recent work) — good for a winner spotlight.

---

## 2. Gap analysis — why the ending feels abrupt

| # | Gap | Where |
|---|-----|-------|
| 1 | PostGame shows only a text line, no scoreboard screen | `PhaseMessage.ts` PostGame case |
| 2 | Scoreboard isn't auto-shown / locked on PostGame | `Scoreboard.ts` (TAB only) |
| 3 | Players can still move & shoot during PostGame | no phase gate in movement/weapon systems |
| 4 | No winner / MVP / "who won" presentation | snapshot has no `winner`; no widget |
| 5 | Endgame soundtrack never plays | not wired to phase change |
| 6 | No dramatic build-up to the finish (match point, final seconds, final kill) | — |

---

## 3. Design goals

1. **Clear resolution.** Within a second of the last frag, every player knows
   *who won* and *how the match shook out*.
2. **A held moment, not a blink.** Lock gameplay, hold the board for the full
   `postGameDuration`, let the result land.
3. **Drama on the way in.** The last stretch of a match should tighten
   (match point, final-seconds, a punctuating final kill).
4. **Per-gametype truth.** A duel wants a head-to-head; a DM wants a leaderboard;
   a TDM wants team score + top players.
5. **Reuse the house style.** Washoi print-slab, blood-plate slam, Soba/Udon
   palette, the Endgame track — it should feel like the same game, louder.
6. **Deterministic & demo-safe.** Winner/summary derived from
   authoritative state; the post-game screen is pure presentation over a
   snapshot, so demos replay it for free.

---

## 4. Design brainstorm

Organized as tiers so we can ship value early and layer drama on top.

### Tier 0 — Make PostGame a real screen (MVP, ~half a day)

- **Auto-show + lock the scoreboard** for the whole PostGame phase. Reuse
  `FPSScoreboard`; on `onPhaseChange(PostGame)` force-open it and ignore the TAB
  toggle until Warmup.
- **Freeze gameplay**: gate movement/weapon input to `phase === Active` (server),
  or at minimum stop local input + pull the camera to a neutral/winner view.
  (Server-side lock is the honest fix and keeps clients in sync.)
- **Winner banner** above the board: `WRAITH WINS` / `TEAM UDON WINS`, colored by
  team, using the blood-plate slam. Derive the winner from top score / team score
  (add an authoritative `winner` to the snapshot in Tier 1).
- **Wire the Endgame playlist**: on PostGame, `AudioManager.startPlaylist(Endgame)`;
  on Warmup, restore map/warmup music.

### Tier 1 — Winner + MVP presentation (~1–2 days)

- **VICTORY / DEFEAT slam** (per-player), like round-end in Overwatch/Valorant —
  gold "VICTORY" for the winner(s), muted "DEFEAT" for the rest. Reuse
  `w-fight-stamp`.
- **MVP / Most Frags card**: highlight the top fragger — name, frags, and (juice)
  a lit **player model pose** using the team tint + outline. Camera can orbit
  the winner's corpse/model (reuse `DeathCamera`'s damped follow).
- **Authoritative summary in the snapshot**: extend `MatchStateSnapshot` (or a new
  `match_result` event fired once on `endMatch()`) with `winner`
  (playerId/team/`"draw"`), and a compact per-player stat line (frags, deaths,
  and if cheap: damage, accuracy, best streak). Keeps client presentation dumb.
- **Per-gametype layouts**:
  - **Duel**: giant head-to-head `12 — 7`, winner's name on top, portrait/model
    of each. "FLAWLESS" stamp on a shutout.
  - **Deathmatch**: leaderboard, winner crowned at #1, your row highlighted.
  - **TDM**: team score banner (Soba vs Udon), top 3 players per team.

### Tier 2 — Dramatic build-up to the finish (~2–3 days, high payoff)

The user explicitly wants the *ending* to be dramatic. Ideas, roughly by cost:

- **MATCH POINT** banner when a player/team is one frag from the limit (Warsow /
  fighting-game staple). Cheap, huge tension.
- **Final-seconds intensity**: last 10s of a timed match → the Timer pulses,
  music ducks/lifts, a subtle vignette. Reuse the countdown pulse styling.
- **The finishing blow**: on the frag that ends the match, a brief **slow-mo +
  killcam** of the final kill before the board slams in (Rocket League / CoD
  finisher). We already have the death camera to build this on.
- **OVERTIME**: if scores are tied at time-out in a mode that shouldn't draw,
  transition to sudden-death instead of PostGame — "OVERTIME" slam, next frag
  wins. (Bigger; needs a phase/config addition.)
- **Endgame track swell**: the Endgame music starts on the *finishing blow* /
  match-point-converted, not just when the board appears — so the audio leads the
  moment.

### Tier 3 — "Play of the Game" / stretch

- **POTG-style replay**: pick the highest-impact moment (multi-kill, match-winning
  frag) from the demo buffer and replay it on the post-game screen. We record
  demos already; a heuristic + the demo playback path could drive this. Ambitious
  but iconic.
- **End-of-match cards / accolades**: "Most Aggressive", "Comeback", "Untouchable"
  — small awards computed from stats. Great personality, low gameplay risk.
- **Rematch / next-map vote** during PostGame instead of a silent auto-restart.

### Cross-cutting: motion & audio juice

- Board slams in with the print-slab shake; rows stagger-reveal top-to-bottom.
- Winner row gets a gold rail + subtle idle shimmer.
- Numbers **count up** to final scores rather than appearing.
- Audio: finishing-blow stinger → Endgame track swell → soft ambient under the
  board → warmup cue on transition out.
- Respect `prefers-reduced-motion` for the shakes/slams.

---

## 5. Recommended implementation path

Ship in the tier order above; each tier is independently valuable.

1. **Tier 0 first** — it removes the "abrupt" feeling with the least code:
   freeze input in PostGame (server phase gate), auto-lock the existing
   scoreboard, add a winner banner, wire the Endgame track. This alone fixes the
   reported problem.
2. **Tier 1** — add the authoritative `winner`/summary to state, VICTORY/DEFEAT
   slam, MVP card, per-gametype layouts (duel head-to-head first — it's the mode
   most in need).
3. **Tier 2** — MATCH POINT + final-seconds + finishing-blow slow-mo. This is
   where the drama the user wants really lands.
4. **Tier 3** — POTG / accolades / rematch vote as time allows.

Guardrails:
- Keep it **presentation over authoritative state** — the server decides
  winner/phase/duration; the client renders. This keeps it demo-faithful and
  determinism-neutral (no sim changes except the PostGame input gate, which is
  itself deterministic).
- The input freeze is the one gameplay-affecting change — gate it cleanly on
  `phase === Active` in the movement/weapon input path and cover it with a test.

---

## 6. Open questions

- **Input lock granularity**: fully freeze (can't move/look) vs. free-look but
  no fire/move? Overwatch-style free-look while the board shows reads well.
- **`postGameDuration`**: 10s enough for a winner slam + board + music beat?
  Duel might want a touch longer to savor a clean win.
- **Winner authority**: derive client-side (simplest) vs. add `winner` to the
  snapshot / a one-shot `match_result` event (cleaner, needed for MVP stats).
- **Draws**: what shows on a tie — "DRAW", or force OVERTIME per gametype?
- **Stats budget**: frags/deaths are free; damage/accuracy/streaks need the
  server to track and ship them — worth it for MVP/accolades, but scope it.

---

## Appendix — key files

| Concern | File |
|---|---|
| Phase enum | `src/shared/server/gametype/GametypeTypes.ts` |
| Phase machine + durations | `src/games/fps/server/gametypes/MatchState.ts` |
| Win condition → endMatch | `src/games/fps/server/gametypes/GametypeController.ts` |
| Per-gametype config | `server/gametypes/{Deathmatch,Duel,TeamDeathmatch}.ts` |
| Client match state | `src/games/fps/client/MatchStateManager.ts` |
| Phase announcements | `src/games/fps/client/hud/widgets/PhaseMessage.ts` |
| Scoreboard | `src/games/fps/client/hud/widgets/Scoreboard.ts` |
| Player score wire | `src/engine/network/core/GameState.ts` |
| Audio / playlists | `src/engine/AudioManager.ts`, `MapRenderer.ts` |
| Endgame track | `public/data/endgame.playlist.json` (`Endgame_Udon.mp3`) |
| Reusable slam style | `src/engine/ui/hud/styles/WashikiTheme.css` (`w-fight-stamp`) |
| Reusable camera | `src/games/fps/client/DeathCamera.ts` |
