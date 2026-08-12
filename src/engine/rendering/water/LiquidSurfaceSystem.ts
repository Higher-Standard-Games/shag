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
 *
 * ONE extra scene pass, ever: the depth pass. It is the whole effect — colour,
 * transparency, foam and caustics are all the thickness term — and everything
 * else the surface does is arithmetic inside the water's own draw. A refraction
 * capture and a planar mirror were built here and removed: each re-submitted
 * all world geometry, tripling draw calls on a map made of small brush
 * submeshes, and what they bought was a few pixels of distortion over flat
 * textures and a reflection that Fresnel correctly hides at the angle players
 * actually look at pools.
 */

import type { Material } from "@babylonjs/core/Materials/material";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import RenderVars from "../RenderVars";
import { createUnifiedWaterMaterial, disposeWaterNoise, type WaterKind } from "./UnifiedWaterMaterial";
import { WaterDepthProvider } from "./WaterDepth";

/**
 * Frames without water drawn before the depth pass stops.
 *
 * A pillar briefly hiding a pool must not toggle a render target in and out of
 * the scene; a few frames of grace costs far less than the churn.
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

    if (count > 0) this.start();
    return count;
  }

  /**
   * Have this surface say when it is drawn.
   *
   * The signal the depth pass is gated on, and it has to come from the mesh
   * because every signal computed ALONGSIDE the renderer has been wrong here.
   * Testing bounding boxes against the frustum answered "no" while a pool
   * filled the screen. Reading `scene.getActiveMeshes()` oscillated every
   * frame, because that list is rebuilt whenever a render target draws and the
   * water's own targets exclude liquid — so enabling them erased the evidence
   * that they should be enabled.
   *
   * A mesh reporting its own draw cannot suffer either problem.
   */
  private watchDraws(mesh: AbstractMesh): void {
    // AbstractMesh does not declare the observable; Mesh does, and BSP
    // surfaces are Meshes. Feature-detected rather than assumed, so a surface
    // type that is not a Mesh degrades to "always visible" instead of throwing.
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
   * Drive the wave clock and feed the per-frame uniforms.
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

      // The depth pass is a full sweep over the world, and in a Q3 map the
      // player is looking at water a small fraction of the time.
      const visible = this.anyLiquidVisible();
      this.depth.setRendering(visible);
      this.reportState(visible, depthMap !== null);

      for (const material of this.materials.values()) {
        material.setFloat("uDebug", debug);
        material.setFloat("uTime", this.elapsed);
        material.setVector3("uCameraPosition", camera.globalPosition);
        // Turns the depth term back into a distance along the view ray, which
        // is what places caustics on the floor rather than letting them slide
        // as the player turns.
        material.setVector3("uCameraForward", camera.getDirection(FORWARD));
        material.setFloat("uCameraFar", camera.maxZ);
        // Screen size every frame rather than at build: a resize would
        // otherwise offset every depth lookup by the ratio of the change.
        this.screenSize.set(engine.getRenderWidth(), engine.getRenderHeight());
        material.setVector2("uScreenSize", this.screenSize);

        if (depthMap && visible) {
          material.setTexture("uSceneDepth", depthMap);
          material.setFloat("uHasDepth", 1);
        } else {
          material.setFloat("uHasDepth", 0);
        }
      }
    });
  }

  /**
   * Say, once, whenever the set of active water terms changes.
   *
   * Every failure in this feature has looked the same from outside — a flat
   * pale surface — whether the cause was tuning, a missing texture or a gate
   * answering wrong. Guessing between those cost more time than building any
   * of them. One line per CHANGE tells them apart and is quiet enough to leave
   * switched on.
   */
  private reportState(visible: boolean, depth: boolean): void {
    const line = `waterOnScreen=${visible} depth=${depth}`;
    if (line === this.lastReport) return;
    this.lastReport = line;
    console.log(`[Water] ${line}`);
  }

  /** Did the renderer actually draw a liquid surface last frame? */
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

    disposeWaterNoise(this.scene);
    this.elapsed = 0;
    this.lastReport = "";
  }
}
