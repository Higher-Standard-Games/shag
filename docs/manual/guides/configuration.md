# Configuration

SHAG currently has three distinct configuration concerns: build-time game code, loose-asset paths, and server/lobby environment.

## Build-time game selection

`vite.config.ts` selects the Vite `@game` alias from `GAME`, falling back to `public/engine.json.defaultGame`.

```powershell
$env:GAME = 'fps'
npm run dev
```

This is only partly generic today. `tsconfig.json` still maps `@game/*` to `src/games/fps/*`, and `src/main.ts` directly composes the FPS game. A new selected game therefore needs bootstrap and TypeScript wiring, not just an environment variable.

Engine code should not import `@game`; keep that dependency in application/game composition.

## engine.json and GamePaths

`public/engine.json` is required by browser startup and is injected explicitly by the headless composition:

```text
defaultGame: fps
engineAssetsPath: /engine
```

The file is JSON; the values above describe the currently committed configuration.

`GamePaths` builds:

| Helper | Current shape |
| --- | --- |
| `game(path)` | `/games/<id>/<path>` |
| `engine(path)` | `/engine/<path>` by default |
| `maps/textures/prefabs/data/music/fonts` | convenience paths below the loose game root |

```ts
// From src/main.ts
import { GamePaths } from './engine/core/GamePaths';

const paths = GamePaths.getInstance();
await paths.init();
console.log(paths.game('models/example.glb'));
```

The FPS PK3 pipeline is separate and primarily reads `public/data/`. Do not change PK3 lookup to `GamePaths.data()`.

## External game data

```text
public/data/
  *.pk3
  pk3_manifest.json
  ktx2cache/
```

```bash
npm run tools:manifest
npm run tools:textures
```

`public/data/`, `public/games/`, PK3 files, and generated media are ignored. A clean checkout needs external compatible assets.

## Networking environment

Copy and review `.env.example`, which lists every variable below.

| Variable | Owner | What it does |
| --- | --- | --- |
| `VITE_LOBBY_URL` | browser | Lobby socket the client connects to |
| `SHAG_PUBLIC_GAME_PROTOCOL` / `SHAG_PUBLIC_GAME_HOST` | lobby | The address the lobby advertises for spawned game servers |
| `SERVER_DATA_DIR` | lobby, bot server | Where `players.db` and the shared bot secret live; `--data-dir` wins over it |
| `BOT_SECRET` | lobby, bot server | Proves a bot connection; written into the data directory when unset |
| `BOT_SERVER_URL` | lobby | Bot control socket the lobby asks for bots |
| `LOBBY_BOT_CONNECT_URL` | lobby | Lobby URL a spawned bot connects back to |
| `SHAG_SPAWN_TIMEOUT_MS` | lobby | How long to wait for a spawned server to report ready (default 45s, clamped to 5s–5min) |
| `SHAG_LOBBY_MAX_PLAYERS` | lobby | Players online at once, bots not counted; `0` for no cap (default 64). `--max-players` wins over it |
| `SHAG_MATCH_ADMISSION` / `SHAG_MATCH_RESULT_SECRET` | spawned server | That match's seat manifest, and the secret its result line is signed with; the lobby sets both per match |
| `SHAG_TIMELIMIT` / `SHAG_WARMUP` / `SHAG_SCORELIMIT` | game server | Match rule overrides; a bare number is minutes for the time limit and seconds for warmup, and either takes an `s`/`m` suffix |
| `SHAG_GAME_CERT_PATH` / `SHAG_GAME_KEY_PATH` | spawned server | TLS files for a direct `wss://` socket |
| `GAME_PATH` | headless | Asset-directory override |
| `BOT_NAV_CACHE_DIR` / `BOT_GOAL_ARBITER` | bot server | Navigation cache directory and goal-arbiter selection |

Only `VITE_*` variables are exposed to browser code; the rest are read by Node processes only.

## UI and game metadata

`src/games/fps/game.json` contains FPS metadata. Optional loose game config/UI/HUD paths exist in `GamePaths`, but the active direct FPS bootstrap does not imply every optional file is loaded.

Keep secrets and machine-local paths out of Vite-exposed variables and source-controlled configuration.
