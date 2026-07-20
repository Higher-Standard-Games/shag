import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LASERGUN } from "../../shared/entities/definitions/weapons/lasergun";
import { PLASMAGUN } from "../../shared/entities/definitions/weapons/plasmagun";
import { VOLTAIC } from "../../shared/entities/definitions/weapons/voltaic";
import type { WeaponDef } from "../../shared/entities/WeaponDef";
import { WeaponViewManager } from "../weapon/WeaponViewManager";

const hitscan = vi.hoisted(() => ({
  init: vi.fn(),
  beginLightning: vi.fn(),
  updateLightningBeam: vi.fn(),
  updateBeam: vi.fn(),
  stopBeam: vi.fn(),
  stopLightning: vi.fn(),
  setMuzzleAnchorResolver: vi.fn(),
  fireMuzzleFlash: vi.fn(),
}));

vi.mock("../weapon/HitscanEffects", () => ({
  getHitscanEffects: () => hitscan,
}));

vi.mock("../weapon/ProjectileManager", () => ({
  getProjectileManager: () => ({ init: vi.fn() }),
}));

interface BeamRoutingInternals {
  beamActive: boolean;
  currentWeaponDef: WeaponDef | null;
  getMuzzleWorldPosition: () => Vector3 | null;
  updateMuzzleFlash: (deltaTime: number) => void;
  muzzleSocket: TransformNode | null;
  weaponCamera: FreeCamera;
  weaponRoot: TransformNode;
}

describe("WeaponViewManager continuous beam routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses one procedural Voltaic renderer path", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new FreeCamera("camera", Vector3.Zero(), scene);
    const manager = new WeaponViewManager();

    try {
      manager.init(scene, camera);
      const internals = manager as unknown as BeamRoutingInternals;
      internals.currentWeaponDef = VOLTAIC;
      internals.beamActive = true;
      internals.getMuzzleWorldPosition = () => new Vector3(2, -1, 4);

      internals.updateMuzzleFlash(1 / 60);

      expect(hitscan.updateLightningBeam).toHaveBeenCalledOnce();
      expect(hitscan.updateBeam).not.toHaveBeenCalled();
    } finally {
      manager.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("exports Lasergun as the exact canonical Voltaic definition", () => {
    expect(LASERGUN).toBe(VOLTAIC);
    expect(VOLTAIC.modelPath).toBe("/data/models/weapons/lasergun/lasergun.glb");
    expect(VOLTAIC.viewModel.modelPath).toBe(VOLTAIC.modelPath);
    expect(VOLTAIC.viewModel.viewModelFormat).toBe("glb");
    expect(VOLTAIC.viewModel.adsOffset).toEqual({ x: 0, y: -21, z: -5 });
    expect(VOLTAIC.reloadTime).toBe(PLASMAGUN.reloadTime);
  });

  it("projects the authored muzzle socket to the same pixel in the world camera", () => {
    const engine = new NullEngine({
      renderWidth: 1280,
      renderHeight: 720,
      textureSize: 512,
      deterministicLockstep: false,
      lockstepMaxSteps: 4,
    });
    const scene = new Scene(engine);
    const camera = new FreeCamera("camera", Vector3.Zero(), scene);
    camera.fov = (105 * Math.PI) / 180;
    const manager = new WeaponViewManager();

    try {
      manager.init(scene, camera);
      const internals = manager as unknown as BeamRoutingInternals;
      internals.weaponRoot.position.set(0, -4, 10);
      const socket = new TransformNode("tag_flash", scene);
      socket.parent = internals.weaponRoot;
      socket.position.set(7, 2, 25);
      internals.muzzleSocket = socket;
      socket.computeWorldMatrix(true);

      camera.getViewMatrix(true);
      camera.getProjectionMatrix(true);
      internals.weaponCamera.getViewMatrix(true);
      internals.weaponCamera.getProjectionMatrix(true);
      const viewport = internals.weaponCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
      const identity = Matrix.Identity();
      const socketPixel = Vector3.Project(
        socket.getAbsolutePosition(),
        identity,
        internals.weaponCamera.getTransformationMatrix(),
        viewport,
      );
      const muzzle = manager.getMuzzleWorldPosition();
      expect(muzzle).not.toBeNull();
      const muzzlePixel = Vector3.Project(muzzle!, identity, camera.getTransformationMatrix(), viewport);

      expect(muzzlePixel.x).toBeCloseTo(socketPixel.x, 3);
      expect(muzzlePixel.y).toBeCloseTo(socketPixel.y, 3);
    } finally {
      manager.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});
