// @vitest-environment jsdom

import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { afterEach, describe, expect, it, vi } from "vitest";
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
