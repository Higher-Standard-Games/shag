# Lobby server

The lobby is a WebSocket server that owns everything around a match: who a
player is, the room they wait in, the dedicated game server that gets spawned
for them, and the result that comes back. It is a separate process from
both the browser client and the game servers it starts.

Washoi owns application startup at `src/games/fps/cli/lobby-server.ts` and
the server build recipe at `src/games/fps/scripts/build-servers.mjs` in the
assembled checkout. Reusable lobby, account, result and process-management
services remain in SHAG. The examples below start at the assembled SHAG root;
the game package owns the commands. Install dependencies once at that root.
Inside `src/games/fps`, use `npm run lobby:server` or `npm run bot:server`.
Both forms launch with the SHAG root as their working directory, so relative
`--data-dir` paths and `public/data/` keep the same location. The outer package
does not provide a `lobby:server` shortcut.

Washoi's demo-ownership and real lobby/match integration tests live in
`src/games/fps/server/__tests__/lobby/`. `npm --prefix src/games/fps run ranking:acceptance` includes
these tests alongside SHAG's reusable lobby and ranking tests.

Application name reservations are explicit: pass the same predicate to
`PlayerStore.open(dataDir, isReserved)` (or its constructor), browser
`checkPlayerName(name, isReserved)` and `logIn(client, isReserved)`.
`LobbyServerOptions.reservePlayerName` configures the lobby's own in-memory
store; a supplied `players` store carries its own policy. Generic validation
always reserves `Player_<digits>` and checks name syntax. Washoi supplies
`isBotName` for its additional reservations, including numbered bot names.
Account key formats and stored records are independent of that predicate.

`LobbyServerOptions.resolveDemoMap` resolves the map media key used for demo
levelshots. Without it, the lobby normalizes path, extension and case without
game-specific aliases. Washoi supplies `resolveFPSDemoMap`; the recorded map
identity and ownership checks keep using the recording's original map.

```bash
npm --prefix src/games/fps run lobby:server -- --port 9000 --data-dir ./server-data
```

The default server runtime is Node 24 or newer. The start command first builds
the server artifacts under `dist-server/`, then runs the lobby with Node.
`npm --prefix src/games/fps run lobby:server:node` selects Node explicitly.
`npm --prefix src/games/fps run lobby:server:bun` is an experimental alternative requiring the Bun
version recorded in `.bun-version`. Node and npm remain required for building
and development; Bun is optional.
`npm --prefix src/games/fps run lobby:server:dev` retains the Vite-based development launch.
The bot server follows the same pattern: `npm --prefix src/games/fps run bot:server` builds and runs
`dist-server/bot-server.mjs`, `npm --prefix src/games/fps run bot:server:dev` the Vite launch.

A bundled server starts in about a quarter of a second and uses about half the
memory of the Vite launch, which transpiles the TypeScript sources at every
start (a `washoi_dm2` match server: 0.26 s and 122 MB against 1.1 s and
268 MB). `npm --prefix src/games/fps run build:server` builds into a staging directory and swaps it in
at the end, so a lobby spawning a match during a rebuild never loads a
half-written bundle. Rebuild after changing server code: bundled servers run
what was built, not the working tree.

Game servers inherit the lobby's actual runtime executable and launch mode.
A Bun lobby spawns Bun matches; a production Node lobby spawns production Node
matches. Children run directly, without an npm or shell wrapper. Startup logs
identify the runtime/version and PID. A missing runtime fails startup rather
than silently choosing another one. Owned match servers accept `quit` on stdin
to finish recording and shut down; the lobby retains its forced-kill timeout.

Application startup supplies the dedicated server's entry locations through
the second constructor argument to `GameServerSpawner`:
`{ sourceEntry, bundledEntry }`. Paths can be absolute or relative to the
assembled project root (the working directory captured when the spawner is
constructed). Washoi's lobby CLI supplies `FPS_SERVER_APPLICATION` from
`src/games/fps/server/FpsServerApplication.ts`. It selects the game-owned
`src/games/fps/cli/headless-netserver-v2.ts` source entry and the
`dist-server/headless-netserver-v2.mjs` artifact. Commands run from the
assembled project root; moving the source does not change the child's cwd.

