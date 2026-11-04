// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { InputSystem } from "../InputSystem";

type Frames = { updateActionStates(): void; clearPerFrameState(): void; releaseHeldInput(): void };

const input = InputSystem.getInstance();
const frames = input as unknown as Frames;
const frame = () => {
  frames.updateActionStates();
  const state = {
    active: input.isActive("test_jump"),
    pressed: input.wasPressed("test_jump"),
    released: input.wasReleased("test_jump"),
  };
  frames.clearPerFrameState();
  return state;
};

input.registerAction({ id: "test_jump", type: "button", defaultBindings: [{ key: "Space" }] });
input.registerContext({ id: "test_context", blocking: true, actions: ["test_jump"] });
input.pushContext("test_context");

afterEach(() => input.setVirtualAction("test_jump", false));

describe("virtual actions", () => {
  it("read like a held key: pressed once, active while held, released once", () => {
    input.setVirtualAction("test_jump", true);
    expect(frame()).toEqual({ active: true, pressed: true, released: false });
    input.setVirtualAction("test_jump", true);
    expect(frame()).toEqual({ active: true, pressed: false, released: false });
    input.setVirtualAction("test_jump", false);
    expect(frame()).toEqual({ active: false, pressed: false, released: true });
    expect(frame()).toEqual({ active: false, pressed: false, released: false });
  });

  it("count a press and release within one frame as a tap", () => {
    input.setVirtualAction("test_jump", true);
    input.setVirtualAction("test_jump", false);
    expect(frame()).toEqual({ active: false, pressed: true, released: true });
  });

  it("let go when the held input is released, as when play ends", () => {
    input.setVirtualAction("test_jump", true);
    frame();
    frames.releaseHeldInput();
    expect(frame().active).toBe(false);
  });
});
