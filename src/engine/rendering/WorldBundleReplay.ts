/**
 * Replays the static world's recorded WebGPU render bundles in the main view.
 *
 * In non-compatibility mode Babylon records each draw as a GPU render bundle
 * and replays it on later frames, but only after selecting the mesh, binding
 * its material, lights and mesh uniforms, and checking that the bundle still
 * matches: about 27 µs of JavaScript for each world surface, a quarter of a
 * frame on washoi_dm2. Most world surfaces cannot change between frames: their
 * materials are frozen, their world matrices are frozen and nothing animates
 * them per draw.
 *
 * Those surfaces leave the main camera's mesh selection. After the camera's
 * selection, the visible ones (enabled, inside the PVS, in the frustum) are
 * added back to the scene's active meshes, so the depth, refraction and water
 * targets that draw from that list still see them. In the main pass, before
 * the first rendering group, each one's recorded bundle is added straight to
 * the pass when every uniform buffer it reads is the one Babylon would bind
 * now. A surface that fails a check, and one surface each frame in turn, draws
 * through Babylon's normal path instead, which records the bundle the next
 * frame replays.
 *
 * Babylon's FAST snapshot mode bypasses material binding the same way; the
 * clustered light container's camera-dependent uniforms are refreshed here as
 * Babylon refreshes them for that mode.
 *
 * `?worldbundles=0` in the page address turns the replay off for the session.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";
import { installSceneMeshFilter } from "./SceneMeshCandidates";

/** Material plugins whose bindings do not change from frame to frame on a frozen material. */
const STATIC_PLUGINS = new Set([
  "BspBakedLighting",
  "BspSurfaceArray",
  "BspVertexLighting",
  "AtmosphericFog",
  "PBRBRDF",
  "PBRClearCoat",
  "PBRIridescence",
  "PBRAnisotropic",
  "Sheen",
  "PBRSubSurface",
  "DetailMap",
]);

/** Bundle bindings the engine owns per draw or keeps constant. */
const OWNED_BINDINGS = new Set(["Internals", "LeftOver"]);

interface DataBufferLike {
  readonly uniqueId?: number;
}
interface UniformBufferLike {
  getBuffer(): DataBufferLike | null;
}
interface DrawContextLike {
  fastBundle?: unknown;
  buffers: Record<string, DataBufferLike | null | undefined>;
}
interface DrawWrapperLike {
  drawContext?: DrawContextLike | null;
  effect?: unknown;
  _wasPreviouslyReady?: boolean;
  _forceRebindOnNextCall?: boolean;
}
interface BundleListLike {
  addBundle(bundle: unknown): void;
}
interface ReplayEngine {
  _bundleList?: BundleListLike;
  _applyRenderPassChanges?(bundleList: BundleListLike): void;
  _reportDrawCall?(): void;
  currentRenderPassId: number;
  compatibilityMode?: boolean;
  isWebGPU?: boolean;
}
interface ClusterContainerLike {
  _lastBoundLightIndex: string | null;
  _uniformBuffer?: UniformBufferLike & {
    updateFloat2(name: string, x: number, y: number, suffix?: string): void;
    updateFloatArray(name: string, array: Float32Array, suffix?: string): void;
    update(): void;
  };
  _sliceScale: number;
  _sliceBias: number;
  _sliceRanges: Float32Array;
}
interface Capture {
  bundle: unknown;
  effect: unknown;
  material: Material;
  /** Each bundle binding with the uniform buffer it must still match. */
  bindings: { name: string; buffer: DataBufferLike | null | undefined; source: () => DataBufferLike | null }[];
}
interface Surface {
  mesh: Mesh;
  subMesh: SubMesh;
  capture: Capture | null;
}

export interface WorldBundleReplayStats {
  frames: number;
  replayed: number;
  drawn: number;
}

export interface WorldBundleReplayHandle {
  readonly surfaces: number;
  enabled: boolean;
  stats(): WorldBundleReplayStats;
  dispose(): void;
}

const handles = new WeakMap<Scene, WorldBundleReplay>();

/** The scene's world bundle replay, if one is installed. */
export function getWorldBundleReplay(scene: Scene): WorldBundleReplayHandle | null {
  return handles.get(scene) ?? null;
}

/** Whether the session address turns world bundle replay off (`?worldbundles=0`). */
export function worldBundlesDisabledBySearch(search = ""): boolean {
  return new URLSearchParams(search).get("worldbundles") === "0";
}

/** Whether the engine records render bundles and exposes what replay needs. */
export function supportsWorldBundleReplay(engine: AbstractEngine): boolean {
  const e = engine as unknown as ReplayEngine;
  return (
    !!e.isWebGPU &&
    e.compatibilityMode === false &&
    !!e._bundleList &&
    typeof e._bundleList.addBundle === "function" &&
    typeof e._applyRenderPassChanges === "function"
  );
}

