# SHAG Engine Feature Matrix

> Verified against SHAG 0.9.22 / Babylon.js 9.17.0 on 2026-08-06.

| Area | Status | Current state |
|---|---|---|
| IBSP / FBSP and PK3 | Implemented | Geometry, entities, shaders, lightmaps, PVS, collision |
| Raw <code>.map</code> | Extension | Valve planes, brushDef, patchDef2 |
| Models | Implemented | GLB/glTF/OBJ, MD3, tags |
| Rendering | Implemented | WebGL2, PBR companions, deluxe/light maps, sky, PVS |
| WebGPU | Experimental | Explicit <code>?renderer=webgpu</code> path |
| Post effects | Partial | Bloom/image processing plus optional SSAO, glow, SSR |
| FPS movement | Implemented | Shared step-slide collision and prediction |
| Liquids | In progress | Contents/water-level work exists; complete experience does not |
| Weapons and pickups | Implemented | Shared definitions, server authority |
| Teleporters/jumppads | Implemented | Shared deterministic extraction |
| Doors | Partial | <code>func_door</code>; broader movers absent |
| Multiplayer/modes | Implemented | Lobby, dedicated server, FFA, TDM, Duel, SnD |
| Bots and demos | Implemented | Server/training and record/play/verify tools |
| Weather/sprites/prefabs/buildables | Extension | APIs not all wired into FPS |
| KTX2 sidecars | Implemented | Generated cache with PK3 fallback |
| Android | Partial | Capacitor 8 project/scripts exist; bridge and manual splash hiding are not wired into the active FPS bootstrap |
| Electron | Implemented | Development, preview, compile, and packaged-build scripts |
| iOS project | Not checked in | No native iOS directory |

Volatile counts, bundle sizes, and asset statistics must be measured from the current build/data set.
