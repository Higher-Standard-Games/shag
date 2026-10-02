/**
 * `camera mode` reports and selects a controller. What it reports has to be a
 * word a player can type straight back at it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraSystem } from "../../camera/CameraSystem";
import CameraCommand from "../commands/CameraCommand";

// biome-ignore lint/suspicious/noExplicitAny: stands in for the camera singleton
const system = () => CameraSystem.getInstance() as any;

function withController(type: string | null): void {
  vi.spyOn(system(), "getCamera").mockReturnValue({} as never);
  vi.spyOn(system(), "getActiveController").mockReturnValue(type === null ? null : ({ type } as never));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("camera mode", () => {
  it("names the active controller as its own type", async () => {
    withController("freefly");
    const output = await new CameraCommand().execute(["mode"]);
    expect(output).toContain("Current mode: freefly");
  });

  it("says so when nothing is driving the camera", async () => {
    withController(null);
    const output = await new CameraCommand().execute(["mode"]);
    expect(output).toContain("Current mode: unknown");
  });

  it("offers every name it accepts, short forms included", async () => {
    withController("fps");
    const output = (await new CameraCommand().execute(["mode"])) ?? "";
    for (const name of ["iso", "isometric", "fps", "freefly", "follow", "sidescroll"]) {
      expect(output).toContain(name);
    }
  });

  it("turns down a name it does not have", async () => {
    withController("fps");
    await expect(new CameraCommand().execute(["mode", "orthographic"])).resolves.toBe("Unknown mode: orthographic");
  });

  it("selects a controller by either of its names", async () => {
    withController("fps");
    const setController = vi.spyOn(system(), "setController").mockReturnValue(true);

    await new CameraCommand().execute(["mode", "iso"]);
    await new CameraCommand().execute(["mode", "isometric"]);

    expect(setController).toHaveBeenNthCalledWith(1, "isometric");
    expect(setController).toHaveBeenNthCalledWith(2, "isometric");
  });
});
