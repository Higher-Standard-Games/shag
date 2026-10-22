# Player accounts and keys

Status: built (2026-09-20) — the lobby, the browser, and the screens a player sees. This is server milestone S3 in [NEW_UI.md](NEW_UI.md). The leaderboard milestone (S4) builds on it.

## Decisions

- **Every player has an account. There are no guests.** A browser that connects without a key gets a new account on the spot, so every match a person plays can count towards their stats.
- **A new account is named `Player_<number>`,** with a number no other account uses. The player can rename it whenever they like, outside a room.
- **Names are unique regardless of capitals:** `Sundflux` and `SUNDFLUX` are the same name. A rename frees the old name at once.
- **The key is the login.** The server makes a random key when it creates the account and sends it to that browser once. The browser keeps it. Pasting the key into another browser logs in there. No email, no password.
- **The server stores four things per account:** an id, the key's hash, the name, and the name in lowercase. The id stays the same if a key is ever replaced, so match results keep pointing at the right player.
- **Storage is SQLite built into Node** (`node:sqlite`): one file, no database server, no npm package.
- **Bots are not accounts.** A bot proves itself with a secret it shares with the lobby. Bots never appear on the leaderboard. Matches with bots still count for the humans' own stats, and they count for the leaderboard only when enough of the players are human. See [Bots](#bots).

We accept that stale tabs and scripts will leave many `Player_<number>` accounts that never play. A row is about 100 bytes, so a million accounts is roughly 100 MB. If it ever matters, the fix is a "last played" date so empty accounts can be removed. That date is a new stored field, so it needs a product decision first.

## Why SQLite instead of JSON files

Accounts alone would fit in a JSON file loaded into memory. The leaderboard needs more:
- match results stored safely even when the same result arrives twice;
- 30-day windows;
- paged ranking queries.

Doing that with JSON means hand-writing safe file writes, indexes and data-format upgrades. SQLite does all of it in one file. A `UNIQUE` column also makes the database itself refuse two accounts with the same name, even if both are created at the same moment.

It runs on Node 22.15 under `vite-node`, the way the lobby does, without a flag. Node still marks `node:sqlite` experimental and prints one warning at startup. All database code is in `PlayerStore`, so replacing the storage later touches one file.

The installed `@types/node` (20.5) predates `node:sqlite`, so `src/node-sqlite.d.ts` declares the few functions `PlayerStore` uses. Delete it once `@types/node` is 22.5 or newer.

## Storage

```sql
CREATE TABLE players (
  id        INTEGER PRIMARY KEY,
  key_hash  BLOB NOT NULL UNIQUE,   -- sha256 of the key; the key itself is never stored
  name      TEXT NOT NULL,          -- as the player typed it
  name_key  TEXT NOT NULL UNIQUE    -- lowercase name, so capitals don't make a new name
);
```

- **File location:** `<data-dir>/players.db`. The data directory is `--data-dir` on `lobby:server`, else `SERVER_DATA_DIR`, else `server-data/` at the repo root, which git ignores. Never under `public/`: the dev server serves that folder to anyone, demos included.
- **Upgrades:** SQLite's `user_version` records the account layout a file has; `PlayerStore` brings older files up to date when it opens them. The account layout above is version 1. `MatchResultStore` creates separate `matches` and `match_participants` tables in the same file for the pending leaderboard feature, without changing the account table or its key handling.
- **Hashing:** plain SHA-256. Slow password hashes such as bcrypt or argon2 protect guessable passwords; a 120-bit random key can't be guessed. SHA-256 also makes login a single indexed lookup.
- **Backups:** copy the file, or run `VACUUM INTO` while the server is running. The lobby uses WAL mode, so `players.db-wal` and `players.db-shm` sit beside it.

## Keys

