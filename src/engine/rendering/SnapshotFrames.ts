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
 *   the camera never changes what the recording holds; the other frames keep
 *   it, and the world bundle replay, so a frame that cannot replay costs what
 *   it costs without snapshots;
 * - before each replayed frame writes what changes in place: skeletons, the
 *   world matrix of every recorded mesh that moved, and the sky's
 *   camera-following matrix; draws that keep their own world or camera
 *   matrices in their per-draw uniforms (outline passes, shader materials) get
 *   them written there, as Babylon's snapshot helper does for effect layers;
 *   lights get the uniforms Babylon writes while binding a material (the
 *   clustered light container refreshes its own in this mode); and materials
 *   learned to change between frames (effect time, scrolling stages, fades)
 *   are bound again into their recorded draws' uniform slots;
 * - compares a signature of the draw list (enabled, visible meshes, their
 *   materials and instance buffers) before a recorded or replayed frame draws,
 *   after every other per-camera observer, and on a change draws that frame
 *   normally; once the signature has held still for a frame (longer after a
 *   recording that replayed only a frame or two) the next frame records;
 * - keeps instanced effect batches in the recording whatever their count:
 *   they record indirect draws, and each replayed frame writes the current
 *   instance count, 0 for a batch the game has switched off;
 * - learns which meshes keep being shown and hidden (pooled projectiles,
 *   trails, dropped weapons, players) and keeps them in the recording too:
 *   a hidden one draws with a collapsed world matrix, so showing and hiding
 *   it no longer changes the draw list;
 * - marks the rendering groups each camera drew while recording as occupied
 *   in replayed frames: Babylon clears depth before a group, and runs its
 *   hooks, only for a group with something in it, and in a replayed frame
 *   every group is empty. The clears restart passes the recording holds;
 * - checks every replayed pass against the pass the recording made at that
 *   position, so a pass that appears or disappears (a clear, a mipmap pass)
 *   is caught, and stops replaying until the next recording;
 * - stops at once when a mesh, geometry, material or texture is disposed or
 *   Babylon releases a GPU buffer or texture (a recording may hold it; Babylon
 *   destroys it after the frame is submitted), and for the session on a
 *   device validation error.
 *
 * Snapshots start only between frames: a recording begun mid-frame would hold
 * the later passes at the wrong positions. Stopping is safe at any point; the
 * rest of the frame draws normally.
 *
 * `?snapshot=1` in the page address turns snapshots on.
 */

import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Effect } from "@babylonjs/core/Materials/effect";
import type { Material } from "@babylonjs/core/Materials/material";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, type Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";

/** Babylon's SNAPSHOTRENDERING_FAST. */
const FAST = 1;
/** Replayed frames below which a recording did not pay for itself. */
const SHORT_REPLAY = 3;
/** Replayed frames from which recordings start again after one stable frame. */
const LONG_REPLAY = 30;
/** The most stable normal frames a recording waits for. */
const MAX_STABLE_WAIT = 8;
/** Draws a normal frame compares for changing material values. */
const LEARNED_DRAWS_PER_FRAME = 256;
/** The world matrix of a mesh hidden in place: every vertex at the origin, nothing drawn. */
const COLLAPSED = Matrix.Zero();

interface PassWrapper {
  renderPassDescriptor?: {
    colorAttachments?: ({ loadOp?: string } | null)[];
    depthStencilAttachment?: { depthLoadOp?: string };
  };
}
interface Recorder {
  record: boolean;
  _record: boolean;
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
  _bufferManager?: { releaseBuffer(buffer: unknown): boolean };
  _textureHelper?: { releaseTexture(texture: unknown): void };
  _draw?: (...args: unknown[]) => unknown;
}
interface DrawContextLike {
  enableIndirectDraw: boolean;
  indirectDrawBuffer?: unknown;
  setIndirectData(indexOrVertexCount: number, instanceCount: number, firstIndexOrVertex: number, force?: boolean): void;
}
interface LeftOverBuffer {
  _uniformLocations?: Record<string, number>;
  _uniformSizes?: Record<string, number>;
  /** Each draw context's slot, and every slot's buffer with its CPU copy. */
  _slotByOwner?: Map<unknown, number>;
  _buffers?: [unknown, Float32Array | undefined][];
  _bufferIndex?: number;
  _bufferData?: Float32Array;
  /** The engine frame each slot was last flushed in. */
  _slotFrameId?: number[];
  setDataBuffer(dataBuffer: unknown): boolean;
  update(): void;
}

/**
 * Upload a slot written outside a draw, keeping its CPU copy equal to what
 * the GPU holds: Babylon's draws compare against that copy to skip uploads,
 * and `update()` keeps it only while the buffer has more than one slot.
 */
