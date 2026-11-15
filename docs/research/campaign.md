# Campaign mode

Started 2026-11-15 on `staging`. Goal: a story campaign of eight missions,
played alone against bots, built so that friends can later play it together
(co-op is a release target). The player picks a mission on a Campaign page,
watches that mission's comic card, and lands in a match whose map, gametype,
bots and player models the campaign decides. Winning clears the mission and
unlocks the next one; progress belongs to the account.

## Missions

Eight missions; the first four are defined, the last four show as locked and
classified until they are written.

| # | Map | Gametype | Rival | Bots | Models (you / enemy) | Story beat | Art |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | `washoi_amphi2` | Amphi (1v1 rounds) | Cartel King | 1 Easy | robot / cartel | Prove yourself to the Cartel | card1 |
| 02 | `washoi_dm1` | FFA | Street Rioters | 4 Easy | robot / riotkitty | The street riot | card2 |
| 03 | `washoi_snd1` (Concrete Strike) | S&D | Metropol Riot Cops | 4 Medium allies, 5 Medium enemies | robot / police | First sabotage mission | card3 |
| 04 | `washoi_dm2` | Duel | Glitch Punk Leader | 1 Medium | robot / riotkitty | Rival gang leader | card4 |
| 05-08 | — | — | — | — | — | classified | — |

The protagonist in the art is the hooded robot with the anarchy mark, so the
player's own model is `robot` throughout. Missions 1 and 2 are the ones built
and tested first; 3 and 4 have their rules in the catalog so they unlock in
order, but S&D bot team play is still being worked on in another branch.

## Flow

1. **Campaign page.** A rail key under Quick play opens it. The operations
   run down a scrolling list, each row the whole comic card (16:9) with its
   details beside it, each with one bullet naming its game mode: cleared
   (most frags of the best clear, Replay),
   next (Play), classified (a shallow strip). A track down the
   left joins the rows, cyan through cleared operations, gold at the next,
   dashed beyond; the list opens centred on the next one. The header shows
   `n / 8 cleared`. Above it a banner shows the squad (`squad.webp`, cut out)
   standing on the street (`street.webp`), both in one 16:9 stage at the scale
   they were drawn for, heads to waist, masked out at the bottom into the
   page's purple; a blurred copy of the street fills wide screens. Scrolling
   the list drifts the street at 0.035 and the squad at 0.08 of the scroll
   (capped at 600 px). Like the lobby's drifting lights, the banner's motion
   and the comic card's drift run whatever the system's reduced-motion
   setting says. An idle handheld-camera
   sway runs on the layers' `translate` (apart from the scroll drift on
   `transform`): the street wanders up to about 18 px over a 17 s loop and the
   squad a quarter as far, so the street slides behind them.
2. **Play.** The client asks the lobby for a campaign room
   (`lobby:create` with `campaign: <missionId>`) and at the same moment fades
   the screen to black and plays the mission's comic card.
3. **Comic card.** Full black background. The card's first framed panel is
   zoomed to fill the screen and drifts slowly (a little tilt and pan);
   everything outside that panel is blurred and dimmed. After 5 seconds, or on
   a click or key, the view moves to the next framed panel the same way. After
   the last panel it fades to black.
4. **In the background** the lobby has created a private room with the
   mission's single map and filled it with the mission's bots. The room view is
   the normal one, behind the card. When the card ends the client readies up;
   the room starts once every campaign bot is seated, and the normal connecting
   overlay and loading screen take over.
5. **Match** plays out normally; the end screen and Return to lobby are the
   ones every match has. Return to lobby comes back to the Campaign page.
6. **Win** clears the mission: the lobby stores it for the account and sends
   the new progress, which the client mirrors to `localStorage`. The next card
   unlocks.

## Architecture

The lobby owns the rules; the game client owns the presentation.

