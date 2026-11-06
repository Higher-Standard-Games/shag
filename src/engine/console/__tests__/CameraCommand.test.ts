/** Camera controller selection and field-of-view command results. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraSystem } from "../../camera/CameraSystem";
import { Cvar } from "../../core/Cvar";
import { MovementVars } from "../../movement/MovementVars";
import { CommandRegistry } from "../CommandRegistry";
import CameraCommand from "../commands/CameraCommand";

const system = () => CameraSystem.getInstance();

function withController(type: string | null): void {
  vi.spyOn(system(), "getCamera").mockReturnValue({} as never);
  vi.spyOn(system(), "getActiveController").mockReturnValue(type === null ? null : ({ type } as never));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("camera fov", () => {
  let movement: MovementVars;
  let initialFov: number;
  beforeEach(() => {
    vi.spyOn(Cvar, "getBool").mockReturnValue(false);
    withController("fps");
    movement = MovementVars.getInstance();
    initialFov = movement.get("cl_fov");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    movement.set("cl_fov", initialFov);
  });

  it("reports the current FOV when no value is supplied", async () => {
    const set = vi.spyOn(movement, "set");
    await expect(new CameraCommand().execute(["fov"])).resolves.toBe(`cl_fov ${initialFov}° horizontal at 16:9`);
    expect(set).not.toHaveBeenCalled();
  });

  it.each(["95junk", "NaN", "Infinity", "-Infinity", ""])(
    "rejects invalid FOV %j without setting it",
    async (value) => {
      const set = vi.spyOn(movement, "set");
      await expect(new CameraCommand().execute(["fov", value])).resolves.toEqual({
        ok: false,
        output: "Usage: camera fov [degrees] (finite number)",
      });
      expect(set).not.toHaveBeenCalled();
      expect(movement.get("cl_fov")).toBe(initialFov);
    },
  );

  it.each(["79", "111"])("rejects out-of-range FOV %s", async (value) => {
    const set = vi.spyOn(movement, "set");
    await expect(new CameraCommand().execute(["fov", value])).resolves.toEqual({
      ok: false,
      output: "cl_fov must be between 80 and 110 degrees",
    });
    expect(set).not.toHaveBeenCalled();
  });

  it.each(["80", "95.5", "110"])("sets a valid FOV %s", async (value) => {
    await expect(new CameraCommand().execute(["fov", value])).resolves.toBe(`cl_fov set to ${value}°`);
    expect(movement.get("cl_fov")).toBe(Number(value));
  });

  it("rejects excess arguments without changing the FOV", async () => {
    const set = vi.spyOn(movement, "set");
    expect(await new CameraCommand().execute(["fov", "90", "extra"])).toEqual({
      ok: false,
      output: "Usage: camera fov [degrees] (finite number)",
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("reports a rejected variable update as a failure", async () => {
    vi.spyOn(movement, "set").mockReturnValue(false);
    await expect(new CameraCommand().execute(["fov", "90"])).resolves.toEqual({
      ok: false,
      output: "Failed to set cl_fov.",
    });
  });
});

describe("camera mode", () => {
  beforeEach(() => {
    vi.spyOn(Cvar, "getBool").mockReturnValue(true);
  });

  it.each([["mode"], ["mode", "freefly"], ["MODE", "isometric"]])(
    "requires developer mode before camera access: %j",
    async (...args) => {
      vi.mocked(Cvar.getBool).mockReturnValue(false);
      const getCamera = vi.spyOn(system(), "getCamera");
      const setController = vi.spyOn(system(), "setController");
      await expect(new CameraCommand().execute(args)).resolves.toEqual({
        ok: false,
        output: "Command 'camera mode' requires developer mode",
      });
      expect(getCamera).not.toHaveBeenCalled();
      expect(setController).not.toHaveBeenCalled();
    },
  );

  it("offers mode completions only with developer mode enabled", () => {
    const command = new CameraCommand();
    expect(command.getCompletions("", [])).toContain("mode");
    expect(command.getCompletions("", ["mode"])).toContain("isometric");
    vi.mocked(Cvar.getBool).mockReturnValue(false);
    expect(command.getCompletions("", [])).toEqual(["fov", "pos", "info"]);
    expect(command.getCompletions("", ["mode"])).toEqual([]);
  });

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

  it.each(["orthographic", "constructor", "__proto__"])("rejects unknown or inherited mode names: %s", async (mode) => {
    withController("fps");
    const setController = vi.spyOn(system(), "setController").mockReturnValue(true);
    await expect(new CameraCommand().execute(["mode", mode])).resolves.toEqual({
      ok: false,
      output: `Unknown mode: ${mode}`,
    });
    expect(setController).not.toHaveBeenCalled();
  });

  it("selects a controller by either of its names", async () => {
    withController("fps");
    const setController = vi.spyOn(system(), "setController").mockReturnValue(true);

    await new CameraCommand().execute(["mode", "iso"]);
    await new CameraCommand().execute(["mode", "isometric"]);

    expect(setController).toHaveBeenNthCalledWith(1, "isometric");
    expect(setController).toHaveBeenNthCalledWith(2, "isometric");
  });

  it("reports a controller switch failure through checked execution", async () => {
    withController("fps");
    vi.spyOn(system(), "setController").mockReturnValue(false);
    const registry = CommandRegistry.getInstance();
    registry.register(new CameraCommand());
    try {
      await expect(registry.executeChecked("camera mode freefly")).resolves.toEqual({
        ok: false,
        output: "Failed to set mode: freefly (controller not registered or camera not initialized)",
      });
    } finally {
      registry.unregister("camera");
    }
  });

  it("reports a missing active camera as a failure", async () => {
    vi.spyOn(system(), "getCamera").mockReturnValue(null);
    await expect(new CameraCommand().execute(["mode", "fps"])).resolves.toEqual({
      ok: false,
      output: "No active camera",
    });
  });
});
