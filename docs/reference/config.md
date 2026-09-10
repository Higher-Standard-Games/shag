# Configuration

> Verified on 2026-08-06.

The active FPS bootstrap uses layered configuration. A separate generic <code>GameConfig</code> still exists for the <code>AssetLoader</code>/<code>EngineScene</code> raw-map extension path.

| Layer | Source | Owner |
|---|---|---|
| Engine selection | <code>public/engine.json</code> | <code>GamePaths</code> |
| FPS metadata | <code>src/games/fps/game.json</code> | Browser bootstrap |
| Map pool | <code>config/maps.json</code> | Lobby server |
| Loose-game defaults | <code>/games/&lt;id&gt;/engine-settings.json</code> | <code>EngineSettings</code> |
| Raw-map extension manifest | <code>/games/&lt;id&gt;/config.json</code> | <code>AssetLoader</code> |
| Live/user settings | Cvars and browser storage | Owning subsystem |
| Process options | CLI arguments/environment | Entry point |

Current <code>engine.json</code> selects game <code>fps</code> and engine root <code>/engine</code>. Headless roots may pass the same data to <code>initFromConfig()</code>.

Optional engine settings cover camera, lighting, time, and post-processing. A missing file is valid and uses defaults. The current FPS public game directory is not checked in.

The direct FPS entry point in <code>src/main.ts</code> loads <code>EngineSettings</code>, but does not call <code>AssetLoader.loadAll()</code>. Consequently, <code>config.json</code> is not an active FPS configuration layer. <code>EngineScene</code> can use the loader for raw <code>.map</code> files, prefabs, and conventional audio assets.

FPS media follows a separate path: <code>public/data</code> PK3 files through <code>PK3Index</code>/<code>PK3Loader</code>. Do not add ad-hoc BSP filesystem searches.

Choose ownership deliberately:

- deterministic gameplay: shared typed definition;
- live preference: cvar;
- map display/mode metadata: <code>config/maps.json</code>;
- boot selection: <code>engine.json</code>;
- build/deployment: Vite, package scripts, Capacitor, or Electron.

Use <code>cvarlist</code>, <code>help &lt;cvar&gt;</code>, <code>reset</code>, and <code>cvarexport</code> for runtime settings.
