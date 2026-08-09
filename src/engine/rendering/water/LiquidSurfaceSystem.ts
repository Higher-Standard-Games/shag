/**
 * Map-scoped owner of every liquid surface.
 *
 * One thing holds the materials, the shared noise, the per-frame clock and the
 * original materials it displaced — so a map unload is a single `dispose()`
 * rather than a hunt for whatever the water left behind. That ownership is the
 * whole reason this is a system and not a function.
 *
 * It claims meshes by the `liquidKind` annotation `BspMeshBuilder` writes, which
 * comes from the classifier: compiled BSP content flags first, the shader's own
 * `surfaceparm` second, an exact-name override above both. A surface is never
 * claimed because its name contains "water".
 *
 * A NODRAW liquid brush produces no drawn mesh at all, so it never reaches
 * here — correct, because it is a volume you swim in with no surface to look
 * at, and 22 of wdm5's 22 liquid brushes are exactly that.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Material } from "@babylonjs/core/Materials/material";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { MirrorTexture } from "@babylonjs/core/Materials/Textures/mirrorTexture";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import RenderVars from "../RenderVars";
import { createUnifiedWaterMaterial, disposeWaterNoise, type WaterKind } from "./UnifiedWaterMaterial";
import { WaterDepthProvider } from "./WaterDepth";
import { WaterReflection } from "./WaterReflection";
import { WaterSceneCapture } from "./WaterSceneCapture";

/**
 * Frames without water drawn before the Epic passes stop.
 *
 * A pillar briefly hiding a pool must not toggle two render targets in and
 * out of the scene; a few frames of grace costs far less than the churn.
 */
const DRY_FRAMES_BEFORE_STOPPING = 10;

/** Local forward, reused so the per-frame camera query does not allocate. */
const FORWARD = new Vector3(0, 0, 1);

interface ClaimedSurface {
  mesh: AbstractMesh;
  /** What the mesh was drawn with before, restored if water is turned off. */
  original: Material | null;
}

export class LiquidSurfaceSystem {
  private readonly materials = new Map<WaterKind, ShaderMaterial>();
  private readonly claimed: ClaimedSurface[] = [];
  private observer: Observer<Scene> | null = null;
  private elapsed = 0;
  /** Reused so the per-frame uniform write does not allocate. */
  private readonly screenSize = new Vector2(1920, 1080);
  /** Owns water's own depth pass; see WaterDepth for why it is not shared. */
  private readonly depth: WaterDepthProvider;
  /** Epic only: a copy of the world behind the water, for refraction. */
  private capture: WaterSceneCapture | null = null;
  /** Epic only: one planar reflection, for the largest pool in the map. */
  private reflection: WaterReflection | null = null;
  /** Height of that pool's surface, chosen once when surfaces are claimed. */
  private reflectionPlaneY: number | null = null;
  /** Last state line printed, so only CHANGES are logged. */
  private lastReport = "";
  /** Set by a claimed mesh when it is drawn; read and cleared each frame. */
  private waterDrawn = false;
  /** False until at least one mesh could be hooked, in which case assume visible. */
  private drawHooked = false;
  /** Consecutive frames with no water drawn, for the stop hysteresis. */
  private dryFrames = 0;
  /** Draw observers on the claimed meshes, removed on dispose. */
  private readonly drawObservers: Array<{ mesh: Mesh; observer: Observer<Mesh> }> = [];

  constructor(private readonly scene: Scene) {
    this.depth = new WaterDepthProvider(scene);
  }

  /**
   * Replace the material on every liquid surface under `root`.
   *
   * @returns how many surfaces were claimed, for the audit command and tests.
   */
  claim(root: AbstractMesh): number {
    let count = 0;

    for (const mesh of [root, ...root.getChildMeshes(false)]) {
      const kind = mesh.metadata?.liquidKind as WaterKind | null | undefined;
      if (!kind) continue;

      const material = this.materialFor(kind);
      // A shader that would not compile leaves the legacy surface alone. A map
      // rendering its old water beats a map with a hole where water should be.
      if (!material) continue;

      this.claimed.push({ mesh, original: mesh.material });
      mesh.material = material;
      this.watchDraws(mesh);
      count++;
    }

    if (count > 0) {
      // Chosen once, here, rather than per frame: the plane is a property of
      // the map, and re-picking it as the player moves would swap which pool
      // reflects mid-match.
      this.reflectionPlaneY = WaterReflection.choosePlaneY(this.claimed.map((s) => s.mesh));
      this.start();
    }
    return count;
  }

