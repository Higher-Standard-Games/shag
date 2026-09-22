# Frequently asked questions

## What is SHAG Engine?

SHAG is a Babylon.js engine and arena-FPS stack for Quake 3 and Warsow media. It includes BSP/PK3 loading, Quake shader compatibility, deterministic movement, an authoritative multiplayer server, console tooling, and the active FPS game module.

## What license is it under?

The repository uses the MIT License. See the [LICENSE file](https://github.com/Higher-Standard-Games/shag/blob/main/LICENSE).

## Where do maps and PK3s go?

Put external game data under `public/data/`. The directory and `*.pk3` files are ignored by Git. Generate the manifest/index using the repository scripts, then confirm discovery with:

```text
developer 1
pk3 stats
pk3 list
pk3 find maps/wdm2.bsp
```

## Why does a map not load?

Check these in order:

1. the expected PK3 is under `public/data/`;
2. the generated index is current;
3. `pk3 find maps/<name>.bsp` resolves;
4. `bsp load <name>` succeeds in the headless runner;
5. the browser network panel has no missing PK3, texture, WASM, or manifest requests.

Use `bsp load` for inspection and `map <name> [gametype]` for normal gameplay.

## Why did `bsp load` not start a match?

`bsp load` is the loader/inspection path. A browser match uses the gameplay launcher and server:

```text
map wdm2 duel
```

See [Map launching](../guides/map-launching.md).

## How do I open the console?

Press backquote/tilde. F1 is not a current default console binding. Enable restricted commands with `developer 1`.

## What is the player key, and what happens if I lose it?

Every player has an account, and the key is what opens it. A browser that
reaches the lobby without one is given a new account and a key, kept in that
browser's local storage; pasting the key into another browser opens the same
account there. The lobby stores only the key's SHA-256, so nobody — including
the server operator — can recover a lost key or tell you what it was. The
Profile page is where you copy it, save it as a file, or hand it to the
browser's password manager. Lose it and the account is gone; make a new one.

See the [Lobby server guide](../guides/lobby-server.md).

## How do I change rendering settings?

Individual variables apply immediately:

```text
r_wireframe 1
r_wireframe 0
r_bloom 1.2
render list
render reset
```

`r_apply` is not a standalone command. `render apply` remains as a compatibility message because changes already apply through callbacks.

## Does SHAG support raw .map files?

The parser and renderer exist, but the active high-level `MapLoader` currently resolves indexed BSPs and marks local text-map loading TODO. Treat raw maps as an engine extension path, not as a complete FPS workflow.

## How should I test a change?

```bash
npm run typecheck
npm run test:run
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
npm run test:simulation
npm run test:physics
```

Renderer or networking edits need the extended regression set in `AGENTS.md`.

## Where do I report a problem?

Search or open an issue in the [SHAG GitHub repository](https://github.com/Higher-Standard-Games/shag/issues). Include the exact command, map, browser/runtime, console output, and a minimal reproduction.
