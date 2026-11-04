/**
 * Whether the player is in play: the game, not the page, owns the input.
 *
 * With a mouse that is pointer lock. A touch screen has no pointer lock, so
 * touch play is held by the game itself (`setTouchPlay`). Gameplay code asks
 * `inPlay()` and listens for PLAY_CHANGE on the document rather than reading
 * pointer lock, and `enterPlay` / `leavePlay` take whichever the device in use
 * needs. Switching to keyboard and mouse ends touch play, since the mouse plays
 * through pointer lock.
 */

import { background } from "../core/AsyncErrors";
import { EventBus } from "../core/EventBus";
import { requestBrowserPointerLock } from "../ui/BrowserControlFeedback";
import { INPUT_DEVICE_CHANGED, InputDevice, type InputDeviceKind } from "./InputDevice";
import { enterTouchFullscreen } from "./TouchFullscreen";

/** Dispatched on the document whenever `inPlay()` may have changed. */
export const PLAY_CHANGE = "shag:playchange";

let touchPlay = false;
let offDevice: (() => void) | null = null;

const announce = (): void => {
  document.dispatchEvent(new Event(PLAY_CHANGE));
};

export function inPlay(): boolean {
  return touchPlay || !!document.pointerLockElement;
}

export function inTouchPlay(): boolean {
  return touchPlay;
}

export function setTouchPlay(on: boolean): void {
  if (touchPlay === on) return;
  touchPlay = on;
  announce();
}

/**
 * Start play: touch play on a touch screen, otherwise lock the pointer to
 * `canvas`. From a tap (Resume), touch play also goes back to fullscreen.
 */
export function enterPlay(canvas: HTMLCanvasElement | null): void {
  if (InputDevice.getInstance().current === "touch") {
    background(enterTouchFullscreen(), "PlayCapture");
    setTouchPlay(true);
  } else {
    requestBrowserPointerLock(canvas);
  }
}

/** End play, whichever kind it is. */
export function leavePlay(): void {
  if (document.pointerLockElement) document.exitPointerLock?.();
  setTouchPlay(false);
}

/** Announce pointer lock changes as play changes, and end touch play when the mouse takes over. */
export function startPlayCapture(): void {
  if (offDevice) return;
  document.addEventListener("pointerlockchange", announce);
  offDevice = EventBus.on<{ device: InputDeviceKind }>(INPUT_DEVICE_CHANGED, ({ device }) => {
    if (device !== "touch") setTouchPlay(false);
  });
}

export function stopPlayCapture(): void {
  if (!offDevice) return;
  document.removeEventListener("pointerlockchange", announce);
  offDevice();
  offDevice = null;
  touchPlay = false;
}
