// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POSE,
  FAST_FACTOR,
  FLY_SPEED,
  FlyCameraController,
  type FlyPose,
  fly,
  forwardOf,
  framePose,
  look,
  MAX_PITCH,
  poseFromOrbit,
  poseLookingAlong,
  rightOf,
  WHEEL_STEP,
} from "../FlyCamera";

const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
};
const at = (x: number, y: number, z: number, yaw = 0, pitch = 0): FlyPose => ({ position: { x, y, z }, yaw, pitch });

describe("flycam pose math", () => {
  it("looks along Quake axes: yaw 0 is +X, 90 is +Y, positive pitch is up; right is horizontal", () => {
    close(forwardOf(at(0, 0, 0, 0, 0)), { x: 1, y: 0, z: 0 });
    close(forwardOf(at(0, 0, 0, 90, 0)), { x: 0, y: 1, z: 0 });
    close(forwardOf(at(0, 0, 0, 0, 90)), { x: 0, y: 0, z: 1 });
    close(rightOf(at(0, 0, 0, 0, 0)), { x: 0, y: -1, z: 0 });
    close(rightOf(at(0, 0, 0, 90, 45)), { x: 1, y: 0, z: 0 });
  });

  it("turns right and looks down with the mouse, clamps pitch and wraps yaw", () => {
    const turned = look(at(0, 0, 0, 10, 0), 100, 50, 0.2);
    expect(turned.yaw).toBeCloseTo(350, 9);
    expect(turned.pitch).toBeCloseTo(-10, 9);
    expect(look(at(0, 0, 0), 0, -10_000).pitch).toBe(MAX_PITCH);
    expect(look(at(0, 0, 0), 0, 10_000).pitch).toBe(-MAX_PITCH);
  });

  it("flies forward along the view, strafes horizontally, rises along Z, and a diagonal is no faster", () => {
    close(fly(at(0, 0, 0, 90, 0), { forward: 1, strafe: 0, up: 0 }, 100).position, { x: 0, y: 100, z: 0 });
    close(fly(at(0, 0, 0, 0, 0), { forward: 0, strafe: 1, up: 0 }, 50).position, { x: 0, y: -50, z: 0 });
    close(fly(at(0, 0, 0, 0, 60), { forward: 0, strafe: 0, up: -1 }, 10).position, { x: 0, y: 0, z: -10 });
    const diagonal = fly(at(0, 0, 0), { forward: 1, strafe: 1, up: 0 }, 100).position;
    expect(Math.hypot(diagonal.x, diagonal.y, diagonal.z)).toBeCloseTo(100, 9);
    expect(fly(at(5, 6, 7), { forward: 0, strafe: 0, up: 0 }, 100).position).toEqual({ x: 5, y: 6, z: 7 });
  });

  it("frames bounds by backing off along the current view", () => {
    const pose = at(1000, 1000, 1000, 45, -30);
    const framed = framePose(pose, { x: 0, y: 0, z: 0 }, { x: 512, y: 512, z: 256 }, Math.PI / 6);
    expect(framed.yaw).toBe(45);
    expect(framed.pitch).toBe(-30);
    const f = forwardOf(pose);
    const distance = (Math.hypot(512, 512, 256) * 0.6) / Math.sin(Math.PI / 6);
    close(framed.position, { x: -f.x * distance, y: -f.y * distance, z: -f.z * distance }, 6);
  });

  it("converts an orbit view to the same eye looking at the same target", () => {
    const target = { x: 16, y: 32, z: 48 };
    const pose = poseFromOrbit(1, 1.2, 800, target);
    expect(Math.hypot(pose.position.x - 16, pose.position.y - 32, pose.position.z - 48)).toBeCloseTo(800, 6);
    const f = forwardOf(pose);
    close(
      { x: pose.position.x + f.x * 800, y: pose.position.y + f.y * 800, z: pose.position.z + f.z * 800 },
      target,
      6,
    );
    // the default starts above the origin, looking down at it
    expect(DEFAULT_POSE.position.z).toBeGreaterThan(0);
    expect(DEFAULT_POSE.pitch).toBeLessThan(0);
    expect(poseLookingAlong({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }).pitch).toBe(-MAX_PITCH);
  });
});