  /**
   * Have this surface say when it is drawn.
   *
   * The signal the Epic passes are gated on. It has to come from the mesh
   * because every signal computed ALONGSIDE the renderer has been wrong — see
   * `anyLiquidVisible` for both previous attempts.
   */
  private watchDraws(mesh: AbstractMesh): void {
    // AbstractMesh does not declare the observable; Mesh does, and BSP
    // surfaces are Meshes. Feature-detected rather than assumed, so a future
    // surface type that is not a Mesh degrades to "always visible" instead of
    // throwing.
    const drawable = mesh as unknown as Partial<Mesh>;
    if (!drawable.onBeforeDrawObservable) return;

    const observer = drawable.onBeforeDrawObservable.add(() => {
      this.waterDrawn = true;
    });
    if (!observer) return;

    this.drawObservers.push({ mesh: mesh as Mesh, observer });
    this.drawHooked = true;
  }

  private materialFor(kind: WaterKind): ShaderMaterial | null {
    const existing = this.materials.get(kind);
    if (existing) return existing;

    const created = createUnifiedWaterMaterial(this.scene, kind);
    if (created) this.materials.set(kind, created);
    return created;
  }

  /**
   * Drive the wave clock.
   *
   * Wall time rather than a frame counter, so the surface moves at the same
   * rate whatever the frame rate, and a hitch does not teleport the waves.
   */
  private start(): void {
    if (this.observer) return;
    this.observer = this.scene.onBeforeRenderObservable.add(() => {
      this.elapsed += Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
      const camera = this.scene.activeCameras?.[0] ?? this.scene.activeCamera;
      if (!camera) return;

      const engine = this.scene.getEngine();
      // Asked per frame with the live camera: it swaps on death, spectate and
      // freefly, and a map built for a camera that is no longer rendering
      // describes a view nobody is looking through.
      const depthMap = this.depth.mapFor(camera);
      const debug = RenderVars.getInstance().get("r_water_debug") ?? 0;
      // Refraction costs a second pass over the world, so it is Epic only.
      // Read per frame rather than latched at claim time: r_water_quality is
      // a live setting, and a tier change must not need a map reload.
      const wantsRefraction = (RenderVars.getInstance().get("r_water_quality") ?? 2) >= 3;
      // Both Epic passes are full sweeps over the world, and in a Q3 map the
      // player is looking at water a small fraction of the time. Paying for
      // them while facing away is most of what made Epic expensive.
      const visible = this.anyLiquidVisible();

      const sceneColor = this.captureFor(camera, wantsRefraction, visible);
      const mirror = this.reflectionFor(camera, wantsRefraction, visible);
      this.reportState(wantsRefraction, visible, depthMap !== null, sceneColor !== null, mirror !== null);

      for (const material of this.materials.values()) {
        material.setFloat("uDebug", debug);
        material.setFloat("uTime", this.elapsed);
        material.setVector3("uCameraPosition", camera.globalPosition);
        // Needed to turn the depth term back into a distance along the view
        // ray, which is what places caustics on the floor rather than letting
        // them slide as the player turns.
        material.setVector3("uCameraForward", camera.getDirection(FORWARD));
        material.setFloat("uCameraFar", camera.maxZ);
        // Screen size every frame rather than at build: a resize would
        // otherwise offset every depth lookup by the ratio of the change.
        this.screenSize.set(engine.getRenderWidth(), engine.getRenderHeight());
        material.setVector2("uScreenSize", this.screenSize);

        if (depthMap) {
          material.setTexture("uSceneDepth", depthMap);
          material.setFloat("uHasDepth", 1);
        } else {
          material.setFloat("uHasDepth", 0);
        }

        // Refraction needs BOTH: the capture to sample, and the depth term to
        // decide how far to bend it. Without depth every fragment would think
        // it was infinitely thick and the whole pool would smear equally,
        // including the shoreline.
        if (sceneColor && depthMap) {
          material.setTexture("uSceneColor", sceneColor);
          material.setFloat("uHasRefraction", 1);
        } else {
          material.setFloat("uHasRefraction", 0);
        }

        if (mirror) {
          material.setTexture("uReflection", mirror);
          material.setFloat("uHasReflection", 1);
        } else {
          material.setFloat("uHasReflection", 0);
        }
      }
    });
  }

  /**
   * The planar reflection, built on the first Epic frame and released with it.
   *
   * One mirror for the whole map, at the height of its largest pool. Pools on
   * other floors keep the flat sky colour — a deliberate budget, since each
   * mirror is another full pass over the world and a reflection is the least
   * load-bearing thing the surface does.
   */
  private reflectionFor(camera: Camera, wanted: boolean, visible: boolean): MirrorTexture | null {
    if (!wanted || this.reflectionPlaneY === null) {
      if (this.reflection) {
        this.reflection.dispose();
        this.reflection = null;
      }
      return null;
    }

    if (!this.reflection) this.reflection = new WaterReflection(this.scene);
    const mirror = this.reflection.textureFor(camera, this.reflectionPlaneY);
    this.reflection.setRendering(visible);
    return visible ? mirror : null;
  }

