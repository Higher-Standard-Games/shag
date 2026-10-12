# Lobby server

The lobby is a WebSocket server that owns everything around a match: who a
player is, the room they wait in, the dedicated game server that gets spawned
for them, and the result that comes back. It is a separate Node process from
both the browser client and the game servers it starts.

```bash
npm run lobby:server -- --port 9000 --data-dir ./server-data
```

Browsers reach it through `VITE_LOBBY_URL`. The environment variables it reads
are listed in [Configuration](./configuration.md).

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
npm run lobby:server -- --max-players 40     # or SHAG_LOBBY_MAX_PLAYERS=40
npm run lobby:server -- --max-players 0      # no cap
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

## Rooms

A room is one gametype, one map vote and up to that gametype's player count.

- **Public or private.** A private room is absent from the live match list, the
  queue and the player list; the only way in is a link carrying its invite
  token, which is 24 random bytes, separate from the room id.
- **Teams** are `alpha` and `bravo` on the wire, with display names the
  gametype supplies. A joining player is auto-assigned to the smaller side and
  may switch without a vote; a shuffle needs `ceil(players / 2)` votes.
- **Maps.** Three are drawn from the gametype's pool, and only maps that are
  actually installed are offered. Most votes wins, ties are random.
- **Bots** are invited in private rooms through the bot server, at `easy`, `medium` (the
  default), `hard` or `insane`. A bot carries no account. Once the last human
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

FFA can start with two players and holds up to eight. S&D can start with two
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

The game server prints one signed line when the match ends, naming each seat's
ticket and how it finished. The lobby refuses anything malformed, oversized,
forged, or naming a seat that was never on the roster, and stores the result
once, keyed by match id.

The current child-to-lobby result contract is **V2**. It binds played seats to
stable admission IDs and captures match start/end, join/leave ticks, teams played,
final team scores, placements and completion reason. Initial/recovery credentials
and resumed sockets cannot create two result participants for one seat. Upgrade
the lobby and spawned game-server code together; V1 result lines are not accepted.

A player who disconnects remains in the final played roster. In FFA their last
score survives permanent departure, and equal scores share a placement at any
position. Tied leaders receive draws; lower placements receive losses. A client
who only watched or permanently left before the match started creates no played entry.

In a started single-match Duel/Amphi game, a human's expired **20-second** resume
grace triggers a forfeit only when the original two opponents played from the
start, stayed on their respective sides, and the other is still playing on a
connected socket. Both seats and actual scores are retained; the forfeit decides
the outcome even when the departed player was leading. Simultaneous departures,
an empty match and a graceful mid-match server stop are aborted, with no invented
win/draw. FFA and S&D have no disconnect-forfeit rule in this slice.

Aborted reports are diagnosed as `skipped: aborted` and do not change the record
board. Verified reports now save a durable normalized V2 snapshot, played seats,
starting roster and record/rating processing reasons. The snapshot and eligible
W/L/D projection commit in one SQLite transaction. Aborted/ineligible receipts
remain excluded from record statistics. Ticket fields and authentication secrets
are omitted from the journal. Changed results under an existing match ID fail;
equivalent reordered duplicates preserve the original receipt.

Complete eligible human results now atomically apply TrueSkill updates and their
before/after states in separate public/private pools for Duel, Amphi, S&D and FFA.
The original roster must play from the first Active tick on unchanged sides.
Late joins, missing participation evidence and interrupted play keep their
records with an explicit skill exclusion. A spectator departure stays marked
after rejoining; a reconnect-held entity continues participating. A valid final
Duel/Amphi forfeit is eligible. S&D uses team standings; FFA uses every placement,
including ties. Uncalibrated private bot games wait with `bot_reference_pending`.
Older pending receipts are not activated by retries.

Lobby display sides use the same mapping as gameplay and result normalization:
`alpha` is Soba and `bravo` is Udon. Duel retains the assigned side independent
of connection order. Upgrade/restart the lobby together with the game-server
code so an old result normalizer cannot incorrectly exclude unchanged teams.

