/**
 * Whole-frame snapshots on WebGPU: record a frame's render passes once and
 * replay their bundles on the frames that follow.
 *
 * Babylon's FAST snapshot mode replays every render pass of a recorded frame
 * without selecting a mesh or binding a material, which is most of a frame's
 * JavaScript. A replay is only right while the frame would issue the same
 * draws in the same passes, so this controller:
 *
 * - records with culling off (PVS paused, frustum clipping skipped), so moving
 *   the camera never changes what the recording holds;
 * - before each replayed frame writes what changes in place: skeletons, the
 *   world matrix of every recorded mesh that moved, and the sky's
 *   camera-following matrix;
 * - compares a signature of the draw list (enabled, visible meshes, their
 *   materials, effects and instance counts) at the end of every frame, and on
 *   any change draws the next frame normally and records the one after;
 * - marks the rendering groups each camera drew while recording as occupied
 *   in replayed frames: Babylon clears depth before a group, and runs its
 *   hooks, only for a group with something in it, and in a replayed frame
 *   every group is empty. The clears restart passes the recording holds;
 * - checks every replayed pass against the pass the recording made at that
 *   position, so a pass that appears or disappears (a clear, a mipmap pass)
 *   is caught, and stops replaying until the next recording;
 * - stops at once when a mesh, geometry, material or texture is disposed, and
 *   for the session on a device validation error.
 *
 * Snapshots start only between frames: a recording begun mid-frame would hold
 * the later passes at the wrong positions. Stopping is safe at any point; the
 * rest of the frame draws normally.
 *
 * `?snapshot=1` in the page address turns snapshots on.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";

/** Babylon's SNAPSHOTRENDERING_FAST. */
const FAST = 1;

interface PassWrapper {
  renderPassDescriptor?: {
    colorAttachments?: ({ loadOp?: string } | null)[];
    depthStencilAttachment?: { depthLoadOp?: string };
  };
}
interface Recorder {
  record: boolean;
  play: boolean;
  _allBundleLists: unknown[];
  _playBundleListIndex: number;
  endRenderPass(pass: unknown): boolean;
}
interface SnapshotEngine {
  isWebGPU?: boolean;
  compatibilityMode?: boolean;
  snapshotRendering: boolean;
  snapshotRenderingMode: number;
  _snapshotRendering?: Recorder;
  _currentRenderTarget?: { texture?: { uniqueId?: number } } | null;
  _mainRenderPassWrapper?: PassWrapper;
  _rttRenderPassWrapper?: PassWrapper;
  _device?: GPUDevice;
}
interface PvsLike {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

export type SnapshotFrameKind = "normal" | "recording" | "replay";

export interface SnapshotFrameStats {
  normal: number;
  recording: number;
  replay: number;
  /** Why the draw list was found changed, by cause. */
  changes: Record<string, number>;
}

export interface SnapshotFramesHandle {
  readonly active: boolean;
  /** Off draws every frame normally, with culling, until switched on again. */
  enabled: boolean;
  stats(): SnapshotFrameStats;
  dispose(): void;
}

/** Whether the session address turns whole-frame snapshots on (`?snapshot=1`). */
export function snapshotFramesRequested(search = ""): boolean {
  return new URLSearchParams(search).get("snapshot") === "1";
}

/** Whether the engine records WebGPU bundles in a way snapshots can replay. */
export function supportsSnapshotFrames(engine: AbstractEngine): boolean {
  const e = engine as unknown as SnapshotEngine;
  const recorder = e._snapshotRendering;
  return (
    !!e.isWebGPU &&
    e.compatibilityMode === false &&
    !!recorder &&
    typeof recorder.endRenderPass === "function" &&
    Array.isArray(recorder._allBundleLists)
  );
}

/**
 * A number that changes when anything that decides the frame's draws changes:
 * which meshes draw, with which material, how many instances, and whether a
 * material was marked for rebinding (`Material.markDirty` clears a draw
 * wrapper's readiness, which is how frozen materials take light changes).
 */
export function drawListSignature(meshes: readonly AbstractMesh[]): number {
  let hash = 0;
  let count = 0;
  for (const mesh of meshes) {
    if (!mesh.subMeshes?.length || !mesh.isEnabled() || !mesh.isVisible || mesh.visibility <= 0) continue;
    const material = mesh.material;
    const wrappers = (
      mesh.subMeshes[0] as unknown as { _drawWrappers: ({ _wasPreviouslyReady?: boolean } | undefined)[] }
    )._drawWrappers;
    let unready = 0;
    for (const wrapper of wrappers) if (wrapper && !wrapper._wasPreviouslyReady) unready++;
    const instances = (mesh as { thinInstanceCount?: number }).thinInstanceCount ?? 0;
    hash = (Math.imul(hash, 31) + mesh.uniqueId) | 0;
    hash = (Math.imul(hash, 31) + (material?.uniqueId ?? -1)) | 0;
    hash = (Math.imul(hash, 31) + unready) | 0;
    hash = (Math.imul(hash, 31) + instances) | 0;
    hash = (Math.imul(hash, 31) + mesh.renderingGroupId) | 0;
    count++;
  }
  return (Math.imul(hash, 31) + count) | 0;
}

class SnapshotFrames implements SnapshotFramesHandle {
  private kind: SnapshotFrameKind = "normal";
  private lastSignature = 0;
  private recordedSignature = 0;
  private passKeys: string[] = [];
  private passMismatch = false;
  private stopped = false;
  private disposed = false;
  private updatedFrame = -1;
  private readonly worldFlags = new WeakMap<AbstractMesh, number>();
  private recorded: AbstractMesh[] = [];
  private readonly counters: SnapshotFrameStats = { normal: 0, recording: 0, replay: 0, changes: {} };
  private readonly frameEnd: Observer<Scene>;
  private readonly frameStart: Observer<Scene>;
  private recordNext = false;
  /** The rendering groups each camera drew in the recorded frame. */
  private readonly occupied = new Map<Camera, number[]>();
  private readonly drawStart: Observer<Scene>;
  private readonly drawEnd: Observer<Scene>;
  private readonly cameraStart: Observer<Camera>;
  private readonly removals: (() => void)[] = [];
  private readonly worldDispose: Observer<Node> | null;
  private readonly originalEndRenderPass: Recorder["endRenderPass"];
  private readonly onDeviceError = (event: Event) => {
    if (this.kind === "normal") return;
    this.stop(`device error: ${(event as GPUUncapturedErrorEvent).error?.message ?? "unknown"}`, true);
  };
  private savedSkipFrustum: boolean;
  private on = true;

