# Touchscreen controls

**Date:** 2026-11-04
**Status:** investigation, nothing implemented
**Scope:** the game in mobile and tablet browsers (Chrome, Safari, Firefox on
Android, iOS and iPadOS). The Capacitor Android build is out of scope here; it
already locks landscape in its manifest and can reuse whatever the browser path
builds.

## Summary

| Question | Answer |
| --- | --- |
| Can we detect phones, tablets and touchscreens? | We can detect **touch capability** and **which input the player is using right now**, reliably. We cannot reliably detect the device *class* (phone vs tablet vs touchscreen laptop), and do not need to. |
| Can that decide whether the touch HUD shows? | Yes, if the decision follows the **last input used** rather than a one-off device check. A touchscreen laptop then shows touch controls only while someone is touching it. |
| Can we force landscape? | On Android (Chrome, Firefox): yes, but only from fullscreen, which needs a tap; the boot screen's existing "Tap to start" (there to unlock sound) is that tap. On iPhone Safari: no; the page cannot enter fullscreen or lock orientation, so it shows a "rotate your device" screen in portrait instead. iPad: fullscreen is possible, orientation lock is not. |
| How do mobile FPS games control? | Left thumb: a floating move stick. Right thumb: a look area you drag like a trackpad, with a fire button you can also drag to aim. Jump, crouch and weapon buttons around the right thumb, a layout editor, and often gyro aiming. |
| Steam Controller style touch area? | Yes, and it suits an arena shooter better than a plain swipe: a look pad with an acceleration curve (slow drag for precise aim, fast drag for big turns), edge spin (hold at the pad's edge to keep turning) and optional trackball inertia. |
| Protocol or simulation change needed? | **No.** The movement command already carries a free world direction, so a stick can move at any angle without a new field. |

The largest piece of work is not the controls themselves. The game currently
treats **pointer lock as "in play"**, and mobile browsers have no pointer lock.
That assumption has to become an explicit "playing" state first (see
[Pointer lock is the gameplay state](#pointer-lock-is-the-gameplay-state)).

## What the code has today

Verified in source on `main` at `500579ee`.

### Touch detection exists, but is too broad

`src/engine/core/CapacitorBridge.ts` runs in the browser too (via
`src/games/fps/client/main.ts`). Its `isTouchDevice()` is:

```ts
"ontouchstart" in window || navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches
```

When true it adds `body.touch-device` and loads `src/engine/ui/styles/mobile.css`
(411 lines: larger buttons, menus fitted to narrow screens). Because the test
is an OR, a Windows laptop with a touchscreen also matches, since its
`maxTouchPoints` is above 0. That is harmless for bigger menu buttons, but it
would be wrong as the switch for gameplay touch controls.

`src/engine/core/QualityDetector.ts` `detectDeviceType()` classifies
desktop/mobile/tablet from the user agent. iPadOS Safari sends a Mac user agent
by default, so an iPad reaches the "touch device with a wide screen" fallback
at best, and only when `innerWidth >= 1024`.

### Raw touch input is collected but unused

`src/engine/input/InputSystem.ts` listens for `touchstart`, `touchmove`,
`touchend` and `touchcancel` on the canvas and keeps `rawState.touch.points`
(id, position, start position, delta). `getTouchPoints()` exposes them, but no
gameplay code reads them. `InputBinding` in `InputTypes.ts` already reserves
`gesture?: string` ("Touch gesture (future)") and `gamepadButton?: number`
("Gamepad button (future)"); `updateActionStates()` checks only keys, mouse
buttons and the scroll wheel. No code calls `navigator.getGamepads`.

### Pointer lock is the gameplay state

On desktop, clicking the canvas takes pointer lock, and losing it (Esc) opens the
match menu. Fifteen source files read pointer-lock state. The ones that matter for
touch:

- `CameraInputHandler` (`src/engine/camera/CameraInputHandler.ts`): mouse look
  runs only while locked (`if (!this._isPointerLocked ...) return`). The look
  maths, which applies `m_sensitivity`, `m_invertY`, the ADS modifier and the
  pitch clamp, sits inside the `mousemove` handler.
- `FPSController.syncKeysFromInput()`: fire and aim are
  `this.inputHandler.isPointerLocked && input.isActive(FPS.FIRE / FPS.AIM)`.
- `FPSHud`: a `pointerlockchange` to unlocked opens the match menu, and
  locking closes it.
- `Crosshair`: hidden when pointer lock is lost.
- `MatchInputBindings`, `FPSPickup`, `DroppedWeaponRenderer`: gameplay-only
  checks.

Mobile browsers do not offer pointer lock to touch input. Before any touch
control can fire a weapon, these sites need one question to ask instead, such as
"is the player in play", which is true when either pointer lock is held **or**
touch play is active.

### Movement already accepts any angle

- `Game.sendInput()` (`src/games/fps/Game.ts`) turns the four movement booleans
  into a world-space direction, normalizes it and sends
  `direction: {x, y: 0, z}`.
- On the wire, `BinaryProtocol.encodeCommand` writes the direction as three
  `float32`, so it is not limited to 8 directions.
- `MovementProfile` normalizes the wish direction (`wishLen`) and moves at full
  speed in that direction.
- The server's `movementKeys()` (`FPSMovementSubsystem.ts`) derives the
  forward/strafe keys used for animation and the snapshot from the direction,
  with a ±0.25 threshold.

So a stick can send any angle with no protocol, demo or simulation change: it
only needs a way into `sendInput` besides four booleans. The stick's
**magnitude** is ignored, because the direction is normalized: a half-pushed
stick still runs at full speed. That fits the game: `cl_autorun` defaults to 1,
so running is normal and walking is the held exception. Walking from a lightly
pushed stick would need a movement change and is not proposed.

### HUD and fullscreen hooks

- HUD widgets are DOM elements placed through `FPSHud.addWidget(id, widget, area)`
  (areas such as `bottom-left`, `bottom-right`, `overlay`). A touch controls
  widget fits this pattern.
- `requestBrowserFullscreen()` (`src/engine/ui/BrowserControlFeedback.ts`)
  already wraps `requestFullscreen` with an error message. Orientation lock
  would go right after it.

## 1. Detecting touch devices

### Signals available in browsers

| Signal | What it tells | Caveat |
| --- | --- | --- |
| `matchMedia("(pointer: coarse)")` | The **primary** pointer is a finger | Touch laptops report `fine` (the trackpad is primary). Correct for phones and tablets. |
| `matchMedia("(any-pointer: fine)")` | Some precise pointer exists (mouse, trackpad, stylus) | True on an iPad with a Magic Keyboard or a phone with a mouse attached |
| `matchMedia("(hover: none)")` | The primary pointer cannot hover | Same as `pointer: coarse` in practice |
| `navigator.maxTouchPoints` | Touch hardware exists, and how many fingers | Above 0 on touch laptops and some Windows desktops with touch drivers |
| `navigator.userAgentData.mobile` | The browser says it is a mobile browser | Chromium only; Safari and Firefox lack it |
| User agent string | Rough device class | iPadOS sends a Mac user agent; Android tablets often omit "tablet" |
| `PointerEvent.pointerType` | Which input produced **this** event: `"touch"`, `"pen"` or `"mouse"` | Live per event, so it is the most reliable signal there is |
| `gamepadconnected` / `navigator.getGamepads()` | A controller is connected and a button was pressed | Browsers only report a pad after its first button press |

### Recommendation: capability once, last input always

1. **At boot, decide whether touch is possible:** `maxTouchPoints > 0` or
   `pointer: coarse`. This only decides whether the touch code loads and whether
   touch settings rows appear; it shows nothing.
2. **At boot, guess the starting device:** touch if
   `(pointer: coarse) && !(any-pointer: fine)`, otherwise keyboard and mouse.
   That puts phones and tablets straight into touch, and touch laptops into
   mouse.
3. **While running, follow the last input:**
   - `pointerdown` with `pointerType === "touch"` → touch;
   - a `keydown`, or a `pointermove` with `pointerType === "mouse"`, → keyboard and mouse;
   - a gamepad button (later) → gamepad.

   Switch only on a deliberate input (a press, or real mouse movement), not on
   the compatibility mouse events a browser fires after a tap. Pointer Events
   already tell these apart through `pointerType`.
4. **Emit one event**, for example `input:device_changed` with
   `"touch" | "keyboard_mouse" | "gamepad"`, on the EventBus. The HUD shows or
   hides touch controls from it; settings, hints and button prompts read the
   same state.

This is how console and PC games that support several inputs behave (prompts
switch the moment you touch the other device), and it handles the hard cases
without a setting: a touch laptop, an iPad with a keyboard, a phone with a
gamepad.

## 2. Fullscreen and landscape

### What browsers allow

| Platform | Fullscreen for the game element | `screen.orientation.lock("landscape")` | Notes |
| --- | --- | --- | --- |
| Android Chrome / Edge / Samsung Internet | Yes, from a user gesture | Yes, **only while fullscreen** | The usual web-game path |
| Android Firefox | Yes, from a user gesture | Yes, while fullscreen | Verify on a device |
| iPadOS Safari | Yes (`requestFullscreen`, older versions `webkitRequestFullscreen`) | No | The iPad rotates freely; a portrait iPad is still playable but cramped |
| iPhone Safari (and every iOS browser, which all use WebKit) | **No** for anything but `<video>` | No | The browser bars stay; the page cannot rotate itself |
| Installed web app (manifest `"orientation": "landscape"`, `"display": "fullscreen"`) | Launches without browser bars | Android honors the manifest orientation; iOS does not | `public/site.webmanifest` exists but still says "SHAG Engine", `"display": "standalone"` and has no `orientation`; updating it is cheap. "Add to Home Screen" is the best iPhone experience |

Verify each row on real devices before building on it, because browser support
in this area changes between releases. The two rules that have held for years:
orientation lock needs fullscreen, and iPhone Safari offers neither.

### Proposed flow

1. **The boot screen's tap goes fullscreen.** The loading screen already waits
   for a tap so the browser lets the game play sound:
   `LoadingScreen.start()` (`src/engine/ui/LoadingScreen.ts`) runs inside
   that click handler and calls `AudioManager.unlockAudio()`. On a touch device,
   that same handler calls `requestBrowserFullscreen(true)` and, once fullscreen
   is entered, `screen.orientation.lock("landscape")`. The fullscreen request
   needs the user gesture, and the lock needs fullscreen. There is no extra tap
   and no new screen. The screen already tells touch from mouse
   (`matchMedia("(pointer: coarse)")` picks "Tap to start" over "Click to
   start"); use the boot-time guess from
   [section 1](#1-detecting-touch-devices) here instead, so a touchscreen
   laptop's mouse user does not get fullscreen at boot. Ignore a rejected
   request or lock: it is expected where the browser cannot do it (iPhone).
2. A **rotate screen** overlay covers the game whenever
   `(orientation: portrait)` matches in touch mode: a phone icon turning, and
   the match keeps running underneath. On iPhone this is the only way to get
   landscape; elsewhere it covers a refused lock or a player who left
   fullscreen.
3. Leaving fullscreen (Android back gesture) mid-match shows the pause menu, as
   Esc does on desktop. Its **Resume** tap is a fresh user gesture, so it
   re-enters fullscreen and re-locks landscape, as desktop's Resume re-takes
   pointer lock. No separate fullscreen button is needed.
4. Respect safe areas: the touch layer pads itself with
   `env(safe-area-inset-*)`, so buttons stay clear of notches and the iPhone
   home bar. `src/games/fps/index.html` already sets `viewport-fit=cover` and
   disables pinch zoom in its viewport meta, so those values are live.
5. Add `touch-action: none` and `overscroll-behavior: none` on the game layer,
   so drags never scroll, zoom or trigger pull-to-refresh, and suppress the
   long-press callout (`-webkit-touch-callout: none`, `user-select: none`).

## 3. How mobile FPS games handle controls

The pattern that big mobile shooters (Call of Duty: Mobile, PUBG Mobile,
Fortnite, Standoff 2, Critical Ops) have converged on:

- **Left thumb: a floating move stick.** It appears where the thumb lands
  anywhere in the left part of the screen, so the player never has to find it.
  Pushing past an outer ring often locks sprint ("sprint lock").
- **Right thumb: the look area.** Most of the right half acts as a trackpad:
  drag deltas turn the view, with separate horizontal and vertical sensitivity
  and an optional acceleration curve. There is no cursor; the delta is all that
  counts.
- **A fire button that also aims.** Pressing fire starts shooting, and dragging
  without lifting keeps turning the view, so the thumb never leaves aim to
  shoot. Many games add a second fire button on the left for "claw" players.
- **Context buttons** around the right thumb: jump, crouch/slide, reload, aim
  (ADS), grenade. Weapons are tapped from a small bar, or swiped.
- **Layout editor:** drag each button, change its size and opacity, keep
  presets. Competitive players rely on it; it removes most complaints about
  fixed layouts.
- **Gyro aiming** (optional): small device rotations add to the look,
  usually only while aiming or firing. It gives the fine correction thumbs are
  bad at.
- **Aim assist / auto-fire:** most shooters on phones and consoles slow the
  view near a target and pull slightly toward it; casual ones also fire
  automatically when the crosshair is on an enemy. Auto-fire is not proposed.
  A small assist that only shapes the player's own turn is, for touch look
  only; see [Aim assist](#aim-assist).
- **Haptics:** a short vibration on hit or damage. `navigator.vibrate` works in
  Android browsers but not on iOS.

### Steam Controller ideas that fit a fast arena shooter

The Steam Controller's trackpads faced the same problem: a thumb on a small
surface replacing a mouse. Its modes map directly onto a touch look area:

| Idea | How it works | Why it helps here |
| --- | --- | --- |
| **Acceleration curve** | Turn = delta × sensitivity × f(drag speed). Slow drags turn less than linear; fast flicks turn more | One pad gives both fine rail aim and 180° turns. This is the "turn slower or faster" idea. |
| **Edge spin** | Holding the thumb near the pad's edge after a drag keeps turning in that direction, faster the closer to the edge | A thumb runs out of glass long before a mouse runs out of mousepad; this removes the need to lift and re-swipe during a long turn |
| **Trackball inertia** | Lifting during a fast drag lets the view keep turning, slowing with friction; a touch stops it | Fast turnarounds with a flick; optional, since some players hate it |
| **Gyro plus pad** | Pad for large turns, gyro for fine corrections | The Steam Input "gyro + trackpad" combination many aim-focused players use |
| **Flick stick** | (stick mapping) Point the stick in a direction and the view snaps there, then rotating the stick turns | Fits gamepads better than touch; noted for the gamepad pass |

A single pad that **moves forward and turns** at once (drag up to move, drag
sideways to turn, like old tank-style mobile shooters) is simpler to learn, but
it cannot strafe while turning. Strafe jumping, circle jumps and air control
in this game need move and look at the same time from different thumbs, so
this layout would cap a touch player's movement. It could be an optional
"simple" preset; it should not be the default.

## 4. Control scheme

The layout below was settled with the owner on 2026-11-04 in an interactive
mockup, kept as [touchscreen_controls_mockup.html](./touchscreen_controls_mockup.html).
Open it in a browser and drag with the mouse; on a phone turned sideways it
fills the screen.

```text
 ┌──────────────────────────────────────────────────────────────────────┐
 │ [≡] [score]                   timer · frags                    [chat] │
 │                                                                        │
 │   ╭─ move (left 42%) ───────╮   ╭─ look (right 58%) ────────────────╮  │
 │   │ floating stick: appears │   │ drag = look (acceleration curve)  │  │
 │   │ under the thumb; a faint│   │ hold at either edge = edge spin   │  │
 │   │ ghost marks its rest    │   │        [BL]   [«]   [»]           │  │
 │   │ any angle, always runs  │   │   (reload) ( FIRE )◆(AIM)         │  │
 │   │                         │   │       (crouch)  (JUMP)            │  │
 │   ╰─────────────────────────╯   ╰───────────────────────────────────╯  │
 │              health · armor                weapon · ammo               │
 └──────────────────────────────────────────────────────────────────────┘
```

**Placement.** The right thumb's buttons are placed in screen heights from the
bottom-right corner (CSS container units, `cqh`), so the cluster keeps its
shape on every phone width. The phone is held by its lower corners, so the
thumb comes up from below: AIM sits at FIRE's right, a little below its middle,
about a thumb pad apart. The other keys ring FIRE loosely at about the same
distance: the weapon keys arc above it (« centred over it, BL and » on either
side), RELOAD sits to its left, and CROUCH and JUMP sit under it. Tried on a
phone, the cluster needed buttons 30% larger than the first mockup's (FIRE is
about 27% of the screen height). Health and armor sit bottom centre-left and the
weapon and ammo bottom centre-right, clear of both thumbs.

**One thumb on FIRE and AIM.** A touchscreen reports a finger as one point, its
centre, so a thumb resting across two buttons presses only the one under that
centre. The seam between FIRE and AIM (◆) is therefore its own spot: it holds
fire and aim together, dragging from it aims, and on release aim returns to
how it was. With the blade out it only slashes, since the blade's aim button
charges the blast.

**Look.** Zones are invisible in play; a faint "Move" / "Look" label shows
until each side has been used once. The mockup also offers outlined and grey
zones for comparison: choose one before building rather than shipping a
setting. Buttons are ink discs with cream line icons, the HUD's offset print
shadow and one shared opacity. A press lights a button cyan (FIRE magenta, the
seam gold) and drops its shadow, so the thumb gets feedback without looking.

| Control | Behavior | Feeds |
| --- | --- | --- |
| Move stick | Floating; direction relative to the stick's centre, dead zone about 12% of its radius; any angle at full run | New stick input into `Game.sendInput` direction (see stage 3) |
| Walk | Pushing the stick only a little does **not** walk (magnitude is ignored); a held **walk** toggle on the stick ring is optional | `FPS.SPRINT` (held = walk, since `cl_autorun` is 1) |
| Look side | Drag deltas with an acceleration curve; edge spin; trackball inertia optional; aim assist | Shared look function (see stage 2) |
| Fire | Press = fire; drag while held = look | `FPS.FIRE` plus look |
| Aim | Tap toggles zoom, so nothing is held while firing. With the blade it is held, because the blade's alternate fire charges the blast. The rocket and grenade launchers already aim when fired (`hipfireBlocked`) | `FPS.AIM` (alternate fire) |
| Fire + aim seam | Holds both; drag = look | `FPS.FIRE` + `FPS.AIM` plus look |
| Jump | Hold = held jump (bunny hopping, wall jumps) | `FPS.JUMP` |
| Crouch / slide | Hold | `FPS.CROUCH` |
| Reload | Tap; the machinegun, riotgun, plasma gun and voltaic have clips | `FPS.RELOAD` |
| « / » | Tap: previous / next gun. Cycling skips the blade, as `FPSController` already does | `FPS.WEAPON_PREV` / `FPS.WEAPON_NEXT` |
| BL | Tap: the blade; tap again: back to the last gun | `onWeaponSelect` |
| Menu | Opens the match menu (desktop's Esc) | `FPSHud.showMatchMenu()` |
| Scoreboard | Hold | `FPS.SCOREBOARD` |
| Chat | Opens chat; the on-screen keyboard appears | `FPS.CHAT` |
| Ready | Shown during warmup only | `FPS.READY` |
| Use | Not on screen; add it if a map needs it | `FPS.USE` |

### Aim assist

The owner chose to try a small assist for touch look (2026-11-04). The mockup
implements these rules; the numbers are starting points to tune on a phone:

- **It only shapes the thumb's own turn.** A still thumb gets nothing, so it
  can never aim on its own.
- **Friction:** while the crosshair is over a target, turning slows to 60%.
- **Pull:** toward the target, at most 25% of the thumb's own turn
  horizontally and 15% vertically.
- **Reach:** only within about three target widths of the crosshair, and
  within a set distance.
- **Only touch look passes through it.** It runs inside the touch look path,
  before the shared look function, so mouse look never reaches it and forcing
  touch with `in_touch 1` gives a mouse player nothing.

The game needs what the mockup fakes: the remote players the client already
interpolates, enemies only (not teammates), nobody dead, and a line-of-sight
check, so it never pulls toward a player behind a wall. Which collision query
the client can run for that is still to be checked.

Every button except the move stick and look pad becomes an action through the
existing action map, so `FPSController.syncKeysFromInput()` keeps reading
`input.isActive(FPS.JUMP)` and does not need to know a finger pressed it.

## 5. Setup and auto-detection

Following the project's rule of a better default over an optional toggle:

- **No "touch controls on/off" setting.** The touch HUD shows when the last
  input was touch and hides when the player uses a keyboard, mouse or (later) a
  gamepad, as described in [section 1](#1-detecting-touch-devices). A developer
  cvar can force it for testing (for example `in_touch -1/0/1`: auto, off, on).
  It is not a settings row.
- **Controls page, touch rows**, shown only on touch-capable devices:

| Row | Default | Notes |
| --- | --- | --- |
| Look sensitivity | Tuned on a device | Separate from `m_sensitivity`: thumb pixels and mouse counts are different units, and a touch laptop player needs both |
| Look acceleration | On, moderate | The curve's strength; 0 is linear |
| Edge spin | On | Spin speed follows the existing sensitivity; no extra row unless testing asks for one |
| Invert look | Reuses `m_invertY` | One meaning for "invert" on every device |
| Gyro aim | Off, with an **Enable** button | iOS needs `DeviceMotionEvent.requestPermission()` from a tap, so it cannot be on by default there. Android Chrome gives motion data on HTTPS without a prompt |
| Layout | "Edit layout" opens the editor | Drag, resize and set the opacity of each button; reset to default |
| Haptics | On where `navigator.vibrate` exists | Hidden on iOS |

- **Where values live:** archived cvars, like the mouse settings, so they
  persist per browser and appear in the console. The layout is one cvar
  holding JSON, or its own storage key next to `engine_binds`.
- **First touch match:** a one-time hint over the controls ("drag right side
  to look, hold the edge to keep turning"). It reuses the hint panel widget
  (`HintPanel`).
- **Gamepad later:** the same device switching covers a gamepad; it needs
  `gamepadButton` bindings in `updateActionStates()` and a stick look path. It
  is out of scope here, but the design leaves room for it.

## 6. Implementation outline

Small, reviewable stages. Stages 1 to 3 are engine and controller plumbing
without any visible touch UI, testable on desktop.

1. **Input device state (engine). Done** on `feature/touch-controls`.
   `src/engine/input/InputDevice.ts`: the capability check, last-input
   tracking from Pointer Events and keys, the `input:device_changed` EventBus
   event and `in_touch`. `body.touch-device` and the boot screen's "Tap to
   start" now follow the primary pointer, so a touch laptop no longer gets
   them.
2. **A "playing" state independent of pointer lock.** Give
   `CameraInputHandler` an `inPlay` state (pointer locked **or** touch play
   active) and a public `applyLookDelta(dx, dy)`, holding the existing
   sensitivity, ADS, invert, clamp and `rotationApplier` code. Mouse look
   calls it, and so will touch look. Move the fifteen pointer-lock checks to
   `inPlay`; the pause menu opens on leaving play, from Esc or the touch menu
   button.
3. **Stick input into movement.** Add an optional
   `moveAxis?: { forward: number; right: number }` to `PlayerInputState`.
   `Game.sendInput()` builds the world direction from it when present (the same
   yaw rotation, then normalize), otherwise from the four booleans. The
   sprint-forward-only check in `FPSController` reads the axis too. There is no
   wire, demo or server change; check with the `protocol-change` skill anyway,
   to confirm nothing downstream assumes 8 directions.
4. **Virtual buttons as bindings (engine).** Implement the reserved
   `InputBinding.gesture`: touch buttons set ids such as `touch_fire` in a
   held set, and `updateActionStates()` treats them like keys (active, pressed,
   released). Add a `{ gesture: "touch_*" }` default binding to each FPS action
   in `FPSActions.ts`. Keyboard rebinding keeps working, because these entries
   never show in the key binder.
5. **Touch controls widget (fps).**
   `src/games/fps/client/hud/widgets/TouchControls.ts`: a full-screen layer
   in the `overlay` area, on top of the canvas, using Pointer Events with
   `setPointerCapture` per finger. Each finger owns one control until it lifts:
   the stick zone, the look pad, a button, or fire-then-drag. It shows and
   hides on `input:device_changed`, removes its listeners in `dispose`, and
   keeps the EventBus unsubscribe handle.
6. **Fullscreen, orientation, rotate overlay.** The flow in
   [section 2](#2-fullscreen-and-landscape): fullscreen and the landscape lock
   from `LoadingScreen.start()` and from the touch pause menu's Resume, the
   portrait overlay and the safe-area padding. This stage can ship before the
   controls; it is small and visible straight away.
7. **Settings rows and layout editor**, in `ControlsPage.ts` and `SettingsModel.ts`.
8. **Aim assist** in the touch look path, as described under
   [Aim assist](#aim-assist), with unit tests for friction, pull and the
   still-thumb case.
9. **Gyro (optional)**: `devicemotion` `rotationRate` added through
   `applyLookDelta`, only while fire or aim is held, by default.

### Things to watch

- **Two input paths for one finger.** `InputSystem` already calls
  `preventDefault` on touches on the canvas. The touch layer sits above the
  canvas and takes the events itself; the canvas handlers must not also turn
  the same finger into something.
- **Menus.** `mobile.css` already fits dialogs to small screens; menus need a
  pass on a real phone in landscape, where the height is about 360–430 CSS
  pixels.
- **Performance.** A mid-range phone GPU is far below the 165 fps desktop
  target. `QualityDetector` already lowers settings for mobile user agents
  (and misses iPads). Mobile frame rate is a separate investigation, but touch
  controls are pointless if the game runs at 20 fps. Check a phone on WebGPU
  and WebGL2 before investing in the layout editor.
- **Fairness.** Touch players join the same lobbies as mouse players, with a
  small aim assist that mouse look never receives. A modified client could do
  far more than the assist anyway, so the assist adds no new way to cheat; an
  input-device badge on the scoreboard keeps it visible.

## 7. Testing

- **Headless, desktop:** the `browser-probe` driver can enable CDP touch
  emulation (`Emulation.setTouchEmulationEnabled`,
  `Emulation.setEmitTouchEventsForMouse`) and send multi-finger gestures with
  `Input.dispatchTouchEvent`. That covers device switching, a stick drag with a
  look drag at the same time, fire-then-drag and the rotate overlay (set a
  portrait viewport with `Emulation.setDeviceMetricsOverride`).
- **Android:** USB debugging and `chrome://inspect` from the Windows machine,
  against the dev server on the LAN. Pointer lock, fullscreen and orientation
  lock behave differently from emulation, so this is the real test.
- **iPhone and iPad:** Safari's Web Inspector needs a Mac. Without one, test by
  hand on the device and use on-screen diagnostics (a `developer 1` overlay that
  prints the input device, orientation and lock result).
- **Unit tests:** device switching rules (compatibility mouse events ignored),
  the stick-to-direction maths (dead zone, any angle, normalized), the
  acceleration curve and edge spin as pure functions, and the binding check
  for `gesture` ids.

## Open questions

1. Is mobile a 1.0 goal, or a post-1.0 track? That decides whether
   performance on phones is investigated first.
2. Should the existing manifest be made Washoi's (name, `fullscreen`,
   `landscape`) and "Add to Home Screen" promoted on iPhone, since it is the
   only way there to play without browser bars?
3. Should the scoreboard show the input device?
4. Which zone style ships: invisible (the mockup's default), outlined or grey?
