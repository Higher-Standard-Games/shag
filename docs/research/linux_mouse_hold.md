# Linux: mouse movement releases held fire or ADS

## Report — 2026-10-19

Status: open, reported by a Linux player; not reproduced locally. Browser,
version, distribution, desktop session (Wayland/X11) and mouse software are
unconfirmed. Do not classify this as Firefox-specific without that information.

The player reports that holding Mouse2 starts the zoom animation briefly, then
unzooms. The clarification is more specific: moving the mouse a little while
still holding Mouse2 ends ADS, and moving while holding Voltaic fire stops firing.
This is mouse movement within gameplay, not deliberately looking at another tab.
The developer cannot reproduce the symptom on their machine.

### Additional Firefox report

A second player explicitly reports Firefox: crosshair movement is very choppy
despite smooth physical mouse movement, and firing works only while standing
still and not moving the crosshair. Their OS is unconfirmed. The supplied image
shows the browser's pointer-control notice, but does not provide an event trace
or establish the game's frame rate. The overlap with the Linux report makes
held-button reconciliation during movement worth testing; do not assume the
choppy aim and low game FPS have the same cause.

## Code path to investigate

`src/engine/input/InputSystem.ts` tracks mouse pointer button holds from
`pointerdown`, `pointermove` and `pointerup`, with compatibility `mousedown` and
`mouseup` handlers. `boundPointerChange` reconciles held buttons against
`PointerEvent.buttons` for the tracked mouse pointer. A matching movement event
whose mask omits a physically held button would release that action. This is a
testable hypothesis, not evidence that Linux sends an incorrect mask.

`pointercancel`, focus loss, hidden visibility and pointer-lock transitions are
other release paths. Record their ordering before changing the release logic:
ignoring genuine releases can leave firing stuck on.

## Reproduction and acceptance checklist

- Capture trusted pointer and compatibility mouse events: type, pointer type/id,
  button, buttons, movement delta, timestamp, canvas target, document focus,
  visibility and pointer-lock state. Sample raw held buttons and `fps_fire` /
  `fps_aim` alongside them.
- On native Linux, test stationary Mouse2 hold, hold plus motion, Voltaic fire
  plus motion, both buttons held, and release of either button while moving.
- Repeat after Escape/re-lock, alt-tab and fullscreen transitions. Keep browser
  and desktop session details with each trace.
- Confirm that the physical hold remains active through movement and that real
  button release, cancellation and focus loss still stop the action promptly.
- Recheck Firefox and Chromium on Windows and Linux after a fix. Existing
  Windows automation does not establish Linux pointer-lock behaviour.

No input change is included in this investigation. Firefox in-game performance
is the higher-priority active task.
