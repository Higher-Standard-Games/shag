import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { Effect } from "@babylonjs/core/Materials/effect";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waterPatch } from "../rendering/water/WaterProbeCache";
import { WaterSurfaceLighting, waterMapLights, waterSurfaceLights } from "../rendering/water/WaterSurfaceLighting";

let engine: NullEngine, scene: Scene, lighting: WaterSurfaceLighting;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  lighting = new WaterSurfaceLighting(scene);
});
afterEach(() => {
  lighting.dispose();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});
const source = (properties: Record<string, string>) => ({ classname: "light", properties });

it("parses authored coordinates/colour/range and excludes malformed and targeted lights", () => {
  const lights = waterMapLights([
    source({ origin: "10 20 100", _color: "255 128 0", light: "200" }),
    source({ origin: "0 0 100", target: "sun" }),
    source({ origin: "NaN 0 0" }),
    source({ origin: "0 0 0", light: "-1" }),
    { classname: "projectile", properties: { origin: "0 0 100" } },
  ]);
  expect(lights).toHaveLength(1);
  expect(lights[0].position.asArray()).toEqual([10, 100, 20]);
  expect(lights[0].range).toBe(200);
  expect(lights[0].colour).toEqual([2, 256 / 255, 0]);
});

function pool() {
  const root = new Mesh("world", scene);
  const water = CreateGround("pool", { width: 80, height: 80 }, scene);
  water.parent = root;
  water.metadata = { liquidKind: "water" };
  return { root, patch: waterPatch(water)! };
}

it("bakes visibility once, caps lights, owns only textures, ignores transient scene lights", () => {
  const { root, patch } = pool();
  const spy = vi.spyOn(RawTexture, "CreateRGBATexture");
  const sources = waterMapLights(Array.from({ length: 8 }, () => source({ origin: "0 0 100" })));
  lighting.prepare(root, [patch], sources);
  expect(lighting.lightCount).toBe(4);
  const bytes = spy.mock.calls[0][0] as Uint8Array;
  expect(bytes.every((v) => v === 255)).toBe(true);
  const flash = new PointLight("muzzle", new Vector3(0, 50, 0), scene);
  flash.intensity = 100;
  flash.metadata = { excludeFromWaterCapture: true };
  lighting.prepare(root, [patch], sources);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(scene.customRenderTargets).toHaveLength(0);
  lighting.dispose();
  expect(scene.textures).toHaveLength(0);
  expect(flash.isDisposed()).toBe(false);
});

it("hidden, non-pickable static walls block highlights; effects do not", () => {
  const { root, patch } = pool();
  const wall = CreateBox("wall", { width: 200, depth: 200, height: 10 }, scene);
  wall.parent = root;
  wall.position.y = 50;
  wall.isVisible = false;
  wall.isPickable = false;
  const spy = vi.spyOn(RawTexture, "CreateRGBATexture");
  const sources = waterMapLights([source({ origin: "0 0 100" })]);
  lighting.prepare(root, [patch], sources);
  expect((spy.mock.calls[0][0] as Uint8Array).every((v) => v === 0)).toBe(true);
  lighting.dispose();
  wall.metadata = { effectOwned: true };
  lighting.prepare(root, [patch], sources);
  const bytes = spy.mock.calls[1][0] as Uint8Array;
  expect(bytes[0]).toBe(255);
});

it("clears per-mesh uniforms on unlit patches and rejects underwater/out-of-range sources", () => {
  const { root, patch } = pool();
  lighting.prepare(
    root,
    [patch],
    waterMapLights([source({ origin: "0 0 -100" }), source({ origin: "0 0 100", range: "20" })]),
  );
  expect(lighting.lightCount).toBe(0);
  const effect = { setTexture: vi.fn(), setFloatArray4: vi.fn(), setVector3: vi.fn() };
  lighting.bind(effect as unknown as Effect, patch);
  expect(effect.setFloatArray4.mock.calls[0][1]).toEqual(new Float32Array(16));
  expect(effect.setTexture).toHaveBeenCalledOnce();
});

it("only uses emitting panels facing the pool, with cached-room colour enabled", () => {
  const { root, patch } = pool();
  const panel = {
    position: new Vector3(0, 100, 0),
    normal: new Vector3(0, -1, 0),
    width: 32,
    height: 32,
    area: 1024,
    textureName: "light-panel",
    textureIndex: 0,
    surfaceLight: 300,
  };
  const sources = waterSurfaceLights([
    panel,
    { ...panel, surfaceLight: 0 },
    { ...panel, normal: new Vector3(0, 1, 0) },
  ]);
  expect(sources).toHaveLength(2);
  expect(sources[0].position.y).toBe(98);
  const effect = { setTexture: vi.fn(), setFloatArray4: vi.fn(), setVector3: vi.fn() };
  lighting.prepare(root, [patch], sources);
  expect(lighting.lightCount).toBe(1);
  lighting.bind(effect as unknown as Effect, patch);
  expect(effect.setFloatArray4.mock.calls[1][1][3]).toBe(1);
});