The runtime selects the bundled entry when the parent entry is an `.mjs` file
directly under the root's `dist-server/`; otherwise it selects the source entry.
A spawner constructed without application entries can support lobby-only use,
but a spawn request fails before allocating a port or preparing result delivery.
Reusable lobby code has no default game-server entry path.

See [Headless mode](./headless-mode.md#server-memory-profiling) for reproducible
memory benchmarks. All standalone/profile runs should use scratch data paths.

Browsers reach it through `VITE_LOBBY_URL`. The environment variables it reads
are listed in [Configuration](./configuration.md).

## Map pools

`config/maps.json` assigns display names and gametypes to maps. The lobby reads
it at startup and filters the pools against installed `map_*.pk3` packages in
`public/data/`. Numbered SHAGGED packages such as `map_solamphi1_00008.pk3`
also advertise their base map name, `solamphi1`.

The Amphi pool contains `washoi_amphi1` from `map_washoi_amphi1.pk3`, with shared
media in `washoi_textures.pk3`. Relay Yard (`solamphi1`) and the DA arenas
are excluded. Restart the lobby after changing the configuration.

The S&D pool contains only Concrete Strike (`washoi_snd1`), provided
`map_washoi_snd1.pk3` is installed. Duel and FFA use Washoi DM2, DM5 and DM11.
The room's map vote keeps three card slots. With fewer offered maps, unused
slots display disabled placeholders and cannot receive votes.

## Chat filtering

Lobby and room chat mask recognized English profanity as `***` before delivery
and history storage, including private rooms. Match servers apply the same filter
to global, team and spectator chat. The general dictionary uses whole words with
Unicode boundaries; a small list of strong terms also matches inside words to
catch added-letter bypasses. Player names are unchanged. It does not issue
penalties and does not cover every language or deliberate spelling bypass.

## Accounts

Every connection has an account — there are no guests. A browser that connects
without a key is given a new account named `Player_<number>` and a key, sent
once and kept in that browser's local storage. Pasting that key into another
browser opens the same account.

- The key is 24 characters of Crockford base32, 120 bits of randomness.
- The server stores an account id, the SHA-256 of the key, the name, and the
  name folded to lowercase. It never stores the key itself and never logs one.
- Names are unique regardless of capitals. `Player_<digits>` and the bot
  server's names are reserved.
- A rename reaches every connection logged in to that account, and everyone
  else's player list. It is refused while the player is in a room, because a
  room holds its own copy of every name.
- New accounts, wrong keys and renames are rate-limited per address. Behind a
  proxy on the same machine, the address comes from `X-Forwarded-For`, believed
  only from loopback.

The design, including what a lost key means, is in
`docs/research/PLAYER_IDENTITY.md`.

## Player cap

The lobby takes at most 64 players online at once. A player over the cap is
told so at login, before an account is opened or created, and disconnected:

```bash
npm --prefix src/games/fps run lobby:server -- --max-players 40     # or SHAG_LOBBY_MAX_PLAYERS=40
npm --prefix src/games/fps run lobby:server -- --max-players 0      # no cap
```

- **Who counts:** connections that have logged in. Bots don't count and are
  never turned away; connections still logging in don't count.
- **The answer** is `auth:error` with code `lobby_full`, the number online, the
  cap, and `retryAfterSec` (60), then close code 4008.
- **Coming back:** an account that disconnected within the last minute gets back
  in over the cap, once. "Return to lobby" reloads the page, and the slot it
  frees must not go to someone else in between. The lobby can briefly hold a
  few more than the cap because of this.
- **In the browser** a "Servers are full" card sits over the lobby chat, which
  is closed meanwhile. It counts down to the next try, the lobby's wait give or
  take ten seconds so the players turned away don't all return at once, and
  has a **Try now** key. Settings, demos and the rest of the menu still work.
  The Find key reads "Servers full".

The cap is per lobby, so per region. It counts players, not matches: a player
waiting in the lobby costs next to nothing, and what fills a server's memory
is running matches. Size it from the capacity matrix in the deployment notes.
The lobby logs its cap at start and every player it turns away.

## Connection recovery

An unavailable lobby shows **Lobby offline** with **Try now**. The browser
automatically retries after approximately 2, 5, 10, then 30 seconds, with jitter
to spread returning clients. Only one connection attempt runs at a time. This
is separate from the longer full-server admission wait above. A reconnect tries
to rejoin the remembered room only if the logged-in account is unchanged; a
server restart may have removed that room.

If browser storage fails, the accepted account key remains available for this
page's lifetime. Welcome/Profile warn the player to copy or save it before
reloading. Incoming WebSocket messages are limited to 64 KiB; outbound welcome
and archive responses may be larger. Demo archive requests include a request ID
for stale-response protection and show **Try again** after a 10-second timeout.

## Rooms

A room is one gametype, one map vote and up to that gametype's player count.

- **Public or private.** A private room is absent from the live match list, the
  queue and the player list; the only way in is a link carrying its invite
  token, which is 24 random bytes, separate from the room id. Adding a bot to
  a waiting public room makes it private: the room gets an invite token, leaves
  the public lists and the queue, and its members receive `lobby:made_private`
  with the new `shareUrl`.
- **Teams** are `alpha` and `bravo` on the wire, with display names the
  gametype supplies. A joining player is auto-assigned to the smaller side and
  may switch without a vote; a shuffle needs `ceil(players / 2)` votes.
- **Maps.** Three are drawn from the gametype's pool, and only maps that are
  actually installed are offered. Most votes wins, ties are random.
- **Bots** play in private rooms only, invited through the bot server, at `easy`,
  `medium`, `hard` or `insane`. An invite that names no level (the room's
  **+ Add bot**) fields the preset whose Private rating in the room's mode is
  nearest the inviter's, with a minimum of Hard. A player with no rating meets
  Hard; a rating match to Insane selects Insane. Explicit preset requests can
  still select any level. The room shows each bot's level on its seat. A bot plays its ratings
  as its preset's account (see "Bots are rated accounts"). Once the last human
  leaves, the room's bots are evicted so a bot-only room can never linger or
  start a match.
- **Chat** belongs to the room: members only, the last 50 messages handed over
  on joining, gone when the room is destroyed.

### Coming back from a match

Returning from a game server is a page load, so the player arrives on a *new*
lobby socket while the one that carried them into the match may not be known to
be gone yet. A room gives the seat to the newest connection of that account:
the older connection is told it left, the room drops the empty chair, and the
returning player keeps the side they were playing and comes back unready. The
room itself is held open for a few minutes after its match server exits, so a
reload that drops every socket at once still finds it.

## Starting a match

When everyone is ready, the lobby spawns a dedicated game server for that match
alone and hands each player a ticket to it.

FFA can start with four players and holds up to eight. S&D can start with two
players, with both teams populated, and holds up to ten. Every player present
must be ready; the minimum does not allow a room to launch past unready players.
Duel and Amphi require their two seats.

1. The lobby picks the winning map and spawns a game server on a free port.
2. It builds a seat manifest — one entry per player, each with its own secret
   token — and passes it to the child as `SHAG_MATCH_ADMISSION`, along with the
   secret its result will be signed with.
3. Each client is sent the server URL and *its own* token. A name a client
   sends identifies nobody; the token does.
4. A seat survives a dropped socket, so a reload before the match starts can
   claim the same seat rather than a new one. Mid-match, the game server holds
   a dropped player's seat for 20 seconds against a resume token.
5. A connection with no ticket is allowed to watch; it takes a seat only with a
   ticket (see *Joining a match under way*).
6. If the child does not report ready within `SHAG_SPAWN_TIMEOUT_MS` (45
   seconds by default), the lobby terminates it — SIGTERM, then SIGKILL — so
   the port is released, and tells the room why.

When the child exits, the room returns to waiting with its ready flags cleared,
and everyone in it is told the match ended.

### Joining a match under way

A running room takes players while it has fewer than its gametype's player
count, as a Quake or Warsow server does. Joining it (`lobby:join` on a playing
room) is a drop-in:

1. The lobby seats the player in the room at once, on the smaller side, so two
   players cannot both take the last place while the server answers.
2. It issues the seat a ticket and a recovery ticket, and writes their hashes
   to the game server's stdin as `admit <base64url JSON>`. Only the parent
   process can write there, and the raw tickets never leave the lobby.
3. The game server adds the grants and prints `SHAG_ADMITTED <seat id>`. Only
   then is the player sent `lobby:connect` with the ticket: a ticket handed out
   earlier could reach the game server before its own seat. No answer within
   three seconds, and the seat is given back with "Could not join the match."
4. A client already watching that server claims the seat on the connection it
   has, with the ticket in its `JoinGame`; anyone else connects with it as a
   normal player would.

The drop-in seat is added to the manifest results are verified against, so a
late player's result counts, and its recovery ticket serves **Rejoin match**
like any other seat. A full room answers "This match is full."; bots and
connections without an account cannot drop in. A Duel whose two sides are taken
— including a side held for a player who dropped — puts the newcomer in the
challengers queue, and the side is theirs when it frees.

## Results and ranking

### The result report

The game server prints one signed line when the match ends, naming each seat's
ticket and how it finished. The lobby refuses anything malformed, oversized,
forged, or naming a seat that was never on the roster, and stores the result
once, keyed by match id.

The child-to-lobby result contract is **V2**. It binds played seats to stable
admission IDs and records match start and end, join and leave ticks, the teams
played, final team scores, placements and the completion reason. Initial and
recovery credentials and resumed sockets cannot create two result participants
for one seat. The lobby does not accept V1 result lines, so upgrade the lobby
and the game-server code together.

A player who disconnects remains in the final played roster. In FFA their last
score survives a permanent departure, and equal scores share a placement at any
position: tied leaders receive draws, lower placements receive losses. A client
who only watched, or left for good before the match started, creates no played
entry.

In a started single-match Duel or Amphi game, a human whose **20-second** resume
grace expires forfeits, provided the original two opponents played from the
start, stayed on their sides, and the other is still playing on a connected
socket. Both seats and the actual scores are kept, and the forfeit decides the
outcome even when the departed player was leading. Simultaneous departures, an
empty match and a graceful mid-match server stop are aborted, with no invented
win or draw. FFA and S&D have no disconnect-forfeit rule.

A verified report is saved as a normalized V2 snapshot with its played seats,
starting roster and the reasons for how it was processed. The snapshot and its
win/loss/draw record commit in one SQLite transaction. Aborted reports are
logged as `skipped: aborted` and change no record. Ticket fields and
authentication secrets are left out of the journal. A different result under an
existing match ID fails; an equivalent duplicate in another order keeps the
original receipt.

### Which matches count

A public match is ranked from the roster it starts with:

| Mode | Ranked when |
| --- | --- |
| Duel, Amphi | Both players are people |
| Team modes | More than half the room is people, **and** each side has at least one |
| Free for all | More than half the room is people |

Two people is the floor in every mode. The team rule needs its second half
because a majority alone would rank four people against three bots, which is
people farming bots. The rule lives in `isRankedRoster()` in
`src/lobby/LobbyServer.ts`.

Private matches are kept separately from the public record. Against bots, one
verified account is enough, and a loss to a bot counts too. A private
human-only match still needs two verified accounts and consistent outcomes. The
visibility and the bot-seat count are fixed from the room's starting roster,
and the result comes only from the authenticated game-server report.

### Skill ratings

Each complete, eligible result updates TrueSkill ratings atomically, storing
every player's before and after state, in separate Public and Private pools for
Duel, Amphi, S&D and FFA. The original roster must play from the first active
tick on unchanged sides. Late joins, missing participation evidence and
interrupted play keep their records but are excluded from skill, with the
reason stored. A spectator departure stays marked after rejoining; an entity
held through a reconnect keeps participating. A valid final Duel or Amphi
forfeit is eligible. S&D rates by team standings; FFA rates every placement,
including ties.

Lobby display sides use the same mapping as gameplay and result normalization:
`alpha` is Soba and `bravo` is Udon. Duel keeps the assigned side regardless of
connection order.

### Bots are rated accounts

Each bot preset is an account: **Bot · Easy**, **Bot · Medium**, **Bot · Hard**
and **Bot · Insane**, rated in each mode's Private pool like a player but
left off the leaderboards (see "Leaderboard"). A private match rates every seat, people and
bots, under the same participation rules. The first bot of a preset in a match
is that account; a second one of the same preset plays at the account's
current rating and leaves it unchanged, since one account takes one seat. The
first bot seat of each preset also carries the account's win, loss or draw.

The account is made the first time its preset plays and has no key, so no one
can log in to it. `bot_accounts` in `players.db` maps each preset to its
account.

The bot service supplies each bot's reference (preset or custom difficulty,
goal arbiter, behavior build and loaded model), and the lobby accepts it only
from the authenticated local bot service; the admission manifest and the signed
result bind it to the played seat. These bot games keep their records but are
not rated:

| Reason | When |
| --- | --- |
| `bot_reference_changed` | A bot's configuration changed after the match handoff, even if changed back, or its control connection was lost before the result committed. |
| `bot_custom` | A bot played with a custom difficulty: it names no account. |
| `bot_reference_missing` | A bot's reference is absent from the result. |

Ranking schema **3** introduced the accounts. Opening a schema 1 or 2 store
rates every stored result again in sequence order, private bot games included,
and drops the old `bot_calibrations` table; the stored snapshots are the
source and are not changed. Upgrade the bot server, the lobby and the
game-server code together.

Bot invitations give an unavailable bot service eight seconds to respond. A
verified preparation announcement extends that once to 75 seconds, covering a
60-second model preparation and a ten-second lobby join. Closing or starting
the room, or losing the requesting control connection, cancels the preparation
and prevents a late bot join.

### Leaderboard

The leaderboard opens on **Public** matches. **Public / Private**, left of the
gametype selector, selects independent boards: Private contains only private
matches, including bot games. The bots' preset accounts are rated there (people
are rated against them) but never listed: both boards show people only, ranked
among themselves. The selection
applies to every mode and is remembered in that browser; the board, your pinned
row and the ranks in the rail all follow it.

The podium, rows, rail and profile rank by career skill in the selected pool.
Rows also show wins, losses, draws and matches, the rating, provisional status
and the number of rated matches. **Last 30 days** lists accounts active in that
window with their record over it; it does not reset or recalculate career
skill.