New clients request the TrueSkill ladder explicitly, using the advertised
`features.skillRatings` capability and `system: "trueskill"`. Podium, rows,
rail and profile use career skill in the selected public/private mode pool.
Rows retain W/L/D and matches and show Rating, provisional status and career
rated-match count. Last 30 days filters active rated accounts and record totals;
it does not reset or recalculate career skill. Old requests retain the record
endpoint; a records-only server does not supply an invented skill ladder.

Private bots now carry service-owned calibration metadata: effective preset or
custom difficulty, goal arbiter, behavior build and loaded model content identity.
The lobby accepts it only from the authenticated local bot service; the admission
manifest and signed result bind it to the played seat. Names/process IDs and model
directory names do not identify opponent strength. Bots await model preparation
before lobby authentication. Configuration changes after match handoff are latched
as `bot_reference_changed`: records remain, skill is excluded even if settings are
changed back. Fixed-reference private ratings are implemented, but the registry
ships empty. Eligible private contests update only human posteriors when an
immutable calibration covers the exact mode/configuration and piloted map.
Bots never get accounts or mutable ratings. Upgrade bot, lobby and child-server
code together.

Operator-reviewed human pilots are required before installing production strengths:

```bash
npm run ranking:references -- --check path/to/calibration.json
npm run ranking:references -- --list --data-dir ./server-data
npm run ranking:references -- --install path/to/calibration.json --data-dir ./server-data
```

An artifact contains version 1, immutable `id`, current `policyVersion`, `mode`,
canonical `reference`, finite `mu`, positive `sigma` and `evidence` with
`kind: "human_pilot"`, match/human counts, covered `maps`, report location and
`createdAt`. The validator checks structure, not the truth or adequacy of a pilot.
Custom/fallback/unstable references are refused. Check/list do not initialize
storage. Install requires existing consistent ranking storage and an explicit
directory. Exact retries are safe; changing active strengths requires a new
policy/replay. Old pending results stay pending. Synthetic `ranking:simulate`
fixed-opponent numbers are illustrations only and establish no production strength.

### Delivery recovery

Supervised matches persist private verification context before child launch.
The child flushes a signed final report into `<data-dir>/result-outbox/` before
stdout delivery. Startup, five-second retries and graceful shutdown recover
valid completed reports into the journal. A committed receipt precedes file/
context cleanup, so retrying after a crash cannot rate the match twice.
Failed/rejected reports remain available for retry/inspection. No completion
is invented for a child killed before writing its final report.

```bash
npm run lobby:server -- --results-recover --data-dir ./server-data
```

This explicit offline command writes recovered receipts without starting the
lobby. It requires existing consistent storage, reports delivered/waiting/
rejected/failed counts, and exits nonzero on error/rejection. After a lobby
restart, uncommitted bot matches retain records but are excluded from skill
because the prior bot-control session cannot be proved continuous. Existing
committed bot receipts remain unchanged. This restores finished results, not
running lobby rooms. Protect the data directory: pending verification contexts
contain signing secrets, while the normalized ranking journal does not.
Outbox failure still attempts stdout and logs that restart recovery is unavailable.
Machine power-loss durability and automatic retention cleanup are unverified.

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

Private matches are stored separately from that public record. Against bots,
one verified account is enough, and a human loss to a bot counts too. A private
human-only match still needs two verified accounts and consistent outcomes.
The visibility and bot-seat count are fixed from the room's starting roster,
and the result still comes only from the authenticated game-server report.

The leaderboard opens on **Public** matches. **Public / Private**, left of the
gametype selector, selects independent boards: Private contains only private
matches, including bot games. This setting applies to every mode and is
remembered in that browser. The board, your pinned row and the ranks in the
rail all use the same selection. There is no rating number yet; these boards
count wins, losses and draws. A versioned, tested TrueSkill math adapter is
available; `npm run ranking:simulate` exercises it headlessly. Transactional
Human skill storage and live updates are implemented; bot calibration and leaderboard integration remain pending in
`docs/research/ranking_matches.md`.