  get enabled(): boolean {
    return this.on;
  }

  set enabled(enabled: boolean) {
    if (enabled === this.on || !this.active) return;
    this.on = enabled;
    if (!enabled) this.stop("switched off");
    this.setCulling(!enabled);
    this.onActive(enabled);
  }

  constructor(
    private readonly scene: Scene,
    private readonly world: AbstractMesh,
    private readonly pvs: () => PvsLike | null,
    private readonly onActive: (active: boolean) => void,
  ) {
    const engine = this.engine;
    engine.snapshotRenderingMode = FAST;
    const recorder = engine._snapshotRendering as Recorder;
    this.originalEndRenderPass = recorder.endRenderPass;
    recorder.endRenderPass = (pass: unknown) => this.guardPass(recorder, pass);
    this.savedSkipFrustum = scene.skipFrustumClipping;
    this.setCulling(false);
    this.frameEnd = scene.onAfterRenderObservable.add(() => this.endOfFrame());
    // The frame's last pass ends after onAfterRender: a recording starts with the next frame.
    this.frameStart = scene.onBeforeRenderObservable.add(() => this.startOfFrame());
    this.cameraStart = scene.onBeforeCameraRenderObservable.add(() => this.writeFrameData());
    this.drawStart = scene.onBeforeDrawPhaseObservable.add(() => this.markGroups());
    this.drawEnd = scene.onAfterDrawPhaseObservable.add(() => this.noteGroups());
    const stopOnRemoval = (what: string) => () => {
      if (this.kind !== "normal") this.stop(`${what} disposed`);
    };
    const mesh = scene.onMeshRemovedObservable.add(stopOnRemoval("mesh"));
    const geometry = scene.onGeometryRemovedObservable.add(stopOnRemoval("geometry"));
    const material = scene.onMaterialRemovedObservable.add(stopOnRemoval("material"));
    const texture = scene.onTextureRemovedObservable.add(stopOnRemoval("texture"));
    this.removals.push(
      () => scene.onMeshRemovedObservable.remove(mesh),
      () => scene.onGeometryRemovedObservable.remove(geometry),
      () => scene.onMaterialRemovedObservable.remove(material),
      () => scene.onTextureRemovedObservable.remove(texture),
    );
    engine._device?.addEventListener("uncapturederror", this.onDeviceError);
    this.worldDispose = world.onDisposeObservable.addOnce(() => this.dispose());
    scene.onDisposeObservable.addOnce(() => this.dispose());
    onActive(true);
  }