Clients ask for the skill ladder explicitly, using the advertised
`features.skillRatings` capability and `system: "trueskill"`; a lobby without
skill ratings answers with records only. Leaderboard queries are authenticated,
bounded and read-only: a mode, a period of the last 30 days or all time, an
offset and a page of at most 100. The answer carries the asking account's own
rank and row even when that row falls outside the page. `scope` is `public` or
`private`, defaulting to `public`; `leaderboard:page` echoes the resolved scope,
and clients reject a reply with a missing or different scope. Requests that use
the obsolete `includePrivate` field are rejected.

### Player stats and recent results

Lobbies that advertise `features.playerStats` show, in **Profile**, separate
Public and Private records and career gameplay totals for each mode. These do
not require a skill rating: a match excluded from rating still shows its
win/loss/draw and gameplay totals. Selecting a mode name opens that account's
ten most recent results; **Older matches** pages back through a stable sequence
cursor and **Latest matches** returns to the first page. Each entry shows the
personal score, frags and deaths, enemy damage, and the rating change or the
reason the match was not rated. In windows up to 1100px wide, the account
controls and records stack in one scrollable Profile.

The server records personal mode score, enemy frags, team frags, deaths, enemy
and friendly damage, plants, defuses and active participation time. Warmup,
countdown, round intermission, spectating and time after leaving for good are
excluded; being dead in an active S&D round still counts as playing. Damage is
counted before armor, and self-damage is not enemy damage. Team standings and
personal score are separate values. Weapon accuracy and assists are not
recorded.