/** A world surface whose recorded draw cannot change from frame to frame. */
export function isStaticWorldSurface(mesh: AbstractMesh): mesh is Mesh {
  const material = mesh.material;
  if (!material?.isFrozen || mesh.renderingGroupId !== 0 || !mesh.isWorldMatrixFrozen) return false;
  if (mesh.subMeshes?.length !== 1 || mesh.skeleton || mesh.morphTargetManager) return false;
  if (
    (mesh as Mesh).hasInstances ||
    (mesh as Mesh).hasThinInstances ||
    (mesh as Mesh).onBeforeRenderObservable.hasObservers()
  )
    return false;
  if (material.needAlphaBlendingForMesh(mesh) || material.needAlphaTestingForMesh(mesh)) return false;
  const plugins = (material.pluginManager as unknown as { _plugins?: { name: string; isEnabled?: boolean }[] })
    ?._plugins;
  return (plugins ?? []).every((plugin) => plugin.isEnabled === false || STATIC_PLUGINS.has(plugin.name));
}

function isClusterContainer(light: unknown): light is ClusterContainerLike {
  return (light as { getClassName?: () => string })?.getClassName?.() === "ClusteredLightContainer";
}

/** The uniform or storage buffer a recorded binding reads, or undefined when unknown. */
function bindingSource(scene: Scene, mesh: Mesh, name: string): (() => DataBufferLike | null) | undefined {
  if (name === "Scene") return () => scene.getSceneUniformBuffer().getBuffer();
  if (name === "Mesh") {
    const ubo = mesh.getMeshUniformBuffer() as unknown as UniformBufferLike;
    return () => ubo.getBuffer();
  }
  const light = /^Light(\d+)$/.exec(name);
  if (light) {
    const index = Number(light[1]);
    return () =>
      (mesh.lightSources[index] as unknown as { _uniformBuffer?: UniformBufferLike })?._uniformBuffer?.getBuffer() ??
      null;
  }
  const tiles = /^tileMaskBuffer(\d+)$/.exec(name);
  if (tiles) {
    const index = Number(tiles[1]);
    return () =>
      (
        mesh.lightSources[index] as unknown as { _tileMaskBuffer?: { getBuffer(): DataBufferLike } }
      )?._tileMaskBuffer?.getBuffer() ?? null;
  }
  return undefined;
}

