---
name: local-stack
description: Bring up SHAG's full local multiplayer stack - lobby server (which seats bots itself) and the browser dev server - for live testing of rooms, matches, bots, results, ratings, demos or the leaderboard, and shut it down cleanly. Use this whenever a test or a user request needs a real lobby or match ("play a match", "invite a bot", "test the leaderboard", "does the room work", "map needs the lobby"), when `map <name>` fails for lack of a lobby, or when ports 9000, 9100 or 7777+ are busy.
---

# The local multiplayer stack

Normal play goes through the **lobby** (accounts, rooms, results, ratings),
which spawns one **game server** per match and, for a match with bots, a
**match runner** that plays them. The browser talks to the lobby. Without
the lobby, `map <name>` and the Play menu cannot start a match; offline work
can use a demo instead (see `browser-probe`).

| Process | Command | Port |
| --- | --- | --- |
| Lobby | `npm --prefix src/games/fps run lobby:server -- --port 9000 --data-dir <dir>` | 9000 |
| Game servers | spawned by the lobby, one per match | 7777 upward |
| Match runners | spawned by the lobby, one per match with bots | none |
| Browser | `npm --prefix src/games/fps run dev` (or the private probe server) | 3000 (3100) |

## Choose the data directory

The lobby keeps accounts, results and ratings in `<data-dir>/players.db`, and
the bots' match reports in `<data-dir>/bot-intel.db`.

- **Automated tests and probes:** use a scratch directory, for example
  `--data-dir ./server-data-test`, so test matches never touch real ratings.
  Delete it afterwards.
- **The user's own play:** the default `./server-data`, which holds their real
  accounts and boards.


## Start

1. **Clear stale servers.** A game server left over from an earlier run keeps
   simulating at 125 Hz and starves the machine. Check ports 7770–7790, 9000
   and 9100, and stop leftover `node` processes you started earlier; ask before
   killing a process you did not start, since the user may be playing on it.
   On Windows: `netstat -ano | findstr ":7777 :9000 :9100"`.
2. **Start the lobby**, in the background:
   `npm --prefix src/games/fps run lobby:server -- --port 9000 --data-dir ./server-data-test`.
   It logs its storage summary and player cap when ready.
   It seats invited and campaign bots itself (`Bots: seated by the lobby`).
   Only to test the bot server path, start the lobby with `--bot-server` and
   `npm --prefix src/games/fps run bot:server -- --data-dir <same dir>` beside
   it: the two share a secret in that directory, on `ws://127.0.0.1:9100`.
3. **Start the browser side.** The client connects to `VITE_LOBBY_URL`
   (default `ws://localhost:9000`). For a lobby on another port, set it in the
   environment of the dev or probe server before starting it; it is read at
   build time.

Bots join private rooms on invite, and a public room with a person in it
invites AI players by itself after 90 seconds (`AI_INVITE_AFTER_MS` in
`src/lobby/MatchLobby.ts`). A match with a bot in it is rated in the private pool.

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

Stop the lobby (Ctrl+C, or stop the background task), and the bot server if you
started one. Then check ports 7770–7790 again: a game server whose match was
still running can outlive the lobby (match runners exit with it). Delete the scratch data directory if you made one.

## Report

Say which data directory you used, which processes you started, and that you
stopped them (or that you left them running for the user, with their ports).
