# Game Paths

> Verified against <code>GamePaths.ts</code> on 2026-08-06.

<code>GamePaths</code> builds conventional loose-asset URLs. Browser startup fetches <code>public/engine.json</code>; headless code uses <code>initFromConfig()</code>.

Current selection is game <code>fps</code> with engine root <code>/engine</code>.

| Method | Current result |
|---|---|
| <code>game()</code> | <code>/games/fps</code> |
| <code>engine()</code> | <code>/engine</code> |
| <code>maps(file)</code> | <code>/games/fps/maps/file</code> |
| <code>textures(file)</code> | <code>/games/fps/textures/file</code> |
| <code>prefabs(file)</code> | <code>/games/fps/prefabs/file</code> |
| <code>data(file)</code> | <code>/games/fps/data/file</code> |
| <code>music(file)</code> | <code>/games/fps/music/file</code> |
| <code>fonts(file)</code> | <code>/games/fps/fonts/file</code> |

Config helpers return <code>config.json</code>, <code>engine-settings.json</code>, <code>data/ui-config.json</code>, and <code>data/hud-config.json</code> under the game root. A helper does not imply the file exists.

<code>resolve(relativePath)</code> sends HTTP HEAD requests to the game path and then engine fallback. If both fail, it warns and returns the game URL. Servers/CDNs must support HEAD for reliable detection.

<code>setGame()</code> changes the stored id but requires reload; it does not rebuild services. <code>resetInstance()</code> is for tests.

The FPS BSP/media path is separate: it primarily uses indexed PK3 files under <code>public/data</code>.

The <code>game</code> command exposes <code>info</code>, <code>load</code>, <code>switch</code>, and <code>reload</code>. Only <code>info</code> is a dependable diagnostic today: load changes memory until reload, while switch/reload write a <code>?game=</code> URL that the current bootstrap does not consume. Persistent selection still comes from <code>engine.json</code>.
