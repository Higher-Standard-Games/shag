import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityHandlerRegistry } from "../../../core/EntityHandlerRegistry";
import { SkyLightSystem } from "../../../lighting/SkyLightSystem";
import { getCollisionManager } from "../../../physics";
import { ContentFlags } from "../../../physics/ContentFlags";
import RenderVars from "../../../rendering/RenderVars";
import * as EffectPreloader from "../../../weapon/EffectPreloader";
import { AssetPreloader } from "../../AssetPreloader";
import { clearGameMapEntities, registerGameMapEntities } from "../../map/GameMapEntities";
import { MapLoader } from "../../map/MapLoader";
import { PK3Index } from "../../pk3/PK3Index";
import { PK3Loader } from "../../pk3/PK3Loader";
import { PK3TextureLoader } from "../../pk3/PK3TextureLoader";
import { Q3ShaderRegistry } from "../../shader/Q3ShaderRegistry";
import type { ResolvedMaterialProps } from "../../shader/Q3ShaderTypes";
import * as BspEntityHandlers from "../BspEntityHandlers";
import { type BspFile, BspLoader } from "../BspLoader";
import { BspManager } from "../BspManager";
import { BspMeshBuilder, type BspMeshBuildResult } from "../BspMeshBuilder";
import { buildFaceClusters } from "../mesh/pvs";
import { faceSpatialCell, normalizeSpatialCellSize } from "../mesh/spatialBatching";
import { createPVSCuller, PVSCuller } from "../PVSCuller";

vi.mock("../../../physics/PhysicsSystem", () => ({
  PhysicsSystem: { getInstance: () => ({ createStaticBody: () => {} }) },
}));

/** Two rooms divided at x=0; neither room sees the other. */
function fixture(): BspFile {
  return {
    header: { magic: 0x50534249, version: 46, isFBSP: false },
    lumps: [],
    entities: [],
    brushes: [],
    brushSides: [],
    leafBrushes: [],
    textures: [0, 1].map((i) => ({ name: `textures/pvs/stone${i}`, contentFlags: 0, surfaceFlags: 0 })),
    planes: [{ normal: [1, 0, 0], dist: 0 }],
    nodes: [{ planeIndex: 0, children: [-1, -2], mins: [-10, -10, -10], maxs: [10, 10, 10] }],
    leafs: [0, 1].map((cluster) => ({
      cluster,
      area: 0,
      mins: [-10, -10, -10],
      maxs: [10, 10, 10],
      firstLeafFace: cluster,
      numLeafFaces: 1,
      firstLeafBrush: 0,
      numLeafBrushes: 0,
    })),
    leafFaces: [0, 1],
    models: [{ mins: [-10, -10, -10], maxs: [10, 10, 10], firstFace: 0, numFaces: 3, firstBrush: 0, numBrushes: 0 }],
    vertices: Array.from({ length: 9 }, (_, i) => ({
      position: [i < 3 ? 2 : -2, i % 3 === 1 ? 1 : 0, i % 3 === 2 ? 1 : 0],
      normal: [1, 0, 0],
      texCoord: [0, 0],
      lightmapCoord: [0, 0],
      color: [255, 255, 255, 255],
    })),
    meshVerts: [0, 1, 2, 0, 1, 2, 0, 1, 2],
    faces: [0, 1, 2].map((i) => ({
      textureIndex: i === 2 ? 1 : 0,
      effectIndex: -1,
      faceType: 1,
      firstVertex: i * 3,
      numVertices: 3,
      firstMeshVert: i * 3,
      numMeshVerts: 3,
      lightmapIndex: -1,
      lightmapStart: [0, 0],
      lightmapSize: [0, 0],
      lightmapOrigin: [0, 0, 0],
      lightmapVecs: [
        [0, 0, 0],
        [0, 0, 0],
      ],
      normal: [1, 0, 0],
      patchSize: [0, 0],
    })),
    effects: [],
    lightmaps: [],
    lightVols: [],
    lightmapSize: 128,
    visData: { numClusters: 2, bytesPerCluster: 1, bitVectors: new Uint8Array([1, 2]) },
  };
}

