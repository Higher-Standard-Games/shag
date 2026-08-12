# Weather Effects

> Verified against <code>src/engine/effects</code> and <code>EngineScene</code> on 2026-08-06.

Weather is an engine extension, not currently wired into the direct FPS bootstrap.

| System | Current behavior |
|---|---|
| <code>PrecipitationEffect</code> | Rain/snow particles around the camera; GPU path on supported WebGL2, CPU fallback otherwise |
| <code>WindSystem</code> | Direction/strength state and listeners; precipitation can subscribe |
| <code>FogEffect</code> | Babylon linear, exponential, and exponential-squared fog |
| <code>ThunderEffect</code> | Timed ambient darkening, screen flashes, and audio |
| <code>DebrisEffect</code> / <code>LocalDebrisManager</code> | Global/local leaves, trash, dust, or mixed particles |

<code>EngineScene</code> constructs these systems and exposes a <code>window.weather</code> facade. It also interprets raw-map worldspawn weather/time settings.

The active FPS entry point creates a Babylon <code>Scene</code> directly and does not install that facade. Consequently, <code>weather</code>, <code>wind</code>, and <code>debris</code> commands report unavailable in normal FPS composition. The separate <code>fog</code> command edits the active scene directly and works without the facade.

Precipitation owns render observers, particle systems, wind listeners, and audio; thunder owns DOM/timer/audio state. Always call their stop/dispose paths during map or scene teardown.

WebGPU precipitation remains on its compatibility path. Visual density, coverage, indoor behavior, audio availability, and mobile performance require browser/device verification.
