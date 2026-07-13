# Post-Game Screen — Research & Design

**Status:** research / design — not yet implemented
**End goal:** the best FPS endgame screen ever made.

Today the match ends and a new warmup silently begins; there is no post-game
moment at all. This doc maps the full match-flow codepaths as they exist,
identifies the gaps, and designs the ending — from a minimum-viable version to
the north star.

## 0. North star — "the chapter closes"

What we already have that no other FPS has: **the game tells you the ending is
coming.** The timer escalates (warning ≤30s, critical ≤10s), the pre-match beats
(WARMUP → 3-2-1 → FIGHT!) are staged like an opening. The match is already
paced like a story — and then the story is missing its last page.

So the north star is not "a scoreboard popup". It is a **three-act ending**:

- **Act 1 — Foreshadow** *(already partly ours)*: the game openly builds toward
  the end. Timer escalation, MATCH POINT, the music tightening. Lean into what's
  already unique instead of hiding the ending like every other FPS.
- **Act 2 — Climax**: the finishing blow is *witnessed*. Time dilates, the
  camera leaves your hands and finds the moment, the Endgame track hits.
- **Act 3 — Resolution: the Chapter End page.** The signature. The whole HUD is
  Washoi manga print-slab — so the endgame screen is **the final page of the
  match's manga chapter**. Not a table with a header: a full-bleed manga page.
  Winner splash panel with speed-lines and halftone, the score as a chapter
  title, key moments as small panels, an onomatopoeia stamp slamming in
  (勝利 / DOOM! / WASHOI!). Then the page *turns* — literally, a page-turn
  transition — into the next chapter: warmup, with "PRESS F4 WHEN READY" printed
  on the new page's corner.

No FPS ends a match as a manga page. That's the "best ever" claim: everyone
else shows a UI; we close a chapter. It also solves the user's original
complaint — the between-match flow becomes legible because it's *narrated*:
chapter ends → page turns → next chapter begins.

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
- **The foreshadow that already works** (the part the user loves): `Timer.ts`
  escalates as the end approaches — `fps-timer--warning` at ≤30s,
  `fps-timer--critical` at ≤10s. This is the seed of Act 1; the ending is
  *announced*, which almost no FPS does. Build on it, don't replace it.

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

## 4. The choreographed ending — beat by beat

The north star as a concrete timeline. Times are from the moment the match ends
(`T0` = win condition met / time out). `postGameDuration` likely grows from 10s
to **~15s** to fit the sequence (duel maybe 18s — savor it).

### Act 1 — Foreshadow (before T0)

| When | Beat | Builds on |
|---|---|---|
| last 60s | Timer amber; music adds a layer / tightens | `fps-timer--warning` (move to 60s?) |
| **match point** | **MATCH POINT** blood-plate slam + persistent corner stamp ("WRAITH AT MATCH POINT"); heartbeat undertone | new; `w-fight-stamp` reuse |
| last 10s | Timer critical + per-second tick pulse; subtle vignette | `fps-timer--critical` |
| tied, near end | "SUDDEN FINISH?" tension stamp (or OVERTIME rules, below) | new |

### Act 2 — Climax (T0 → T0+3s)

| When | Beat | Builds on |
|---|---|---|
| T0 | **Finishing blow**: hit-stop (~120ms world freeze), then ~1.5s slow-mo. Camera leaves first person and frames the final kill (victim ragdoll + killer) | `DeathCamera` damped follow; ragdoll already live |
| T0 | Input locked server-side (phase gate); no more shots land — the fight is *over*, visibly | new phase gate |
| T0+0.5s | **Endgame track hits** — the stinger lands on the kill, not on the UI | `endgame.playlist.json` (unwired today) |
| T0+2s | Manga freeze-frame: the final kill gets the halftone/ink treatment, speed-lines radiate, onomatopoeia stamp slams (DOOM! / 終) | Washoi tokens; screen-space filter |

### Act 3 — Resolution: the Chapter End page (T0+3s → T0+15s)

