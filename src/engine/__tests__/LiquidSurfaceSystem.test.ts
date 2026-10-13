/**
 * Liquid surface ownership (water Phase 3).
 *
 * The system exists for its lifecycle rather than its rendering: it holds the
 * materials, the shared noise and the originals it displaced, so a map unload
 * is one `dispose()` instead of a hunt for what the water left behind.
 *
 * Runs against a real Babylon scene on the NullEngine — the shader never
 * compiles there, which is exactly the fallback path worth exercising.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RenderVars from "../rendering/RenderVars";
import { hasReactiveSurface, LiquidSurfaceSystem } from "../rendering/water/LiquidSurfaceSystem";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  // Restore the value without scheduling a browser-only animation callback.
  RenderVars.getInstance().getVar("r_water_quality")!.value =
    RenderVars.getInstance().getVar("r_water_quality")!.defaultValue;
  scene.dispose();
  engine.dispose();
});

/** A world root with children, some annotated as liquid by the classifier. */
function buildWorld(kinds: Array<string | null>): Mesh {
  const root = new Mesh("bsp_world", scene);
  kinds.forEach((kind, i) => {
    const child = new Mesh(`bsp_tex_${i}`, scene);
    child.parent = root;
    child.material = new StandardMaterial(`legacy_${i}`, scene);
    child.metadata = { textureName: `textures/test/${i}`, liquidKind: kind };
  });
  return root;
}