- **Generation:** `crypto.randomBytes(15)`, which is 120 bits, written as 24 characters of Crockford base32. Shown as `WASHOI-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (`formatKey`).
- **Reading a pasted key** (`normalizeKey`), forgiving like the prototype in `public/ui-proto/welcome.html`:
  - ignore case, spaces and dashes;
  - drop a leading `WASHOI`;
  - read `O` as `0`, and `I` or `L` as `1`.
- **Never logged.** The lobby logs account ids and names only; a test checks the output.
- **Production must use `wss://`.** The client's default lobby address is currently `ws://localhost:9000`.

## Names

- **Default names:** a random 4-digit number, inserted as `Player_<number>`. If that name is taken, the insert fails on the unique name and another number is tried. After 10 failures it moves to 5 digits, up to 9, which keeps names within 16 characters.
- **Name rules for a rename:** 2–16 characters of `A–Z a–z 0–9 _ -`, the same as the prototype.
- **Reserved names,** in any capitals, which nobody can rename to:
  - anything matching `player_<digits>`, so default names can't be copied and the generated names stay free for new accounts;
  - the bot names, with or without the `_<digits>` suffix the bot server adds when it runs out, so a bot and a player never share a name in a room, a demo or a scoreboard.
- **Changing only the capitals of your own name** is always allowed, a default name included.
- **Not while in a room.** A room keeps its own copy of each player's name, and so does a running match, so a rename there would leave the copies out of step. Renames happen on the Welcome and Profile screens, outside rooms.

The key and name rules live in `src/lobby/PlayerIdentity.ts`, which has no Node imports, so the browser checks a name or reads a pasted key exactly as the server does.

## Lobby protocol