| Piece | Where | What |
| --- | --- | --- |
| Mission rules | `config/campaign.json` | id, map, gametype, bots (name, skill), human side, forced models. Read by the lobby at start, the way `config/maps.json` is. |
| Rules parser and unlock logic | `src/lobby/Campaign.ts` | Validates the file, `unlockedThrough(clears)`, `roomUnlockedThrough(members)`. Pure, unit-tested. |
| Progress store | `src/lobby/CampaignStore.ts` | `campaign.db` beside `players.db`: one row per account and cleared mission, with the best time and frags (the page shows frags only: most matches run to a time limit, so a time says little). |
| Lobby server | `src/lobby/LobbyServer.ts` | Campaign rooms, bot fill, start condition, result hook, `campaign:get` / `campaign:state`. |
| Story and art | `src/games/fps/client/campaign/CampaignStory.ts` | Titles, one-line hooks, card images and the panel rectangles of each card. |
| Campaign page | `src/games/fps/client/campaign/CampaignView.ts` | The operations list with its progress track, start. |
| Comic card | `src/games/fps/client/campaign/CampaignCutscene.ts` | Black screen, panel zoom with blur outside, click/5 s advance. |
| Forced models | `src/games/fps/client/PlayerModelSelection.ts` | An override layer above the player's model settings, set for a campaign match. |

Missions are addressed by id (`cartel-contract`, ...), not by number, so a
mission can be inserted later without renumbering anyone's progress.

### Why the lobby decides

A campaign room is a private room with extra rules, and the lobby already owns
rooms, bots and verified match results. Doing the campaign there means:

- **Progress cannot be forged by a client.** A mission is cleared only from a
  verified match result (`MatchResultReport`, signed by the game server), for
  a match the lobby itself started as that mission.
- **Co-op needs no new path.** A friend joins the campaign room with its invite
  link like any private room; the lobby checks their progress and seats them on
  the human side.
- **The match is fixed.** Players in a campaign room cannot vote another map,
  add or remove bots, switch sides or shuffle; the room has one map and the
  mission's roster.

### Lobby rules for a campaign room

- Created only if the creator has unlocked the mission
  (`unlockedThrough(clears) >= mission number`).
- Private, with a one-map pool (the mission's map) and the mission's gametype.
- The lobby invites the mission's bots one at a time, named as the campaign
  says ("Cartel King"), at the campaign's skill. Humans cannot add bots.
- Teams: humans on the mission's human side; each bot is an ally (the human
  side) or an enemy (the other side), as the mission lists it. FFA has no
  sides.
- Starts only when every campaign bot is seated and every human is ready.
- `lobby:connect` carries `campaign: { missionId, models }` so each client
  draws the mission's models.
- When the verified result arrives, every human account in the match is
  cleared if any human won (co-op: the humans win or lose together; in FFA
  that means a human placed first). Draws and losses clear nothing.
- Matches are not ranked: one human against bots never is
  (`isRankedRoster`), and co-op rooms are mostly bots.

### Co-op rule

"Progress is limited to the lowest unlocked mission": a campaign room can be
started or joined only for a mission every human in it has unlocked.
`roomUnlockedThrough(members)` is the minimum of each member's
`unlockedThrough`. A joiner who has not unlocked the room's mission is refused
with a reason. Seats are humans plus the mission's bots, capped at the
gametype's maximum, so a 1v1 mission (Amphi, Duel) has no room for a friend;
those missions need a co-op variant (two humans against a boss pair, or a
2v2) when co-op is built.

### Forced models

Models are a client-side choice (`cl_team_ally_model`, `cl_team_enemy_model`).
The campaign does not change those settings; it sets an override that
`playerModelChoice()` checks first, for the duration of that match. The
override comes from `lobby:connect` and is kept in `sessionStorage` across the
connect hand-off, like the lobby team already is. Voices follow the model, as
they do for the settings.

### Progress in the profile and in localStorage

The lobby is the record (`campaign.db`), keyed by account id, so progress
follows the account key to any browser. The client keeps a copy of the last
state it received in `localStorage` (`washoi.campaign.<accountId>`) so the
page draws instantly and offline; the lobby's answer replaces it.

## Messages

| Message | Direction | Payload |
| --- | --- | --- |
| `campaign:get` | client → lobby | — |
| `campaign:state` | lobby → client | `length`, `missions[]` (id, number, map, map title, gametype, bots, models), `clears[]` (mission id, cleared at, best time ms, best frags), `unlockedThrough` |
| `lobby:create` | client → lobby | adds optional `campaign: missionId` |
| `lobby:connect` | lobby → client | adds optional `campaign: { missionId, models }` |
| `welcome.features.campaign` | lobby → client | true when the lobby runs the campaign |

The lobby sends `campaign:state` after welcome and again whenever the account's
progress changes.

## Status (2026-11-15)