describe("flycam controller", () => {
  let element: HTMLElement;
  let pose: FlyPose;
  let abort: AbortController;
  let controller: FlyCameraController;
  let over: boolean;
  const onRightClick = vi.fn();

  const pointer = (type: string, init: MouseEventInit & { movementX?: number; movementY?: number } = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    for (const key of ["movementX", "movementY"] as const)
      if (init[key] !== undefined) Object.defineProperty(event, key, { value: init[key] });
    element.dispatchEvent(event);
    return event;
  };
  const key = (type: "keydown" | "keyup", value: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent(type, { key: value, cancelable: true, ...init });
    return type === "keydown" ? controller.keyDown(event) : controller.keyUp(event);
  };

  beforeEach(() => {
    element = document.createElement("div");
    document.body.appendChild(element);
    pose = at(0, 0, 0, 0, 0);
    over = true;
    abort = new AbortController();
    onRightClick.mockClear();
    controller = new FlyCameraController({
      element,
      isOver: () => over,
      getPose: () => pose,
      setPose: (next) => {
        pose = next;
      },
      onRightClick,
      signal: abort.signal,
    });
  });
  afterEach(() => {
    abort.abort();
    document.body.replaceChildren();
  });

  it("looks with a middle or right drag", () => {
    pointer("pointerdown", { button: 2, clientX: 100, clientY: 100 });
    pointer("pointermove", { clientX: 150, clientY: 120 });
    pointer("pointerup", { button: 2, clientX: 150, clientY: 120 });
    expect(pose.yaw).toBeCloseTo(350, 9);
    expect(pose.pitch).toBeCloseTo(-4, 9);
    expect(onRightClick).not.toHaveBeenCalled();
    expect(controller.isFreeLook).toBe(false);
  });

  it("toggles free look with a middle click, where any movement looks, until a click or Escape", () => {
    const middle = pointer("pointerdown", { button: 1, clientX: 10, clientY: 10 });
    expect(middle.defaultPrevented).toBe(true); // no autoscroll
    pointer("pointerup", { button: 1, clientX: 10, clientY: 10 });
    expect(controller.isFreeLook).toBe(true);
    pointer("pointermove", { movementX: -50, movementY: 0 });
    expect(pose.yaw).toBeCloseTo(10, 9);
    // a right click leaves free look rather than deselecting
    pointer("pointerdown", { button: 2, clientX: 10, clientY: 10 });
    pointer("pointerup", { button: 2, clientX: 10, clientY: 10 });
    expect(controller.isFreeLook).toBe(false);
    expect(onRightClick).not.toHaveBeenCalled();
    pointer("pointerdown", { button: 1 });
    pointer("pointerup", { button: 1 });
    expect(key("keydown", "Escape")).toBe(true);
    expect(controller.isFreeLook).toBe(false);
    expect(key("keydown", "Escape")).toBe(false);
  });

  it("deselects on a right click", () => {
    pointer("pointerdown", { button: 2, clientX: 10, clientY: 10 });
    pointer("pointerup", { button: 2, clientX: 12, clientY: 11 });
    expect(onRightClick).toHaveBeenCalledTimes(1);
  });

  it("ignores presses outside the 3D pane", () => {
    over = false;
    pointer("pointerdown", { button: 2, clientX: 0, clientY: 0 });
    pointer("pointermove", { clientX: 300, clientY: 0 });
    pointer("pointerup", { button: 2 });
    expect(pose.yaw).toBe(0);
    expect(onRightClick).not.toHaveBeenCalled();
  });

  it("flies while fly keys are held over the pane, faster with Shift, and only then", () => {
    pointer("pointermove", { clientX: 5, clientY: 5 });
    expect(key("keydown", "w")).toBe(true);
    controller.step(0.5);
    expect(pose.position.x).toBeCloseTo(FLY_SPEED * 0.1, 9); // a long frame is clamped to 0.1 s
    key("keydown", "d", { shiftKey: true });
    controller.step(0.05);
    expect(pose.position.y).toBeLessThan(0);
    key("keyup", "w");
    key("keyup", "d");
    const before = { ...pose.position };
    controller.step(0.05);
    expect(pose.position).toEqual(before);
    key("keydown", " ", { shiftKey: true });
    controller.step(0.1);
    expect(pose.position.z).toBeCloseTo(FLY_SPEED * FAST_FACTOR * 0.1, 9);
    // tool shortcuts and modified keys are left alone
    expect(key("keydown", "b")).toBe(false);
    expect(key("keydown", "s", { ctrlKey: true })).toBe(false);
  });

  it("stops flying when the pointer leaves the pane or the window loses focus", () => {
    pointer("pointermove", {});
    key("keydown", "w");
    element.dispatchEvent(new MouseEvent("pointerleave"));
    controller.step(0.1);
    expect(pose.position.x).toBe(0);
    expect(key("keydown", "w")).toBe(false); // not over the pane any more
    pointer("pointermove", {});
    key("keydown", "w");
    window.dispatchEvent(new Event("blur"));
    controller.step(0.1);
    expect(pose.position.x).toBe(0);
  });

  it("steps along the view with the wheel", () => {
    const wheel = new WheelEvent("wheel", { deltaY: -120, cancelable: true });
    element.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(pose.position.x).toBeCloseTo(WHEEL_STEP, 9);
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, shiftKey: true }));
    expect(pose.position.x).toBeCloseTo(WHEEL_STEP - WHEEL_STEP * FAST_FACTOR, 9);
  });

  it("removes its listeners when the signal aborts", () => {
    abort.abort();
    pointer("pointerdown", { button: 2, clientX: 0, clientY: 0 });
    pointer("pointermove", { clientX: 100, clientY: 0 });
    expect(pose.yaw).toBe(0);
  });
});