| When | Beat | Builds on |
|---|---|---|
| +3s | **Page turn** — the frozen frame becomes a manga panel that shrinks into the page; full-bleed Chapter End page slams in | new (CSS/canvas page comp) |
| +3.5s | **Winner splash panel**: winner's player model (team tint + outline — the accessibility-loved look) in a speed-line splash panel; "WRAITH WINS" / "TEAM UDON WINS" as chapter title; **duel gets the 3D Face-Off tableau (§7)** with giant `12 — 7` | player model + outline system; `createDetachedModelAt` |
| +5s | **Score panels stagger in**: leaderboard rows reveal top-to-bottom, numbers count up; your row highlighted; FLAWLESS/comeback stamps where earned | `Scoreboard` rendering, restyled as panels |
| +8s | **MVP / accolade mini-panels**: most frags, best streak, "first blood" — small manga panels with stat stamps | needs server stat lines |
| +12s | **Handoff printed on the page**: "NEXT CHAPTER: WARMUP — PRESS [F4] WHEN READY" (keycap style); ready count visible | `ReadyBar`, keycap chips |
| +15s | The page turns again → warmup begins; music crossfades to warmup/map track | `restart()` (already exists) |

Notes:
- The page is **still a scoreboard** — all the information is there, just art-directed.
  TAB during warmup shows the plain board as usual; the chapter page is the *event* version.
- Everything is presentation over authoritative state: server decides T0, winner,
  and durations; the client performs the choreography from the phase change +
  one `match_result` payload. Demos replay the whole ending for free.

## 5. Design ideas by tier (shippable slices of the north star)

Organized as tiers so we can ship value early and layer drama on top. Each tier
is a coherent, shippable subset of the beat sheet above.

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

## 6. Recommended implementation path

Ship in tier order; each tier is a coherent slice of the beat sheet (§4).

1. **Tier 0 = Act 3 skeleton** — removes the "abrupt / doesn't exist" feeling
   with the least code: freeze input in PostGame (server phase gate), auto-lock
   the scoreboard, winner banner, wire the Endgame track. The ending *exists*.
2. **Tier 1 = Act 3 proper** — authoritative `match_result` (winner + stat
   lines), the Chapter End page composition (winner splash panel, staggered
   score panels, chapter-title score), per-gametype layouts (duel head-to-head
   first — the mode most in need).
3. **Tier 2 = Acts 1–2** — MATCH POINT, final-seconds escalation,
   finishing-blow hit-stop/slow-mo + manga freeze-frame, music timed to the
   kill. This is where "best ever" starts being earned.
4. **Tier 3 = flourish** — page-turn transitions, POTG replay from the demo
   buffer, accolade panels, rematch/next-map vote on the page.

Guardrails:
- Keep it **presentation over authoritative state** — the server decides
  winner/phase/duration; the client renders. This keeps it demo-faithful and
  determinism-neutral (no sim changes except the PostGame input gate, which is
  itself deterministic).
- The input freeze is the one gameplay-affecting change — gate it cleanly on
  `phase === Active` in the movement/weapon input path and cover it with a test.

---

## 7. The Duel Face-Off — 3D versus tableau (brainstorm)

> "Could we render two facing models with team colors (for each player locally)
> with their most used gun in hand?" — yes, and it might be the single most
> memorable element of the whole screen.

### Why this works *here* specifically

- **Detached model spawning already exists** — the death camera added
  `RemotePlayerRenderer.createDetachedModelAt` (spawn a posed player model
  anywhere, outside the sim). The face-off is two of those + a camera.
- **"For each player locally" is free** — team tint/outline are *client-side
  cvars* (`cl_team_*_color`). Each viewer already sees their own palette, so the
  tableau is automatically personalized (and colorblind-friendly) with zero
  server work.
- **Weapons attach to models already** (third-person weapon on bone). "Most used
  gun" just needs a per-player weapon-usage stat in the `match_result` payload
  (kills-per-weapon or shots-per-weapon — track in WeaponSystem/CombatSystem).

### The tableau (duel Chapter End page, Act 3)

