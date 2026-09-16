/**
 * SpawnValidator smoke tests (QA matrix #10).
 *
 * SpawnValidator has no in-repo callers — it's a public engine API for
 * downstream game submodules (see docs/reference/prefabs.md and the
 * Architecture Context section of docs/research/0.9.13-QA-improvements.md).
 * These tests exist so the public surface is exercised in CI even when
 * no in-repo game uses it.
 *
 * Tested surface:
 *  - Singleton lifecycle (resettable between tests).
 *  - register / registerGlobal / unregister routing.
 *  - validate() global ordering + short-circuit on first denial.
 *  - validate(context, ids) runs named validators after globals.
 *  - disableCollisionCheck / enableCollisionCheck toggle.
 *  - Built-in CollisionValidator with mock scene.
 *  - Example ResourceCostValidator + MaxCountValidator paths.
 *
 * No Babylon scene is constructed; tests inject a minimal mock that
 * satisfies the SpawnValidationContext shape via `as unknown as Scene`.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CollisionValidator,
  type ISpawnValidator,
  MaxCountValidator,
  ResourceCostValidator,
  type SpawnValidationContext,
  type SpawnValidationResult,
  SpawnValidator,
} from "../SpawnValidator";

function resetSingleton() {
  // biome-ignore lint/suspicious/noExplicitAny: tests reach into private statics intentionally — see BuildableSystem.test.ts for the same pattern
  (SpawnValidator as any).instance = undefined;
}

function makeContext(overrides: Partial<SpawnValidationContext> = {}): SpawnValidationContext {
  const scene = {
    meshes: [],
    transformNodes: [],
  } as unknown as Scene;
  return {
    prefabName: "test_prefab",
    position: new Vector3(0, 0, 0),
    scene,
    triggerProperties: {},
    ...overrides,
  };
}

function makeValidator(id: string, result: SpawnValidationResult, calls?: { count: number }): ISpawnValidator {
  return {
    id,
    validate: vi.fn(() => {
      if (calls) calls.count++;
      return result;
    }),
  };
}

describe("SpawnValidator", () => {
  beforeEach(() => {
    resetSingleton();
  });

  describe("singleton + defaults", () => {
    it("returns the same instance from getInstance()", () => {
      const a = SpawnValidator.getInstance();
      const b = SpawnValidator.getInstance();
      expect(a).toBe(b);
    });

    it("registers the built-in collision validator globally by default", () => {
      const sv = SpawnValidator.getInstance();
      // Disabling proves the global was there; if it wasn't, the call is a no-op
      sv.disableCollisionCheck();
      // Re-enable and verify validate() with a non-empty mesh list would consult it
      sv.enableCollisionCheck(10);
      // Sanity: a validator with id "collision" can now be retrieved indirectly by
      // toggling — the public surface doesn't expose globals, but disable+enable
      // should not throw.
      expect(() => sv.validate(makeContext())).not.toThrow();
    });
  });

  describe("register / unregister", () => {
    it("register() stores a named validator retrievable via getValidator()", () => {
      const sv = SpawnValidator.getInstance();
      const v = makeValidator("named_one", { allowed: true });
      sv.register(v);
      expect(sv.getValidator("named_one")).toBe(v);
    });

    it("unregister(id) removes the named validator", () => {
      const sv = SpawnValidator.getInstance();
      sv.register(makeValidator("named_two", { allowed: true }));
      sv.unregister("named_two");
      expect(sv.getValidator("named_two")).toBeUndefined();
    });

    it("unregister(id) also removes a globally-registered validator", () => {
      const sv = SpawnValidator.getInstance();
      sv.disableCollisionCheck(); // drop the built-in so this test runs isolated
      const calls = { count: 0 };
      sv.registerGlobal(makeValidator("globe", { allowed: true }, calls));

      sv.validate(makeContext()); // should hit the global → count=1
      expect(calls.count).toBe(1);

      sv.unregister("globe");
      sv.validate(makeContext()); // should no longer hit it → still 1
      expect(calls.count).toBe(1);
    });
  });

  describe("validate() routing", () => {
    it("runs global validators in registration order", () => {
      const sv = SpawnValidator.getInstance();
      sv.disableCollisionCheck();
      const order: string[] = [];
      sv.registerGlobal({
        id: "g1",
        validate: () => {
          order.push("g1");
          return { allowed: true };
        },
      });
      sv.registerGlobal({
        id: "g2",
        validate: () => {
          order.push("g2");
          return { allowed: true };
        },
      });

      sv.validate(makeContext());
      expect(order).toEqual(["g1", "g2"]);
    });

    it("short-circuits on the first global denial and returns its reason", () => {
      const sv = SpawnValidator.getInstance();
      sv.disableCollisionCheck();
      const laterCalls = { count: 0 };
      sv.registerGlobal({
        id: "denier",
        validate: () => ({ allowed: false, reason: "nope" }),
      });
      sv.registerGlobal(makeValidator("later", { allowed: true }, laterCalls));

      const result = sv.validate(makeContext());

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("nope");
      expect(laterCalls.count).toBe(0);
    });

    it("runs named validators after globals when validatorIds is provided", () => {
      const sv = SpawnValidator.getInstance();
      sv.disableCollisionCheck();
      const order: string[] = [];
      sv.registerGlobal({
        id: "g",
        validate: () => {
          order.push("g");
          return { allowed: true };
        },
      });
      sv.register({
        id: "named",
        validate: () => {
          order.push("named");
          return { allowed: true };
        },
      });

      sv.validate(makeContext(), ["named"]);
      expect(order).toEqual(["g", "named"]);
    });

    it("ignores validatorIds entries that aren't registered and continues", () => {
      const sv = SpawnValidator.getInstance();
      sv.disableCollisionCheck();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = sv.validate(makeContext(), ["does_not_exist"]);

      expect(result.allowed).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("does_not_exist"));
      warn.mockRestore();
    });
  });

  describe("disable/enable collision check", () => {
    it("disableCollisionCheck removes the built-in collision validator", () => {
      const sv = SpawnValidator.getInstance();
      const calls = { count: 0 };
      // Replace the global "collision" with a tracker so we can observe whether it fires
      sv.disableCollisionCheck();
      sv.registerGlobal(makeValidator("collision", { allowed: true }, calls));
      sv.disableCollisionCheck(); // should drop our tracker since its id matches

      sv.validate(makeContext());
      expect(calls.count).toBe(0);
    });

    it("enableCollisionCheck re-adds the built-in if absent", () => {
      const sv = SpawnValidator.getInstance();
      sv.disableCollisionCheck();
      sv.enableCollisionCheck(8);

      // Spawn one prefab-like mesh near the origin so the built-in denies
      const meshes: Array<{
        parent: { name: string };
        name: string;
        getBoundingInfo: () => {
          boundingBox: { centerWorld: Vector3 };
          boundingSphere: { radiusWorld: number };
        };
      }> = [
        {
          parent: { name: "prefab_existing" },
          name: "existing_mesh",
          getBoundingInfo: () => ({
            boundingBox: { centerWorld: new Vector3(0, 0, 0) },
            boundingSphere: { radiusWorld: 100 },
          }),
        },
      ];
      const ctx = makeContext({ scene: { meshes, transformNodes: [] } as unknown as Scene });

      const result = sv.validate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("prefab");
    });
  });

  describe("CollisionValidator (built-in)", () => {
    it("allows a spawn when no other prefabs are present", () => {
      const v = new CollisionValidator(32);
      const ctx = makeContext();
      expect(v.validate(ctx).allowed).toBe(true);
    });

    it("denies a spawn that overlaps an existing prefab mesh", () => {
      const v = new CollisionValidator(8);
      const meshes = [
        {
          parent: { name: "prefab_existing" },
          name: "existing_mesh",
          getBoundingInfo: () => ({
            boundingBox: { centerWorld: new Vector3(5, 0, 0) },
            boundingSphere: { radiusWorld: 10 },
          }),
        },
      ];
      const ctx = makeContext({
        position: new Vector3(0, 0, 0),
        scene: { meshes, transformNodes: [] } as unknown as Scene,
      });

      const result = v.validate(ctx);
      expect(result.allowed).toBe(false);
    });

    it("skips meshes that are not prefab-parented", () => {
      const v = new CollisionValidator(32);
      const meshes = [
        {
          parent: { name: "world_geometry" }, // NOT prefab_ prefix
          name: "world_brush",
          getBoundingInfo: () => ({
            boundingBox: { centerWorld: new Vector3(0, 0, 0) },
            boundingSphere: { radiusWorld: 100 },
          }),
        },
      ];
      const ctx = makeContext({
        scene: { meshes, transformNodes: [] } as unknown as Scene,
      });

      expect(v.validate(ctx).allowed).toBe(true);
    });

    it("skips trigger meshes even when prefab-parented", () => {
      const v = new CollisionValidator(32);
      const meshes = [
        {
          parent: { name: "prefab_x" },
          name: "trigger_box", // contains "trigger"
          getBoundingInfo: () => ({
            boundingBox: { centerWorld: new Vector3(0, 0, 0) },
            boundingSphere: { radiusWorld: 100 },
          }),
        },
      ];
      const ctx = makeContext({
        scene: { meshes, transformNodes: [] } as unknown as Scene,
      });

      expect(v.validate(ctx).allowed).toBe(true);
    });
  });

  describe("ResourceCostValidator", () => {
    it("allows when player has enough of every cost_* resource", () => {
      const v = new ResourceCostValidator(() => ({ gold: 100, wood: 50 }));
      const ctx = makeContext({
        triggerProperties: { cost_gold: "30", cost_wood: "20" },
      });
      expect(v.validate(ctx).allowed).toBe(true);
    });

    it("denies when a single resource is insufficient and names it in the reason", () => {
      const v = new ResourceCostValidator(() => ({ gold: 10 }));
      const ctx = makeContext({
        triggerProperties: { cost_gold: "30" },
      });
      const result = v.validate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("gold");
      expect(result.reason).toContain("30");
      expect(result.reason).toContain("10");
    });

    it("treats absent resources as zero available", () => {
      const v = new ResourceCostValidator(() => ({}));
      const ctx = makeContext({
        triggerProperties: { cost_iron: "1" },
      });
      expect(v.validate(ctx).allowed).toBe(false);
    });

    it("ignores non-cost trigger properties", () => {
      const v = new ResourceCostValidator(() => ({ gold: 0 }));
      const ctx = makeContext({
        triggerProperties: { spawnflags: "1", maxCount: "5" },
      });
      expect(v.validate(ctx).allowed).toBe(true);
    });
  });

  describe("MaxCountValidator", () => {
    it("allows when count is below maxCount", () => {
      const v = new MaxCountValidator();
      const transformNodes = [{ name: "prefab_tower_001" }, { name: "prefab_other_001" }];
      const ctx = makeContext({
        prefabName: "tower",
        triggerProperties: { maxCount: "3" },
        scene: { meshes: [], transformNodes } as unknown as Scene,
      });
      expect(v.validate(ctx).allowed).toBe(true);
    });

    it("denies when count equals or exceeds maxCount", () => {
      const v = new MaxCountValidator();
      const transformNodes = [{ name: "prefab_tower_001" }, { name: "prefab_tower_002" }];
      const ctx = makeContext({
        prefabName: "tower",
        triggerProperties: { maxCount: "2" },
        scene: { meshes: [], transformNodes } as unknown as Scene,
      });
      const result = v.validate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("tower");
      expect(result.reason).toContain("2");
    });

    it("defaults to Infinity when maxCount is not provided (always allows)", () => {
      const v = new MaxCountValidator();
      const transformNodes = Array.from({ length: 1000 }, (_, i) => ({ name: `prefab_x_${i}` }));
      const ctx = makeContext({
        prefabName: "x",
        scene: { meshes: [], transformNodes } as unknown as Scene,
      });
      expect(v.validate(ctx).allowed).toBe(true);
    });
  });
});
