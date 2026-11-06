import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, expect, it, vi } from "vitest";
import { CameraSystem } from "../../../camera/CameraSystem";
import { CommandRegistry } from "../../../console/CommandRegistry";
import { Cvar } from "../../../core/Cvar";
import { loadClientMap } from "../ClientMapLoader";
import { MapLoader } from "../MapLoader";

afterEach(() => vi.restoreAllMocks());

it("clears the client scene at developer 0 without executing a developer console command", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const camera = new FreeCamera("camera", Vector3.Zero(), scene);
    const mesh = CreateBox("previous-map", {}, scene);
    vi.spyOn(Cvar, "getBool").mockReturnValue(false);
    vi.spyOn(CameraSystem.getInstance(), "getCamera").mockReturnValue(camera);
    const execute = vi
      .spyOn(CommandRegistry.getInstance(), "execute")
      .mockRejectedValue(new Error("Console path used"));
    vi.spyOn(MapLoader.getInstance(), "disposeCurrentMap").mockResolvedValue(undefined);
    vi.spyOn(MapLoader.getInstance(), "loadMap").mockRejectedValue(new Error("Stop after scene preparation"));
    await expect(loadClientMap("washoi_dm2")).rejects.toThrow("Stop after scene preparation");
    expect(mesh.isDisposed()).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  } finally {
    engine.dispose();
  }
});
