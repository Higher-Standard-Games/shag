// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { InputSystem } from "../InputSystem";

type Frames = {
  updateActionStates(): void;
  clearPerFrameState(): void;
  releaseHeldInput(): void;
  rawState: { keys: Set<string>; keysReleased: Set<string> };
};

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

afterEach(() => {
  frames.releaseHeldInput();
  frame();
});

describe("virtual actions", () => {
  it("does not report release while a physical binding still holds the action", () => {
    frames.rawState.keys.add("Space");
    input.setVirtualAction("test_jump", true, "gamepad");
    frame();
    input.setVirtualAction("test_jump", false, "gamepad");
    expect(frame()).toEqual({ active: true, pressed: false, released: false });
    frames.rawState.keys.delete("Space");
    frames.rawState.keysReleased.add("Space");
    expect(frame()).toEqual({ active: false, pressed: false, released: true });
  });
  it("does not report physical release while a virtual source still holds the action", () => {
    frames.rawState.keys.add("Space");
    input.setVirtualAction("test_jump", true, "gamepad");
    frame();
    frames.rawState.keys.delete("Space");
    frames.rawState.keysReleased.add("Space");
    expect(frame()).toEqual({ active: true, pressed: false, released: false });
    input.setVirtualAction("test_jump", false, "gamepad");
    expect(frame().released).toBe(true);
  });
  it("clears an action hidden by a blocking context and emits its release once", () => {
    input.registerContext({ id: "test_menu", blocking: true, actions: [] });
    input.setVirtualAction("test_jump", true);
    frame();
    input.pushContext("test_menu");
    try {
      expect(frame()).toEqual({ active: false, pressed: false, released: true });
      input.setVirtualAction("test_jump", false);
      expect(frame()).toEqual({ active: false, pressed: false, released: false });
    } finally {
      input.popContext();
    }
    expect(frame()).toEqual({ active: false, pressed: false, released: false });
  });
  it("does not release an action still held by a different source", () => {
    input.setVirtualAction("test_jump", true, "gamepad");
    input.setVirtualAction("test_jump", true);
    frame();
    input.setVirtualAction("test_jump", false, "gamepad");
    expect(frame()).toEqual({ active: true, pressed: false, released: false });
    input.setVirtualAction("test_jump", false);
    expect(frame().released).toBe(true);
  });
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
