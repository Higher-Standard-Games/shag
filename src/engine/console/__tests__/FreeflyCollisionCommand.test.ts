/**
 * `freefly_collision` takes an explicit on or off. Anything else used to fall
 * through to "not on, therefore off" and silently disabled collision — so a
 * typo, or the `info` the manual used to suggest, turned the feature off and
 * reported that as the state.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { FreeflyCollisionCommand } from "../commands/FreeflyCollisionCommand";

vi.mock("../../camera/controllers/FreeflyController", () => ({
  FreeflyController: {
    setCollisionEnabled: vi.fn(),
    isCollisionEnabled: () => true,
    getCollisionMode: () => "bsp",
    setCollisionMode: vi.fn(),
  },
}));

vi.mock("../../physics", () => ({
  getCollisionManager: () => ({
    isInitialized: () => false,
    getStats: () => null,
    getBackendType: () => "q3",
    getInstanceId: () => "test",
  }),
}));

vi.mock("../../camera/CameraSystem", () => ({
  CameraSystem: { getInstance: () => ({ getScene: () => null, getCamera: () => null }) },
}));

const run = async (...args: string[]): Promise<string> => new FreeflyCollisionCommand().execute(args);

afterEach(() => {
  vi.clearAllMocks();
});

describe("freefly_collision", () => {
  it("reports the current state when asked for nothing", async () => {
    const { FreeflyController } = await import("../../camera/controllers/FreeflyController");
    const output = await run();
    expect(output).toContain("freefly_collision = 1");
    expect(FreeflyController.setCollisionEnabled).not.toHaveBeenCalled();
  });

  it("turns collision on and off on an explicit value", async () => {
    const { FreeflyController } = await import("../../camera/controllers/FreeflyController");
    await run("0");
    expect(FreeflyController.setCollisionEnabled).toHaveBeenLastCalledWith(false);
    await run("on");
    expect(FreeflyController.setCollisionEnabled).toHaveBeenLastCalledWith(true);
  });

  it("refuses an option it does not have instead of switching collision off", async () => {
    const { FreeflyController } = await import("../../camera/controllers/FreeflyController");
    const output = await run("info");
    expect(output).toContain("Unknown option: info");
    expect(FreeflyController.setCollisionEnabled).not.toHaveBeenCalled();
  });
});