Two full player models on a shallow diorama stage, facing each other in
three-quarter view — close enough to read, angled like a versus splash page:

- **Winner side**: model standing tall (taunt/idle-aggressive anim if we have
  one; static heroic pose is fine), most-used gun in hand, team tint + outline
  glowing, speed-lines radiating from behind, name + final score stacked above.
- **Loser side**: smaller panel scale-wise (manga hierarchy: winner gets the big
  panel), gun lowered / kneeling / or the classic "on one knee, gun as crutch";
  desaturated halftone treatment.
- Between them: the giant chapter-title score `12 — 7`, and the match arc as tiny
  stamps (FIRST BLOOD, longest streak, lead changes) running down the gutter.
- The camera does a slow dolly/parallax across the diorama for the whole screen
  duration — a living page, not a screenshot.

### Riffs and variations to consider

- **Pose = how the match went.** Blowout → winner towering, loser flat on the
  floor. One-frag nailbiter → both standing, winner just half a head taller,
  "CLOSE FIGHT" stamp. The tableau *tells the score* before you read a number.
- **The actual final moment as pose source**: freeze the winner's model in the
  animation frame they were in at the finishing blow (we have the anim state) —
  the ending literally poses the statue.
- **Weapon story**: each model holds their most-used gun; a small stat chip under
  each ("PG 41% — 6 frags"). If the final blow was a different weapon, that gun
  gets a small inset panel ("FINISHED WITH: ROCKET").
- **Battle damage**: winner's model keeps low-health visual state if they barely
  survived (if/when we have damage states) — "won on 8hp" is legendary and the
  tableau should show it.
- **TDM/DM adaptations**: TDM → two front-line models (each team's top fragger)
  in the same face-off; DM → podium variant, top-3 models, #1 center-forward.
- **Rivalry continuity** (stretch): rematch against the same player → "ROUND 2"
  stamp, running series score (2–1) on the page corner. Duels become a story arc
  across matches, which no arena FPS bothers to do.
- **Warmup echo** (stretch): the *next* warmup's first seconds show the previous
  chapter's mini-page in a corner — continuity between matches, and it makes the
  between-match flow legible.

### Technical sketch

- A `PostGameStage`: hidden diorama root (offscreen or depth-cleared layer, like
  the weapon camera pattern) + 2 detached models + weapon attach + a rail camera.
  Rendered behind the DOM page composition (page panels are DOM/CSS on top; the
  3D face-off shows through a panel-shaped viewport — a manga panel with a
  *window into 3D* is exactly the mixed-media wow moment).
- Server: extend `match_result` with per-player `mostUsedWeapon` (+ per-weapon
  frag counts). Everything else is client presentation.
- Risks: model/anim availability for poses (start with static poses); one more
  camera+layer interaction (we just learned this dance with the ammo counter).

## 8. Open questions

- **Input lock granularity**: fully freeze (can't move/look) vs. free-look but
  no fire/move? Overwatch-style free-look while the board shows reads well.
- **`postGameDuration`**: 10s enough for a winner slam + board + music beat?
  Duel might want a touch longer to savor a clean win.
- **Winner authority**: derive client-side (simplest) vs. add `winner` to the
  snapshot / a one-shot `match_result` event (cleaner, needed for MVP stats).
- **Draws**: what shows on a tie — "DRAW", or force OVERTIME per gametype?
- **Stats budget**: frags/deaths are free; damage/accuracy/streaks need the
  server to track and ship them — worth it for MVP/accolades, but scope it.
- **Weapon-usage tracking** (for the Face-Off's "most used gun"): per-weapon
  frags is nearly free in CombatSystem; per-weapon shots is more bookkeeping in
  WeaponSystem. Frags-per-weapon is probably enough for "most used".
- **Face-off poses**: what anims do the player models actually ship with? Start
  with static poses; inventory the anim set before promising taunts/kneels.
- **Sequence timing**: is 15s right? The beat sheet wants ~15s (duel ~18s);
  playtest and tune `postGameDuration` per gametype.

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
