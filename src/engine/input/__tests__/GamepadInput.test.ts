// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GamepadInput, type PadState, padStick } from "../GamepadInput";

const pad = (buttons: number[] = [], axes = [0, 0, 0, 0], index = 0): PadState => ({
  index,
  id: "Xbox test",
  mapping: "standard",
  axes,
  buttons: Array.from({ length: 17 }, (_, index) => ({
    value: buttons.includes(index) ? 1 : 0,
    pressed: buttons.includes(index),
  })),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("gamepad sampling", () => {
  it("rearms with drift inside the configured radial dead zones", () => {
    const input = new GamepadInput();
    input.setStickDeadZones(0.25, 0.15);
    input.sample([pad([7])]);
    input.suppressUntilNeutral();
    input.sample([pad([], [0.2, 0.2, 0.1, 0])]);
    expect(input.neutral).toBe(false);
    expect(input.axis(0)).toBe(0);
    input.sample([pad([], [0.2, 0.1, 0.1, 0])]);
    expect(input.neutral).toBe(true);
    input.sample([pad([7], [0.2, 0.1, 0.1, 0])]);
    expect(input.pressed.has(7)).toBe(true);
  });
  it("keeps polling other subscribers after an error, logging once per failure streak", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => callbacks.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = new GamepadInput();
    const broken = vi.fn<() => void>(() => {
      throw new Error("Subscriber failure");
    });
    const healthy = vi.fn();
    input.subscribe(broken);
    input.subscribe(healthy);
    try {
      input.start();
      callbacks.shift()?.(10);
      callbacks.shift()?.(20);
      expect(healthy).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledTimes(1);
      broken.mockImplementation(() => {});
      callbacks.shift()?.(30);
      broken.mockImplementation(() => {
        throw new Error("Failed again");
      });
      callbacks.shift()?.(40);
      expect(error).toHaveBeenCalledTimes(2);
      expect(callbacks).toHaveLength(1);
    } finally {
      input.stop();
    }
  });
  it("does not schedule another frame after a subscriber stops the sampler", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => callbacks.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const input = new GamepadInput();
    input.subscribe(() => input.stop());
    input.start();
    callbacks.shift()?.(10);
    expect(callbacks).toHaveLength(0);
  });
  it("reads sparse device lists and edges without treating a connection as input", () => {
    const input = new GamepadInput();
    input.sample([null, pad([], undefined, 1)]);
    expect(input.pad?.index).toBe(1);
    expect(input.pressed.size).toBe(0);
    input.sample([null, pad([0], undefined, 1)]);
    expect([...input.pressed]).toEqual([0]);
    input.sample([null, pad([0], undefined, 1)]);
    expect(input.pressed.size).toBe(0);
    input.sample([]);
    expect([...input.released]).toEqual([0]);
    expect(input.pad).toBeNull();
  });
  it("requires neutral input after a handoff, including a displaced stick", () => {
    const input = new GamepadInput();
    input.sample([pad([7])]);
    input.suppressUntilNeutral();
    input.sample([pad([7], [0.8, 0, 0, 0])]);
    expect(input.down.size).toBe(0);
    expect(input.axis(0)).toBe(0);
    input.sample([pad([], [0.8, 0, 0, 0])]);
    expect(input.axis(0)).toBe(0);
    input.sample([pad()]);
    input.sample([pad([7])]);
    expect(input.pressed.has(7)).toBe(true);
  });
  it("rejects unknown layouts and never merges two pads", () => {
    const input = new GamepadInput();
    input.sample([{ ...pad([0]), mapping: "" }]);
    expect(input.down.size).toBe(0);
    input.select(2);
    input.sample([pad([0]), pad([], undefined, 2)]);
    input.sample([pad([0]), pad([1], undefined, 2)]);
    expect([...input.down]).toEqual([1]);
  });
  it("filters radial drift smoothly and preserves diagonal direction", () => {
    expect(padStick(0.05, 0.05, 0.12)).toEqual({ x: 0, y: 0 });
    expect(padStick(0.56, 0, 0.12).x).toBeCloseTo(0.5);
    const diagonal = padStick(1, 1, 0.12, 1.7);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
    expect(diagonal.x).toBeCloseTo(diagonal.y);
    expect(padStick(NaN, 1, 0.12)).toEqual({ x: 0, y: 0 });
  });
});