class WorldBundleReplay implements WorldBundleReplayHandle {
  enabled = true;
  private readonly list: Surface[];
  private readonly members: Set<AbstractMesh>;
  private readonly visible: Surface[] = [];
  private readonly containers: ClusterContainerLike[];
  private readonly counters = { frames: 0, replayed: 0, drawn: 0 };
  private readonly releaseFilter: () => void;
  private readonly evaluated: Observer<Scene>;
  private readonly drawPhase: Observer<Scene>;
  private readonly sceneDispose: Observer<Scene> | null;
  private readonly worldDispose: Observer<Node> | null;
  private view: Camera | null = null;
  private turn = 0;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    surfaces: Mesh[],
    private readonly viewCamera: () => Camera | null,
    private readonly world: AbstractMesh,
  ) {
    this.list = surfaces.map((mesh) => ({ mesh, subMesh: mesh.subMeshes[0], capture: null }));
    this.members = new Set(surfaces);
    const containers = new Set<ClusterContainerLike>();
    for (const mesh of surfaces)
      for (const light of mesh.lightSources) if (isClusterContainer(light)) containers.add(light);
    this.containers = [...containers];
    this.releaseFilter = installSceneMeshFilter(scene, {
      enabled: (camera) => this.enabled && camera === this.viewCamera(),
      keep: (mesh) => !this.members.has(mesh),
    });
    this.evaluated = scene.onAfterActiveMeshesEvaluationObservable.add(() => this.collect());
    // Before the groups rather than at group 0: Babylon skips an empty group's observers.
    this.drawPhase = scene.onBeforeDrawPhaseObservable.add(() => this.replay());
    this.sceneDispose = scene.onDisposeObservable.addOnce(() => this.dispose());
    this.worldDispose = world.onDisposeObservable.addOnce(() => this.dispose());
  }

  get surfaces(): number {
    return this.list.length;
  }

  stats(): WorldBundleReplayStats {
    return { ...this.counters };
  }

  /** After the main camera's selection: the visible surfaces join the active meshes. */
  private collect(): void {
    this.visible.length = 0;
    const camera = this.scene.activeCamera;
    this.view = this.viewCamera();
    if (!this.enabled || !camera || camera !== this.view) return;
    const planes = this.scene.frustumPlanes;
    const active = this.scene.getActiveMeshes();
    for (const surface of this.list) {
      const mesh = surface.mesh;
      if (mesh.isDisposed() || !mesh.isEnabled() || !mesh.isVisible || mesh.isBlocked) continue;
      if ((mesh.layerMask & camera.layerMask) === 0 || !mesh.isInFrustum(planes)) continue;
      active.push(mesh);
      this.visible.push(surface);
    }
  }

  private replay(): void {
    const camera = this.view;
    const engine = this.scene.getEngine() as unknown as ReplayEngine;
    if (!this.enabled || !camera || this.scene.activeCamera !== camera) return;
    if (engine.currentRenderPassId !== camera.renderPassId || this.visible.length === 0) return;
    const bundles = engine._bundleList;
    if (!bundles) return;
    this.counters.frames++;
    this.refreshClusters();
    const passId = camera.renderPassId;
    const refresh = this.turn++ % this.visible.length;
    let stateApplied = false;
    for (let i = 0; i < this.visible.length; i++) {
      const surface = this.visible[i];
      const capture = surface.capture;
      if (i !== refresh && capture && this.current(surface, capture, passId)) {
        if (!stateApplied) {
          engine._applyRenderPassChanges?.(bundles);
          stateApplied = true;
        }
        bundles.addBundle(capture.bundle);
        engine._reportDrawCall?.();
        this.counters.replayed++;
        continue;
      }
      surface.mesh.render(surface.subMesh, false);
      stateApplied = false;
      surface.capture = this.record(surface, passId);
      this.counters.drawn++;
    }
  }

  /** The clustered container's camera-dependent uniforms, refreshed as Babylon does under FAST snapshots. */
  private refreshClusters(): void {
    for (const container of this.containers) {
      const index = container._lastBoundLightIndex;
      const ubo = container._uniformBuffer;
      if (index === null || !ubo) continue;
      ubo.updateFloat2("vSliceData", container._sliceScale, container._sliceBias, index);
      ubo.updateFloatArray("vSliceRanges", container._sliceRanges, index);
      ubo.update();
    }
  }

  private current(surface: Surface, capture: Capture, passId: number): boolean {
    const wrapper = surface.subMesh._getDrawWrapper(passId) as unknown as DrawWrapperLike | undefined;
    const context = wrapper?.drawContext;
    if (!wrapper || !context || context.fastBundle !== capture.bundle || wrapper.effect !== capture.effect)
      return false;
    if (!wrapper._wasPreviouslyReady || wrapper._forceRebindOnNextCall) return false;
    if (surface.mesh.material !== capture.material || !capture.material.isFrozen) return false;
    for (const binding of capture.bindings) if (binding.source() !== binding.buffer) return false;
    return true;
  }

  /** What a fresh Babylon draw recorded, if every binding it reads can be checked. */
  private record(surface: Surface, passId: number): Capture | null {
    const wrapper = surface.subMesh._getDrawWrapper(passId) as unknown as DrawWrapperLike | undefined;
    const context = wrapper?.drawContext;
    const material = surface.mesh.material;
    if (!wrapper || !context?.fastBundle || !material) return null;
    const bindings: Capture["bindings"] = [];
    for (const name in context.buffers) {
      if (OWNED_BINDINGS.has(name)) continue;
      const source = bindingSource(this.scene, surface.mesh, name);
      if (!source) {
        devLog(`[WorldBundles] ${surface.mesh.name} binds ${name}; drawn normally`);
        this.members.delete(surface.mesh);
        this.list.splice(this.list.indexOf(surface), 1);
        return null;
      }
      bindings.push({ name, buffer: context.buffers[name], source });
    }
    return { bundle: context.fastBundle, effect: wrapper.effect, material, bindings };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (handles.get(this.scene) === this) handles.delete(this.scene);
    this.releaseFilter();
    this.scene.onAfterActiveMeshesEvaluationObservable.remove(this.evaluated);
    this.scene.onBeforeDrawPhaseObservable.remove(this.drawPhase);
    this.scene.onDisposeObservable.remove(this.sceneDispose);
    this.world.onDisposeObservable.remove(this.worldDispose);
    this.list.length = 0;
    this.visible.length = 0;
    this.members.clear();
  }
}

/**
 * Replays the static surfaces of `world` in the camera `view` returns. Returns
 * null when the engine does not record bundles or no surface qualifies.
 */
export function installWorldBundleReplay(
  scene: Scene,
  world: AbstractMesh,
  view: () => Camera | null,
): WorldBundleReplayHandle | null {
  if (!supportsWorldBundleReplay(scene.getEngine())) return null;
  if (typeof location !== "undefined" && worldBundlesDisabledBySearch(location.search)) return null;
  const surfaces = [world, ...world.getChildMeshes()].filter(isStaticWorldSurface);
  if (surfaces.length === 0) return null;
  devLog(`[WorldBundles] Replaying ${surfaces.length} static world surfaces`);
  handles.get(scene)?.dispose();
  const replay = new WorldBundleReplay(scene, surfaces, view, world);
  handles.set(scene, replay);
  return replay;
}