describe("LiquidSurfaceSystem", () => {
  it("updates polish controls without replacing the material or allocating capture targets", () => {
    const root = buildWorld(["water"]);
    scene.activeCamera = new FreeCamera("world", new Vector3(0, 80, 0), scene);
    const vars = RenderVars.getInstance();
    vars.getVar("r_water_quality")!.value = 1;
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);
    const material = root.getChildMeshes(false)[0].material as ShaderMaterial;
    const setFloat = vi.spyOn(material, "setFloat");
    try {
      for (const value of [0, 0.35, 1]) {
        for (const name of ["r_water_blur", "r_water_detail", "r_water_contact"]) vars.getVar(name)!.value = value;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        for (const name of ["uReflectionBlur", "uDetailStrength", "uContactStrength"])
          expect(setFloat).toHaveBeenCalledWith(name, value);
        expect(root.getChildMeshes(false)[0].material).toBe(material);
        expect(scene.activeCamera.customRenderTargets).toHaveLength(0);
        expect(scene.customRenderTargets).toHaveLength(0);
        setFloat.mockClear();
      }
    } finally {
      for (const name of ["r_water_blur", "r_water_detail", "r_water_contact"])
        vars.getVar(name)!.value = vars.getVar(name)!.defaultValue;
      setFloat.mockRestore();
      system.dispose();
    }
  });
  it("binds distinct shader-selected profiles while sharing equal profiles", () => {
    const root = buildWorld(["water", "water", "water"]);
    const [clear, deep, anotherClear] = root.getChildMeshes(false);
    clear.metadata.liquidProfile = "clear";
    deep.metadata.liquidProfile = "deep";
    anotherClear.metadata.liquidProfile = "clear";
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);
    expect(clear.material).not.toBe(deep.material);
    expect(clear.material).toBe(anotherClear.material);
    system.dispose();
  });
  it("claims only the annotated liquid surfaces", () => {
    const root = buildWorld(["water", null, null, "slime"]);
    const system = new LiquidSurfaceSystem(scene);

    const claimed = system.claim(root);

    expect(claimed).toBe(2);
    expect(system.claimedCount).toBe(2);
  });

  it("claims nothing in a map with no liquid", () => {
    const root = buildWorld([null, null, null]);
    const system = new LiquidSurfaceSystem(scene);

    expect(system.claim(root)).toBe(0);
  });

  it("leaves non-liquid materials untouched", () => {
    const root = buildWorld(["water", null]);
    const dry = root.getChildMeshes(false)[1];
    const before = dry.material;
    const system = new LiquidSurfaceSystem(scene);

    system.claim(root);

    expect(dry.material).toBe(before);
  });

  it("asks an occlusion query whether the water is hidden, on bounds with thickness", () => {
    const root = new Mesh("bsp_world", scene);
    const pool = CreateGround("bsp_tex_pool", { width: 256, height: 128 }, scene);
    pool.parent = root;
    pool.material = new StandardMaterial("legacy_pool", scene);
    pool.metadata = { textureName: "textures/test/pool", liquidKind: "water" };
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    expect(pool.occlusionType).toBe(AbstractMesh.OCCLUSION_TYPE_STRICT);
    const { minimum, maximum } = pool.getBoundingInfo();
    expect(maximum.y - minimum.y).toBeGreaterThan(0);

    system.dispose();
    expect(pool.occlusionType).toBe(AbstractMesh.OCCLUSION_TYPE_NONE);
  });

  it("hands the original material back on dispose", () => {
    // A map unload disposes the water materials; a mesh left pointing at one
    // renders as nothing at all. Toggling water off mid-session has to leave
    // the legacy surface exactly as it was.
    const root = buildWorld(["water"]);
    const wet = root.getChildMeshes(false)[0];
    const original = wet.material;
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    system.dispose();

    expect(wet.material).toBe(original);
    expect(system.claimedCount).toBe(0);
  });

  it("restores the legacy surface when Babylon reports a lazy shader compile failure", async () => {
    const root = buildWorld(["water"]);
    const wet = root.getChildMeshes(false)[0];
    const original = wet.material;
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    wet.material?.onError?.({} as never, "synthetic compile failure");
    await Promise.resolve();

    expect(wet.material).toBe(original);
    expect(system.claimedCount).toBe(0);
    system.dispose();
  });

  it("survives disposal of the meshes it claimed", () => {
    // Map unload disposes the world hierarchy. Whichever order that happens
    // in, the system must not throw trying to hand a material back to a
    // disposed mesh.
    const root = buildWorld(["water", "lava"]);
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    for (const child of root.getChildMeshes(false)) child.dispose();
    root.dispose();

    expect(() => system.dispose()).not.toThrow();
  });

  it("is idempotent on dispose", () => {
    const root = buildWorld(["water"]);
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    system.dispose();

    expect(() => system.dispose()).not.toThrow();
    expect(system.claimedCount).toBe(0);
  });

  it("shares one material per liquid kind", () => {
    // Two pools of the same liquid are one material and one noise texture, not
    // two of each — the difference between a map with water in it and a map
    // that allocates per surface.
    const root = buildWorld(["water", "water", "water"]);
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    const materials = new Set(root.getChildMeshes(false).map((m) => m.material));

    expect(materials.size).toBe(1);
  });

  it("gives slime the reactive surface water has (ripples, reflections), and lava none", () => {
    // wamphi1's floor is slime: it was drawn by the water material but never
    // rippled, because only water got a surface patch to carry the waves.
    // Three flat, separate pools: a patch needs a surface to lie on.
    const root = new Mesh("bsp_world", scene);
    const [water, slime, lava] = (["water", "slime", "lava"] as const).map((kind, i) => {
      const pool = CreateGround(`bsp_pool_${kind}`, { width: 64, height: 64 }, scene);
      pool.position.x = i * 200;
      pool.bakeCurrentTransformIntoVertices();
      pool.parent = root;
      pool.material = new StandardMaterial(`legacy_pool_${kind}`, scene);
      pool.metadata = { textureName: `textures/test/${kind}`, liquidKind: kind };
      return pool;
    });
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    const probes = (system as unknown as { probes: { patchFor(mesh: unknown): unknown } }).probes;
    expect(probes.patchFor(water)).toBeDefined();
    expect(probes.patchFor(slime)).toBeDefined();
    expect(probes.patchFor(lava)).toBeUndefined();
    expect(hasReactiveSurface("slime")).toBe(true);
    expect(hasReactiveSurface("lava")).toBe(false);
    system.dispose();
  });

  it("gives different liquids different materials", () => {
    const root = buildWorld(["water", "slime", "lava"]);
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    const materials = new Set(root.getChildMeshes(false).map((m) => m.material));

    expect(materials.size).toBe(3);
  });

  it("registers no render observer for a map with no liquid", () => {
    // A dry map must cost nothing per frame.
    const before = scene.onBeforeRenderObservable.observers.length;
    const system = new LiquidSurfaceSystem(scene);

    system.claim(buildWorld([null, null]));

    expect(scene.onBeforeRenderObservable.observers.length).toBe(before);
    system.dispose();
  });

  it("removes its render observer on dispose", async () => {
    const before = scene.onBeforeRenderObservable.observers.length;
    const system = new LiquidSurfaceSystem(scene);
    system.claim(buildWorld(["water"]));
    expect(scene.onBeforeRenderObservable.observers.length).toBe(before + 1);

    system.dispose();

    // Babylon defers the actual splice to a macrotask so an observable can be
    // safely modified from inside its own notification. The observer is flagged
    // immediately and gone by the next tick, so a synchronous assertion here
    // would be testing Babylon's scheduling rather than our cleanup.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scene.onBeforeRenderObservable.observers.length).toBe(before);
  });

  it("does not accumulate observers across repeated claims", () => {
    // Load, unload, load again is the ordinary case, and the one that leaks.
    const before = scene.onBeforeRenderObservable.observers.length;
    const system = new LiquidSurfaceSystem(scene);

    system.claim(buildWorld(["water"]));
    system.claim(buildWorld(["water"]));
    system.claim(buildWorld(["water"]));

    expect(scene.onBeforeRenderObservable.observers.length).toBe(before + 1);
    system.dispose();
  });

  it("does not claim the same mesh twice or lose its real legacy material", () => {
    const root = buildWorld(["water"]);
    const wet = root.getChildMeshes(false)[0];
    const legacy = wet.material;
    const system = new LiquidSurfaceSystem(scene);

    expect(system.claim(root)).toBe(1);
    expect(system.claim(root)).toBe(0);
    system.dispose();

    expect(wet.material).toBe(legacy);
  });

  it("never schedules a recurring live mirror on Epic", () => {
    const root = new Mesh("bsp_world", scene);
    const wet = CreateBox("pool", { width: 200, depth: 150, height: 1 }, scene);
    wet.parent = root;
    wet.metadata = { liquidKind: "water" };
    wet.material = new StandardMaterial("legacy", scene);
    scene.activeCamera = new FreeCamera("eye", new Vector3(0, 100, 0), scene);

    const qualityVar = RenderVars.getInstance().getVar("r_water_quality");
    expect(qualityVar).toBeDefined();
    qualityVar!.value = 3;
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);
    scene.onBeforeRenderObservable.notifyObservers(scene);

    expect(scene.customRenderTargets.some((target) => target.name === "water-planar-reflection")).toBe(false);

    qualityVar!.value = 2;
    scene.onBeforeRenderObservable.notifyObservers(scene);

    expect(scene.customRenderTargets.some((target) => target.name === "water-planar-reflection")).toBe(false);
    system.dispose();
  });

  it("adds colour refraction only on Epic and suspends every capture offscreen", () => {
    engine.getCaps().textureHalfFloatRender = true;
    const root = buildWorld(["water"]);
    const wet = root.getChildMeshes(false)[0] as Mesh;
    const camera = new FreeCamera("world", new Vector3(0, 100, 0), scene);
    scene.activeCamera = camera;
    const quality = RenderVars.getInstance().getVar("r_water_quality")!;
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);
    for (const [tier, count] of [
      [3, 2],
      [2, 1],
      [1, 0],
      [3, 2],
    ]) {
      quality.value = tier;
      wet.onBeforeDrawObservable.notifyObservers(wet);
      scene.onBeforeRenderObservable.notifyObservers(scene);
      expect(camera.customRenderTargets).toHaveLength(count);
    }
    for (let i = 0; i < 12; i++) scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(camera.customRenderTargets).toHaveLength(0);
    system.dispose();
    expect(camera.customRenderTargets).toHaveLength(0);
  });
});