  /**
   * The scene capture, built on first Epic frame and released when Epic ends.
   *
   * Torn down rather than left idle when the tier drops, because an idle
   * capture is still a full pass over the world every frame — the expensive
   * half of the feature would keep running with nothing sampling it.
   */
  private captureFor(camera: Camera, wanted: boolean, visible: boolean): RenderTargetTexture | null {
    if (!wanted) {
      if (this.capture) {
        this.capture.dispose();
        this.capture = null;
      }
      return null;
    }

    if (!this.capture) this.capture = new WaterSceneCapture(this.scene);
    const texture = this.capture.textureFor(camera);
    // Kept alive but unrendered when no water is on screen: rebuilding it
    // every time the player turns around would cost more than the pass.
    this.capture.setRendering(visible);
    return visible ? texture : null;
  }

  /**
   * Say, once, whenever the set of active water terms changes.
   *
   * Every failure in this feature has looked the same from the outside — a
   * flat pale surface — whether the cause was tuning, a missing texture, a
   * quality tier, or a visibility gate answering wrong. Guessing between those
   * has cost more time than building any of them. One line per CHANGE is
   * enough to tell them apart and quiet enough to leave switched on.
   */
  private reportState(epic: boolean, visible: boolean, depth: boolean, refraction: boolean, reflection: boolean): void {
    const line = `tier=${epic ? "epic" : "low/medium"} waterOnScreen=${visible} depth=${depth} refraction=${refraction} reflection=${reflection}`;
    if (line === this.lastReport) return;
    this.lastReport = line;
    console.log(`[Water] ${line}`);
  }

  /**
   * Did the renderer actually draw a liquid surface last frame?
   *
   * Reported by the water meshes themselves, and that detail is the whole
   * point. Two earlier attempts both failed, in ways worth keeping written
   * down because each looked like the effects being unwired:
   *
   * - Testing bounding boxes against the frustum here answered "no" while a
   *   pool filled the screen. Re-deriving culling beside the renderer means
   *   maintaining a second opinion about visibility, and it was wrong.
   * - Reading `scene.getActiveMeshes()` OSCILLATED, every single frame. The
   *   list is rebuilt when a render target draws, and both Epic targets
   *   deliberately exclude water — so the act of enabling them erased the
   *   evidence that they should be enabled. On, off, on, off, forever.
   *
   * A mesh reporting its own draw cannot suffer either problem. Water is
   * excluded from both extra passes, so the only pass that can fire this is
   * the one the player is looking through.
   */
  private anyLiquidVisible(): boolean {
    // Nothing has reported yet — the first frames of a map, or a build where
    // no claimed mesh could be hooked. Assume visible rather than start the
    // effect switched off with no way to recover.
    if (!this.drawHooked) return true;

    const drawn = this.waterDrawn;
    this.waterDrawn = false;

    if (drawn) {
      this.dryFrames = 0;
      return true;
    }

    // Hysteresis. Registering and unregistering render targets every time a
    // pillar briefly hides a pool would churn more than the passes cost.
    this.dryFrames++;
    return this.dryFrames < DRY_FRAMES_BEFORE_STOPPING;
  }

  /** How many surfaces this system currently draws. */
  get claimedCount(): number {
    return this.claimed.length;
  }

  /**
   * Hand every surface back and release everything owned.
   *
   * Restoring the original material first matters: the meshes outlive this
   * system when water is toggled off mid-session, and a mesh pointing at a
   * disposed material renders as nothing at all.
   */
  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }

    for (const { mesh, observer } of this.drawObservers) {
      if (!mesh.isDisposed()) mesh.onBeforeDrawObservable.remove(observer);
    }
    this.drawObservers.length = 0;
    this.drawHooked = false;
    this.waterDrawn = false;
    this.dryFrames = 0;

    for (const surface of this.claimed) {
      if (!surface.mesh.isDisposed()) surface.mesh.material = surface.original;
    }
    this.claimed.length = 0;

    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();

    // Water's own depth pass, and only water's. Left behind, every map load
    // adds another full-scene depth pass to a scene that may no longer have
    // water in it at all.
    this.depth.dispose();
    this.capture?.dispose();
    this.capture = null;
    this.reflection?.dispose();
    this.reflection = null;
    this.reflectionPlaneY = null;

    disposeWaterNoise(this.scene);
    this.elapsed = 0;
  }
}
