# Debug Console

> Verified from command sources on 2026-08-06.

On desktop, backquote/tilde toggles the console and Escape closes it. It is disabled on touch/mobile devices. Enter executes, Up/Down navigate history, and Tab completes.

Runtime help is authoritative:

    help
    help map
    cvarlist
    cvarlist r_
    developer 1

Engine and FPS commands are auto-discovered from their respective <code>console/commands</code> directories.

| Area | Commands |
|---|---|
| Core | <code>help clear echo exec set toggle reset resetall cvarlist cvarexport developer version quit</code> |
| Maps/assets | <code>map bsp pk3 shader texture scene game</code> |
| Player/camera | <code>camera noclip god gravity pos teleport spawn spectator name</code> |
| Entities/weapons | <code>entity inspect spawnmodel spawn_pickable_entity giveweapon weapon</code> |
| Render | <code>render pp skybox light shadow daynight time godrays arealight pvs fog</code> |
| Diagnostics | <code>debug stats perf mem physics nettest binarytest animtest dump_scene screenshot</code> |
| FPS | <code>connect disconnect demo demolist demoplay loadout netsim pickup_audit</code> |

Use <code>help &lt;command&gt;</code> for current subcommands and aliases. Developer-only commands are rejected until <code>developer 1</code>.

Availability depends on runtime composition. FPS commands need the FPS module. <code>weather</code>, <code>wind</code>, and <code>debris</code> need the <code>window.weather</code> facade installed by <code>EngineScene</code>; the direct FPS bootstrap does not install it. <code>fog</code> operates directly on the active scene.

The headless game adds commands such as <code>sim</code>, <code>trace_test</code>, and <code>leaktest</code>. Browser-only commands may be unavailable there.