Stats are versioned, whitelisted and part of the signed V2 result and its
snapshot. Ranking schema **2** added the `ranking_stats` table. Results stored
before it have no stats, and Profile says how many of the counted matches have
gameplay data when only some do. Aborted and excluded results keep their stats
for the player's own history but add nothing to career totals unless they have
an eligible record.

`stats:get` / `stats:summary` reads a mode and scope summary (`period: all`, or
`month` for a rolling 30 days of records and gameplay; rating and rank are
always career). `stats:history` / `stats:history_page` reads the account's own
results for a mode and scope (limit 1–50, optional exclusive `beforeSequence`),
including `ratingChange` when there is one. The connection's account decides
whose stats are read; a request cannot name another account. Reads share the
ranking rate limit and never return admission credentials or other players'
private match details.

### Delivery recovery

Supervised matches save their private verification context before the child
server starts. The child writes its signed final report into
`<data-dir>/result-outbox/` before printing it. On startup, every five seconds,
and on a graceful shutdown, the lobby collects valid completed reports from
there into the journal. The receipt commits before the files are cleaned up,
so a retry after a crash cannot rate a match twice. Failed and rejected reports
stay for retry and inspection. Nothing is invented for a child killed before it
wrote its final report.

```bash
npm run ranking:delivery -- --recover --data-dir ./server-data
```