function flushSlot(leftOver: LeftOverBuffer): void {
  leftOver.update();
  const copy = leftOver._buffers?.[leftOver._bufferIndex ?? -1]?.[1];
  if (copy && leftOver._bufferData) copy.set(leftOver._bufferData);
}
interface DrawWrapperLike {
  effect?: { _pipelineContext?: { uniformBuffer?: LeftOverBuffer } } & SlotDraw["effect"];
  drawContext?: { buffers: Record<string, unknown> };
  materialContext?: unknown;
  /** The material's defines for this pass; none when another renderer owns the pass's effect. */
  defines?: unknown;
}
/** The engine state a material bind reads: the pass, and the effect and contexts it binds into. */
interface BindingEngine {
  currentRenderPassId: number;
  _currentEffect: unknown;
  _currentMaterialContext: unknown;
  _currentDrawContext: unknown;
}
interface LightBuffer extends LeftOverBuffer {
  useUbo: boolean;
  updateColor4(name: string, color: Color3, alpha: number): void;
}
/** Per-draw uniforms that follow the mesh or the camera, as Babylon's shader materials and outline passes set them. */
const MATRIX_UNIFORMS = [
  "world",
  "view",
  "projection",
  "viewProjection",
  "worldView",
  "worldViewProjection",
  "cameraPosition",
] as const;
type MatrixUniform = (typeof MATRIX_UNIFORMS)[number];
/** A recorded draw with a uniform slot of its own, in one render pass. */
interface SlotDraw {
  mesh: AbstractMesh;
  subMesh: SubMesh;
  /** The material when recorded: a change of material changes the draw list and ends the recording. */
  material: Material | null;
  pass: number;
  wrapper: DrawWrapperLike;
  effect: { setMatrix(name: string, matrix: Matrix): void; setVector3(name: string, vector: Vector3): void };
  leftOver: LeftOverBuffer;
  slot: unknown;
  /** The matrix uniforms among its uniforms. */
  uniforms: MatrixUniform[];
  /** Where its other values are, as [start, end) pairs. */
  ranges: number[];
  /** Its slot in the uniform buffer, once looked up. */
  slotIndex?: number;
  /** Whether a world matrix is among them, so hiding collapses that instead of the camera. */
  hasWorld: boolean;
}
interface ThinInstanceStorage {
  instancesCount: number;
  matrixBuffer?: { getBuffer(): { uniqueId?: number } | null } | null;
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
  /** Milliseconds spent in frames of each kind, frame end to frame end. */
  ms: Record<SnapshotFrameKind, number>;
}

export interface SnapshotFramesHandle {
  readonly active: boolean;
  /** Off draws every frame normally, with culling, until switched on again. */
  enabled: boolean;
  stats(): SnapshotFrameStats;
  dispose(): void;
}

/**
 * Whether the frame being drawn replays a snapshot recording. Such a frame
 * selects, binds and draws no mesh of its own, so mesh draw hooks and the
 * active-mesh list say nothing about what is in view.
 */
