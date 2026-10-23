import { describe, expect, it, vi } from "vitest";
import { ProjectileManager } from "../ProjectileManager";

describe("projectile preparation", () => {
  it("loads each projectile and compiles every material its model has", async () => {
    const scene = {};
    const compile = vi.fn(async () => {});
    const withMaterial = { material: { forceCompilationAsync: compile } };
    const models = new Map([
      ["rocket", { meshes: [withMaterial, { material: null }] }],
      ["grenade", { meshes: [withMaterial] }],
    ]);
    const manager = Object.assign(Object.create(ProjectileManager.prototype), {
      scene,
      modelCache: { get: (id: string) => models.get(id) },
      preloadModel: vi.fn(async () => true),
    }) as ProjectileManager & { preloadModel: ReturnType<typeof vi.fn> };

    await manager.prepare(scene as never, ["rocket", "grenade", "plasma_bolt"]);

    expect(manager.preloadModel.mock.calls.map(([id]) => id)).toEqual(["rocket", "grenade", "plasma_bolt"]);
    // Two meshes with a material; a model that did not load has none to compile
    expect(compile).toHaveBeenCalledTimes(2);
  });
});