This offline command writes recovered receipts without starting the lobby. It
is provided by SHAG and does not require the game checkout. The assembled
Washoi lobby's `--results-recover` option remains available with the same policy. It
requires existing, consistent storage, reports delivered, waiting, rejected and
failed counts, and exits non-zero on an error or rejection. Bot matches still
uncommitted when the lobby restarted keep their records but are excluded from
skill, because the earlier bot control session cannot be proved continuous.
Recovery restores finished results, not running rooms. Protect the data
directory: pending verification contexts contain signing secrets, while the
ranking journal does not. If the outbox cannot be written, the server still
prints the result and logs that restart recovery is unavailable. Durability
across a machine power loss is not verified.

Delivery maintenance:

```bash
npm run ranking:delivery -- --info --data-dir ./server-data
npm run ranking:delivery -- --cleanup --data-dir ./server-data --older-than-hours 168
```

Inspection is paginated (`--offset N`), read-only, and leaves out private
verification keys, tickets and raw reports. Cleanup only previews unless given
`--apply`; stop the lobby first. It keeps unresolved reports and unknown or
running contexts, and removes only committed leftovers, old closed contexts
without reports, and old temporary files it owns. Linked paths are refused. A
running lobby retries 100 contexts at a time in rotation; offline recovery
drains the whole backlog.

### Diagnosing empty boards

```bash
npm --prefix src/games/fps run lobby:server -- --results-info --data-dir ./server-data
```

This prints the resolved data directory, total match and participant counts,
counts per scope and gametype, and the latest stored match. It opens SQLite
read-only and exits without starting a server, creating storage or migrating
results. `missing_database` means the file is absent; `schema_unavailable`
means the file lacks the current result columns. Confirm the browser's
`VITE_LOBBY_URL` and the running service's `--data-dir` or `SERVER_DATA_DIR`
before reading counts from a local default directory.

On startup the lobby logs its storage summary. Each received result logs one
status (`stored`, `duplicate`, `skipped`, `rejected`, `failed`) and a reason
such as `verification_failed`, `unknown_match`, `public_roster_ineligible`,
`too_few_accounts` or `store_error`. Logs carry match and mode identifiers and
the scope, never keys, tickets or participant payloads. `getResultDiagnostics()`
exposes process-local counters and the last 32 outcomes to admin code and
tests; it is not a browser endpoint, and its counters reset when the process
restarts.