Leaderboard queries are authenticated, bounded and read-only: a mode, a period
of the last 30 days or all time, an offset and a page of at most 100. The
answer carries the asking account's own rank and exact row even when that row
falls outside the page. `scope` is `public` or `private`, defaulting to `public`;
`leaderboard:page` echoes the resolved scope. Clients reject replies with a
missing or different scope. Obsolete `includePrivate` requests are rejected.

### Diagnosing empty boards

```bash
npm run lobby:server -- --results-info --data-dir ./server-data
```

This command prints the resolved data directory, total match/participant row
counts, counts per scope/gametype, and latest stored match. It opens SQLite
read-only and exits without starting a server, creating storage, or migrating
old results. `missing_database` means the file is absent; `schema_unavailable`
means that file does not yet have the current result columns. Confirm the
browser's `VITE_LOBBY_URL` and the running service's `--data-dir` or
`SERVER_DATA_DIR` before interpreting counts from a local default directory.

On startup the lobby logs its storage summary. Each received result logs one
status (`stored`, `duplicate`, `skipped`, `rejected`, `failed`) and reason,
such as `verification_failed`, `unknown_match`, `public_roster_ineligible`,
`too_few_accounts` or `store_error`. Logs include bounded match/mode identifiers
and known scope, without keys, tickets or participant payloads. The server's
`getResultDiagnostics()` method exposes process-local counters and the last
32 outcomes for admin code/tests; this is not a browser endpoint. Durable
counts come from SQLite; runtime counters reset when the process restarts.

For the new ranking journal:

```bash
npm run lobby:server -- --ratings-info --data-dir ./server-data
npm run lobby:server -- --ratings-verify --data-dir ./server-data
```

`--ratings-info` reports schema/policy version, receipt/seat/update/rating counts,
processing reasons grouped by mode/scope and the latest committed receipt.
`--ratings-verify` additionally replays applied receipts read-only, comparing
the stored snapshots, seat/record projections, every journal update and current
pool state. It exits nonzero on unavailable storage or divergence. A WAL read
snapshot keeps this check consistent if another connection commits a match.
The commands never create tables, backfill results or start the lobby.

The ranking schema has its own version, separate from account `user_version`.
It initializes empty journal/rating tables and pins the numerical policy;
unsupported/partial schemas or a changed policy fail without an automatic reset.
Existing development records are not imported into ratings. Production will
start fresh as planned; no reset is performed merely by starting these tools.

### Demo privacy

New demo recordings use format v4, which adds the room's privacy flag to the
header. The reader still accepts v1–v3 recordings; those have no privacy flag
and remain eligible as legacy public demos. Featured picks exclude recordings
marked private, including recordings featuring a public top-ten account.
Private recordings remain in the archive and in their verified participants'
**Your demos** list. The privacy flag filters featured picks; it does not
restrict access to demo files.

## What it keeps

### Player gameplay stats and recent results

Updated lobbies advertise `features.playerStats`. In **Profile**, select Public
or Private to see independent records and career gameplay totals for each mode.
These record totals do not require a skill rating: uncalibrated bot games can
show W/L/D and gameplay totals while their skill update remains pending.
Select a mode name to open the ten most recent own-account results. **Older
matches** uses a stable sequence cursor; **Latest matches** returns to the first
page. History shows personal score, frags/deaths, enemy damage and the committed
display-rating change or a readable exclusion/pending reason. In windows up to
1100px wide, account controls and records stack in a single scrollable Profile.
Record rows wrap to fit the available space, including smaller desktop sidebars.

The server captures personal mode score, enemy frags, team frags, deaths,
enemy/friendly damage, plants, defuses and active participation milliseconds.
Warmup, countdown, round intermission, spectator and permanently departed time
are excluded; being dead in an active S&D round still occupies a playing seat.
Damage follows the existing server counter (before armor); self-damage is not
enemy damage. Team standings and personal score are separate values.

Stats are versioned, whitelisted and included in the signed V2 result and its
canonical snapshot. Ranking schema **2** adds the `ranking_stats` projection
and an account/sequence index in an additive transaction from schema 1. It
creates no historical stats: missing fields remain unavailable. Profile shows
the number of results covered if only some counted matches have gameplay data.
Aborted/excluded receipts retain their captured stats for own history/audit but
do not add career gameplay totals when they have no eligible record.

