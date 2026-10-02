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
- **Bots** are invited through the bot server, at `easy`, `medium` (the
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

A match is ranked from the roster it starts with:

| Mode | Ranked when |
| --- | --- |
| Duel, Amphi | Both players are people |
| Team modes | More than half the room is people, **and** each side has at least one |
| Free for all | More than half the room is people |

Two people is the floor in every mode. The team rule needs its second half
because a majority alone would rank four people against three bots, which is
people farming bots. The rule lives in `isRankedRoster()` in
`src/lobby/LobbyServer.ts`.

Leaderboard queries are authenticated, bounded and read-only: a mode, a period
of the last 30 days or all time, an offset and a page of at most 100. The
answer carries the asking account's own rank and exact row even when that row
falls outside the page.

## What it keeps

Everything lives in the data directory — `--data-dir`, else `SERVER_DATA_DIR`,
else `server-data/` beside the repo:

| File | Contents |
| --- | --- |
| `players.db` | Accounts, matches and match participants, in `node:sqlite` |
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