For the ranking journal:

```bash
npm --prefix src/games/fps run lobby:server -- --ratings-info --data-dir ./server-data
npm --prefix src/games/fps run lobby:server -- --ratings-verify --data-dir ./server-data
```

`--ratings-info` reports the schema and policy version, receipt, seat, update
and rating counts, processing reasons by mode and scope, and the latest
committed receipt. `--ratings-verify` also replays the applied receipts
read-only, comparing the stored snapshots, record projections, every journal
update and the current pool state, and exits non-zero when storage is
unavailable or the replay diverges. A WAL read snapshot keeps the check
consistent while another connection commits. Neither command creates tables,
backfills results or starts the lobby.

The ranking schema has its own version, separate from the account database's
`user_version`, and pins the numerical rating policy. An unsupported or partial
schema, or a changed policy, fails without an automatic reset.

`npm run ranking:simulate` exercises the TrueSkill policy on synthetic matches,
and `npm --prefix src/games/fps run ranking:acceptance` runs real lobby and game-server result
handoffs in isolation; run it before live browser testing.

### Demo privacy

Demo format v4 added the room's privacy flag to the header; v5 keeps that
header and adds each player's view to the frames (their keys, slide and ledge
grab phases and crouch eye height, so a watched view leans, dips and crouches
as their screen did). Format v6 retains that layout and adds optional persistent
disabled brush models to S&D objective snapshots. The reader accepts v1–v6,
including v1–v3 recordings, which have no
privacy flag and count as public. Featured picks leave out recordings marked
private, even those featuring a public top-ten account. Private recordings
stay in the archive and in their verified participants' **Your demos** list:
the flag filters featured picks and does not restrict access to demo files.

Recordings shorter than two minutes (`MIN_LISTED_DEMO_MS` in
`src/lobby/FeaturedDemos.ts`) are left out of every list: **Latest**, **Your
demos**, featured picks and the recent demos in `welcome`. They are usually one
player alone on a map or a match abandoned at the start. The files stay on disk.

## What it keeps

Everything lives in the data directory — `--data-dir`, else `SERVER_DATA_DIR`,
else `server-data/` beside the repo:

| File | Contents |
| --- | --- |
| `players.db` | Accounts, records, verified V2 snapshots, the rating policy, states and update journal, bot preset accounts and pending private verification contexts, in `node:sqlite` |
| `settings.db` | Each account's synced settings (bindings and game preferences, never graphics), in `node:sqlite`; kept apart from `players.db` so frequent writes and backups don't touch results. Losing it loses nothing for good: every browser keeps its own copy and uploads it at its next login |
| `result-outbox/` | Signed completed reports awaiting a committed receipt; separate from public demos |
| `bot-secret` | The secret shared with the bot server, written by whichever starts first |

Demo recordings are not kept here: the lobby scans the game servers'
`public/data/demos/` and serves the list.

## The protocol

Every message is JSON over one WebSocket, and every shape is declared in
`src/lobby/types.ts` — `auth` and `welcome`, the `lobby:*` room messages,
`matches:update`, `identity:*`, `settings:*`, `demos:*`, `leaderboard:get`/`page`, and
`match:seat_reissue`. Read that file rather than a list here; it is the
contract both the browser and the bot server compile against.

## Bots and the shared secret

The lobby, the bot server and the game servers run on one machine and share a
secret from `BOT_SECRET`, or one written into the data directory by whichever
starts first. The bot server's control port listens on loopback only and closes
any connection that does not present it. The lobby treats a connection as a bot
only with that secret, from its own machine — so nobody can dodge the
human-presence accounting that decides both room eviction and ranking.

## Bot behaviour

Washoi owns the shared bot-name list and gametype weight profiles in
`src/games/fps/shared/bot/`. The lobby reserves names from `BotNames.ts`;
the bot service selects gametype, role and round-state policy from
`WeightProfiles.ts`. These modules contain plain data and deterministic helpers.

