/**
 * Which input the player is using: touch, or keyboard and mouse.
 *
 * Touch hardware says only that a finger could be used: a laptop with a
 * touchscreen has it and is played with the mouse. So the device starts from
 * the primary pointer (a coarse primary pointer and no fine one is a phone or
 * a tablet) and then follows the last deliberate input: a touch, a key, or a
 * mouse that moved. Pointer Events name the input in `pointerType`, so the
 * mouse events a browser makes up after a tap never count as the mouse.
 *
 * Every change is announced as `input:device_changed`. `in_touch` overrides
 * it for testing: -1 follows the player, 0 keyboard and mouse, 1 touch.
 */

import { Cvar } from "../core/Cvar";
import { EventBus } from "../core/EventBus";

export type InputDeviceKind = "touch" | "keyboard_mouse";

export const INPUT_DEVICE_CHANGED = "input:device_changed";

// The listeners run before the page's own, so a handler that stops an event cannot hide the input
const CAPTURE = { capture: true } as const;

/** The parts of `window` the device is read from. */
export type DeviceWindow = Pick<Window, "addEventListener" | "removeEventListener"> & {
  navigator: { maxTouchPoints?: number };
  matchMedia?: (query: string) => { matches: boolean };
  document?: { activeElement: Element | null };
};

const matches = (win: DeviceWindow, query: string): boolean => win.matchMedia?.(query).matches === true;

/** A finger can reach the page: touch hardware, or a coarse primary pointer. */
export function touchCapable(win: DeviceWindow = window): boolean {
  return (win.navigator.maxTouchPoints ?? 0) > 0 || matches(win, "(pointer: coarse)");
}

/** The device a page starts with, before the player has used anything. */
export function primaryDevice(win: DeviceWindow = window): InputDeviceKind {
  return matches(win, "(pointer: coarse)") && !matches(win, "(any-pointer: fine)") ? "touch" : "keyboard_mouse";
}

/** Typing into a text field, where a phone's own keyboard sends keys too. */
function typing(win: DeviceWindow): boolean {
  const el = win.document?.activeElement as HTMLElement | null | undefined;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true;
}

export class InputDevice {
  private static instance: InputDevice | null = null;

  static getInstance(): InputDevice {
    if (!InputDevice.instance) InputDevice.instance = new InputDevice();
    return InputDevice.instance;
  }

  private win: DeviceWindow | null = null;
  private followed: InputDeviceKind = "keyboard_mouse";
  private published: InputDeviceKind = "keyboard_mouse";
  private capable = false;

  /** The device to show controls for. */
  get current(): InputDeviceKind {
    const forced = Cvar.getNumber("in_touch") ?? -1;
    if (forced === 0) return "keyboard_mouse";
    if (forced === 1) return "touch";
    return this.followed;
  }

  /** Whether touch can be used here at all: decides if touch settings are offered. */
  get touchCapable(): boolean {
    return this.capable;
  }

  /** Begin following the player's input. Once; `stop` ends it. */
  start(win: DeviceWindow = window): void {
    if (this.win) return;
    this.win = win;
    this.capable = touchCapable(win);
    this.followed = primaryDevice(win);
    this.published = this.current;
    win.addEventListener("pointerdown", this.onPointerDown, CAPTURE);
    win.addEventListener("pointermove", this.onPointerMove, CAPTURE);
    win.addEventListener("keydown", this.onKeyDown, CAPTURE);
  }

  stop(): void {
    const win = this.win;
    if (!win) return;
    win.removeEventListener("pointerdown", this.onPointerDown, CAPTURE);
    win.removeEventListener("pointermove", this.onPointerMove, CAPTURE);
    win.removeEventListener("keydown", this.onKeyDown, CAPTURE);
    this.win = null;
  }

  /** Announce the device when it differs from the last one announced. */
  publish(): void {
    const device = this.current;
    if (device === this.published) return;
    this.published = device;
    EventBus.emit(INPUT_DEVICE_CHANGED, { device });
  }

  private follow(device: InputDeviceKind): void {
    if (device === this.followed) return;
    this.followed = device;
    this.publish();
  }

  // A pen is neither: it leaves the device as it was
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "touch") this.follow("touch");
    else if (event.pointerType === "mouse") this.follow("keyboard_mouse");
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && (event.movementX !== 0 || event.movementY !== 0)) {
      this.follow("keyboard_mouse");
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key === "Unidentified" || (this.win && typing(this.win))) return;
    this.follow("keyboard_mouse");
  };
}

Cvar.register("in_touch", -1, {
  type: "int",
  min: -1,
  max: 1,
  persist: false,
  description: "Touch controls: -1 follow the input used, 0 keyboard and mouse, 1 touch",
  onChange: () => InputDevice.getInstance().publish(),
});
