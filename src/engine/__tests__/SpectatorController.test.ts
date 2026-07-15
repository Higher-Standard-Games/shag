/**
 * SpectatorController tests — Chase-cam camera controller
 *
 * Uses vi.mock to replace Babylon.js with lightweight stubs.
 * Tests verify targeting, smoothing, rotation, and lifecycle.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock Babylon.js (inline factories for hoisting) ─────────────

vi.mock("@babylonjs/core/Cameras/camera", () => ({
  Camera: class {},
}));

vi.mock("@babylonjs/core/Cameras/freeCamera", () => {
  const makeVec = (ix: number, iy: number, iz: number) => ({
    x: ix,
    y: iy,
    z: iz,
    set(sx: number, sy: number, sz: number) {
      this.x = sx;
      this.y = sy;
      this.z = sz;
    },
  });
  class MockFreeCamera {
    position: ReturnType<typeof makeVec>;
    rotation: ReturnType<typeof makeVec>;
    rotationQuaternion: null | unknown = null;
    name: string;
    inputs = { clear: vi.fn() };
    constructor(name: string, pos: { x: number; y: number; z: number }) {
      this.name = name;
      this.position = makeVec(pos.x, pos.y, pos.z);
      this.rotation = makeVec(0, 0, 0);
    }
  }
  return { FreeCamera: MockFreeCamera };
});

vi.mock("@babylonjs/core/Maths/math.vector", () => {
  class MockVector3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    clone() {
      return new MockVector3(this.x, this.y, this.z);
    }
    static Zero() {
      return new MockVector3(0, 0, 0);
    }
  }
  return { Vector3: MockVector3 };
});

vi.mock("@babylonjs/core/scene", () => ({
  Scene: class {},
}));

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
// Import AFTER mocks are defined
import {
  SpectatorController,
  type SpectatorTargetData,
  type SpectatorTargetProvider,
} from "../camera/controllers/SpectatorController";

// ─── Helpers ─────────────────────────────────────────────────────

function createController(): SpectatorController {
  return new SpectatorController();
}

function makeProvider(data: SpectatorTargetData | null): SpectatorTargetProvider {
  return (_id: string) => data;
}

/** Attach controller to a mock camera + scene */
function attachController(ctrl: SpectatorController) {
  // Use mocked FreeCamera (not real Babylon)
  const cam = new FreeCamera("testCam", new Vector3(0, 0, 0) as never) as unknown as {
    position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
    rotation: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
  };
  const scene = { activeCamera: null } as never;
  const canvas = {} as HTMLCanvasElement;
  ctrl.attach(cam as never, scene, canvas);
  return cam;
}

// ─── Tests ───────────────────────────────────────────────────────