Built: the lobby rules, store and messages; the Campaign page; the comic card;
forced models; return to the Campaign page after a campaign match.

Verified in a headless browser (WebGL2) against a scratch lobby and bot server:

- Mission 1: page shows mission 1 current and 2-8 locked; Start mission plays
  card1's two panels (zoom, drift, blur outside the panel, auto-advance at
  5 s); the lobby opens a private room on `washoi_amphi2` with `Cartel_King`;
  the client readies after the card; the match loads with models
  robot / cartel.
- Unlock: with a clear of mission 1 in `campaign.db`, the page shows mission 1
  cleared (8:24, 32 frags), mission 2 current, the rail key `1 / 8 cleared`,
  and the state is cached in `localStorage`.
- Mission 2: card2 advances on key presses; the room seats Jolt, Fizz, Buzz and
  Rush, starts only once all four are in, and loads `washoi_dm1` FFA with
  models robot / riotkitty.
- Layout at 1600×900 and 1280×720.

Covered by unit tests, not yet seen live: a won match clearing the mission
from the game server's real result line (the headless player cannot win), and
Return to lobby landing on the Campaign page.

## Campaign server (2026-11-15, second pass)

The owner's play-through cleared missions 1-3; FFA on dm1 needs a real win
(first place, no tie for the top score), which `recordCampaignResult` checks.

One flag carries a campaign match from the lobby to the demo: the lobby spawns
the game server with `--campaign <missionId>` (`SpawnConfig.campaign`), and the
server:

- **Admits only its seats.** A connection without a lobby ticket is closed
  ("campaign match"), so nobody spectates; `admitSeat` refuses drop-in seats,
  and the lobby's `handleDropIn` refuses campaign rooms first. Campaign rooms
  are private, so the queue and the public lists never offer them.
