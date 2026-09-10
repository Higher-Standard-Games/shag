# Engine Architecture

> Verified against SHAG 0.9.22 on 2026-08-06.

The active app is FPS-centric. <code>src/main.ts</code> composes a Babylon scene, services, FPS controls, commands, and networking adapters.

| Layer | Role |
|---|---|
| <code>src/engine</code> | Browser loading, rendering, UI, audio, camera, and adapters |
| <code>src/shared</code> | Babylon-free deterministic client/server code |
| <code>src/games/fps</code> | Active game and server systems |
| <code>src/cli</code> | Headless tools |

<code>@game/*</code> points to the FPS module. WebGL2 is default; WebGPU is experimental.

<code>ServiceLocator</code> owns phased engine lifetimes. Owners still clean up events, observers, and timers. Shared code must not import Babylon or browser APIs.

<code>EngineScene</code> is a reusable extension base, but the FPS bootstrap does not extend it. <code>MapRenderer</code> serves raw <code>.map</code> content; <code>MapLoader</code> is the active BSP path.

See [Service Registries](../manual/guides/service-registries.md).