describe("SpectatorController", () => {
  let controller: SpectatorController;

  beforeEach(() => {
    controller = createController();
  });

  // ── Metadata ──────────────────────────────────────────────────

  it('has type "spectator"', () => {
    expect(controller.type).toBe("spectator");
  });

  it("starts enabled", () => {
    expect(controller.isEnabled()).toBe(true);
  });

  it("can be disabled and re-enabled", () => {
    controller.setEnabled(false);
    expect(controller.isEnabled()).toBe(false);
    controller.setEnabled(true);
    expect(controller.isEnabled()).toBe(true);
  });

  // ── Target tracking ───────────────────────────────────────────

  it("starts with no target", () => {
    expect(controller.getTargetEntityId()).toBeNull();
  });

  it("sets and gets target entity ID", () => {
    controller.setSpectateTarget("player_1");
    expect(controller.getTargetEntityId()).toBe("player_1");
  });

  it("clears target", () => {
    controller.setSpectateTarget("player_1");
    controller.clearSpectateTarget();
    expect(controller.getTargetEntityId()).toBeNull();
  });

  // ── Update without prerequisites ──────────────────────────────

  it("update does nothing when not attached", () => {
    controller.setTargetProvider(makeProvider({ x: 100, y: 200, z: 300, yaw: 1, pitch: 0.5 }));
    controller.setSpectateTarget("player_1");
    controller.update(0.016);
  });

  it("update does nothing when disabled", () => {
    const cam = attachController(controller);
    controller.setTargetProvider(makeProvider({ x: 100, y: 200, z: 300, yaw: 1, pitch: 0.5 }));
    controller.setSpectateTarget("player_1");
    controller.setEnabled(false);
    controller.update(0.016);
    expect(cam.position.x).toBe(0);
    expect(cam.position.y).toBe(0);
    expect(cam.position.z).toBe(0);
  });

  it("update does nothing without target", () => {
    const cam = attachController(controller);
    controller.setTargetProvider(makeProvider({ x: 100, y: 200, z: 300, yaw: 1, pitch: 0.5 }));
    controller.update(0.016);
    expect(cam.position.x).toBe(0);
  });

  it("update does nothing without provider", () => {
    const cam = attachController(controller);
    controller.setSpectateTarget("player_1");
    controller.update(0.016);
    expect(cam.position.x).toBe(0);
  });

  // ── Position tracking ─────────────────────────────────────────

  it("snaps to target position on first frame", () => {
    const cam = attachController(controller);
    controller.setTargetProvider(makeProvider({ x: 100, y: 200, z: 300, yaw: 0, pitch: 0 }));
    controller.setSpectateTarget("player_1");
    controller.update(0.016);

    expect(cam.position.x).toBe(100);
    expect(cam.position.y).toBe(234); // 200 + live standing viewheight (34)
    expect(cam.position.z).toBe(300);
  });

  it("applies eye height offset", () => {
    const cam = attachController(controller);
    controller.setTargetProvider(makeProvider({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }));
    controller.setSpectateTarget("player_1");
    controller.update(0.016);
    expect(cam.position.y).toBe(34);
  });

  it("applies provider eye height and camera-local bob without changing the base sample", () => {
    const cam = attachController(controller);
    controller.setTargetProvider(
      makeProvider({
        x: 10,
        y: 20,
        z: 30,
        yaw: 0,
        pitch: 0,
        eyeHeight: 10,
        bobRight: 2,
        bobUp: 3,
        pitchOffsetDegrees: 5,
        rollDegrees: 4,
        snapToTarget: true,
      }),
    );
    controller.setSpectateTarget("player_1");
    controller.update(0.016);

    expect(cam.position.x).toBeCloseTo(12);
    expect(cam.position.y).toBeCloseTo(33);
    expect(cam.position.z).toBeCloseTo(30);
    expect(cam.rotation.x).toBeCloseTo((5 * Math.PI) / 180);
    expect(cam.rotation.z).toBeCloseTo((4 * Math.PI) / 180);
    expect(controller.getSmoothedPosition()).toEqual({ x: 10, y: 30, z: 30 });
  });

  it("can snap every provider sample that is already interpolated", () => {
    const targetData: SpectatorTargetData = {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      snapToTarget: true,
    };
    const cam = attachController(controller);
    controller.setTargetProvider(() => targetData);
    controller.setSpectateTarget("player_1");
    controller.update(0.016);
    targetData.x = 100;
    controller.update(0.001);
    expect(cam.position.x).toBe(100);
  });

  it("smooths position on subsequent frames", () => {
    const targetData = { x: 100, y: 0, z: 0, yaw: 0, pitch: 0 };
    const cam = attachController(controller);
    controller.setTargetProvider(() => targetData);
    controller.setSpectateTarget("player_1");

    controller.update(0.016); // snap
    expect(cam.position.x).toBe(100);

    targetData.x = 200;
    controller.update(0.016);
    expect(cam.position.x).toBeGreaterThan(100);
    expect(cam.position.x).toBeLessThan(200);
  });

  it("snaps when target moves beyond snap threshold", () => {
    const targetData = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    const cam = attachController(controller);
    controller.setTargetProvider(() => targetData);
    controller.setSpectateTarget("player_1");

    controller.update(0.016);

    targetData.x = 1000;
    controller.update(0.016);
    expect(cam.position.x).toBe(1000);
  });

  // ── Rotation tracking ─────────────────────────────────────────

  it("sets camera rotation from target yaw/pitch on first frame", () => {
    const cam = attachController(controller);
    controller.setTargetProvider(makeProvider({ x: 0, y: 0, z: 0, yaw: 1.5, pitch: -0.3 }));
    controller.setSpectateTarget("player_1");
    controller.update(0.016);

    expect(cam.rotation.x).toBeCloseTo(-0.3);
    expect(cam.rotation.y).toBeCloseTo(1.5);
    expect(cam.rotation.z).toBe(0);
  });

  it("handles yaw wrap-around smoothing", () => {
    const targetData = { x: 0, y: 0, z: 0, yaw: 3.1, pitch: 0 };
    const cam = attachController(controller);
    controller.setTargetProvider(() => targetData);
    controller.setSpectateTarget("player_1");

    controller.update(0.016);
    expect(cam.rotation.y).toBeCloseTo(3.1);

    targetData.yaw = -3.1;
    controller.update(0.016);

    const yaw = cam.rotation.y;
    expect(Math.abs(yaw)).toBeGreaterThan(2.5);
  });

  // ── Provider returning null ───────────────────────────────────

  it("does not move camera when provider returns null", () => {
    let data: SpectatorTargetData | null = { x: 100, y: 200, z: 300, yaw: 0, pitch: 0 };
    const cam = attachController(controller);
    controller.setTargetProvider(() => data);
    controller.setSpectateTarget("player_1");
    controller.update(0.016);

    data = null;
    controller.update(0.016);
    expect(cam.position.x).toBe(100);
  });

  // ── setTarget resets smoothing ────────────────────────────────

  it("snaps to new position when target changes", () => {
    const targetData = { x: 100, y: 0, z: 0, yaw: 0, pitch: 0 };
    const cam = attachController(controller);
    controller.setTargetProvider(() => targetData);
    controller.setSpectateTarget("player_1");
    controller.update(0.016);

    targetData.x = 500;
    controller.setSpectateTarget("player_2");
    controller.update(0.016);
    expect(cam.position.x).toBe(500);
  });

  // ── Configuration ─────────────────────────────────────────────

  it("applies configuration", () => {
    controller.configure({ smoothing: 0.5 });
    expect(controller.getConfig().smoothing).toBe(0.5);
  });

  // ── Lifecycle ─────────────────────────────────────────────────

  it("clears state on detach", () => {
    attachController(controller);
    controller.setSpectateTarget("player_1");
    controller.detach();
    controller.update(0.016);
  });

  it("clears everything on dispose", () => {
    attachController(controller);
    controller.setSpectateTarget("player_1");
    controller.setTargetProvider(makeProvider({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }));
    controller.dispose();
    expect(controller.getTargetEntityId()).toBeNull();
  });

  it("releases an owned target provider without retaining its closure", () => {
    const targetData = { x: 25, y: 0, z: 0, yaw: 0, pitch: 0 };
    const provider = vi.fn(() => targetData);
    const cam = attachController(controller);
    controller.setTargetProvider(provider);
    controller.setSpectateTarget("player_1");
    controller.update(0.016);
    expect(cam.position.x).toBe(25);

    controller.clearTargetProvider();
    targetData.x = 500;
    controller.update(0.016);
    expect(provider).toHaveBeenCalledOnce();
    expect(cam.position.x).toBe(25);
  });

  // ── getSmoothedPosition ───────────────────────────────────────

  it("returns smoothed position", () => {
    attachController(controller);
    controller.setTargetProvider(makeProvider({ x: 50, y: 100, z: 150, yaw: 0, pitch: 0 }));
    controller.setSpectateTarget("player_1");
    controller.update(0.016);

    const pos = controller.getSmoothedPosition();
    expect(pos.x).toBe(50);
    expect(pos.y).toBe(134);
    expect(pos.z).toBe(150);
  });

  // ── Extreme deltaTime ─────────────────────────────────────────

  it("handles zero deltaTime", () => {
    const targetData = { x: 100, y: 0, z: 0, yaw: 0, pitch: 0 };
    const cam = attachController(controller);
    controller.setTargetProvider(() => targetData);
    controller.setSpectateTarget("player_1");
    controller.update(0.016); // snap

    targetData.x = 200;
    controller.update(0);
    expect(cam.position.x).toBe(100);
  });

  it("handles very large deltaTime", () => {
    const targetData = { x: 100, y: 0, z: 0, yaw: 0, pitch: 0 };
    const cam = attachController(controller);
    controller.setTargetProvider(() => targetData);
    controller.setSpectateTarget("player_1");
    controller.update(0.016); // snap

    targetData.x = 200;
    controller.update(10);
    expect(cam.position.x).toBeCloseTo(200, 0);
  });
});
