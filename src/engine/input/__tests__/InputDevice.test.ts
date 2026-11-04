import { afterEach, describe, expect, it } from "vitest";
import { Cvar } from "../../core/Cvar";
import { EventBus } from "../../core/EventBus";
import { type DeviceWindow, INPUT_DEVICE_CHANGED, InputDevice, primaryDevice, touchCapable } from "../InputDevice";

interface FakeOptions {
  coarse?: boolean;
  fine?: boolean;
  touchPoints?: number;
}

function fakeWindow({ coarse = false, fine = true, touchPoints = 0 }: FakeOptions = {}) {
  const target = new EventTarget();
  const document = { activeElement: null as Element | null };
  const win: DeviceWindow = {
    addEventListener: target.addEventListener.bind(target) as Window["addEventListener"],
    removeEventListener: target.removeEventListener.bind(target) as Window["removeEventListener"],
    navigator: { maxTouchPoints: touchPoints },
    matchMedia: (query) => ({
      matches: query === "(pointer: coarse)" ? coarse : query === "(any-pointer: fine)" ? fine : false,
    }),
    document,
  };
  const send = (type: string, fields: Record<string, unknown>) =>
    target.dispatchEvent(Object.assign(new Event(type), fields));
  return { win, document, send };
}

const phone = { coarse: true, fine: false, touchPoints: 5 };
const touchLaptop = { coarse: false, fine: true, touchPoints: 10 };

afterEach(() => {
  Cvar.set("in_touch", -1);
});

describe("starting device", () => {
  it("starts phones on touch and touchscreen laptops on the mouse", () => {
    expect(primaryDevice(fakeWindow(phone).win)).toBe("touch");
    expect(primaryDevice(fakeWindow(touchLaptop).win)).toBe("keyboard_mouse");
    expect(primaryDevice(fakeWindow({ coarse: true, fine: true, touchPoints: 5 }).win)).toBe("keyboard_mouse");
    expect(primaryDevice(fakeWindow().win)).toBe("keyboard_mouse");
  });

  it("calls any page a finger can reach touch capable", () => {
    expect(touchCapable(fakeWindow(phone).win)).toBe(true);
    expect(touchCapable(fakeWindow(touchLaptop).win)).toBe(true);
    expect(touchCapable(fakeWindow().win)).toBe(false);
  });
});

describe("following the player", () => {
  it("switches on a touch, a key or a moving mouse, and announces each switch once", () => {
    const { win, send } = fakeWindow(touchLaptop);
    const device = new InputDevice();
    const seen: string[] = [];
    const off = EventBus.on<{ device: string }>(INPUT_DEVICE_CHANGED, ({ device }) => seen.push(device));
    try {
      device.start(win);
      expect(device.current).toBe("keyboard_mouse");
      expect(device.touchCapable).toBe(true);

      send("pointerdown", { pointerType: "touch" });
      send("pointerdown", { pointerType: "touch" });
      expect(device.current).toBe("touch");

      // A mouse event made up after a tap carries no movement
      send("pointermove", { pointerType: "mouse", movementX: 0, movementY: 0 });
      expect(device.current).toBe("touch");
      send("pointermove", { pointerType: "mouse", movementX: 3, movementY: 0 });
      expect(device.current).toBe("keyboard_mouse");

      send("pointerdown", { pointerType: "touch" });
      send("keydown", { key: "w", isComposing: false });
      expect(device.current).toBe("keyboard_mouse");
      expect(seen).toEqual(["touch", "keyboard_mouse", "touch", "keyboard_mouse"]);
    } finally {
      off();
      device.stop();
    }
  });

  it("stays on touch while the phone's keyboard types into a field, and ignores a pen", () => {
    const { win, document, send } = fakeWindow(phone);
    const device = new InputDevice();
    try {
      device.start(win);
      document.activeElement = { tagName: "INPUT" } as Element;
      send("keydown", { key: "a", isComposing: false });
      document.activeElement = null;
      send("keydown", { key: "Unidentified", isComposing: false });
      send("keydown", { key: "a", isComposing: true });
      send("pointerdown", { pointerType: "pen" });
      expect(device.current).toBe("touch");
    } finally {
      device.stop();
    }
  });

  it("stops listening when stopped", () => {
    const { win, send } = fakeWindow(phone);
    const device = new InputDevice();
    device.start(win);
    device.stop();
    send("pointermove", { pointerType: "mouse", movementX: 5, movementY: 5 });
    expect(device.current).toBe("touch");
  });
});

describe("in_touch", () => {
  it("forces either device and announces the change", () => {
    const { win } = fakeWindow();
    const device = InputDevice.getInstance();
    const seen: string[] = [];
    const off = EventBus.on<{ device: string }>(INPUT_DEVICE_CHANGED, ({ device }) => seen.push(device));
    try {
      device.start(win);
      expect(device.current).toBe("keyboard_mouse");
      Cvar.set("in_touch", 1);
      expect(device.current).toBe("touch");
      Cvar.set("in_touch", 0);
      expect(device.current).toBe("keyboard_mouse");
      Cvar.set("in_touch", -1);
      expect(seen).toEqual(["touch", "keyboard_mouse"]);
    } finally {
      off();
      device.stop();
    }
  });
});