| Client sends | Server answers | Notes |
| --- | --- | --- |
| `auth {key}` | `welcome` with `identity {id, name}` | Returning player, or restoring on another browser. |
| `auth {key}` with an unknown key | `auth:error {code: "unknown_key"}` | No account is created, or a mistyped restore would hide behind a new one. The connection stays open and may send `auth` again. |
| `auth {}` | `welcome` with `identity {id, name}` and `key` | New account named `Player_<number>`. The key is sent only in this answer. |
| `auth` on a connection already logged in | `auth:error {code: "already_authenticated"}` | Switching accounts means a new connection. |
| `identity:rename {name}` | `identity:renamed {identity}` to every connection logged in to the account, `player:renamed {playerId, name}` to everyone else | Or `identity:error {code}`: `name_invalid`, `name_reserved`, `name_taken`, `in_lobby`, `rate_limited`. |
| `identity:delete {key, confirmed}` | `identity:deleted` to every connection logged in to the account, which the lobby then closes | Or `identity:error {code}`: `not_confirmed`, `wrong_key`, `in_lobby`, `rate_limited`. See [Deleting an account](#deleting-an-account). |
| `auth {name, isBot: true, botSecret}` from the lobby's own machine | `welcome` without `identity` | A bot. No account, no key. See [Bots](#bots). |

- **Names in `auth` are ignored for players.** An old tab still sending `auth {name}` gets a new `Player_<number>` account, and the name it sent is never claimed. Otherwise a tab that never stores the key could take a name forever.
- **Identity ids are strings** in the protocol, although they are integers in the database, so the id format can change later.
- **Rate limits, per player address, kept in memory:**
  - new accounts, 30 an hour (`auth:error rate_limited`);
  - wrong keys, 20 a minute, after which every key attempt from that address waits;
  - renames, 10 a minute.
- **The player's address behind a proxy.** Production is expected to put Caddy in front of the lobby for `wss://`, on the same machine. Every proxied connection then comes from loopback, so the lobby takes the address from the last `X-Forwarded-For` entry. It believes that header only from a loopback connection; from anywhere else a client could write anything in it. Without this, all players would share one rate limit and every player would look like a same-machine connection.
- **Game servers never see keys.** The lobby knows each connection's account id and can hand those ids to a match, so S4 can report results by account id.

## Deleting an account

A player can delete their account from the Profile, after ticking that they understand and pasting the whole key again; the lobby checks the key itself, not just the browser.

- **The row stays.** Results and demos keep pointing at the account id, so the row is renamed `[deleted account]` (which no player can type) with a `#deleted:<id>` name key, and a random hash replaces the key's. The key opens nothing again and the old name is free.
- **Where the name changes:** the leaderboards and stats, which read names from `players`, and the lobby's demo list, which swaps the name for each recorded account id on deletion and on every scan.
- **What stays:** demo files are a permanent record and are not edited, so a demo played back still shows the name it was recorded with. Synced settings are erased.
- **The browser** forgets the key and the name, then reloads into a new `Player_<number>` account.

## Bots

Bots don't get accounts: an account exists to collect a player's stats, and bots never appear on the leaderboard. Bot names are reserved, so no player can take one. The names live in `src/bot/BotNames.ts`, which both the bot server and the lobby import.

### How bots are trusted

The lobby, the bot server and the game servers always run together on one machine. On top of that, they share a secret, so a bot needs both to count as a bot. The code is in `src/lobby/ServerData.ts`.

- **Where the secret comes from:**
  - the `BOT_SECRET` environment variable when it's set;
  - otherwise the file `<data-dir>/bot-secret`.

  Whichever process starts first creates the file with 32 random bytes. It writes the secret under a temporary name, then hard-links it into place; the link fails if the file already exists. So two processes starting at the same moment can't end up with different secrets, or read a half-written one. No setup is needed in dev or in production, as long as both processes use the same data directory.
- **Bot to lobby:** a bot's `auth` carries `botSecret`. The lobby treats a connection as a bot only when it comes from its own machine **and** the secret matches, compared in constant time. Anything else is a player and gets a `Player_<number>` account.
- **Lobby to bot server:** the lobby sends the secret in the `x-bot-secret` header when it opens the control port (9100). The bot server closes any connection without it, and listens on `127.0.0.1` only. It refuses to start its control port without a secret.
- **Game servers need no secret.** The lobby starts each match and knows which players are bots.
- **Why nobody can log in as a bot:** a bot has no key to steal or guess, and the bot flag needs both the lobby's machine and the secret.

### Stats and the leaderboard (S4)

Mixed lobbies are wanted, for example bots filling S&D teams. So bots don't wipe out anyone's stats; they only decide whether a match counts for the leaderboard.

- **Every human's result is recorded, in every match.** Each match gets a `ranked` flag, and the leaderboard counts only ranked matches.
- **When a match is ranked:**

  | Mode | Ranked when |
  | --- | --- |
  | Duel, Amphi | Both players are human. |
  | S&D | More than half the players are human, **and** each team has at least one human. |
  | FFA | More than half the players are human. This one is a proposal. |

  S&D needs the second condition because the majority rule alone would rank 4 humans against a team of 3 bots: 4 of 7 players are human, but it's still humans farming bots.
- **Counted once, when the match starts.** The lobby knows the roster then, and it already refuses new bots once a match is starting. If bots ever replace players who leave mid-match, the count at the start still decides.

The rule lives in `isRankedRoster()` in `src/lobby/LobbyServer.ts`, decided from the seats a match is spawned with and remembered per match id; `handleServerResult` stores nothing for a match that was not ranked (`RankedRoster.test.ts`).

## Client

`src/lobby/AccountSession.ts` does the browser side; `FpsLobbyService` calls `logIn(client)` after connecting.

- **Where the key lives:** its own localStorage entry, `shag_player_key`, never inside `PlayerProfile` or anything that syncs. Settings sync (`src/lobby/SettingsSync.ts`, started after every login) copies only the entries `src/shared/settings/SyncedSettings.ts` allows, and the key is not one of them.
- **The account's name is the player's name.** On every login and rename, `PlayerProfile.name` takes the account's name. That's what the rail shows, and what `Game.ts` sends to game servers.
- **Login:**
  - with a stored key, send `auth {key}`;
  - without one, send `auth {}` and store the key from `welcome`;
  - if the stored key is `unknown_key` (for example the server database was reset), move it to `shag_player_key_unknown` (read with `unknownPlayerKey()`), make a new account, and let the UI tell the player;
  - any other refusal rejects with `LoginError(code)`.
- **Migrating existing players:** a browser from before accounts has a name in its profile but no key.
  1. It gets a `Player_<number>` account.
  2. If its profile name was chosen by the player (not the `Player_` plus 4 characters `PlayerProfile` makes up) and passes the name rules, it asks to rename to it.
  3. If the name is taken, the player keeps `Player_<number>` and can pick another.
  4. The old local profile id is not proof of anything.
- **Restoring:** `restoreAccount(client, pastedKey)` logs in with a pasted key on a connection that isn't logged in yet, and replaces the stored key only if the lobby accepts it.
- **Renaming:** `renameAccount(name)` resolves with the new identity or the lobby's reason. A rename from another tab of the same account reaches this one through `identity:renamed`.
- **The `name` console command** renames the account when logged in to the lobby, and otherwise sets a name for local play only.
- **Switching accounts:** `switchFpsAccount(pastedKey)` (in `FpsLobbyService`) is what the screens call. A connection logs in once, so it reconnects: it closes the socket, opens a new one, and sends the pasted key. If the lobby refuses the key it logs back in with the key this browser already had, then rejects, so a mistyped key costs nothing. Browsers delay repeated connections to the same host, which is why `LobbyClient.connect()` takes a timeout and reports a connection that never opens.
- **`NewUiApi` has no identity methods.** Accounts are live, so the screens call `AccountSession` and `FpsLobbyService` directly; the adapter only carries features the server still owes (room chat, private rooms, leaderboard, featured demos).

## What a player sees

- **Welcome** (`src/games/fps/client/WelcomeOverlay.ts`): a browser the lobby has just made an account for is asked "Who are you?" over the lobby, on the gold panel that then narrows onto the rail. The name renames the account; an empty name keeps the `Player_<number>` the lobby gave it. "Use my key" is the same screen's other half, for a player who already has an account. A shared room link waits until this is answered, so a new player joins their friend's room under their own name. `accountIsNew()` decides whether to ask: a browser carrying a name from before accounts is not asked, because its login already claimed that name.
- **Profile** (`src/games/fps/client/ProfileView.ts`): the rail's Profile key widens the rail into the same gold panel as Welcome (`IdentityFrame.ts`), as the prototype drew it. It opens on the key, on a dark plate that stays blurred until the player asks for it, with Done back to the lobby; "Change name" and "Use another key" are screens of their own, and Esc steps back to the key and then closes. The account's ranked record sits on the stage beside the panel.
  - **Name:** the same rules the lobby applies are applied as the player types (`judgeName` in `IdentityFields.ts`); the lobby still has the last word, and its refusal is what the player reads.
  - **Key:** Copy, Save as file, and — where the browser takes one (Chromium) — Save in browser, which hands the key to the password manager so it syncs. The warning next to it says plainly that the key is the account.
  - **Play as someone else:** a key slot that tidies what is pasted into groups of four, and switches accounts once it is whole. Renaming and switching are both refused while the player is in a room, because a room keeps its own copy of every name.
  - **Your record:** one line per mode the lobby ranks this account in — rank, wins, losses, draws — over a summary line. Each line is the account's own row from that mode's leaderboard query, so the card says what is true and nothing more: it asks the player to connect when the lobby is away, passes on the lobby's own words when it does not rank, and says "No ranked match yet" rather than showing a row of zeroes.

## Where it lives

| File | What |
| --- | --- |
| `src/lobby/PlayerStore.ts` | Accounts in SQLite: create, find by key, rename |
| `src/lobby/PlayerIdentity.ts` | Key encoding and reading, name rules (browser-safe) |
| `src/lobby/ServerData.ts` | Data directory, bot secret, constant-time comparison |
| `src/lobby/RateLimiter.ts` | Sliding-window limits per address |
| `src/lobby/LobbyServer.ts` | Login, rename, bot check, proxy address, bot-server header |
| `src/lobby/types.ts` | `auth`, `welcome.identity`/`key`, `auth:error`, `identity:*`, `player:renamed` |
| `src/lobby/AccountSession.ts`, `src/lobby/LobbyClient.ts` | Browser login, key storage, rename |
| `src/bot/BotServer.ts`, `src/bot/BotLobbyClient.ts` | Control port on `127.0.0.1` behind the secret; bots log in with it |
| `src/bot/BotNames.ts` | The bot server's names, reserved from players |
| `src/cli/lobby-server.ts`, `src/cli/bot-server.ts` | `--data-dir`, loading the secret and the store |
| `src/games/fps/client/FpsLobbyService.ts` | Logs in through `AccountSession`; `switchFpsAccount()` |
| `src/games/fps/client/WelcomeOverlay.ts` | The first screen: a name, or the key you already have |
| `src/games/fps/client/ProfileView.ts` | Name, key backup, switching accounts, the account's record |
| `src/games/fps/client/IdentityFields.ts` | The name and key slots both screens use |
| `src/engine/console/commands/NameCommand.ts` | `name` renames the account |

## Open work

1. **A nudge to back the key up**, once a player has something to lose (a first ranked result, say). The Profile has the key; nothing yet asks the player to save it.
2. **A real two-human ranked row has not been seen in a browser.** The server path is verified end to end, and the browser reads the board correctly against stored results; what is missing is two people finishing a match in front of it.

## Validation (2026-09-20)

Screens, in a real browser (headless Edge driving the game against a lobby server): a new browser is asked who it is; the name it picks is the one the lobby, the rail and the chat show; the profile shows the same key the browser stored; renaming from the profile takes; a name someone already has is refused with the lobby's reason; a second browser restores the first one's account from its key; a key nobody has is refused and leaves the browser logged in as itself. 14 of 14 checks.


- `npx vitest run src/lobby src/bot/__tests__/BotServerControlAuth.test.ts` — 9 files, 96 tests:
  - `PlayerIdentity` — keys, names;
  - `PlayerStore` — 300 accounts with name retries, renames, two stores on one file, restart, key never on disk;
  - `LobbyAuth` — login, unknown key, stale-tab names, second login, rate limits, key never logged, renames across tabs, bots with and without the secret, proxy address;
  - `AccountSession` — the browser side against a real in-process lobby, restoring from a pasted key included;
  - `ServerData` — the secret file;
  - `BotServerControlAuth` — the control port over real sockets.
- End-to-end with real processes (a scratch script, not committed): lobby and bot server on spare ports with a temporary data directory. A scripted player:
  - gets `Player_1399` and a key;
  - renames;
  - invites a bot, which joins through the secured bot server;
  - logs back in with the key;
  - a fake bot without the secret becomes a player;
  - the control port closes a caller without the secret (1008);
  - the account survives a lobby restart;
  - no key appears in either server's output. 11 of 11 passed.
- `npm test` — 290 files, 2895 tests passing.
- `npx tsc --noEmit` — clean.
- `node scripts/biome-gate.mjs` — 0 errors, warnings 337 (baseline 339).
- Networking regression suite from `AGENTS.md`: `test:simulation`, `test:physics` (its existing Y-position warning), `server:tick` and `server:fuzz -- --ticks 1000` (determinism checksums match, 0 errors), `cli:game` wdm2 load — all pass.

Not verified:
- Two processes creating the secret file at the same instant; the tests cover a second process reading an existing file, and the hard-link step is what prevents the race.
- A real Caddy in front of the lobby; the `X-Forwarded-For` handling is unit-tested only.
- The browser flow in an actual browser; `AccountSession` is tested against the lobby in-process.