describe("deciding whether water is on screen", () => {
  /**
   * The gate that switched Epic off entirely, twice.
   *
   * First it tested bounding boxes against the frustum and answered "no"
   * while a pool filled the screen. Then it read `scene.getActiveMeshes()`
   * and OSCILLATED every single frame — the list is rebuilt when a render
   * target draws, and both Epic targets deliberately exclude water, so
   * enabling them erased the evidence that they should be enabled.
   *
   * Both failures looked identical from outside: a flat pale surface with no
   * refraction and no reflection. The rule that survives both is that the
   * signal must come from the MESH reporting its own draw, because water is
   * excluded from the extra passes and so only the player's view can fire it.
   */
  it("hooks the claimed surfaces so they can report being drawn", () => {
    const root = buildWorld(["water", null, "slime"]);
    const system = new LiquidSurfaceSystem(scene);

    system.claim(root);

    // Every claimed surface carries a draw observer; nothing else does.
    for (const mesh of scene.meshes) {
      const watched = (mesh as Mesh).onBeforeDrawObservable.hasObservers();
      expect(watched).toBe(Boolean(mesh.metadata?.liquidKind));
    }

    system.dispose();
  });

  it("unhooks them on dispose, so a map unload leaves nothing behind", () => {
    const root = buildWorld(["water"]);
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    system.dispose();

    for (const mesh of scene.meshes) {
      expect((mesh as Mesh).onBeforeDrawObservable.hasObservers()).toBe(false);
    }
  });

  it("does not hook a surface it declined to claim", () => {
    // A shader that will not compile leaves the legacy material in place, and
    // an unclaimed surface must not be driving the Epic gate either.
    const root = buildWorld([null, null]);
    const system = new LiquidSurfaceSystem(scene);

    expect(system.claim(root)).toBe(0);
    for (const mesh of scene.meshes) {
      expect((mesh as Mesh).onBeforeDrawObservable.hasObservers()).toBe(false);
    }

    system.dispose();
  });
});
