# Firefox input investigation

Date: 2026-10-19 (Europe/Helsinki). Branch: `v0.9.34-firefox-input` in both repositories.

## Status

Reproduced and fixed a browser-event compatibility failure that can explain the
reported missing mouse actions. With Babylon's default pointer cancellation,
trusted pointer events arrived but the legacy mouse events used by the game did
not. The original input path recorded zero fire/aim frames while keyboard movement
continued to work. This cancellation path also reproduced in Chromium outside
native pointer lock; it is not exclusively a Firefox implementation bug.

After the fixes, Firefox, Chrome and Brave each passed 18 native-input probe
cases. In the full Firefox WebGL2 client, a local FFA player selected the rocket
launcher, fired two shots and received server ammo updates from 15 to 13.
Mouse-move events also arrived while firing. Native pointer-lock state was
simulated for this end-to-end firing test: the automation environment refused
real pointer lock. Native Linux/Wayland/X11 acceptance remains outstanding.

The fixes are included in the v0.9.34 release. No production services were
changed during this investigation; publication follows the normal main-branch
deployment pipeline.

## Environment and isolation

| Item | Tested configuration |
| --- | --- |
| OS | Local Windows machine; Firefox reports Windows NT 10.0 / Win64 |
| Firefox | Installed Firefox 158.0, build 20261007201254 |
| Chrome | Installed executable version 155.0.8059.84; HeadlessChrome/155 UA |
| Brave | Installed executable version 155.1.97.56; Chromium 155 UA |
| Browser automation | Firefox WebDriver BiDi; Chrome/Brave CDP |
| Rendering | Full Firefox client explicitly selected WebGL2 |
| Private frontend | `127.0.0.1:3100`, HMR/watch disabled |
| Scratch lobby | `127.0.0.1:9200`, in-memory player storage, no ranking/result store |
| Scratch matches | Ports starting at 17777; server-backed `washoi_dm2`, FFA warmup |
| Bot secret | Separate `.cache/firefox-server-data`; no production secret/state used |

Fresh Firefox profiles under `.cache/firefox-profile-*` were used rather than the
user's profile. Both headless and windowed Firefox were attempted for pointer
capture. Test-only focus preferences were tried inside those disposable profiles;
none were added to the game or the user's Firefox configuration. Chrome and Brave
also used separate temporary profiles. Production was not contacted.

WSL listed only `docker-desktop`; the Docker Linux engine was not running. No
Linux browser was available for a local test. The Windows results must not be
described as a Linux reproduction.

## Findings and implemented fixes

### 1. Cancelled pointer events lose fire/aim compatibility mouse events

Source trace:

1. Babylon's `Scene` defaults `preventDefaultOnPointerDown` to `true`.
2. Its scene input manager calls `preventDefault()` on canvas `pointerdown`.
3. Firefox's trusted pointer actions then omit compatibility `mousedown` and
   `mouseup`. The event recorder saw pointer events, not their mouse equivalents.
4. `InputSystem` listened only for `mousedown` to start mouse actions.
5. The FPS controller reads `FPS.FIRE` and `FPS.AIM` from that system each frame,
   so its additional mouse handlers could not recover the missing action state.

The isolated probe uses the real `InputSystem`, FPS action definitions and
Babylon `Scene.attachControl()`. Before the fix it recorded zero active fire and
aim frames, while a held W produced 16 forward frames. A plain canvas without
Babylon cancellation delivered both mouse actions.

`InputSystem` now consumes mouse-type pointer events as well as legacy mouse
events. Both streams update the same button state and duplicate downs are ignored.
The `buttons` mask tracks chords, including changes reported through
`pointermove` and the final `pointerup`. Releases outside the canvas and pointer
cancellation are handled. Blur, hidden-document and pointer-unlock recovery clear
the tracked pointer, so a later move cannot resurrect old held actions. New
listeners are removed by `dispose()`. Touch pointers retain the existing touch
path and are not reinterpreted as mouse presses.

### 2. Holding fire could also suppress mouse-look

Adding pointer-based button handling alone was insufficient. A follow-up native
input probe moved the pointer while holding left click: with Babylon cancellation
enabled it received one `pointermove` and zero `mousemove` events. The camera's
mouse-look handler consumes `mousemove`, so that path would still lose movement.

The gameplay scene now sets `preventDefaultOnPointerDown = false` immediately
after creation. This preserves compatibility mouse events for mouse-look and
legacy consumers. It does not change the separate editor scene. In all three
browsers the same held-button movement then produced both `pointermove` and
`mousemove`. The real Firefox game also reported that the gameplay scene's flag
was false and received three trusted nonzero mouse movements during firing.

