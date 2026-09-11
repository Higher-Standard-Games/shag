import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import { extractLifts, LiftSystem } from "../../shared/bsp/LiftSystem";
import { EntityHandlerRegistry } from "../core/EntityHandlerRegistry";
import {
  registerBspEntityHandlers,
  setCurrentBspForHandlers,
  unregisterBspEntityHandlers,
} from "../loader/bsp/BspEntityHandlers";
import { liftBsp } from "./fixtures/liftBsp";

const context = vi.hoisted(() => ({ lifts: undefined as LiftSystem | undefined }));
const audio = vi.hoisted(() => ({ played: [] as string[], preloaded: [] as string[] }));
vi.mock("../physics/CollisionManager", () => ({ getCollisionManager: () => ({ getLiftSystem: () => context.lifts }) }));
vi.mock("../AudioManager", () => ({
  AudioManager: {
    getInstance: () => ({
      preloadSfx: async (paths: readonly string[]) => {
        audio.preloaded.push(...paths);
      },
      playSfx3D: (path: string) => {
        audio.played.push(path);
      },
    }),
  },
}));
vi.mock("../loader/bsp/BspMeshBuilder", () => ({
  buildBrushModel: async (_bsp: unknown, _index: number, scene: Scene, name: string) => new Mesh(name, scene),
}));
describe("lift mesh follows collision state", () => {
  it("draws the lowered rest position, follows prediction and removes its observer on disposal", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const bsp = liftBsp();
    context.lifts = new LiftSystem(extractLifts(bsp.entities, bsp.models), () => ({
      fraction: 1,
      solid: false,
      normalY: 0,
      modelIndex: -1,
    }));
    setCurrentBspForHandlers(bsp);
    registerBspEntityHandlers();
    try {
      const before = scene.onBeforeRenderObservable.observers.length;
      const result = await EntityHandlerRegistry.getHandler("func_plat")!(bsp.entities[0], scene);
      expect(result.handled).toBe(true);
      expect(result.node!.position.y).toBe(-100);
      const state = context.lifts.snapshot();
      state[0].offset = -50;
      context.lifts.restore(state);
      scene.onBeforeRenderObservable.notifyObservers(scene);
      expect(result.node!.position.y).toBe(-50);
      expect(scene.onBeforeRenderObservable.observers.length).toBe(before + 1);
      result.node!.dispose();
      expect(scene.onBeforeRenderObservable.observers.filter((o) => !o._willBeUnregistered).length).toBe(before);
    } finally {
      unregisterBspEntityHandlers();
      setCurrentBspForHandlers(null);
      context.lifts = undefined;
      scene.dispose();
      engine.dispose();
    }
  });
  it("plays the move one-shot on departure and the arrive one-shot on stop, and is silent at rest", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const bsp = liftBsp();
    const lifts = new LiftSystem(extractLifts(bsp.entities, bsp.models), () => ({
      fraction: 1,
      solid: false,
      normalY: 0,
      modelIndex: -1,
    }));
    context.lifts = lifts;
    audio.played.length = 0;
    audio.preloaded.length = 0;
    const { sound, soundStop, modelIndex } = lifts.definitions[0];
    setCurrentBspForHandlers(bsp);
    registerBspEntityHandlers();
    try {
      const result = await EntityHandlerRegistry.getHandler("func_plat")!(bsp.entities[0], scene);
      expect(audio.preloaded).toEqual([sound, soundStop]);
      // The first frame only establishes a baseline — a resting lift makes no noise.
      scene.onBeforeRenderObservable.notifyObservers(scene);
      expect(audio.played).toEqual([]);
      const rider = { position: { x: 0, y: 24.03125, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
      lifts.step(1 / 60, [rider]);
      scene.onBeforeRenderObservable.notifyObservers(scene);
      expect(lifts.phase(modelIndex)).toBe("up");
      expect(audio.played).toEqual([sound]);
      for (let i = 0; i < 200 && lifts.phase(modelIndex) !== "top"; i++) lifts.step(1 / 60, [rider]);
      scene.onBeforeRenderObservable.notifyObservers(scene);
      expect(audio.played).toEqual([sound, soundStop]);
      result.node!.dispose();
    } finally {
      unregisterBspEntityHandlers();
      setCurrentBspForHandlers(null);
      context.lifts = undefined;
      scene.dispose();
      engine.dispose();
    }
  });
});
