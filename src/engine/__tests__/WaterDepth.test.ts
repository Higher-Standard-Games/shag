/**
 * Water's own depth pass.
 *
 * Two properties, both found by review rather than by playing:
 *
 * `scene.enableDepthRenderer()` caches one renderer per camera and returns the
 * cached one WITH ITS ORIGINAL SETTINGS, discarding the arguments of every
 * later caller. Water needs camera-space Z; the cel outline pass needs the
 * default clip-space metric. Sharing means one of them silently reads the
 * wrong encoding, and for water that does not fail — the surface renders, it
 * just stops varying with depth, which is the single hardest failure in this
 * feature to notice.
 *
 * And the active camera changes constantly in play — death, spectate, freefly.
 * A depth map built for a camera that is no longer rendering describes a view
 * nobody is looking through.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WaterDepthProvider } from "../rendering/water/WaterDepth";

let engine: NullEngine;
let scene: Scene;
let provider: WaterDepthProvider;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  // NullEngine reports no float-render support, and the provider correctly
  // refuses to build a depth map it cannot store world distances in. These
  // tests are about lifecycle, not about the device, so grant the capability.
  engine.getCaps().textureHalfFloatRender = true;
  provider = new WaterDepthProvider(scene);
});

afterEach(() => {
  provider.dispose();
  scene.dispose();
  engine.dispose();
});

const camera = (name: string) => new FreeCamera(name, new Vector3(0, 0, 0), scene);

describe("not sharing the scene's depth renderer", () => {
  it("does not register itself in scene._depthRenderer", () => {
    // The dictionary enableDepthRenderer caches into. Being absent from it is
    // precisely what stops another consumer inheriting our encoding, and stops
    // disableDepthRenderer() tearing ours down.
    provider.mapFor(camera("a"));

    const cached = (scene as unknown as { _depthRenderer?: Record<string, unknown> })._depthRenderer;
    expect(cached === undefined || Object.keys(cached).length === 0).toBe(true);
  });

  it("leaves a pre-existing depth renderer alone", () => {
    // Cel outlines enable one first with the default encoding. Ours must not
    // be that one, and must not replace it.
    const cam = camera("shared");
    const theirs = scene.enableDepthRenderer(cam, false);

    const ours = provider.mapFor(cam);

    expect(ours).not.toBe(theirs.getDepthMap());
    expect(scene.enableDepthRenderer(cam, false)).toBe(theirs);
  });

  it("survives the other consumer disabling theirs", () => {
    const cam = camera("shared");
    scene.enableDepthRenderer(cam, false);
    const ours = provider.mapFor(cam);

    scene.disableDepthRenderer(cam);

    expect(provider.mapFor(cam)).toBe(ours);
    expect(scene.cameras.flatMap((camera) => camera.customRenderTargets)).toContain(ours);
  });
});

describe("following the active camera", () => {
  it("disposes its privately owned render target", () => {
    const cam = camera("owned");
    const map = provider.mapFor(cam);
    expect(scene.textures).toContain(map);
    provider.dispose();
    expect(cam.customRenderTargets).not.toContain(map);
    expect(scene.textures).not.toContain(map);
  });
  it("renders its target as part of the scene", () => {
    // Nothing else gathers it: the scene component's step only walks cameras
    // in `_depthRenderer`, and we are deliberately not one of them.
    const map = provider.mapFor(camera("a"));

    expect(scene.cameras.flatMap((camera) => camera.customRenderTargets)).toContain(map);
  });

  it("reuses the map while the camera is unchanged", () => {
    const cam = camera("a");

    expect(provider.mapFor(cam)).toBe(provider.mapFor(cam));
    expect(scene.cameras.flatMap((camera) => camera.customRenderTargets).length).toBe(1);
  });

  it("rebuilds for a new camera", () => {
    // Death, spectate and freefly all swap the active camera mid-map.
    const first = provider.mapFor(camera("a"));
    const second = provider.mapFor(camera("b"));

    expect(second).not.toBe(first);
    expect(provider.boundCamera?.name).toBe("b");
  });

  it("does not accumulate a target per camera switch", () => {
    // The bug this guards: a session that spectated ten players would be
    // running eleven full-scene depth passes.
    for (let i = 0; i < 10; i++) provider.mapFor(camera(`cam${i}`));

    expect(scene.cameras.flatMap((camera) => camera.customRenderTargets).length).toBe(1);
  });

  it("unregisters the old target when it switches", () => {
    const cam = camera("a");
    const first = provider.mapFor(cam);
    provider.mapFor(camera("b"));

    expect(scene.cameras.flatMap((camera) => camera.customRenderTargets)).not.toContain(first);
  });

  it("switches back and forth without leaking", () => {
    const a = camera("a");
    const b = camera("b");

    for (let i = 0; i < 5; i++) {
      provider.mapFor(a);
      provider.mapFor(b);
    }

    expect(scene.cameras.flatMap((camera) => camera.customRenderTargets).length).toBe(1);
  });
});

describe("a device that cannot store world distances", () => {
  it("refuses rather than handing back an 8-bit map", () => {
    // enableDepthRenderer falls back to UNSIGNED_BYTE when no float target is
    // available. With camera-space Z that is useless — world distances clamp
    // to 1.0, every thickness computes as zero, and the water goes uniformly
    // clear with nothing to say why. Returning null leaves uHasDepth at 0 and
    // the surface falls back to its flat look, which at least looks decided.
    const caps = engine.getCaps();
    caps.textureHalfFloatRender = false;
    caps.textureFloatRender = false;
    const strict = new WaterDepthProvider(scene);

    expect(strict.mapFor(camera("a"))).toBeNull();
    expect(scene.cameras.flatMap((camera) => camera.customRenderTargets).length).toBe(0);
  });

  it("asks the device only once", () => {
    const caps = engine.getCaps();
    caps.textureHalfFloatRender = false;
    caps.textureFloatRender = false;
    const strict = new WaterDepthProvider(scene);

    strict.mapFor(camera("a"));
    // Even if the caps changed under us, a per-frame retry would mean a warning
    // per frame and a construction attempt per frame.
    caps.textureHalfFloatRender = true;

    expect(strict.mapFor(camera("a"))).toBeNull();
  });
});

describe("teardown", () => {
  it("removes its target from the scene", () => {
    const map = provider.mapFor(camera("a"));
    expect(scene.cameras.flatMap((camera) => camera.customRenderTargets)).toContain(map);

    provider.dispose();

    expect(scene.cameras.flatMap((camera) => camera.customRenderTargets)).not.toContain(map);
    expect(provider.boundCamera).toBeNull();
  });

  it("is idempotent", () => {
    provider.mapFor(camera("a"));
    provider.dispose();

    expect(() => provider.dispose()).not.toThrow();
  });

  it("can be used again after disposal", () => {
    // Map unload then load: the same system is rebuilt, not resurrected, but
    // a provider that refused to work twice would be a silent regression.
    provider.mapFor(camera("a"));
    provider.dispose();

    expect(provider.mapFor(camera("b"))).not.toBeNull();
  });
});

describe("what the depth pass draws", () => {
  const captured = (): AbstractMesh[] => {
    const map = provider.mapFor(camera("a"));
    if (!map) return [];
    return (map as RenderTargetTexture).getCustomRenderList?.(0, scene.meshes, scene.meshes.length) ?? [];
  };

  it("uses the current world camera list across successive weapon-camera frames", async () => {
    const eye = camera("world");
    eye.layerMask = 0x0fffffff;
    const weapon = camera("weapon");
    weapon.layerMask = 0x10000000;
    scene.activeCameras = [eye, weapon];
    const wall = CreateBox("wall", { size: 2 }, scene);
    wall.position.z = 8;
    wall.material = new StandardMaterial("wall-material", scene);
    const gun = CreateBox("gun", { size: 1 }, scene);
    gun.position.z = 4;
    gun.layerMask = weapon.layerMask;
    gun.material = wall.material;
    const map = provider.mapFor(eye) as RenderTargetTexture;
    const filter = map.getCustomRenderList!;
    const captures: string[][] = [];
    map.getCustomRenderList = (...args) => {
      const meshes = filter(...args) ?? [];
      captures.push(meshes.map((mesh) => mesh.name));
      return meshes;
    };
    await scene.whenReadyAsync();
    for (let frame = 0; frame < 3; frame++) scene.render();
    expect(captures).toHaveLength(3);
    expect(captures.every((names) => names.includes("wall") && !names.includes("gun"))).toBe(true);
    expect(scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length)).toContain(gun);
    expect(scene.customRenderTargets).not.toContain(map);
    expect(eye.customRenderTargets).toContain(map);
  });

  it("measures against the world", () => {
    const wall = CreateBox("wall", { size: 1 }, scene);

    expect(captured()).toContain(wall);
  });

  it("excludes liquid, since the gap BEHIND it is the whole quantity", () => {
    // A surface that appears in its own depth map measures zero thickness.
    const pool = CreateBox("pool", { size: 1 }, scene);
    pool.metadata = { liquidKind: "water" };

    expect(captured()).not.toContain(pool);
  });

  it("excludes the viewmodel, which is not in the world", () => {
    const gun = CreateBox("viewmodel", { size: 1 }, scene);
    gun.layerMask = 0x10000000;

    expect(captured()).not.toContain(gun);
  });
});

describe("capture ceiling", () => {
  it("leaves out meshes wholly above it, and everything comes back without one", () => {
    const map = provider.mapFor(camera("world")) as RenderTargetTexture;
    const below = CreateBox("below", {}, scene);
    const above = CreateBox("above", {}, scene);
    above.position.y = 200;
    for (const mesh of [below, above]) mesh.computeWorldMatrix(true);
    const meshes = [below, above];
    provider.setCaptureCeiling(60);
    expect(map.getCustomRenderList!(0, meshes, meshes.length)).toEqual([below]);
    provider.setCaptureCeiling(null);
    expect(map.getCustomRenderList!(0, meshes, meshes.length)).toEqual(meshes);
  });
});