This uses the browser event model rather than a Firefox user-agent workaround.
The [Pointer Events compatibility mapping](https://www.w3.org/TR/pointerevents3/#compatibility-mapping-with-mouse-events)
describes suppression of mouse events following a cancelled primary pointerdown.

### 3. Extra mouse buttons incorrectly fell through to left click

`getMouseButton()` returned `left` for every unknown button number, including
side buttons 3/4. It now returns `null` and those unsupported legacy button events
are ignored. A regression test verifies that button 3 does not activate fire.
This does not add side-button rebinding support.

### 4. Rejected pointer capture leaked an unhandled promise

The join completion, kit confirmation and Resume paths called
`canvas.requestPointerLock()` without handling a rejected promise. Firefox logged
`WrongDocumentError: The document is not focused.` during automated joining.

Those paths now use `requestBrowserPointerLock()`, which catches promise
rejections and synchronous failures, accepts legacy void-returning APIs, and
shows the existing dismissible browser-control notice asking the player to click
the game to retry. It avoids requesting again when that canvas is already locked.
The camera's existing click-to-retry and pointer-lock-change handling remain in
place. After the change, the denied-capture case no longer emitted an unhandled
promise rejection during the full Firefox run.

## Native-input matrix

Each browser ran six cases in three modes: Babylon cancellation enabled, a plain
canvas with both event families, and Babylon with the gameplay cancellation flag
disabled. Inputs came from WebDriver BiDi pointer actions or CDP mouse dispatch,
not DOM `dispatchEvent()` calls. Their recorded browser events had `isTrusted=true`.

| Case | Firefox | Chrome | Brave |
| --- | --- | --- | --- |
| Left hold/release; exactly one fire press | Pass | Pass | Pass |
| Right hold/release, aim | Pass | Pass | Pass |
| Middle hold/release, crouch | Pass | Pass | Pass |
| Left + right chord, release left while retaining aim | Pass | Pass | Pass |
| Move while holding fire | Expected suppression with cancellation; mouse movement restored with gameplay policy | Same | Same |
| Release outside canvas | Pass | Pass | Pass |
| Total across all three modes | 18 cases | 18 cases | 18 cases |

The cancelled mode intentionally retains Babylon's original cancellation to
exercise the new pointer-based button fallback. Its missing compatibility mouse
movement is a diagnostic control, not a claimed mouse-look pass. The plain mode
checks that receiving both event families does not double-trigger fire.

An initial Chromium chord-probe failure came from the CDP harness omitting the
`buttons` mask for simultaneous buttons. Correcting the harness to send the held
mask made Chrome and Brave pass; no game change was made for that test error.

## Full Firefox game check

The real local client booted, authenticated against the scratch lobby, loaded DM2
and displayed the FFA loadout picker. Selecting the kit entered `playing` state.
Native keyboard action `2` selected the rocket launcher. Trusted mouse actions
then produced:

| Measurement | Final run |
| --- | --- |
| Input samples with fire active | 54 |
| Samples with FPS controller firing | 54 |
| Input samples with aim active | 20 |
| Rocket ammo before / after | 15 / 13 |
| Trusted compatibility mouse movements while fire held | 3, each with nonzero movement |
| Unhandled JavaScript errors after fixes / harness correction | 0 |

The screenshot `.cache/firefox-game.png` was inspected: the map, HUD, equipped
rocket launcher and server-updated ammo rendered. This is a functional check,
not a Firefox performance benchmark. No multiplayer frag/rating assertion was
made; the match remained in warmup with one player.

### Pointer-lock and automation limits

Real pointer capture failed in both headless and windowed automated Firefox with
an unfocused-document error. Headless Chromium also refused capture with a root
document error. BiDi tab activation, window/canvas focus and an isolated focus
test preference did not establish native capture. These automation failures are
not evidence that a foreground human-controlled Firefox window cannot lock.

For the game firing test only, the probe supplied `document.pointerLockElement`
as the canvas and dispatched `pointerlockchange`, allowing the real FPS gate to
run. Button and movement events remained native/trusted. Server networking,
weapon selection, firing and ammo updates were real; native pointer confinement,
relative movement under confinement, Escape release and OS alt-tab recovery were
not validated end-to-end. Focus recovery is covered by the headless unit tests.

A separate initial `SecurityError` came from an overly broad automation preload
writing localStorage in an unsuitable document. Restricting that preload to the
local game origin removed it. It was not fixed in game code or treated as a game
regression.

## Other observed warnings and remaining checks

The Firefox client logged WebTransport URL failure followed by successful
WebSocket fallback in the local plain-WS setup. The session still joined and
shot. This is not a demonstrated Firefox networking failure.

Map preload warnings referenced `ammobox.md3`, `/data/models/weapons/...` paths,
projectile textures including `plnew1.tga`, unhandled legacy BSP entity classes,
GLTF skin roots and fallback muzzle sockets. They are recorded as follow-up
asset/preload diagnostics, not proven missing visible assets or Firefox-only
bugs. Entity-registration and viewport-effect replacement warnings also appeared.
This task did not change media packages or loader behavior.

Remaining manual/native-platform coverage:

- Foreground Firefox on Windows: actual pointer lock, shoot + aim + movement,
  Escape/Resume, alt-tab out/in and fullscreen transitions.
- Linux Firefox on both Wayland and X11, recording version, distro, compositor
  and whether mouse-look works while buttons fail. Test the same actions after
  loading the fix; no Linux-specific workaround is claimed here.
- Actual locked-pointer play in Chrome/Brave and full-game runs in those browsers.
  Their 18-case native input matrices passed; full-game server firing was Firefox.
- Touch, pen, gamepad, all gametypes/maps, bots, long sessions and WebGPU were not
  separately exercised in this investigation.

## Validation commands and artifacts

| Command | Result |
| --- | --- |
| `npm run test:run -- src/engine/input src/engine/camera/__tests__/CameraInputHandler.test.ts src/engine/ui/__tests__/PointerLockFailure.test.ts src/engine/ui/__tests__/FullscreenFailure.test.ts` | 55 passed |
| `npm run typecheck` | Pass |
| `npm run gate:biome` | Pass, zero errors, 319/339 warnings |
| `npm run build` | Pass |
| `npm run docs:build` | Pass |
| `npm run test:run` | 5,201 passed, one skipped, five known editor fixture failures; see below |
| `npm run test:simulation` | Pass |
| `npm run test:physics` | Pass, known position warning |
| `npm run server:tick` | Pass |
| `npm run server:fuzz -- --ticks 1000` | Pass |
| `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts --exec 'bsp load washoi_dm2; bsp info; sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'` | Pass, map counts and 91 movement ticks |

Full-suite failures are the pre-existing editor compile fixtures:
`ConvexCompile.test.ts` (two), `NaturalCompile.test.ts`,
`PlaytestCompile.test.ts` and `RoundPatchCompile.test.ts`, referring to archived
materials such as `textures/blx/blx_grid`. The suite is not claimed green.

Probe commands (scratch scripts and reports remain under ignored `.cache/`):

```text
node .claude/skills/browser-probe/scripts/private-vite.mjs 3100
node .cache/browser-input-matrix.mjs firefox
node .cache/browser-input-matrix.mjs chrome
node .cache/browser-input-matrix.mjs brave
node .cache/firefox-game-test.mjs
```

Set `VITE_LOBBY_URL=ws://127.0.0.1:9200` before starting the private Vite server.
The Chromium driver reads `EDGE_PATH`; the Chrome and Brave runs pointed it at
their own installed executable, not Edge. Firefox uses `.cache/firefox-bidi.mjs`,
an isolated profile and a loopback BiDi `/session` endpoint, as described by
[Mozilla's BiDi connection guide](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection).
The scratch lobby uses `.cache/firefox-stack.ts` and a `GameServerSpawner(17777)`.

Reports: `.cache/{firefox,chrome,brave}-input-matrix.json`,
`.cache/firefox-input-before.json`, `.cache/chromium-input-before.json`,
`.cache/firefox-game-report.json` and `.cache/firefox-game.png`.
Gate logs use `.cache/firefox-verified-*`, `.cache/firefox-final-gate-*`,
`.cache/firefox-targeted.log`, `.cache/firefox-headless-*` and
`.cache/firefox-cli.log`.

## Files changed

Outer repository:

- `src/engine/input/InputSystem.ts`
- `src/engine/input/__tests__/InputFocusRecovery.test.ts`
- `src/engine/ui/BrowserControlFeedback.ts`
- `src/engine/ui/__tests__/PointerLockFailure.test.ts`
- `src/main.ts`
- `docs/manual/guides/camera-system.md`
- `docs/changelog/v0.9.34.md`
- `docs/research/firefox_testing.md`

FPS repository:

- `Game.ts`
- `client/FPSHud.ts`

No snapshot format, authoritative simulation, renderer shader or media changes.

## Cleanup

Closed the probe browser sessions and stopped the private Vite and scratch lobby
processes. Verified no listeners remained on the probe ports (3100, 9200,
9223–9226 or match ports 17777–17782), and no Firefox process remained with one
of the investigation's profile paths. Existing user services were not stopped.