The Washoi bot application lives in `src/games/fps/bot/`, with startup at
`src/games/fps/cli/bot-server.ts`. Its development tools also live in that game's
`cli/`: `bot-analyze.ts`, `bot-learn.ts`, `bot-train.ts` and `bot-bench.ts`.
Run their `bot:analyze`, `bot:learn`, `bot:train` and `bot:bench` npm commands
from the assembled root; model, route and report paths resolve from that cwd.

Bot clients play over the same protocol as a browser and are bound by the same rules:

- **Commands.** A bot sends one command per server tick by the clock (8 ms at
  125 Hz), sending every command owed when a timer fires late, so it moves at
  full speed on hosts with coarse timers.
- **Perception.** `BotPerception` filters each snapshot down to what a player
  in the bot's place would know: allies, enemies in line of sight inside its
  view cone or revealed by sound with clear line of sight, and enemies heard (shots, explosions, footsteps, jumps, landings,
  pain, pickups). Item state is what the bot saw or heard; a heard pickup is
  timed at its `itemTimingSkill`. Sound ranges are the same at every
  difficulty.
- **Pursuit.** Fresh sound tracks immediately supply a chase target. Prediction
  and memory durations use the 125 Hz physics clock. Hearing can prompt a
  line-of-sight check behind the bot; it still respects the notice delay and
  walls. Navigation can use crouchslides and strafe jumps while chasing.
- **Running and jumps.** Normal navigation, trigger approaches and recovery
  request running speed. Wall avoidance changes heading without adding strafe
  buttons that would force walk speed. Crouchslides take priority over optional
  route strafe jumps; those jumps require at least 400 units/s. Random patrol
  jumps and distance-only combat hops are disabled. Traversal still jumps when
  needed, and noticed combat threats can trigger a single dodge jump with a
  one-second jump cooldown. A stalled slide releases without jump-cancelling.
  Firing, ADS, crouching and combat strafing retain the shared movement limits;
  recorded traversal scripts retain the input their simulation validated.
- **Duel lead.** With a lead greater than two frags against its opponent, a bot's
  reaction-time setting gains a fixed 40 ms for perception, view turns and
  projectile notice. The penalty ends when the lead returns to two or fewer;
  it does not grow with the score or reduce aim accuracy.
- **Duel positioning.** Healthy bots with a usable ranged weapon prefer reachable
  upper-floor patrols and avoid dropping for lower pickups. They try to keep
  their elevation when fighting or tracking an opponent below. Timed-item
  waits use nearby patrols rather than standing at the pickup.
- **Recovery.** Navigation without position progress for two seconds abandons
  the approach, temporarily avoids the failed edge or pickup, and tries a
  supported escape direction. A motionless airborne hang also crouches to
  release a ledge grab. Objective holds, including planting and defusing,
  retain their required stationary input.
- **Ledge boosts.** Skilled bots can slide toward a route's ledge and jump
  before leaving it. The planner simulates the full crossing with the FPS
  movement profile and collision world before sending the input script; it
  rejects misaligned momentum, insufficient slide distance, missing landings,
  and lava or slime. This is an opportunistic traversal, using the default
  movement rules; it does not discover arbitrary new routes.
- **Aim.** `BotAimController` eases the view toward the brain's goal on a
  critically damped spring once per command, with a top speed and settle time
  from the difficulty's `trackingSpeed`, a reaction-time pause before turns
  over 45°, a deadzone for small changes unless firing, and a slowly wandering
  aim offset.
- **Mood and mistakes.** `BotMood` tracks calm, confident, tilted and cautious
  moods, each fading after 20 s, and may give a new fight one mistake, at odds set by the
  preset's `mistakeRate`.
- **Chat.** `BotChat` says the odd line to humans at match start, after a
  kill or death involving a human, and near the end. A bot speaks at most once
  per 20 s and the bot server as a whole once per 5 s; bot-only matches stay
  silent. `BOT_CHAT=0` in the bot server's environment turns it off, and
  training never chats.