export function replaysSnapshot(engine: AbstractEngine): boolean {
  const snapshots = engine as unknown as SnapshotEngine;
  return snapshots.snapshotRendering && snapshots.snapshotRenderingMode === FAST;
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

/** An instanced batch: thin instances in a matrix buffer of fixed capacity. */
export function instanceStorage(mesh: AbstractMesh): ThinInstanceStorage | null {
  const storage = (mesh as unknown as { _thinInstanceDataStorage?: ThinInstanceStorage })._thinInstanceDataStorage;
  return storage?.matrixBuffer && mesh.subMeshes?.length ? storage : null;
}

/**
 * A number that changes when anything that decides the frame's draws changes:
 * which meshes draw, with which material and instance buffer, and whether a
 * material was marked for rebinding (`Material.markDirty` clears a draw
 * wrapper's readiness, which is how frozen materials take light changes).
 * An instanced batch counts whatever its count and enabled state: replayed
 * frames draw it indirectly with the count of the moment. So does a mesh
 * `inPlace` accepts, which replayed frames hide with a collapsed matrix.
 */
export function drawListSignature(
  meshes: readonly AbstractMesh[],
  inPlace: (mesh: AbstractMesh) => boolean = () => false,
  visit?: (mesh: AbstractMesh, shown: boolean) => void,
): number {
  let hash = 0;
  let count = 0;
  for (const mesh of meshes) {
    if (!mesh.subMeshes?.length) continue;
    const batch = instanceStorage(mesh);
    if (!batch) {
      const shown = mesh.isEnabled() && mesh.isVisible && mesh.visibility > 0;
      visit?.(mesh, shown);
      if (!shown && !inPlace(mesh)) continue;
    }
    const material = mesh.material;
    const wrappers = (
      mesh.subMeshes[0] as unknown as { _drawWrappers: ({ _wasPreviouslyReady?: boolean } | undefined)[] }
    )._drawWrappers;
    let unready = 0;
    for (const wrapper of wrappers) if (wrapper && !wrapper._wasPreviouslyReady) unready++;
    const instances = batch ? (batch.matrixBuffer?.getBuffer()?.uniqueId ?? 0) : 0;
    hash = (Math.imul(hash, 31) + mesh.uniqueId) | 0;
    hash = (Math.imul(hash, 31) + (material?.uniqueId ?? -1)) | 0;
    hash = (Math.imul(hash, 31) + unready) | 0;
    hash = (Math.imul(hash, 31) + instances) | 0;
    hash = (Math.imul(hash, 31) + mesh.renderingGroupId) | 0;
    // Below full visibility an opaque mesh moves to the transparent queue
    const fading = mesh.visibility < 1 && !material?.needAlphaBlending();
    hash = (Math.imul(hash, 31) + (fading ? 1 : 0)) | 0;
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
  /** Meshes forced into the recording frame, with the state to put back. */
  private forced: {
    mesh: AbstractMesh;
    enabled: boolean;
    visible: boolean;
    visibility: number;
    count: number;
    /** Its world matrix, when a zero one stands in for this frame. */
    world: Matrix | null;
    /** Its owner froze its world matrix: refrozen on its own matrix after the frame. */
    frozen: boolean;
  }[] = [];
  /** The visibility each recorded mesh last wrote: a fade lives in the mesh uniforms too. */
  private readonly visibilities = new WeakMap<AbstractMesh, number>();
  private readonly skeletons = new Set<Skeleton>();
  private draws: SlotDraw[] | null = null;
  /** The draws among them with matrices in their slot. */
  private matrixDraws: SlotDraw[] | null = null;
  /** The draws among them of materials learned to change. */
  private dynamicDraws: SlotDraw[] | null = null;
  /** Materials seen changing values between frames: rebound in every replayed frame. */
  private readonly dynamicMaterials = new WeakSet<Material>();
  /** Each draw's slot values in the last frame Babylon drew, by draw context. */
  private readonly slotValues = new WeakMap<object, Float32Array>();
  private readonly layoutRanges = new WeakMap<LeftOverBuffer, number[]>();
  private learnCursor = 0;
  /** Normal frames the draw list has held still, and how many a recording waits for. */
  private stableFrames = 0;
  private stableNeeded = 1;
  /** Frames replayed since the last recording. */
  private replayRun = LONG_REPLAY;
  /** The engine frame of the last recording: its draws flushed their slots then. */
  private recordingFrame = -1;
  /** Recorded meshes drawn at full detail in the recording frame, whatever their distance. */
  private fullDetail: AbstractMesh[] = [];
  /** A recording ended and its hidden meshes are not collapsed yet. */
  private hiddenUnwritten = false;
  private readonly lightColor = new Color3();
  private readonly product = new Matrix();
  private readonly watched = new WeakSet<AbstractMesh>();
  /** Forced meshes that drew while recording; one that did not forces a new recording. */
  private readonly drawnForced = new Set<AbstractMesh>();
  /** How often each mesh was shown or hidden; two changes make it hidden in place. */
  private readonly flips = new WeakMap<AbstractMesh, { shown: boolean; count: number }>();
  private readonly inPlace = new WeakSet<AbstractMesh>();
  private readonly hiddenInPlace = new WeakSet<AbstractMesh>();
  /** Map surfaces: always in the recording, hidden by PVS only while culling runs. */
  private readonly worldMeshes: Set<AbstractMesh>;
  private readonly isInPlace = (mesh: AbstractMesh) => this.inPlace.has(mesh) || this.worldMeshes.has(mesh);
  /** Meshes that were forced into a recording and still did not draw: never forced again. */
  private readonly unrecordable = new WeakSet<AbstractMesh>();
  private readonly counters: SnapshotFrameStats = {
    normal: 0,
    recording: 0,
    replay: 0,
    changes: {},
    ms: { normal: 0, recording: 0, replay: 0 },
  };
  private lastFrameEnd = 0;
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
    this.worldMeshes = new Set([world, ...world.getChildMeshes()]);
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
    const buffers = engine._bufferManager;
    const textures = engine._textureHelper;
    if (buffers) {
      const release = buffers.releaseBuffer;
      buffers.releaseBuffer = (buffer: unknown) => {
        if (this.kind !== "normal") this.stop("buffer released");
        return release.call(buffers, buffer);
      };
      this.removals.push(() => {
        buffers.releaseBuffer = release;
      });
    }
    if (textures) {
      const release = textures.releaseTexture;
      textures.releaseTexture = (texture: unknown) => {
        if (this.kind !== "normal") this.stop("texture released");
        release.call(textures, texture);
      };
      this.removals.push(() => {
        textures.releaseTexture = release;
      });
    }
    // A recording keeps each draw's own bundle instead of encoding the draw
    // again: Babylon's recorder stores the pass's bundle list as it stands at
    // the end of the pass, and a draw outside recording adds its cached bundle
    // to that list (encoding one first when it has none or it went stale).
    // Re-encoding every draw made a recording frame cost twice a normal one.
    const draw = engine._draw;
    if (draw && recorder) {
      engine._draw = function (this: SnapshotEngine, ...args: unknown[]) {
        if (!recorder._record) return draw.apply(this, args);
        recorder._record = false;
        try {
          return draw.apply(this, args);
        } finally {
          recorder._record = true;
        }
      };
      this.removals.push(() => {
        engine._draw = draw;
      });
    }
    this.worldDispose = world.onDisposeObservable.addOnce(() => this.dispose());
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  private get engine(): SnapshotEngine {
    return this.scene.getEngine() as unknown as SnapshotEngine;
  }

  get active(): boolean {
    return !this.stopped && !this.disposed;
  }

  stats(): SnapshotFrameStats {
    return { ...this.counters, changes: { ...this.counters.changes }, ms: { ...this.counters.ms } };
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
    if (this.forced.length || this.fullDetail.length) this.releaseForced();
    this.cullingAfterRecording();
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
    const now = performance.now();
    if (this.lastFrameEnd) this.counters.ms[this.kind] += now - this.lastFrameEnd;
    this.lastFrameEnd = now;
    // The recording frame's forced state goes back before anything is compared
    const missing = this.forced.filter(({ mesh }) => !this.drawnForced.has(mesh)).map(({ mesh }) => mesh);
    if (this.forced.length || this.fullDetail.length) this.releaseForced();
    // Normal frames only: a recording frame is the slowest frame there is
    if (this.kind === "normal") this.learnMaterialValues();
    if (this.kind === "replay") this.replayRun++;
    if (this.kind === "replay" || this.kind === "recording") {
      // The draw list was compared before the frame drew; a change after that
      // is found before the next one draws
      if (this.passMismatch) {
        this.passMismatch = false;
        this.stop("pass sequence");
      } else if (this.kind === "recording" && missing.length) {
        // A mesh Babylon would not draw even forced (another camera's layer, a
        // pool root): normal tracking from now on, or every recording fails
        for (const mesh of missing) {
          this.unrecordable.add(mesh);
          this.inPlace.delete(mesh);
        }
        this.stop("forced mesh not recorded");
      } else if (this.kind === "recording") {
        this.kind = "replay";
      }
      this.cullingAfterRecording();
      this.lastSignature = this.recordedSignature;
      return;
    }
    // A normal frame: record the next one once the draw list held still long enough.
    const signature = drawListSignature(this.scene.meshes, this.isInPlace, this.learnToggle);
    this.stableFrames = signature === this.lastSignature ? this.stableFrames + 1 : 0;
    if (this.stableFrames >= this.stableNeeded) {
      // A recording costs about two normal frames; one that replayed only a
      // frame or two (a fight changing what is drawn every few frames) cost
      // more than it saved, so the next waits longer for the draws to settle
      if (this.replayRun < SHORT_REPLAY) this.stableNeeded = Math.min(this.stableNeeded * 2, MAX_STABLE_WAIT);
      else if (this.replayRun >= LONG_REPLAY) this.stableNeeded = 1;
      this.replayRun = 0;
      this.stableFrames = 0;
      this.passKeys = [];
      this.recordedSignature = signature;
      this.recorded = this.scene.meshes.filter(
        (mesh) =>
          mesh.subMeshes?.length &&
          (instanceStorage(mesh) || this.inPlace.has(mesh) || (mesh.isEnabled() && mesh.isVisible)),
      );
      this.recordNext = true;
    }
    this.lastSignature = signature;
  }

  private startOfFrame(): void {
    if (!this.active) return;
    // The frame's writes come after every other per-camera observer: the game
    // places beams and fills effect batches there too
    this.scene.onBeforeCameraRenderObservable.makeObserverBottomPriority(this.cameraStart);
    if (!this.recordNext) return;
    this.recordNext = false;
    this.occupied.clear();
    this.drawnForced.clear();
    this.draws = null;
    this.matrixDraws = null;
    this.dynamicDraws = null;
    this.setCulling(false);
    this.onActive(true);
    this.engine.snapshotRendering = true;
    this.kind = "recording";
  }

  /** Culling and the world replay come back after the recording frame. */
  private cullingAfterRecording(): void {
    if (this.scene.skipFrustumClipping === this.savedSkipFrustum) return;
    this.setCulling(true);
    this.onActive(false);
  }

  /** Meshes that keep being shown and hidden stay in the recording from now on. */
  private readonly learnToggle = (mesh: AbstractMesh, shown: boolean): void => {
    // Map surfaces are in every recording already; PVS showing and hiding
    // them as the camera moves is not a change to collapse them for
    if (this.inPlace.has(mesh) || this.unrecordable.has(mesh) || this.worldMeshes.has(mesh)) return;
    const flips = this.flips.get(mesh);
    if (!flips) {
      this.flips.set(mesh, { shown, count: 0 });
    } else if (flips.shown !== shown) {
      flips.shown = shown;
      if (++flips.count >= 2) this.inPlace.add(mesh);
    }
  };

  /**
   * Babylon draws neither a hidden or disabled mesh nor a batch with no
   * instances, so in the recording frame every batch and every mesh hidden in
   * place draws, a batch with at least one instance through an indirect draw.
   * A mesh hidden by a disabled ancestor is left out: enabling the ancestor
   * would show its other children too (model templates share pool roots). Their real state goes back, and into the GPU data,
   * before the frame is submitted. This runs at the recording frame's first
   * camera, after the game's own updates have set each mesh for the frame.
   */
  private forceRecorded(): void {
    const engine = this.engine as unknown as { _currentDrawContext?: DrawContextLike };
    this.forced = [];
    for (const mesh of this.recorded) {
      // A level of detail with no mesh (small weapon parts at range) would
      // leave the part out of the recording wherever the camera goes later
      if ((mesh as Mesh).hasLODLevels) {
        (mesh as unknown as { getLOD(): AbstractMesh }).getLOD = () => mesh;
        this.fullDetail.push(mesh);
      }
      const storage = instanceStorage(mesh);
      if ((!storage && !this.inPlace.has(mesh)) || this.unrecordable.has(mesh)) continue;
      if (!this.watched.has(mesh)) {
        this.watched.add(mesh);
        (mesh as Mesh).onBeforeDrawObservable.add(() => {
          const context = engine._currentDrawContext;
          if (instanceStorage(mesh) && context && !context.enableIndirectDraw) context.enableIndirectDraw = true;
          if (this.engine._snapshotRendering?.record) this.drawnForced.add(mesh);
        });
      }
      if (mesh.parent && !mesh.parent.isEnabled()) continue;
      const enabled = mesh.isEnabled(false);
      const visible = mesh.isVisible;
      const visibility = mesh.visibility;
      const count = storage?.instancesCount ?? 0;
      const hidden = !enabled || !visible || visibility <= 0 || (storage !== null && count < 1);
      // Drawn so the recording holds it, but collapsed: a forced mesh would
      // otherwise show where it last was for this one frame. This must be the
      // frame's first write to its uniforms, so the matrix it draws with is
      // a frozen zero (for a batch, its instances collapse with it)
      let world: Matrix | null = null;
      const frozen = mesh.isWorldMatrixFrozen;
      if (hidden) {
        world = mesh.getWorldMatrix();
        mesh.freezeWorldMatrix(Matrix.Zero());
      }
      this.forced.push({ mesh, enabled, visible, visibility, count, world, frozen });
      if (!enabled) mesh.setEnabled(true);
      if (!visible) mesh.isVisible = true;
      if (visibility <= 0) mesh.visibility = 1;
      if (storage && count < 1) (mesh as Mesh).thinInstanceCount = 1;
    }
  }

  private releaseForced(): void {
    for (const mesh of this.fullDetail) delete (mesh as unknown as { getLOD?: unknown }).getLOD;
    this.fullDetail = [];
    for (const { mesh, enabled, visible, visibility, count, world, frozen } of this.forced) {
      if (mesh.isDisposed()) continue;
      if (world && frozen) {
        // Frozen by its owner: frozen again on its own matrix
        mesh.freezeWorldMatrix(world);
      } else if (world) {
        // Its own matrix object back, recomputed from its transform
        (mesh as unknown as { _worldMatrix: Matrix })._worldMatrix = world;
        mesh.unfreezeWorldMatrix();
      }
      if (visibility <= 0) mesh.visibility = visibility;
      if (instanceStorage(mesh) && count < 1) (mesh as Mesh).thinInstanceCount = count;
      if (!visible) mesh.isVisible = false;
      if (!enabled) mesh.setEnabled(false);
    }
    this.forced = [];
    this.writeInstanceCounts(true);
    // Collapsed at the start of the next frame: a second write to a mesh's
    // uniforms in the recording frame goes to a new buffer, not the one the
    // recorded draw binds
    this.hiddenUnwritten = true;
  }

  /**
   * Draws that take world or camera matrices as loose uniforms, in a slot of
   * their own: outline passes and shader materials. The camera is the active
   * camera that sees the mesh's layer. A mesh hidden in place gets a collapsed
   * world matrix there too (or a collapsed view-projection when it has none).
   */
  private writeDrawMatrices(): void {
    this.matrixDraws ??= this.slotDraws().filter((draw) => draw.uniforms.length);
    for (const draw of this.matrixDraws) {
      const mesh = draw.mesh;
      if (mesh.isDisposed()) continue;
      const camera = this.cameraOf(mesh);
      if (!camera || !draw.leftOver.setDataBuffer(draw.slot)) continue;
      const hidden = this.hiddenInPlace.has(mesh);
      const world = hidden ? COLLAPSED : mesh.getWorldMatrix();
      const effect = draw.effect;
      for (const name of draw.uniforms) {
        if (name === "world") effect.setMatrix(name, world);
        else if (name === "view") effect.setMatrix(name, camera.getViewMatrix());
        else if (name === "projection") effect.setMatrix(name, camera.getProjectionMatrix());
        else if (name === "viewProjection") {
          effect.setMatrix(name, hidden && !draw.hasWorld ? COLLAPSED : camera.getTransformationMatrix());
        } else if (name === "worldView") {
          effect.setMatrix(name, world.multiplyToRef(camera.getViewMatrix(), this.product));
        } else if (name === "worldViewProjection") {
          effect.setMatrix(name, world.multiplyToRef(camera.getTransformationMatrix(), this.product));
        } else effect.setVector3(name, camera.globalPosition);
      }
      flushSlot(draw.leftOver);
    }
  }

  /** The active camera that draws a mesh: the first whose layers include it. */
  private cameraOf(mesh: AbstractMesh): Camera | null {
    const cameras = this.scene.activeCameras?.length ? this.scene.activeCameras : [this.scene.activeCamera];
    return cameras.find((c) => c && (c.layerMask & mesh.layerMask) !== 0) ?? cameras[0] ?? null;
  }

  /** The recorded draws with a uniform slot of their own; listed once after each recording. */
  private slotDraws(): SlotDraw[] {
    if (this.draws) return this.draws;
    const draws: SlotDraw[] = [];
    for (const mesh of this.recorded) {
      for (const subMesh of mesh.subMeshes ?? []) {
        (subMesh as unknown as { _drawWrappers: (DrawWrapperLike | undefined)[] })._drawWrappers.forEach(
          (wrapper, pass) => {
            const effect = wrapper?.effect;
            const leftOver = effect?._pipelineContext?.uniformBuffer;
            const slot = wrapper?.drawContext?.buffers.LeftOver;
            const names = leftOver?._uniformLocations;
            if (!wrapper || !effect || !leftOver || !slot || !names) return;
            // Only passes the recording holds: a mesh keeps the wrappers of
            // passes that drew it once (a reflection probe's six faces)
            const slotIndex = leftOver._slotByOwner?.get(wrapper.drawContext);
            if (slotIndex === undefined || leftOver._slotFrameId?.[slotIndex] !== this.recordingFrame) return;
            const uniforms = MATRIX_UNIFORMS.filter((name) => name in names);
            const hasWorld = uniforms.some((name) => name.startsWith("world"));
            const material = subMesh.getMaterial(false);
            const ranges = this.valueRanges(leftOver);
            draws.push({
              mesh,
              subMesh,
              material,
              pass,
              wrapper,
              effect,
              leftOver,
              slot,
              uniforms,
              hasWorld,
              ranges,
              slotIndex,
            });
          },
        );
      }
    }
    this.draws = draws;
    return draws;
  }

  /**
   * Materials whose values change between frames (a scrolling stage, a fade,
   * a shader's time), learned in the frames Babylon draws itself: a draw whose
   * uniform slot holds other values than the last such frame left there,
   * matrices aside, marks its material. Each frame compares a share of the
   * draws, carrying on where the last one stopped: a value that changes keeps
   * changing, and comparing every draw cost a normal frame about 3 ms.
   */
  private learnMaterialValues(): void {
    const draws = this.slotDraws();
    let budget = LEARNED_DRAWS_PER_FRAME;
    for (let k = 0; k < draws.length && budget > 0; k++) {
      this.learnCursor = (this.learnCursor + 1) % draws.length;
      const draw = draws[this.learnCursor];
      const { material, leftOver } = draw;
      if (!material || this.dynamicMaterials.has(material) || draw.mesh.isDisposed()) continue;
      budget--;
      const context = draw.wrapper.drawContext;
      draw.slotIndex ??= leftOver._slotByOwner?.get(context);
      const data = draw.slotIndex === undefined ? undefined : leftOver._buffers?.[draw.slotIndex]?.[1];
      if (!context || !data) continue;
      const last = this.slotValues.get(context);
      if (!last || last.length !== data.length) {
        this.slotValues.set(context, data.slice());
        continue;
      }
      const ranges = draw.ranges;
      let changed = false;
      for (let r = 0; r < ranges.length && !changed; r += 2) {
        for (let i = ranges[r]; i < ranges[r + 1]; i++) {
          if (last[i] !== data[i]) {
            changed = true;
            break;
          }
        }
      }
      if (changed) {
        this.dynamicMaterials.add(material);
        this.dynamicDraws = null;
      } else {
        last.set(data);
      }
    }
  }

  /** Where a slot layout keeps values other than the matrices replayed frames write anyway, as [start, end) pairs. */
  private valueRanges(leftOver: LeftOverBuffer): number[] {
    let ranges = this.layoutRanges.get(leftOver);
    if (!ranges) {
      ranges = [];
      const sizes = leftOver._uniformSizes ?? {};
      for (const [name, location] of Object.entries(leftOver._uniformLocations ?? {})) {
        if ((MATRIX_UNIFORMS as readonly string[]).includes(name)) continue;
        ranges.push(location, location + (sizes[name] ?? 0));
      }
      this.layoutRanges.set(leftOver, ranges);
    }
    return ranges;
  }

  /**
   * Draws of materials learned to change get the material bound again, into
   * their recorded slot, as the draw's own pass would bind it. The scene's
   * uniforms stay untouched (each camera's pass writes them; a write from here
   * starts a scene buffer the recorded passes do not bind), the active camera
   * stays the frame's first, and matrices are written afterwards per camera.
   */
  private writeMaterialValues(): void {
    const engine = this.scene.getEngine() as unknown as BindingEngine;
    const saved = {
      pass: engine.currentRenderPassId,
      effect: engine._currentEffect,
      materialContext: engine._currentMaterialContext,
      drawContext: engine._currentDrawContext,
    };
    if (!this.dynamicDraws) {
      // Draws in a pass of the material's own: an outline pass binds its own effect
      this.dynamicDraws = this.slotDraws().filter(
        (draw) => draw.wrapper.defines && draw.material && this.dynamicMaterials.has(draw.material),
      );
    }
    let bound = false;
    for (const draw of this.dynamicDraws) {
      const { mesh, material } = draw;
      // Only draws that draw something now
      if (!material || mesh.isDisposed() || this.hiddenInPlace.has(mesh)) continue;
      if (!mesh.isEnabled() || !mesh.isVisible || mesh.visibility <= 0) continue;
      const storage = instanceStorage(mesh);
      if ((storage && storage.instancesCount < 1) || !draw.leftOver.setDataBuffer(draw.slot)) continue;
      if (!bound) {
        bound = true;
        // The scene's uniforms are the passes' own: a bind must not write them
        (this.scene as unknown as { finalizeSceneUbo(): unknown }).finalizeSceneUbo = () =>
          this.scene.getSceneUniformBuffer();
      }
      engine.currentRenderPassId = draw.pass;
      engine._currentEffect = draw.effect;
      engine._currentMaterialContext = draw.wrapper.materialContext;
      engine._currentDrawContext = draw.wrapper.drawContext;
      this.scene.resetCachedMaterial();
      material.bindForSubMesh(mesh.getWorldMatrix(), mesh as Mesh, draw.subMesh);
      flushSlot(draw.leftOver);
    }
    if (!bound) return;
    delete (this.scene as unknown as { finalizeSceneUbo?: unknown }).finalizeSceneUbo;
    engine.currentRenderPassId = saved.pass;
    engine._currentEffect = saved.effect;
    engine._currentMaterialContext = saved.materialContext;
    engine._currentDrawContext = saved.drawContext;
    this.scene.resetCachedMaterial();
  }

  /** Hidden-in-place meshes: a collapsed world matrix while hidden, the real one when shown. */
  private writeHidden(force: boolean): void {
    for (const mesh of this.recorded) {
      if (!this.inPlace.has(mesh) || mesh.isDisposed()) continue;
      const hidden = !mesh.isEnabled() || !mesh.isVisible || mesh.visibility <= 0;
      if (!force && hidden === this.hiddenInPlace.has(mesh)) continue;
      if (hidden) {
        this.hiddenInPlace.add(mesh);
        mesh.transferToEffect(COLLAPSED);
      } else {
        this.hiddenInPlace.delete(mesh);
        this.worldFlags.delete(mesh);
        // The world loop rewrites the others; a frozen matrix it skips
        if (mesh.isWorldMatrixFrozen && !mesh.infiniteDistance) mesh.transferToEffect(mesh.getWorldMatrix());
      }
    }
  }

  /** Each recorded batch's current count into its indirect draws: 0 when switched off. */
  private writeInstanceCounts(force: boolean): void {
    for (const mesh of this.recorded) {
      const storage = instanceStorage(mesh);
      if (!storage) continue;
      const count = mesh.isEnabled() && mesh.isVisible ? storage.instancesCount : 0;
      for (const subMesh of mesh.subMeshes) {
        for (const wrapper of (
          subMesh as unknown as { _drawWrappers: ({ drawContext?: DrawContextLike } | undefined)[] }
        )._drawWrappers) {
          const context = wrapper?.drawContext;
          if (context?.indirectDrawBuffer)
            context.setIndirectData(subMesh.indexCount, count, subMesh.indexStart, force);
        }
      }
    }
  }

  private get groups(): ({ _empty: boolean; prepare(): void } | undefined)[] {
    return (
      this.scene.renderingManager as unknown as {
        _renderingGroups: ({ _empty: boolean; prepare(): void } | undefined)[];
      }
    )._renderingGroups;
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
   * occupied, the rest empty. Their lists are emptied either way: a group
   * still holding the recording frame's submeshes would bind every one of them
   * again, only to have the engine skip the draw.
   */
  private markGroups(): void {
    const camera = this.scene.activeCamera;
    if (!camera || !this.engine._snapshotRendering?.play) return;
    const occupied = this.occupied.get(camera) ?? [];
    this.groups.forEach((group, index) => {
      if (!group) return;
      group.prepare();
      group._empty = !occupied.includes(index);
    });
  }

  /** Before the first camera of a frame: batches into a recording, or what moved into a replay. */
  private writeFrameData(): void {
    if (this.kind === "normal") return;
    const frame = this.scene.getFrameId();
    if (frame === this.updatedFrame) return;
    this.updatedFrame = frame;
    // Every update of the frame has run and nothing has drawn: a frame whose
    // draws differ from the recording's draws normally instead of showing what
    // just left (or missing what just came)
    if (drawListSignature(this.scene.meshes, this.isInPlace, this.learnToggle) !== this.recordedSignature) {
      this.stop("draw list");
      return;
    }
    if (this.kind === "recording") {
      this.recordingFrame = (this.scene.getEngine() as unknown as { frameId: number }).frameId;
      this.forceRecorded();
      return;
    }
    // Only the skeletons of skinned meshes that draw, as Babylon's own selection does
    this.skeletons.clear();
    for (const mesh of this.recorded) {
      if (mesh.skeleton && !this.hiddenInPlace.has(mesh) && mesh.isEnabled()) this.skeletons.add(mesh.skeleton);
    }
    for (const skeleton of this.skeletons) skeleton.prepare();
    this.writeInstanceCounts(false);
    this.writeHidden(this.hiddenUnwritten);
    this.hiddenUnwritten = false;
    for (const mesh of this.recorded) {
      if (this.hiddenInPlace.has(mesh) || (mesh.isWorldMatrixFrozen && !mesh.infiniteDistance)) continue;
      const world = mesh.computeWorldMatrix(mesh.infiniteDistance);
      const flag = world.updateFlag;
      const visibility = mesh.visibility;
      const same = this.worldFlags.get(mesh) === flag && this.visibilities.get(mesh) === visibility;
      if (!mesh.infiniteDistance && !mesh.skeleton && same) continue;
      this.worldFlags.set(mesh, flag);
      this.visibilities.set(mesh, visibility);
      mesh.transferToEffect(world);
    }
    // After the loop: binds and per-draw matrices read this frame's world
    // matrices, and the matrices go last (a bind writes the frame's first camera)
    this.writeMaterialValues();
    this.writeDrawMatrices();
    this.writeLights();
  }

  /**
   * What Babylon writes into a light's uniforms while binding a material:
   * direction or position, and the scaled colours. A light bound by materials
   * with and without specular in one frame has a buffer for each, so every
   * buffer gets them. The effect argument is only read without uniform buffers.
   */
  private writeLights(): void {
    for (const light of this.scene.lights) {
      if (!light.isEnabled() || light.getClassName() === "ClusteredLightContainer") continue;
      const ubo = (light as unknown as { _uniformBuffer?: LightBuffer })._uniformBuffer;
      if (!ubo?.useUbo || !ubo._buffers) continue;
      const intensity = light.getScaledIntensity();
      for (const [buffer] of ubo._buffers) {
        if (!ubo.setDataBuffer(buffer)) continue;
        light.transferToEffect(null as unknown as Effect, "");
        light.diffuse.scaleToRef(intensity, this.lightColor);
        ubo.updateColor4("vLightDiffuse", this.lightColor, light.range);
        light.specular.scaleToRef(intensity, this.lightColor);
        ubo.updateColor4("vLightSpecular", this.lightColor, light.radius);
        ubo.update();
      }
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