  private get engine(): SnapshotEngine {
    return this.scene.getEngine() as unknown as SnapshotEngine;
  }

  get active(): boolean {
    return !this.stopped && !this.disposed;
  }

  stats(): SnapshotFrameStats {
    return { ...this.counters, changes: { ...this.counters.changes } };
  }

  /** The recording needs everything that may come into view. */
  private setCulling(on: boolean): void {
    this.scene.skipFrustumClipping = on ? this.savedSkipFrustum : true;
    const pvs = this.pvs();
    if (pvs && pvs.isEnabled() === on) return;
    pvs?.setEnabled(on);
  }

  private change(cause: string): void {
    this.counters.changes[cause] = (this.counters.changes[cause] ?? 0) + 1;
  }

  /** Stop replaying now; the rest of this frame and the next draw normally. */
  private stop(cause: string, forSession = false): void {
    this.change(cause);
    this.engine.snapshotRendering = false;
    this.kind = "normal";
    this.recordNext = false;
    this.lastSignature = 0;
    if (forSession) {
      devLog(`[Snapshots] Off for this session: ${cause}`);
      this.stopped = true;
      this.restore();
    }
  }

  /** End of a frame: decide what the next frame does. */
  private endOfFrame(): void {
    if (!this.active || !this.on) return;
    this.counters[this.kind]++;
    const signature = drawListSignature(this.scene.meshes);
    if (this.kind === "replay" || this.kind === "recording") {
      if (this.passMismatch) {
        this.passMismatch = false;
        this.stop("pass sequence");
      } else if (signature !== this.recordedSignature) {
        this.stop("draw list");
      } else if (this.kind === "recording") {
        this.kind = "replay";
      }
      this.lastSignature = signature;
      return;
    }
    // A normal frame: record the next one once the draw list held still for a frame.
    if (signature === this.lastSignature) {
      this.passKeys = [];
      this.recordedSignature = signature;
      this.recorded = this.scene.meshes.filter((mesh) => mesh.subMeshes?.length && mesh.isEnabled() && mesh.isVisible);
      this.recordNext = true;
    }
    this.lastSignature = signature;
  }

  private startOfFrame(): void {
    if (!this.recordNext || !this.active) return;
    this.recordNext = false;
    this.occupied.clear();
    this.engine.snapshotRendering = true;
    this.kind = "recording";
  }

  private get groups(): ({ _empty: boolean } | undefined)[] {
    return (this.scene.renderingManager as unknown as { _renderingGroups: ({ _empty: boolean } | undefined)[] })
      ._renderingGroups;
  }

  private noteGroups(): void {
    const camera = this.scene.activeCamera;
    if (!camera || !this.engine._snapshotRendering?.record) return;
    const indices: number[] = [];
    this.groups.forEach((group, index) => {
      if (group && !group._empty) indices.push(index);
    });
    this.occupied.set(camera, indices);
  }

  /**
   * Groups are shared by every camera and a replayed frame never resets them,
   * so each camera sets all of them: the groups it drew while recording are
   * occupied, the rest empty.
   */
  private markGroups(): void {
    const camera = this.scene.activeCamera;
    if (!camera || !this.engine._snapshotRendering?.play) return;
    const occupied = this.occupied.get(camera) ?? [];
    this.groups.forEach((group, index) => {
      if (group) group._empty = !occupied.includes(index);
    });
  }

