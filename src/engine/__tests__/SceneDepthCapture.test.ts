import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { expect, it, vi } from "vitest";
import { SceneDepthCapture } from "../rendering/SceneDepthCapture";

it("does not return a disposed borrowed capture or reuse its size as proof of validity", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const camera = new FreeCamera("world", Vector3.Zero(), scene);
  const target = new RenderTargetTexture("capture", 4, scene);
  const source = { width: 4, height: 4 };
  const capture = SceneDepthCapture.for(scene);
  Object.assign(capture, { camera, capturedFrame: engine.frameId, viewZ: target, source });
  try {
    expect(capture.textureFor(camera)).toBe(target);
    target.dispose();
    expect(capture.textureFor(camera)).toBeNull();
    vi.spyOn(target, "getSize").mockReturnValue({ width: 4, height: 4 });
    Object.assign(capture, { depthTarget: { _depthStencilTexture: {} } });
    const internals = capture as unknown as {
      prepare(target: typeof source): boolean;
      formatOf(target: typeof source): number;
    };
    const format = vi.spyOn(internals, "formatOf").mockReturnValue(0);
    expect(internals.prepare(source)).toBe(false);
    expect(format).toHaveBeenCalledOnce();
  } finally {
    Object.assign(capture, { depthTarget: null });
    vi.restoreAllMocks();
    scene.dispose();
    engine.dispose();
  }
});
