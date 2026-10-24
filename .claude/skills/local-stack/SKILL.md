---
name: local-stack
description: Bring up SHAG's full local multiplayer stack - lobby server, bot server and the browser dev server - for live testing of rooms, matches, bots, results, ratings, demos or the leaderboard, and shut it down cleanly. Use this whenever a test or a user request needs a real lobby or match ("play a match", "invite a bot", "test the leaderboard", "does the room work", "map needs the lobby"), when `map <name>` fails for lack of a lobby, or when ports 9000, 9100 or 7777+ are busy.
---

# The local multiplayer stack

Normal play goes through three processes: the **lobby** (accounts, rooms,
results, ratings), which spawns one **game server** per match, and the **bot
server**, which the lobby asks for bots. The browser talks to the lobby. Without
the lobby, `map <name>` and the Play menu cannot start a match; offline work
can use a demo instead (see `browser-probe`).

| Process | Command | Port |
| --- | --- | --- |
| Lobby | `npm --prefix src/games/fps run lobby:server -- --port 9000 --data-dir <dir>` | 9000 |
| Bot server | `npm --prefix src/games/fps run bot:server -- --data-dir <dir>` | 9100 (loopback control) |
| Game servers | spawned by the lobby, one per match | 7777 upward |
| Browser | `npm --prefix src/games/fps run dev` (or the private probe server) | 3000 (3100) |

## Choose the data directory

The lobby keeps accounts, results and ratings in `<data-dir>/players.db`, and
the lobby and bot server share a secret written into the same directory.

- **Automated tests and probes:** use a scratch directory, for example
  `--data-dir ./server-data-test`, so test matches never touch real ratings.
  Delete it afterwards.
- **The user's own play:** the default `./server-data`, which holds their real
  accounts and boards.

Give the lobby and the bot server the **same** `--data-dir`, or the bot server's
secret will not match and bots are refused.

## Start

1. **Clear stale servers.** A game server left over from an earlier run keeps
   simulating at 125 Hz and starves the machine. Check ports 7770–7790, 9000
   and 9100, and stop leftover `node` processes you started earlier; ask before
   killing a process you did not start, since the user may be playing on it.
   On Windows: `netstat -ano | findstr ":7777 :9000 :9100"`.
2. **Start the lobby**, in the background:
   `npm --prefix src/games/fps run lobby:server -- --port 9000 --data-dir ./server-data-test`.
   It logs its storage summary and player cap when ready.
3. **Start the bot server** when bots are needed, in the background:
   `npm --prefix src/games/fps run bot:server -- --data-dir ./server-data-test`. Invites from a
   private room then reach it on `ws://127.0.0.1:9100` (`BOT_SERVER_URL`
   overrides).
4. **Start the browser side.** The client connects to `VITE_LOBBY_URL`
   (default `ws://localhost:9000`). For a lobby on another port, set it in the
   environment of the dev or probe server before starting it; it is read at
   build time.

Bots join only **private** rooms. Public matchmaking is people only.

## While it runs

- A lobby round trip takes 1–3 seconds on a loaded machine. Wait seconds, not
  milliseconds, before deciding something failed, and check the lobby log: each
  result logs one status (`stored`, `skipped`, `rejected`, …) with a reason.
- The lobby logs each spawned game server's port and each received result.
  Match demos land in `public/data/demos/`.
- Read-only inspection without disturbing the running lobby:
  `npm --prefix src/games/fps run lobby:server -- --results-info --data-dir <dir>` and
  `--ratings-info`.

## Stop

Stop the bot server, then the lobby (Ctrl+C, or stop the background task). Then
check ports 7770–7790 again: a game server whose match was still running can
outlive the lobby. Delete the scratch data directory if you made one.

## Report

Say which data directory you used, which processes you started, and that you
stopped them (or that you left them running for the user, with their ports).
