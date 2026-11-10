import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import { BrushModelState, extractBrushModels } from "../../shared/bsp/BrushModelState";
import { EntityHandlerRegistry } from "../core/EntityHandlerRegistry";
import {
  registerBspEntityHandlers,
  setCurrentBspForHandlers,
  unregisterBspEntityHandlers,
} from "../loader/bsp/BspEntityHandlers";
import { liftBsp } from "./fixtures/liftBsp";

const context = vi.hoisted(() => ({ state: undefined as BrushModelState | undefined }));
vi.mock("../physics/CollisionManager", () => ({
  getCollisionManager: () => ({ getSweepBackend: () => ({ brushModels: context.state }) }),
}));
vi.mock("../loader/bsp/BspMeshBuilder", () => ({
  buildBrushModel: async (_bsp: unknown, _index: number, scene: Scene, name: string) => new Mesh(name, scene),
}));

describe("explosive brush rendering", () => {
  it("follows authoritative enabled state and cleans its observer on disposal", async () => {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      bsp = liftBsp();
    bsp.entities = [{ classname: "func_explosive", properties: { model: "*1" } }];
    context.state = new BrushModelState(extractBrushModels(bsp.entities, bsp.models));
    setCurrentBspForHandlers(bsp);
    registerBspEntityHandlers();
    try {
      const before = scene.onBeforeRenderObservable.observers.length;
      const handler = EntityHandlerRegistry.getHandler("func_explosive");
      const result = await handler!(bsp.entities[0], scene);
      expect(result.node?.isEnabled()).toBe(true);
      context.state.restore([1]);
      scene.onBeforeRenderObservable.notifyObservers(scene);
      expect(result.node?.isEnabled()).toBe(false);
      context.state.reset();
      scene.onBeforeRenderObservable.notifyObservers(scene);
      expect(result.node?.isEnabled()).toBe(true);
      result.node?.dispose();
      expect(scene.onBeforeRenderObservable.observers.filter((o) => !o._willBeUnregistered).length).toBe(before);
    } finally {
      unregisterBspEntityHandlers();
      setCurrentBspForHandlers(null);
      scene.dispose();
      engine.dispose();
      context.state = undefined;
    }
  });
});

describe("static brush rendering", () => {
  it("builds a func_static's brush model as map scenery, and refuses the world model", async () => {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      bsp = liftBsp();
    setCurrentBspForHandlers(bsp);
    registerBspEntityHandlers();
    try {
      const handler = EntityHandlerRegistry.getHandler("func_static");
      const result = await handler!({ classname: "func_static", properties: { model: "*1" } }, scene);
      expect(result.handled).toBe(true);
      expect(result.node?.name).toBe("func_static_1");
      expect(result.node?.metadata).toMatchObject({ mapOwned: true, entityType: "func_static" });
      expect((await handler!({ classname: "func_static", properties: { model: "*0" } }, scene)).handled).toBe(false);
    } finally {
      unregisterBspEntityHandlers();
      setCurrentBspForHandlers(null);
      scene.dispose();
      engine.dispose();
    }
  });
});
