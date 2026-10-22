# Configuration

SHAG has three distinct configuration concerns: build-time game code, loose-asset paths, and server/lobby environment.

## Build-time game selection

`vite.config.ts` selects the Vite `@game` alias from `GAME`, falling back to `public/engine.json.defaultGame`.

```powershell
$env:GAME = 'fps'
npm run dev
```

Game selection is only partly generic: `tsconfig.json` maps `@game/*` to `src/games/fps/*`, and `src/main.ts` directly composes the FPS game. A new selected game therefore needs bootstrap and TypeScript wiring, not just an environment variable.

Engine code should not import `@game`; keep that dependency in application/game composition.

## Game-owned HUD styling

The FPS HUD theme lives in `src/games/fps/client/hud/styles/WashikiTheme.css`.
`FPSHud` imports it as a raw stylesheet and injects it through `UIStyles` before
creating the widgets. Edit game HUD appearance there. The engine's generic HUD
manager separately loads `src/engine/ui/hud/styles/HUD.css`.

Shared font assets remain under `/engine/fonts/`. Engine UI components can consume
the game's CSS variables through their existing fallbacks; the engine does not
import the FPS stylesheet.

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

## Browser preferences

Saved cvars and binding overrides are validated when loaded. Invalid entries
fall back to declared defaults; other valid preferences remain usable. Explicit
empty binding arrays still mean unbound. Storage failures leave changes working
for the session, and Settings displays "Session only · could not save" until
the affected preferences can be saved successfully. These preferences are
separate from account-key recovery; heed Profile's account-key warning too.

Once logged in to the lobby, key bindings (`shag_keybindings`, `engine_binds`),
the `cl_`, `cg_`, `s_` and `m_` cvars, the HUD layout, the UI theme and the
remembered loadouts also follow the account to other browsers (see
`src/shared/settings/SyncedSettings.ts`), as do the colour-blindness
correction cvars `r_colorcorrection` and `r_colorcorrection_strength`. Graphics
stay per device: other `r_*` and quality cvars and `engine.renderVars` never
sync, nor do debug cvars and
settings tuned to this machine or connection (`cl_interp`, `cl_timenudge`,
`cl_player_pose_hz`). On login an account's saved settings replace a browser's,
unless that browser changed its own more recently; the first time they do, the
browser's earlier settings are kept under `shag_settings_backup`. Changes upload
a few seconds after they settle and when the page is hidden. The lobby keeps each account's copy in `settings.db` ([Lobby server](./lobby-server.md#what-it-keeps)).

The initial account download finishes before background uploads begin. Switching
accounts or disconnecting stops that sync session; its late replies cannot
replace the new session's local sync state. Downloaded cvars also apply to
subsystems that load later. Saved values awaiting registration remain in browser
storage and account uploads until their owner declares the default and bounds;
resetting them removes the pending preference so that declared default applies.

## Networking environment

Copy and review `.env.example`, which lists every variable below.

| Variable | Owner | What it does |
| --- | --- | --- |
| `VITE_LOBBY_URL` | browser | Lobby socket the client connects to |
| `VITE_PK3_MIRROR_URL` | browser | HTTP mirror pk3 packages are downloaded from when it has them; unset, they come from the game's own server ([PK3 filesystem](./pk3-filesystem.md#http-mirror)) |
| `SHAG_PUBLIC_GAME_PROTOCOL` / `SHAG_PUBLIC_GAME_HOST` | lobby | The address the lobby advertises for spawned game servers |
| `SERVER_DATA_DIR` | lobby, bot server | Where `players.db` and the shared bot secret live; `--data-dir` wins over it |
| `BOT_SECRET` | lobby, bot server | Proves a bot connection; written into the data directory when unset |
| `BOT_SERVER_URL` | lobby | Bot control socket the lobby asks for bots |
| `LOBBY_BOT_CONNECT_URL` | lobby | Lobby URL a spawned bot connects back to |
| `SHAG_SPAWN_TIMEOUT_MS` | lobby | How long to wait for a spawned server to report ready (default 45s, clamped to 5s–5min) |
| `SHAG_LOBBY_MAX_PLAYERS` | lobby | Players online at once, bots not counted; `0` for no cap (default 64). `--max-players` wins over it |
| `SHAG_MATCH_ADMISSION` / `SHAG_MATCH_RESULT_SECRET` / `SHAG_MATCH_RESULT_OUTBOX` | spawned server | That match's seat manifest, the secret its result line is signed with, and the file the signed result is also written to; the lobby sets all three per match |
| `SHAG_TIMELIMIT` / `SHAG_WARMUP` / `SHAG_SCORELIMIT` | game server | Match rule overrides; a bare number is minutes for the time limit and seconds for warmup, and either takes an `s`/`m` suffix |
| `SHAG_GAME_CERT_PATH` / `SHAG_GAME_KEY_PATH` | spawned server | TLS files for a direct `wss://` socket |
| `GAME_PATH` | headless | Asset-directory override |
| `BOT_NAV_CACHE_DIR` / `BOT_GOAL_ARBITER` | bot server | Navigation cache directory and goal-arbiter selection |
| `BOT_CHAT` | bot server | `0` stops bots from chatting to human players; any other value or unset leaves chat on |
| `VITE_SHAGGED_API_URL`, `SHAGGED_*` | editor, map service | The SHAGGED map service address, map root and compiler paths, each described in `.env.example` |

Only `VITE_*` variables are exposed to browser code; the rest are read by Node processes only.

## UI and game metadata

`src/games/fps/game.json` contains FPS metadata. Optional loose game config/UI/HUD paths exist in `GamePaths`, but the active direct FPS bootstrap does not imply every optional file is loaded.

Keep secrets and machine-local paths out of Vite-exposed variables and source-controlled configuration.