  /** Before the first camera of a replayed frame: what moved since the recording. */
  private writeFrameData(): void {
    if (this.kind !== "replay") return;
    const frame = this.scene.getFrameId();
    if (frame === this.updatedFrame) return;
    this.updatedFrame = frame;
    for (const skeleton of this.scene.skeletons) skeleton.prepare(true);
    for (const mesh of this.recorded) {
      if (mesh.isWorldMatrixFrozen && !mesh.infiniteDistance) continue;
      const world = mesh.computeWorldMatrix(mesh.infiniteDistance);
      const flag = world.updateFlag;
      if (!mesh.infiniteDistance && !mesh.skeleton && this.worldFlags.get(mesh) === flag) continue;
      this.worldFlags.set(mesh, flag);
      mesh.transferToEffect(world);
    }
  }

  /**
   * The ending pass, by its label without the frame prefix ("[frame|n] - ").
   * The engine's current target already describes the pass that comes next.
   */
  private passKey(pass: unknown): string {
    return ((pass as { label?: string })?.label ?? "").replace(/^\[[^\]]*\] - /, "");
  }

  private guardPass(recorder: Recorder, pass: unknown): boolean {
    if (recorder.record) {
      const before = recorder._allBundleLists.length;
      // An empty list starts a recording, including one Babylon restarted.
      if (before === 0) this.passKeys = [];
      const handled = this.originalEndRenderPass.call(recorder, pass);
      if (recorder._allBundleLists.length > before) this.passKeys.push(this.passKey(pass));
      return handled;
    }
    if (recorder.play) {
      const key = this.passKey(pass);
      const index = recorder._playBundleListIndex;
      if (this.passKeys[index] !== key) {
        this.passMismatch = true;
        // A missing pass: continue at the next recorded pass of this kind.
        const next = this.passKeys.indexOf(key, index + 1);
        if (next < 0) return true; // a pass the recording never made draws nothing
        recorder._playBundleListIndex = next;
      }
    }
    return this.originalEndRenderPass.call(recorder, pass);
  }

  private restore(): void {
    const engine = this.engine;
    engine.snapshotRendering = false;
    const recorder = engine._snapshotRendering;
    if (recorder) recorder.endRenderPass = this.originalEndRenderPass;
    this.setCulling(true);
    this.onActive(false);
  }

  dispose(): void {
    if (this.disposed) return;
    if (!this.stopped) this.restore();
    this.disposed = true;
    this.scene.onAfterRenderObservable.remove(this.frameEnd);
    this.scene.onBeforeRenderObservable.remove(this.frameStart);
    this.scene.onBeforeDrawPhaseObservable.remove(this.drawStart);
    this.scene.onAfterDrawPhaseObservable.remove(this.drawEnd);
    this.occupied.clear();
    this.scene.onBeforeCameraRenderObservable.remove(this.cameraStart);
    for (const remove of this.removals) remove();
    this.world.onDisposeObservable.remove(this.worldDispose);
    this.engine._device?.removeEventListener("uncapturederror", this.onDeviceError);
    this.recorded = [];
    if (handles.get(this.scene) === this) handles.delete(this.scene);
  }
}

const handles = new WeakMap<Scene, SnapshotFrames>();

/** The scene's whole-frame snapshot controller, if one is installed. */
export function getSnapshotFrames(scene: Scene): SnapshotFramesHandle | null {
  return handles.get(scene) ?? null;
}

/**
 * Starts whole-frame snapshots for the map whose root is `world` when the
 * session asks for them and the engine can replay bundles. `onActive` hears
 * when snapshots start and stop (world bundle replay steps aside meanwhile).
 */
export function installSnapshotFrames(
  scene: Scene,
  world: AbstractMesh,
  pvs: () => PvsLike | null,
  onActive: (active: boolean) => void,
): SnapshotFramesHandle | null {
  if (typeof location === "undefined" || !snapshotFramesRequested(location.search)) return null;
  if (!supportsSnapshotFrames(scene.getEngine())) return null;
  handles.get(scene)?.dispose();
  const frames = new SnapshotFrames(scene, world, pvs, onActive);
  handles.set(scene, frames);
  devLog("[Snapshots] Whole-frame snapshots on");
  return frames;
}
