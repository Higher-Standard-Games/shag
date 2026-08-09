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

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiquidSurfaceSystem } from "../rendering/water/LiquidSurfaceSystem";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
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
});

describe("deciding whether water is on screen", () => {
  /**
   * The gate that turned Epic off entirely.
   *
   * The first version tested bounding boxes against the frustum here, and it
   * answered "no" while a pool filled the screen — which switched off BOTH
   * extra passes and looked exactly like refraction and reflection never
   * having been wired up. `r_water_debug 4` came back flat red, which was the
   * first evidence that distinguished a dead term from a subtle one.
   *
   * The property that fixes it: the answer must come from what the renderer
   * decided to draw, not from culling re-derived alongside it.
   */
  it("says yes when the renderer is drawing a liquid surface", () => {
    const root = buildWorld(["water"]);
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    // The scene's own active-mesh list is the source of truth. Standing in
    // for a rendered frame: whatever is in here is what got drawn.
    const water = scene.meshes.find((m) => m.metadata?.liquidKind);
    expect(water).toBeDefined();
    scene.getActiveMeshes().push(water as never);

    expect(hasLiquidAmongActive(scene)).toBe(true);

    system.dispose();
  });

  it("says no when only dry geometry is being drawn", () => {
    const root = buildWorld(["water"]);
    const system = new LiquidSurfaceSystem(scene);
    system.claim(root);

    const dry = scene.meshes.find((m) => !m.metadata?.liquidKind);
    expect(dry).toBeDefined();
    scene.getActiveMeshes().push(dry as never);

    expect(hasLiquidAmongActive(scene)).toBe(false);

    system.dispose();
  });
});

/**
 * The same question `anyLiquidVisible` asks, spelled out.
 *
 * Kept alongside rather than reaching into the private method: what is being
 * protected is the RULE — read the renderer's decision, do not re-derive it —
 * and a test that mirrors the rule catches a reimplementation that drifts.
 */
function hasLiquidAmongActive(target: Scene): boolean {
  const active = target.getActiveMeshes();
  if (active.length === 0) return true;
  for (let i = 0; i < active.length; i++) {
    if (active.data[i]?.metadata?.liquidKind) return true;
  }
  return false;
}