- **Starts without a ready-up.** `MatchState.setCampaignStart(people)` (people =
  the admission manifest's non-bot grants): warmup ends as soon as every seated
  person is in the match with an opponent, or after 60 s if one never arrives.
- **Holds a 10-second opening countdown.** `countdownFreezes` makes the server
  zero input during it, as a round mode's freeze does; outside round modes the
  match reset and respawns move from going live to the countdown's start, so
  everyone waits at their spawn. A round mode (Amphi) gets the 10 s for its
  first round only. The client mirrors the hold
  (`MatchStateManager.setCampaignCountdown`, set at connect from the campaign
  hand-off) so prediction does not walk through it and snap back. The
  announcer already says "get ready" at the start of a countdown long enough
  for it, then three, two, one and fight.
- **Marks its demo.** Demo format v8 adds the mission id to the header after
  the privacy byte; frames keep the v7 layout and the reader accepts v1-v8.
  The lobby keeps campaign demos out of **Latest**, featured picks and
  `welcome`'s recent demos, and lists them in **Your demos** for the accounts
  the verified result names, so players can still cut highlight videos.

**Completion flag.** `campaign.db` has `campaign_completions`: the first time an
account has cleared every mission of the full `length` (all eight written and
cleared). `campaign:state` carries it as `completedAt`. Nothing shows it yet;
it is there for the reward.

**Models in FFA.** A free-for-all player has a server-assigned look (body and
colour, demo v7), which wins over the client's model choice, forced or not. So
the campaign's forced models apply in team modes (Amphi, Duel, S&D); FFA keeps
its mixed crowd, which the owner liked.

**Ratings.** A campaign match is a private match with bots, so it is recorded
and rated like any other (`normalizeResult` records private bot matches with
one account). Whether it should be is an open question below.

## Concrete Strike and the crew (2026-11-15)

- **Attack only.** A mission may set `"side": "attack"` (S&D only). The lobby
  passes `--campaign-side attack`; the game server finds the players' team
  from their seats in the admission manifest and calls
  `MatchState.setAttackersThroughout(team)`: that team attacks every round
  (`roundsPerHalf` off, so no swap and no overtime) and `leadRequired` drops
  to 1, so the first side to the round limit (10) wins, 10-9 included.
- **Mixed crew.** A campaign bot may carry its own `model`; the lobby sends
  them as `botModels` (name to model) in the campaign hand-off, and the
  renderer draws a player named there with that model before the side's
  model applies. Concrete Strike's crew is cartel, riotkitty, cartel,
  riotkitty; the player stays the robot; the defenders are police.
- **Green teammates.** In a campaign match the ally style is always the
  palette's Lime, tinted and outlined (outline at least size 25), whatever
  `cl_team_ally_color`, `cl_player_tint` and `cl_player_outline` say
  (`setCampaignTeammates`, set at connect). Enemies keep the player's
  settings.

Verified live (headless WebGL2): round 1 had our side (soba) attacking, the
crew resolved to the four models above with the cops as police, and the
screenshot during the held countdown shows a lime-tinted, lime-outlined
cartel and riotkitty beside the player.

## Missions 5-8 (plan from the owner)

| # | Map | Mode | Rival | Difficulty | Story beat |
| --- | --- | --- | --- | --- | --- |
| 05 | `washoi_dm18` | Survival (special) | Rival Cartel Bot Guards | Medium | Caught in the bot trap |
| 06 | `washoi_amphi1` | Amphi (1v1 rounds) | Heavy Siege Bot (2x scale) | Hard | The final robot boss |
| 07 | `washoi_snd6` (Depot) | S&D | Pink-Visor Spec-Ops & Unit 07 | Hard | High-profile cash heist |
| 08 | `washoi_dm5` | 1v2 handicap | Metropol Police Duo (male & female) | Insane | "Your road ends here" |

### 05 Survival

A single-player fragfest against weak robots on dm18:

- 5 minutes. The player cannot die.
- Robots: robot model, 42 HP, machine gun only (no blade), nameless.
- A fixed number of robots alive at all times: 4 in the first minute, 6 in
  the second, 7 in the third (and after, unless decided otherwise); each one
  killed is replaced by a new one.

What it needs, roughly:

- A server-side mode or a campaign rule set on top of a team deathmatch: the
  player on one side, robots on the other, no score limit, 5-minute limit.
- Per-spawn rules for bots: health 42, loadout machine gun only, no blade;
  the player takes no damage (or cannot drop below 1 HP).
- A director that keeps the robot count at the minute's target: spawning by
  the game server itself (it already spawns bots with `spawn_bots`) rather than
  lobby invites, since robots come and go every few seconds.
- What counts as winning: surviving is guaranteed, so clearing needs a goal
  (a frag count, or simply finishing). To decide.

### 06 Heavy Siege Bot

A 2x scale boss: a model and hitbox scale on one player entity. Collision,
hitboxes, camera height and movement all read the player size, so this is the
largest engine change of the eight. Needs its own design pass.

### 08 1v2 handicap

Two enemy bots on one side and the player alone: the team modes already
allow uneven sides, so this is a Duel/TDM-style match with the mission's two
bots on one team. The duo wants two models (police and female police), which
needs per-bot models on the enemy side.

### Co-op later

The owner's direction: 1v1 missions become 2v2 in co-op through a "tdm" option
that lifts the team size limit with the same rules otherwise, so co-op plays
2v2 Amphi and 2v2 TDM instead of 1v1. To be planned when co-op is built.

## Open questions

Collected for review; the implementation picks a default for each.

1. ~~**Models for missions 2-4.**~~ Answered: Cartel King right; FFA's mix is
   good (it is the FFA look system, see above).
2. **Bot skill per mission.** Easy, Easy, Medium, Medium from the table. Should
   a cleared mission offer a harder replay?
3. **Grades.** The mockup shows S / A+. Defaults to time and frags only until a
   grading rule is chosen.
4. **Campaign rewards**: nothing yet; the completion flag is in place.
5. **Co-op on 1v1 missions**: a "tdm" option for 2v2, planned later.
6. **Replays.** Cleared missions can be replayed; a replay that is faster or
   with more frags updates the best.
7. **Cards on replay.** Should the comic card be skippable at once (Esc) on a
   replay? Click already advances.
8. **Missions 5-8**: planned above; art to come.
9. **Co-op seats.** A full room refuses a second human. Should ally bots (the
   S&D crew) give up their seat to a joining friend?
10. **Bot names.** Bots follow the player-name rule (2-16 letters, digits, `_`,
    `-`), so the Cartel King plays as `Cartel_King`.
11. ~~**Card 3**~~ Answered: caption first, then the panels, is right.
12. **Ratings.** Campaign matches count toward the player's record and rating
    like any private bot match. Keep that, or leave campaign matches out of
    results and ratings?
13. **Survival win.** What clears mission 05, when the player cannot lose?
