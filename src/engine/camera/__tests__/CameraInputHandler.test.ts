// @vitest-environment jsdom

import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cvar } from "../../core/Cvar";
import { inTouchPlay, setTouchPlay } from "../../input/PlayCapture";
import { CameraInputHandler } from "../CameraInputHandler";

describe("CameraInputHandler capture handoff", () => {
  const handler = new CameraInputHandler();

  afterEach(() => handler.teardown());

  it("does not let gameplay recapture the editor's shared canvas", () => {
    const canvas = document.createElement("canvas");
    const requestPointerLock = vi.fn();
    canvas.requestPointerLock = requestPointerLock;
    handler.setup(canvas, {} as FreeCamera, {}, "FPSController");

    handler.setCaptureEnabled(false);
    canvas.click();
    expect(requestPointerLock).not.toHaveBeenCalled();

    handler.setCaptureEnabled(true);
    canvas.click();
    expect(requestPointerLock).toHaveBeenCalledOnce();
  });
});

describe("CameraInputHandler on a touch screen", () => {
  const handler = new CameraInputHandler();

  afterEach(() => {
    handler.teardown();
    setTouchPlay(false);
    Cvar.set("in_touch", -1);
  });

  it("starts touch play from a tap instead of asking for pointer lock, and reports play starting and ending", () => {
    Cvar.set("in_touch", 1);
    const canvas = document.createElement("canvas");
    const requestPointerLock = vi.fn();
    canvas.requestPointerLock = requestPointerLock;
    const onLocked = vi.fn();
    const onUnlocked = vi.fn();
    handler.setup(canvas, {} as FreeCamera, {}, "FPSController", { onLocked, onUnlocked });

    canvas.click();
    expect(requestPointerLock).not.toHaveBeenCalled();
    expect(inTouchPlay()).toBe(true);
    expect(handler.inPlay).toBe(true);
    expect(onLocked).toHaveBeenCalledOnce();

    setTouchPlay(false);
    expect(handler.inPlay).toBe(false);
    expect(onUnlocked).toHaveBeenCalledOnce();
  });

  it("starts touch play from a touch on the game, which sends no click", () => {
    const canvas = document.createElement("canvas");
    handler.setup(canvas, {} as FreeCamera, {}, "FPSController");

    canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "mouse" }));
    expect(inTouchPlay()).toBe(false);
    canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch" }));
    expect(inTouchPlay()).toBe(true);
  });

  it("turns the view through the controller's modifier, invert and pitch clamp", () => {
    const canvas = document.createElement("canvas");
    const applied: [number, number][] = [];
    handler.setup(
      canvas,
      { rotation: { x: 0, y: 0 } } as FreeCamera,
      { invertY: true },
      "FPSController",
      {},
      { mouseLookModifier: (s) => s / 2, rotationApplier: (x, y) => applied.push([x, y]) },
    );

    handler.applyLookDelta(10, 4, 0.01);
    expect(applied[0][0]).toBeCloseTo(-0.02);
    expect(applied[0][1]).toBeCloseTo(0.05);

    handler.applyLookDelta(0, -10_000, 0.01);
    expect(applied[1][0]).toBeCloseTo(Math.PI / 2 - 0.1);

    handler.setLookFrozen(true);
    handler.applyLookDelta(10, 0, 0.01);
    expect(applied).toHaveLength(2);
    handler.setLookFrozen(false);
  });
});