Protocol: `stats:get`/`stats:summary` reads a mode/scope summary (`period: all`
or `month`, a rolling 30 days for records/gameplay; rating/rank remain career).
`stats:history`/`stats:history_page` reads own-mode/scope receipts (limit 1–50,
optional exclusive `beforeSequence`), including `ratingChange` when available.
The authenticated connection determines the account; requests cannot select
another account. Reads share the existing ranking rate limit and return no
admission credentials or other players' private match details. Older lobbies
retain the existing rating-only Profile behavior. Weapon accuracy and assists
are outside this initial stats capture.

For repeatable ranking acceptance, run `npm run ranking:acceptance` before live
browser testing. It includes isolated real lobby/child-server result handoffs.

Private bot skill requires reviewed human calibration; no bot strengths ship by
default. The saved recipe, verified read-only export and offline draft workflow:

```bash
npm run ranking:pilot -- --plan --output pilot-plan.json
npm run ranking:pilot -- --export --mode duel --data-dir ./server-data --output pilot.json
npm run ranking:pilot -- --analyze pilot.json --output analysis.json
npm run ranking:pilot -- --artifact pilot.json --reference <digest> --id duel-medium-v1 --report analysis.json --reviewed --output calibration.json
```

Export requires one bot and established same-mode pre-match human anchors.
`--anchor-scope public` is an explicit offline option; live public/private pools
remain separate. Draft analysis is not automatic approval. Review actual human
evidence and the report, then check/install using `ranking:references`. Outputs
refuse overwrites. Newly generated artifacts bind played BSP fingerprints;
changed map bytes remain pending. Earlier pending games are not backfilled.

Bot invitations give an unavailable service eight seconds to respond. A verified
preparation announcement extends that budget once to 75 seconds, covering a
60-second model preparation and ten-second lobby join. Closing/starting a room
or losing the requesting control connection cancels preparation and prevents a
late bot join. Native loading itself can finish later, with resources disposed.

Minimal delivery maintenance:

```bash
npm run ranking:delivery -- --info --data-dir ./server-data
npm run ranking:delivery -- --cleanup --data-dir ./server-data --older-than-hours 168
```

Inspection is paginated (`--offset N`), read-only and excludes private verification
keys, tickets and raw reports. Cleanup previews by default; stop the lobby before
adding `--apply`. It preserves unresolved reports and unknown/running contexts,
and removes only committed leftovers, old known-closed contexts without reports,
and old owned temporary files. Linked paths are refused. Live retries process a
rotating budget of 100 contexts; explicit offline recovery drains the backlog.

Everything lives in the data directory — `--data-dir`, else `SERVER_DATA_DIR`,
else `server-data/` beside the repo:

| File | Contents |
| --- | --- |
| `players.db` | Accounts, records, verified V2 snapshots, rating policy/state/update journal, fixed bot references and private pending verification contexts, in `node:sqlite` |
| `result-outbox/` | Signed completed reports awaiting committed receipt/acknowledgement; separate from public demos |
| `bot-secret` | The secret shared with the bot server, written by whichever starts first |

Demo recordings are not kept here: the lobby scans the game servers'
`public/data/demos/` and serves the list.

## The protocol

Every message is JSON over one WebSocket, and every shape is declared in
`src/lobby/types.ts` — `auth` and `welcome`, the `lobby:*` room messages,
`matches:update`, `identity:*`, `demos:*`, `leaderboard:get`/`page`, and
`match:seat_reissue`. Read that file rather than a list here; it is the
contract both the browser and the bot server compile against.

## Bots and the shared secret

The lobby, the bot server and the game servers run on one machine and share a
secret from `BOT_SECRET`, or one written into the data directory by whichever
starts first. The bot server's control port listens on loopback only and closes
any connection that does not present it. The lobby treats a connection as a bot
only with that secret, from its own machine — so nobody can dodge the
human-presence accounting that decides both room eviction and ranking.