let engine: NullEngine;
let scene: Scene;
let bsp: BspFile;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  bsp = fixture();
});

afterEach(() => {
  BspManager.reset();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

function roomMeshes() {
  const world = new Mesh("world", scene);
  const front = new Mesh("front", scene);
  const back = new Mesh("back", scene);
  front.parent = back.parent = world;
  front.metadata = { bspPvsClusters: [0] };
  back.metadata = { bspPvsClusters: [1] };
  return { world, front, back };
}

function registered() {
  const meshes = roomMeshes();
  const culler = new PVSCuller(bsp);
  culler.registerFromWorldMesh(meshes.world);
  return { ...meshes, culler };
}

/** A 1,024-triangle material batch crossing two rooms, plus an unassigned face. */
function largeBatchFixture(): void {
  const indices = Array.from({ length: 512 * 3 }, (_, i) => i % 3);
  bsp.meshVerts = [...indices, ...indices, 0, 1, 2];
  bsp.faces[0].numMeshVerts = indices.length;
  bsp.faces[1].numMeshVerts = indices.length;
  bsp.faces[1].firstMeshVert = indices.length;
  bsp.faces[2].firstMeshVert = indices.length * 2;
}

describe("optional spatial BSP grouping", () => {
  it("splits a large opaque batch without changing vertex channels or triangle winding", () => {
    largeBatchFixture();
    const baseline = BspMeshBuilder.build(bsp, scene);
    const original = baseline.worldMesh.getChildMeshes().find((mesh) => mesh.metadata.textureIndex === 0)!;
    const split = BspMeshBuilder.build(bsp, scene, { spatialCellSize: 1024 });
    const parts = split.worldMesh.getChildMeshes().filter((mesh) => mesh.metadata.textureIndex === 0);
    expect(parts).toHaveLength(2);
    expect(split.stats).toEqual(baseline.stats);
    for (const kind of [
      VertexBuffer.PositionKind,
      VertexBuffer.NormalKind,
      VertexBuffer.UVKind,
      VertexBuffer.UV2Kind,
      VertexBuffer.ColorKind,
    ]) {
      expect(parts.flatMap((mesh) => Array.from(mesh.getVerticesData(kind) ?? []))).toEqual(
        Array.from(original.getVerticesData(kind) ?? []),
      );
    }
    const offset = parts[0].getTotalVertices();
    expect([...parts[0].getIndices()!, ...Array.from(parts[1].getIndices()!, (index) => index + offset)]).toEqual(
      Array.from(original.getIndices()!),
    );
    expect(parts.map((mesh) => mesh.metadata.bspPvsClusters)).toEqual([[0], [1]]);
    const culler = new PVSCuller(bsp);
    culler.registerFromWorldMesh(split.worldMesh);
    expect(culler.update(new Vector3(2, 0, 0)).visibleMeshes).toBe(2);
    expect(parts.map((mesh) => mesh.isVisible)).toEqual([true, false]);
    expect(culler.update(new Vector3(-2, 0, 0)).visibleMeshes).toBe(2);
    expect(parts.map((mesh) => mesh.isVisible)).toEqual([false, true]);
    culler.dispose();
  });

  it("keeps small groups merged and retains their full cluster union", () => {
    const result = BspMeshBuilder.build(bsp, scene, { spatialCellSize: 1024 });
    const meshes = result.worldMesh.getChildMeshes();
    expect(meshes).toHaveLength(2);
    expect(meshes.find((mesh) => mesh.metadata.textureIndex === 0)?.metadata.bspPvsClusters).toEqual([0, 1]);
    expect(meshes.every((mesh) => mesh.metadata.bspSpatialCell === null)).toBe(true);
  });

  it.each<Partial<ResolvedMaterialProps>>([
    { isTransparent: true },
    { alphaMode: "add" },
    { needsAnimation: true },
    { polygonOffset: true },
    { autosprite: true },
  ])("preserves special-surface grouping for %j", (overrides) => {
    largeBatchFixture();
    const registry = Q3ShaderRegistry.getInstance();
    const props = registry.resolveMaterialProps(bsp.textures[0].name);
    vi.spyOn(registry, "resolveMaterialProps").mockReturnValue({ ...props, ...overrides });
    const baseline = BspMeshBuilder.build(bsp, scene);
    const split = BspMeshBuilder.build(bsp, scene, { spatialCellSize: 1024 });
    expect(split.worldMesh.getChildMeshes().length).toBe(baseline.worldMesh.getChildMeshes().length);
    expect(split.stats).toEqual(baseline.stats);
    expect(split.worldMesh.getChildMeshes().some((mesh) => mesh.metadata.bspSpatialCell)).toBe(false);
  });

  it("keeps liquids out of spatial splitting", () => {
    largeBatchFixture();
    bsp.textures[0].contentFlags = ContentFlags.WATER;
    const liquid = BspMeshBuilder.build(bsp, scene, { spatialCellSize: 1024 });
    expect(liquid.worldMesh.getChildMeshes()).toHaveLength(2);
    expect(liquid.worldMesh.getChildMeshes()[0].metadata.liquidKind).toBe("water");
  });

  it("splits a fogged material and carries the fog to every cell", () => {
    // Fog is a per-material association taken from the first fogged face. A
    // split must not leave it on whichever cell happened to contain that face:
    // the others belong to the same material and have to look the same.
    //
    // This replaces a rule that refused to split any texture with a fogged face
    // anywhere. On wbomb6 that held back 12,651 of 21,584 faces while only 1,546
    // are in a fog volume — most of the map excluded over a handful of faces.
    largeBatchFixture();
    bsp.textures[0].contentFlags = 0;
    bsp.faces[0].effectIndex = 0;

    const baseline = BspMeshBuilder.build(bsp, scene);
    const split = BspMeshBuilder.build(bsp, scene, { spatialCellSize: 1024 });

    const parts = split.worldMesh.getChildMeshes().filter((mesh) => mesh.metadata.textureIndex === 0);
    expect(parts.length).toBeGreaterThan(1);
    // Geometry is untouched by the regrouping; only the batching changed.
    expect(split.stats).toEqual(baseline.stats);

    const original = baseline.worldMesh.getChildMeshes().find((mesh) => mesh.metadata.textureIndex === 0)!;
    for (const part of parts) {
      expect(part.metadata.fogParams).toEqual(original.metadata.fogParams);
    }
  });

  it("keeps lightmap groups separate while loading each texture once for all chunks", async () => {
    largeBatchFixture();
    bsp.faces[2].textureIndex = 0;
    bsp.faces[2].lightmapIndex = 1;
    const result = BspMeshBuilder.build(bsp, scene, { spatialCellSize: 1024 });
    const meshes = result.worldMesh.getChildMeshes();
    expect(meshes.map((mesh) => mesh.metadata.lightmapIndex)).toEqual([-1, -1, 1]);
    expect(result.textureGroups).toEqual([{ textureIndex: 0, textureName: bsp.textures[0].name }]);
    const texture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false);
    const loader = PK3TextureLoader.getInstance();
    const resolve = vi
      .spyOn(loader, "resolveAndLoadTexture")
      .mockImplementation(async (name) => (name === bsp.textures[0].name ? texture : null));
    await BspMeshBuilder.applyTextures(result, bsp, scene, undefined, { pbr: false });
    expect(resolve.mock.calls.filter(([name]) => name === bsp.textures[0].name)).toHaveLength(1);
    expect(
      meshes.every((mesh) => mesh.material instanceof StandardMaterial && mesh.material.diffuseTexture === texture),
    ).toBe(true);
    expect(meshes.map((mesh) => mesh.metadata.bspPvsClusters)).toEqual([[0], [1], [-1]]);
  });

  it("normalizes the option and rejects non-finite face bounds", () => {
    expect([0, -1, NaN, Infinity].map(normalizeSpatialCellSize)).toEqual([0, 0, 0, 0]);
    expect(normalizeSpatialCellSize(1)).toBe(128);
    expect(normalizeSpatialCellSize(9999)).toBe(4096);
    expect(faceSpatialCell(bsp, bsp.faces[1], 1024)).toBe("-1,0,0");
    bsp.vertices[0].position[0] = NaN;
    expect(faceSpatialCell(bsp, bsp.faces[0], 1024)).toBeNull();
  });
});

describe("compiled PVS membership", () => {
  it("retains all leaf references, deduplicates them and fails open for unassigned faces", () => {
    bsp.leafFaces = [0, 0, 0, 1];
    bsp.leafs[0].numLeafFaces = 2;
    bsp.leafs[1].firstLeafFace = 2;
    bsp.leafs[1].numLeafFaces = 2;
    expect(buildFaceClusters(bsp)).toEqual([[0, 1], [1], [-1]]);
    bsp.leafs[1].cluster = 50;
    expect(buildFaceClusters(bsp)).toEqual([[0, -1], [-1], [-1]]);
  });

  it("builds a multi-room material batch with the union of its actual face clusters", () => {
    const result = BspMeshBuilder.build(bsp, scene);
    const batches = result.worldMesh.getChildMeshes();
    expect(batches).toHaveLength(2);
    expect(batches.find((m) => m.metadata.textureIndex === 0)?.metadata.bspPvsClusters).toEqual([0, 1]);
    expect(batches.find((m) => m.metadata.textureIndex === 1)?.metadata.bspPvsClusters).toEqual([-1]);
    const culler = new PVSCuller(bsp);
    culler.registerFromWorldMesh(result.worldMesh);
    expect(culler.update(new Vector3(2, 0, 0)).visibleMeshes).toBe(2);
    expect(culler.update(new Vector3(-2, 0, 0)).visibleMeshes).toBe(2);
  });

  it("ignores untagged mover descendants and preserves initially hidden surfaces", () => {
    const { world, front, culler } = registered();
    const mover = new Mesh("moving-door", scene);
    mover.parent = world;
    front.isVisible = false;
    // Finish the previous registration before changing its owned visibility.
    culler.dispose();
    front.isVisible = false;
    culler.registerFromWorldMesh(world);
    culler.update(new Vector3(-1, 0, 0));
    culler.update(new Vector3(1, 0, 0));
    expect(mover.isVisible).toBe(true);
    expect(culler.getStats().totalMeshes).toBe(2);
    expect(front.isVisible).toBe(false);
    culler.setEnabled(false);
    expect(front.isVisible).toBe(false);
  });
});

describe("PVS frame updates", () => {
  it("updates visibility across a sub-unit cluster crossing", () => {
    const { front, back, culler } = registered();
    culler.update(new Vector3(0.1, 0, 0));
    expect([front.isVisible, back.isVisible]).toEqual([true, false]);
    culler.update(new Vector3(-0.1, 0, 0));
    expect([front.isVisible, back.isVisible]).toEqual([false, true]);
  });

  it("performs no mesh visibility reads on stationary or same-cluster frames", () => {
    const { front, back, culler } = registered();
    const expected = culler.update(new Vector3(1, 0, 0));
    const frontRead = vi.spyOn(front, "isVisible", "get");
    const backRead = vi.spyOn(back, "isVisible", "get");
    const leafLookup = vi.spyOn(culler, "findClusterAtPosition");
    expect(culler.update(new Vector3(1, 0, 0))).toEqual(expected);
    expect(leafLookup).not.toHaveBeenCalled();
    expect(culler.update(new Vector3(100, 0, 0))).toEqual(expected);
    expect(leafLookup).toHaveBeenCalledOnce();
    expect(frontRead).not.toHaveBeenCalled();
    expect(backRead).not.toHaveBeenCalled();
  });

  it("reapplies invalidated visibility and restores it on disable/re-enable", () => {
    const { front, back, culler } = registered();
    const position = new Vector3(1, 0, 0);
    culler.update(position);
    back.isVisible = true;
    culler.invalidate();
    culler.update(position);
    expect(back.isVisible).toBe(false);
    culler.setEnabled(false);
    expect([front.isVisible, back.isVisible]).toEqual([true, true]);
    expect(culler.update(position).visibleMeshes).toBe(2);
    culler.setEnabled(true);
    expect(culler.update(position).culledMeshes).toBe(1);
  });

  it("fails open for missing cameras, invalid camera clusters and malformed PVS", () => {
    const { front, back, culler } = registered();
    culler.update(new Vector3(1, 0, 0));
    expect(culler.update(null).visibleMeshes).toBe(2);
    culler.update(new Vector3(-1, 0, 0));
    bsp.leafs[0].cluster = 999;
    expect(culler.update(new Vector3(1, 0, 0)).visibleMeshes).toBe(2);
    expect([front.isVisible, back.isVisible]).toEqual([true, true]);
    bsp.visData!.bitVectors = new Uint8Array([1]);
    expect(createPVSCuller(bsp)).toBeNull();
    bsp.visData = null;
    expect(createPVSCuller(bsp)).toBeNull();
  });

  it("releases culled surfaces on re-registration and disposal without retaining old meshes", () => {
    const { front, back, culler } = registered();
    culler.update(new Vector3(1, 0, 0));
    culler.registerClusterMeshes([{ cluster: 1, meshes: [front, front] }]);
    expect(back.isVisible).toBe(true);
    expect(culler.getStats().totalMeshes).toBe(1);
    culler.update(new Vector3(1, 0, 0));
    expect(front.isVisible).toBe(false);
    culler.dispose();
    expect(front.isVisible).toBe(true);
    expect(culler.getStats().totalMeshes).toBe(0);
  });
});

function managerWithWorld() {
  const meshes = roomMeshes();
  const manager = BspManager.getInstance();
  manager.setBsp("test", bsp);
  manager.setMeshResult({ worldMesh: meshes.world, lightmapTextures: [] } as unknown as BspMeshBuildResult);
  const camera = new FreeCamera("camera", new Vector3(1, 0, 0), scene);
  scene.activeCamera = camera;
  return { ...meshes, manager, camera };
}

const frameObserverCount = () => scene.onBeforeRenderObservable.observers.filter((o) => !o._willBeUnregistered).length;

describe("PVS camera and map lifetime", () => {
  it("follows camera swaps and parented world positions; multi-view falls back to all surfaces", async () => {
    const { front, back, manager, camera } = managerWithWorld();
    await manager.enablePVS(scene, camera);
    expect([front.isVisible, back.isVisible]).toEqual([true, false]);
    const other = new FreeCamera("other", new Vector3(1, 0, 0), scene);
    const parent = new TransformNode("camera-rig", scene);
    parent.position.x = -10;
    other.parent = parent;
    scene.activeCamera = other;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect([front.isVisible, back.isVisible]).toEqual([false, true]);
    expect(await manager.getCameraClusterInfo(other)).toContain("Cluster: 1");
    scene.activeCameras = [camera, other];
    scene.onBeforeRenderObservable.notifyObservers(scene);
    manager.getPVSStatus(camera);
    expect([front.isVisible, back.isVisible]).toEqual([true, true]);
    scene.activeCameras = [];
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect([front.isVisible, back.isVisible]).toEqual([false, true]);
  });

  it("uses the world camera across weapon-overlay frames", async () => {
    const { front, back, manager, camera } = managerWithWorld();
    const weapon = new FreeCamera("weapon", new Vector3(-1, 0, 0), scene);
    weapon.layerMask = 0x10000000;
    scene.activeCameras = [camera, weapon];
    scene.activeCamera = weapon;
    await manager.enablePVS(scene, camera);
    expect([front.isVisible, back.isVisible]).toEqual([true, false]);
    camera.position.x = -1;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect([front.isVisible, back.isVisible]).toEqual([false, true]);
    scene.activeCameras = [weapon];
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect([front.isVisible, back.isVisible]).toEqual([true, true]);
  });

  it("does not duplicate observers and detaches on world disposal/map replacement", async () => {
    const { world, manager, camera } = managerWithWorld();
    const before = frameObserverCount();
    await manager.enablePVS(scene, camera);
    await manager.enablePVS(scene, camera);
    expect(frameObserverCount()).toBe(before + 1);
    world.dispose();
    expect(frameObserverCount()).toBe(before);
    expect(manager.getPVSCuller()).toBeNull();
    const replacement = roomMeshes();
    manager.setMeshResult({ worldMesh: replacement.world, lightmapTextures: [] } as unknown as BspMeshBuildResult);
    await manager.enablePVS(scene, camera);
    expect(frameObserverCount()).toBe(before + 1);
    manager.setBsp("next-map", fixture());
    expect(frameObserverCount()).toBe(before);
    expect(manager.getPVSCuller()).toBeNull();
    expect(replacement.back.isVisible).toBe(true);
  });

  it("removes the original scene observer on disable and unload", async () => {
    const { back, manager, camera } = managerWithWorld();
    const before = frameObserverCount();
    await manager.enablePVS(scene, camera);
    const anotherScene = new Scene(engine);
    manager.disablePVS(anotherScene);
    expect(frameObserverCount()).toBe(before);
    expect(back.isVisible).toBe(true);
    anotherScene.dispose();
    await manager.enablePVS(scene, camera);
    manager.unload();
    expect(frameObserverCount()).toBe(before);
    expect(manager.getPVSCuller()).toBeNull();
  });

  it("releases a disabled culler when its world is disposed", async () => {
    const { world, manager, camera } = managerWithWorld();
    await manager.enablePVS(scene, camera);
    manager.disablePVS(scene);
    expect(manager.getPVSCuller()).not.toBeNull();
    world.dispose();
    expect(manager.getPVSCuller()).toBeNull();
  });
});

describe("default PVS through gameplay MapLoader", () => {
  let loader: MapLoader;

  beforeEach(() => {
    // Exercise the real load sequence, mesh builder, culler and teardown with a
    // tiny indexed BSP. Asset I/O, GPU warmup and gameplay services are stubbed.
    vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    bsp.faces = bsp.faces.slice(0, 2);
    bsp.faces[1].textureIndex = 1;
    bsp.models[0].numFaces = 2;
    vi.spyOn(PK3Index.getInstance(), "findMap").mockReturnValue("map_test.pk3");
    vi.spyOn(PK3Loader.getInstance(), "getPackageInfo").mockReturnValue([]);
    vi.spyOn(PK3Loader.getInstance(), "ensurePK3").mockResolvedValue(undefined);
    vi.spyOn(PK3Loader.getInstance(), "ensurePK3FromUrl").mockResolvedValue(undefined);
    vi.spyOn(BspLoader, "loadFromPK3").mockImplementation(async () => bsp);
    vi.spyOn(Q3ShaderRegistry.getInstance(), "loadShaders").mockResolvedValue(0);
    vi.spyOn(BspMeshBuilder, "applyTextures").mockResolvedValue(0);
    vi.spyOn(SkyLightSystem.getInstance(), "init").mockImplementation(() => {});
    vi.spyOn(SkyLightSystem.getInstance(), "setBspMode").mockImplementation(() => {});
    vi.spyOn(getCollisionManager(), "init").mockResolvedValue(undefined);
    vi.spyOn(AssetPreloader.getInstance(), "preloadFromBsp").mockResolvedValue(0);
    vi.spyOn(EffectPreloader, "preloadEffectShaders").mockResolvedValue(undefined);
    vi.spyOn(scene, "isReady").mockReturnValue(true);
    vi.spyOn(BspEntityHandlers, "registerBspEntityHandlers").mockImplementation(() => {});
    registerGameMapEntities({ initializeDefinitions() {}, registerHandlers() {}, disposeMapEntities() {} });
    vi.spyOn(EntityHandlerRegistry, "runPreRenderHooks").mockResolvedValue(undefined);
    vi.spyOn(RenderVars.getInstance(), "get").mockReturnValue(0);
    loader = MapLoader.getInstance();
  });

  afterEach(async () => {
    await loader.disposeCurrentMap();
    clearGameMapEntities();
    BspEntityHandlers.setCurrentBspForHandlers(null);
    vi.unstubAllGlobals();
  });

  it("initializes game definitions before model discovery and handlers before entity dispatch", async () => {
    const order: string[] = [];
    registerGameMapEntities({
      initializeDefinitions() {
        order.push("definitions");
      },
      registerHandlers() {
        order.push("handlers");
      },
      disposeMapEntities() {},
    });
    const internals = loader as unknown as { resolveEntityModelDependencies(bsp: BspFile): string[] };
    vi.spyOn(internals, "resolveEntityModelDependencies").mockImplementation(() => {
      order.push("dependencies");
      return [];
    });
    vi.spyOn(AssetPreloader.getInstance(), "preloadFromBsp").mockImplementation(async () => {
      order.push("preload");
      return 0;
    });
    vi.spyOn(EntityHandlerRegistry, "runPreRenderHooks").mockImplementation(async () => {
      order.push("dispatch");
    });
    const loaded = await loader.loadMap("test", scene);
    expect(loaded.success).toBe(true);
    expect(order).toEqual(["definitions", "dependencies", "preload", "handlers", "dispatch"]);
  });

  it("uploads newly visible billboards in the same frame as a PVS boundary crossing", async () => {
    const vertex = bsp.vertices[0];
    bsp.vertices = [2, -2].flatMap((x) =>
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([y, z]) => ({
        ...vertex,
        position: [x, y, z] as [number, number, number],
      })),
    );
    bsp.meshVerts = [0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3];
    bsp.faces = bsp.faces.map((face, i) => ({
      ...face,
      firstVertex: i * 4,
      numVertices: 4,
      firstMeshVert: i * 6,
      numMeshVerts: 6,
    }));
    const registry = Q3ShaderRegistry.getInstance();
    const resolve = registry.resolveMaterialProps.bind(registry);
    vi.spyOn(registry, "resolveMaterialProps").mockImplementation((name, options) => ({
      ...resolve(name, options),
      autosprite: true,
    }));
    const camera = new FreeCamera("eye", new Vector3(0.1, 0, 10), scene);
    const loaded = await loader.loadMap("test", scene);
    expect(loaded.success).toBe(true);
    const sprites = loaded.meshResult!.autospriteMeshes!;
    expect(sprites).toHaveLength(2);
    const uploads = sprites.map(({ mesh }) => vi.spyOn(mesh, "updateVerticesData"));
    const expectUploads = (counts: number[]) => {
      for (const kind of [VertexBuffer.PositionKind, VertexBuffer.NormalKind])
        expect(uploads.map((upload) => upload.mock.calls.filter(([buffer]) => buffer === kind).length)).toEqual(counts);
    };
    const frame = () => {
      scene.onBeforeRenderObservable.notifyObservers(scene);
      scene.onBeforeCameraRenderObservable.notifyObservers(camera);
    };
    frame();
    expectUploads([1, 0]);
    camera.position.x = -0.1;
    frame();
    expectUploads([1, 1]);
    frame();
    expectUploads([1, 1]);
    BspManager.getInstance().disablePVS(scene);
    frame();
    expectUploads([2, 1]);
  });

  it("enables PVS after setup, supports off, and re-enables on the next map", async () => {
    const manager = BspManager.getInstance();
    const camera = new FreeCamera("eye", new Vector3(1, 0, 0), scene);
    scene.activeCamera = camera;
    const cullersDuringSetup: (PVSCuller | null)[] = [];
    const frozenDuringSetup: boolean[] = [];
    vi.mocked(scene.isReady).mockImplementation(() => {
      cullersDuringSetup.push(manager.getPVSCuller());
      frozenDuringSetup.push(scene.meshes.some((mesh) => mesh.material?.isFrozen));
      return true;
    });
    bsp.entities = [{ classname: "info_player_start", properties: {} }];
    vi.spyOn(EntityHandlerRegistry, "getHandler").mockReturnValue(async () => {
      cullersDuringSetup.push(manager.getPVSCuller());
      return { handled: true };
    });

    const loaded = await loader.loadMap("test", scene);
    expect(loaded.success).toBe(true);
    expect(cullersDuringSetup.length).toBeGreaterThanOrEqual(2);
    expect(cullersDuringSetup.every((culler) => culler === null)).toBe(true);
    expect(frozenDuringSetup.every((frozen) => !frozen)).toBe(true);
    expect(loaded.meshResult!.worldMesh.getChildMeshes().every((mesh) => mesh.material?.isFrozen)).toBe(true);
    expect(manager.getPVSStatus()).toContain("Enabled: YES");
    expect(manager.getPVSCuller()?.getStats()).toMatchObject({ totalMeshes: 2, visibleMeshes: 1 });
    const previous = manager.getPVSCuller();
    manager.disablePVS(scene);
    camera.position.x = -1;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(manager.getPVSCuller()?.getStats()).toMatchObject({ enabled: false, visibleMeshes: 2 });

    expect((await loader.loadMap("next", scene)).success).toBe(true);
    expect(cullersDuringSetup.length).toBeGreaterThanOrEqual(4);
    expect(cullersDuringSetup.every((culler) => culler === null)).toBe(true);
    expect(manager.getPVSCuller()).not.toBe(previous);
    expect(previous?.getStats().totalMeshes).toBe(0);
    expect(manager.getPVSCuller()?.getStats()).toMatchObject({ enabled: true, currentCluster: 1, visibleMeshes: 1 });
    await loader.disposeCurrentMap();
    expect(manager.getPVSCuller()).toBeNull();
  });

  it("reports a failed map instead of entering gameplay when rendering never becomes ready", async () => {
    vi.useFakeTimers();
    vi.mocked(scene.isReady).mockReturnValue(false);
    let waiting = false;
    try {
      const pending = loader.loadMap("test", scene, (progress) => {
        if (progress.detail === "Waiting for GPU readiness") waiting = true;
      });
      await vi.waitFor(() => expect(waiting).toBe(true));
      await vi.advanceTimersByTimeAsync(16000);
      const result = await pending;
      expect(result.success).toBe(false);
      expect(result.error).toContain("Map rendering did not become ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits conservatively for a camera and starts culling when the eye is assigned", async () => {
    const manager = BspManager.getInstance();
    expect((await loader.loadMap("test", scene)).success).toBe(true);
    expect(manager.getPVSCuller()?.getStats()).toMatchObject({ enabled: true, visibleMeshes: 2 });
    scene.activeCamera = new FreeCamera("late-eye", new Vector3(-1, 0, 0), scene);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(manager.getPVSCuller()?.getStats()).toMatchObject({ currentCluster: 1, visibleMeshes: 1 });
  });

  it.each(["missing", "malformed"])("loads without hiding surfaces when PVS data is %s", async (kind) => {
    if (kind === "missing") bsp.visData = null;
    else bsp.visData!.bitVectors = new Uint8Array([1]);
    expect((await loader.loadMap("test", scene)).success).toBe(true);
    expect(BspManager.getInstance().getPVSCuller()).toBeNull();
    expect(
      loader
        .getCurrentMeshResult()
        ?.worldMesh.getChildMeshes()
        .every((mesh) => mesh.isVisible),
    ).toBe(true);
  });

  it("does not register menu background maps with the gameplay PVS manager", async () => {
    const manager = BspManager.getInstance();
    const loaded = await loader.loadMap("test", scene, undefined, { backgroundOnly: true });
    expect(loaded.success).toBe(true);
    expect(manager.getBsp()).toBeNull();
    expect(manager.getPVSCuller()).toBeNull();
    expect(loaded.meshResult?.worldMesh.getChildMeshes().every((mesh) => mesh.isVisible)).toBe(true);
  });
});
