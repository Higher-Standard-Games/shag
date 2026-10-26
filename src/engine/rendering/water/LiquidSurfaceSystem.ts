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
 * All tiers use cached static room cubemaps and reactive normals. Medium/Epic
 * add camera-scoped depth; Epic also captures half-resolution world colour.
 * Both passes are suspended off-screen, and behind walls: a surface the view's
 * occlusion query finds hidden is not drawn.
 * Splash geometry is owned by the gameplay interaction system (tiers 2/3).
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Material } from "@babylonjs/core/Materials/material";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Vector2, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { devLog } from "../../core/DevLog";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.query";
import "@babylonjs/core/Engines/Extensions/engine.query";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import "@babylonjs/core/Rendering/boundingBoxRenderer";
import type { Scene } from "@babylonjs/core/scene";
import RenderVars from "../RenderVars";
import {
  createUnifiedWaterMaterial,
  disposeWaterNoise,
  setWaterEnvironment,
  type WaterKind,
  waterFallbackCube,
  waterFallbackTexture,
} from "./UnifiedWaterMaterial";
import { WaterActorReflection } from "./WaterActorReflection";
import { WaterDepthProvider } from "./WaterDepth";
import { clearWaterDisturbances, waterDisturbancesFor } from "./WaterDisturbances";
import { WaterProbeCache } from "./WaterProbeCache";
import { WaterRefractionProvider } from "./WaterRefraction";
import { type WaterMapLight, WaterSurfaceLighting } from "./WaterSurfaceLighting";

/**
 * Whether a liquid gets the reactive surface: a probe patch, and with it the
 * ripples and wakes of bodies moving through it, and players reflected in it.
 * Water and slime do; slime is thick, but a body wading through it still pushes
 * a wave. Lava does not: it crusts rather than ripples, and reflects nothing.
 * Static light highlights stay calm water's alone, in the shader.
 */
export function hasReactiveSurface(kind: WaterKind): boolean {
  return kind !== "lava";
}

/**
 * Frames without water drawn before the depth pass stops.
 *
 * A pillar briefly hiding a pool must not toggle a render target in and out of
 * the scene; a few frames of grace costs far less than the churn.
 */
const DRY_FRAMES_BEFORE_STOPPING = 10;
/** Units added around a surface's bounds for its occlusion query. */
const OCCLUSION_PAD = 4;
/** Height a liquid surface may span and still count as flat. */
const FLAT_TOLERANCE = 2;

/** Local forward, reused so the per-frame camera query does not allocate. */
const FORWARD = new Vector3(0, 0, 1);

interface ClaimedSurface {
  mesh: AbstractMesh;
  kind: WaterKind;
  key: string;
  /** What the mesh was drawn with before, restored if water is turned off. */
  original: Material | null;
}

interface OwnedEnvironment {
  texture: BaseTexture;
  owned: boolean;
}

export class LiquidSurfaceSystem {
  private readonly materials = new Map<string, ShaderMaterial>();
  /** A failed variant stays on legacy for the remainder of this map load. */
  private readonly failedKinds = new Set<string>();
  private readonly claimed: ClaimedSurface[] = [];
  private readonly claimedMeshes = new Set<AbstractMesh>();
  private observer: Observer<Scene> | null = null;
  private elapsed = 0;
  /** Reused so the per-frame uniform write does not allocate. */
  private readonly screenSize = new Vector2(1920, 1080);
  private readonly depthProjection = new Vector4(0, 0, 0, 0);
  /** Owns water's own depth pass; see WaterDepth for why it is not shared. */
  private readonly depth: WaterDepthProvider;
  private readonly refraction: WaterRefractionProvider;
  private readonly actorReflection: WaterActorReflection;
  /** Borrowed map sky used when a liquid does not provide its own cubemap. */
  private fallbackEnvironment: BaseTexture | null = null;
  /** Per-kind shader cubemaps. These map resources are disposed with water. */
  private readonly environments = new Map<WaterKind, OwnedEnvironment>();
  private readonly probes: WaterProbeCache;
  private readonly lighting: WaterSurfaceLighting;
  /** Authored BSP lights only, supplied before claim; not live scene lights. */
  mapLights: readonly WaterMapLight[] = [];
  /** Last state line printed, so only CHANGES are logged. */
  private lastReport = "";
  private readonly lastReportFields = {
    visible: false,
    depth: false,
    quality: Number.NaN,
    cached: false,
    environment: false,
    actors: Number.NaN,
  };
  private readonly cameraForward = new Vector3();
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
    this.refraction = new WaterRefractionProvider(scene);
    this.actorReflection = new WaterActorReflection(scene);
    this.probes = new WaterProbeCache(scene, RenderVars.getInstance().get("r_water_probe_height") ?? 64);
    this.lighting = new WaterSurfaceLighting(scene);
    waterDisturbancesFor(scene).resolveSurface = (position) => this.probes.surfaceAt(position);
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
      if (this.claimedMeshes.has(mesh)) continue;

      const requestedProfile = mesh.metadata?.liquidProfile ?? "default";
      const profile = kind === "water" && ["clear", "deep"].includes(requestedProfile) ? requestedProfile : "default";
      if (requestedProfile !== profile)
        console.warn(`[Water] Unknown ${kind} profile '${requestedProfile}'; using default`);
      const key = `${kind}:${profile}`;
      const material = this.materialFor(kind, profile);
      // A synchronous construction failure leaves the legacy surface alone;
      // lazy GPU compilation failure is handled by material.onError below.
      if (!material) continue;

      this.claimed.push({ mesh, kind, key, original: mesh.material });
      this.claimedMeshes.add(mesh);
      mesh.material = material;
      // Strict queries retain the last answer while the next is in flight.
      // NCM can replay queries in a pass without a query set; keep water visible
      // there and let ordinary visibility/frustum tests decide whether it draws.
      mesh.occlusionType = this.supportsOcclusionQueries()
        ? AbstractMesh.OCCLUSION_TYPE_STRICT
        : AbstractMesh.OCCLUSION_TYPE_NONE;
      if (!this.supportsOcclusionQueries()) mesh.isOccluded = false;
      mesh.occlusionQueryAlgorithmType = AbstractMesh.OCCLUSION_ALGORITHM_TYPE_CONSERVATIVE;
      // A flat pool has flat bounds, and an accurate query never sees a box
      // without thickness
      const bounds = mesh.getBoundingInfo();
      const pad = new Vector3(OCCLUSION_PAD, OCCLUSION_PAD, OCCLUSION_PAD);
      bounds.reConstruct(bounds.minimum.subtract(pad), bounds.maximum.add(pad), mesh.getWorldMatrix());
      devLog(`[Water] Bound ${mesh.name}: kind=${kind} profile=${profile}`);
      this.watchDraws(mesh);
      count++;
    }

    if (count > 0) {
      this.actorReflection.claim(root);
      this.probes.claim(
        root,
        this.claimed.filter((surface) => hasReactiveSurface(surface.kind)).map((surface) => surface.mesh),
      );
      this.start();
      this.lighting.prepare(
        root,
        this.claimed.flatMap((surface) => {
          const patch = this.probes.patchFor(surface.mesh);
          return hasReactiveSurface(surface.kind) && patch ? [patch] : [];
        }),
        this.mapLights,
      );
      devLog(`[Water] Cached static highlight sources: ${this.lighting.lightCount}`);
    }
    return count;
  }

  /**
   * Bind a borrowed scene environment, or an optionally-owned liquid cubemap.
   * A kind-specific map always wins over the general sky fallback.
   */
  /** Capture every pool's room cubemap now; map loading calls this behind the loading screen. */
  captureReflections(camera: Camera): number {
    return this.probes.captureAll(camera);
  }

  setEnvironmentTexture(texture: BaseTexture | null, options: { kind?: WaterKind; owned?: boolean } = {}): void {
    if (options.kind) {
      const previous = this.environments.get(options.kind);
      if (previous?.owned && previous.texture !== texture) previous.texture.dispose();
      if (texture) this.environments.set(options.kind, { texture, owned: options.owned ?? false });
      else this.environments.delete(options.kind);

      for (const [key, material] of this.materials) {
        if (key.split(":")[0] === options.kind) setWaterEnvironment(material, texture ?? this.fallbackEnvironment);
      }
      return;
    }

    this.fallbackEnvironment = texture;
    for (const [key, material] of this.materials) {
      const kind = key.split(":")[0] as WaterKind;
      setWaterEnvironment(material, this.environments.get(kind)?.texture ?? texture);
    }
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

  private materialFor(kind: WaterKind, profile: string): ShaderMaterial | null {
    const key = `${kind}:${profile}`;
    if (this.failedKinds.has(key)) return null;
    const existing = this.materials.get(key);
    if (existing) return existing;

    const created = createUnifiedWaterMaterial(this.scene, kind, { profile });
    if (created) {
      created.onError = (_effect, errors) => this.scheduleLegacyFallback(key, created, errors);
      setWaterEnvironment(created, this.environments.get(kind)?.texture ?? this.fallbackEnvironment);
      // onBind runs after ShaderMaterial's cached uniform upload. Set per-mesh
      // resources directly on the effect so a shared material never samples
      // the previous pool's capture or impulse membership.
      created.onBindObservable.add((mesh) => {
        if (!mesh) return;
        const effect = created.getEffect();
        const fallback =
          this.environments.get(kind)?.texture ?? this.fallbackEnvironment ?? waterFallbackCube(this.scene);
        this.probes.bind(effect, mesh, fallback);
        const patch = this.probes.patchFor(mesh);
        this.actorReflection.bind(effect, hasReactiveSurface(kind) ? patch : null);
        this.lighting.bind(effect, hasReactiveSurface(kind) ? patch : null);
        const impulses = waterDisturbancesFor(this.scene);
        effect.setFloatArray4(
          "uImpulses",
          impulses.pack((x, y, z) => patch?.contains(x, y, z) ?? false),
        );
      });
      this.materials.set(key, created);
    }
    return created;
  }

  /**
   * Shader compilation is lazy in Babylon, so constructor try/catch cannot
   * catch the important failure. Restore every affected surface after the
   * failing render finishes rather than leaving an invisible shader assigned.
   */
  private scheduleLegacyFallback(key: string, material: ShaderMaterial, errors: string): void {
    if (this.failedKinds.has(key)) return;
    this.failedKinds.add(key);
    console.warn(`[Water] ${key} shader failed; restoring legacy materials`, errors);

    queueMicrotask(() => {
      if (this.materials.get(key) !== material) return;
      const restoredMeshes = new Set<AbstractMesh>();

      for (let i = this.claimed.length - 1; i >= 0; i--) {
        const surface = this.claimed[i];
        if (surface.key !== key) continue;
        if (!surface.mesh.isDisposed()) {
          surface.mesh.material = surface.original;
          surface.mesh.occlusionType = AbstractMesh.OCCLUSION_TYPE_NONE;
        }
        restoredMeshes.add(surface.mesh);
        this.probes.remove(surface.mesh);
        this.claimedMeshes.delete(surface.mesh);
        this.claimed.splice(i, 1);
      }

      for (let i = this.drawObservers.length - 1; i >= 0; i--) {
        const watched = this.drawObservers[i];
        if (!restoredMeshes.has(watched.mesh)) continue;
        if (!watched.mesh.isDisposed()) watched.mesh.onBeforeDrawObservable.remove(watched.observer);
        this.drawObservers.splice(i, 1);
      }

      this.materials.delete(key);
      material.dispose();

      if (this.claimed.length === 0 && this.observer) {
        this.scene.onBeforeRenderObservable.remove(this.observer);
        this.observer = null;
        this.depth.setRendering(false);
        this.refraction.setRendering(false);
        this.actorReflection.dispose();
        this.probes.dispose();
        this.lighting.dispose();
      }
      if (this.materials.size === 0) disposeWaterNoise(this.scene);
    });
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
      const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
      this.elapsed += dt;
      waterDisturbancesFor(this.scene).update(dt);
      const camera = this.scene.activeCameras?.[0] ?? this.scene.activeCamera;
      if (!camera) return;
      for (const surface of this.claimed) this.occlusionFor(surface.mesh, camera);

      const engine = this.scene.getEngine();
      // Asked per frame with the live camera: it swaps on death, spectate and
      // freefly, and a map built for a camera that is no longer rendering
      // describes a view nobody is looking through.
      const debug = RenderVars.getInstance().get("r_water_debug") ?? 0;
      const quality = RenderVars.getInstance().get("r_water_quality") ?? 3;
      // Epic reads depth from its colour capture's own depth buffer, one scene
      // pass for both; Medium, or a device without that buffer, has the depth pass
      const colourMap = quality >= 3 ? this.refraction.mapFor(camera) : null;
      const colourDepth = colourMap ? this.refraction.depthTexture() : null;
      const depthMap = quality >= 2 && !colourDepth ? this.depth.mapFor(camera) : null;
      const sceneDepth = colourDepth ?? depthMap;

      // The depth pass resubmits the world camera's visible geometry; suspend
      // it after the water leaves view.
      const visible = this.anyLiquidVisible();
      const ceiling = this.captureCeiling(camera);
      this.depth.setCaptureCeiling(ceiling);
      this.refraction.setCaptureCeiling(ceiling);
      this.depth.setRendering(visible && depthMap !== null);
      this.refraction.setRendering(visible && colourMap !== null && sceneDepth !== null);

      if (visible) this.probes.update(camera);
      this.actorReflection.update(
        camera,
        this.claimed.flatMap((surface) => {
          const patch = this.probes.patchFor(surface.mesh);
          return hasReactiveSurface(surface.kind) && patch ? [patch] : [];
        }),
        visible && quality >= 3 && !!RenderVars.getInstance().get("r_water_actors"),
        !RenderVars.getInstance().get("r_water_actors")
          ? "r_water_actors 0"
          : quality < 3
            ? "requires quality 3"
            : "water offscreen",
      );
      this.reportState(
        visible,
        sceneDepth !== null,
        quality,
        this.probes.entries.some((entry) => entry.ready),
      );

      // The same for every material this frame, so read once rather than per
      // material: six cvar lookups and a camera direction each.
      const vars = RenderVars.getInstance();
      const highlights = vars.get("r_water_highlights") ?? 0.6;
      const roughness = vars.get("r_water_roughness") ?? 0.3;
      const reflection = vars.get("r_water_reflection") ?? 1.3;
      const blur = vars.get("r_water_blur") ?? 0.3;
      const detail = vars.get("r_water_detail") ?? 0.8;
      const contact = vars.get("r_water_contact") ?? 0.25;
      camera.getDirectionToRef(FORWARD, this.cameraForward);
      for (const material of this.materials.values()) {
        material.setFloat("uDebug", debug);
        material.setFloat("uTime", this.elapsed);
        material.setFloat("uHighlightStrength", highlights);
        material.setFloat("uRoughness", roughness);
        material.setFloat("uReflectionStrength", reflection);
        material.setFloat("uReflectionBlur", blur);
        material.setFloat("uDetailStrength", detail);
        material.setFloat("uContactStrength", contact);
        material.setFloat("uHasRefraction", colourMap && sceneDepth && visible ? 1 : 0);
        material.setTexture(
          "uSceneColour",
          colourMap && sceneDepth && visible ? colourMap : waterFallbackTexture(this.scene),
        );
        if (colourMap) {
          const processing = this.scene.imageProcessingConfiguration;
          material.setFloat("uRefractionIsLinear", processing.isEnabled && processing.applyByPostProcess ? 1 : 0);
        }
        material.setVector3("uCameraPosition", camera.globalPosition);
        // Turns the depth term back into a distance along the view ray, which
        // is what places caustics on the floor rather than letting them slide
        // as the player turns.
        material.setVector3("uCameraForward", this.cameraForward);
        material.setFloat("uCameraFar", camera.maxZ);
        // Screen size every frame rather than at build: a resize would
        // otherwise offset every depth lookup by the ratio of the change.
        this.screenSize.set(engine.getRenderWidth(), engine.getRenderHeight());
        material.setVector2("uScreenSize", this.screenSize);

        if (sceneDepth && visible) {
          material.setTexture("uSceneDepth", sceneDepth);
          material.setFloat("uHasDepth", 1);
          this.depthProjection.set(camera.minZ, camera.maxZ, engine.isNDCHalfZRange ? 1 : 0, colourDepth ? 1 : 0);
          material.setVector4("uDepthProjection", this.depthProjection);
        } else {
          // ShaderMaterial checks bound samplers even when uHasDepth disables their use.
          material.setTexture("uSceneDepth", waterFallbackTexture(this.scene));
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
  private reportState(visible: boolean, depth: boolean, quality: number, cached: boolean): void {
    let environment = false;
    for (const key of this.materials.keys()) {
      const colon = key.indexOf(":");
      const kind = (colon < 0 ? key : key.slice(0, colon)) as WaterKind;
      if ((this.environments.get(kind)?.texture ?? this.fallbackEnvironment) !== null) {
        environment = true;
        break;
      }
    }
    // Compared field by field before any string is built: this runs every
    // frame and the answer changes a handful of times per map.
    const actors = this.actorReflection.actorCount;
    const last = this.lastReportFields;
    if (
      last.visible === visible &&
      last.depth === depth &&
      last.quality === quality &&
      last.cached === cached &&
      last.environment === environment &&
      last.actors === actors
    ) {
      return;
    }
    Object.assign(last, { visible, depth, quality, cached, environment, actors });
    const line = `waterOnScreen=${visible} tier=${quality} depth=${depth} environment=${environment} cachedRoom=${cached} reflectedActors=${actors}`;
    if (line === this.lastReport) return;
    this.lastReport = line;
    devLog(`[Water] ${line}`);
  }

  private supportsOcclusionQueries(): boolean {
    const engine = this.scene.getEngine();
    return !engine.isWebGPU || engine.compatibilityMode !== false;
  }

  /**
   * The view's own pass asks the query; other passes that draw the water reuse
   * its answer. The query draws the surface's bounds, and from inside them no
   * face of the box is drawn, so a view inside the bounds — a map whose pools
   * are one mesh spanning most of it — would find the water hidden for good.
   * There the query is off and the surface is drawn.
   */
  private occlusionFor(mesh: AbstractMesh, camera: Camera): void {
    if (!this.supportsOcclusionQueries()) {
      mesh.occlusionType = AbstractMesh.OCCLUSION_TYPE_NONE;
      mesh.isOccluded = false;
      return;
    }
    mesh.occlusionForRenderPassId = camera.renderPassId;
    const { minimumWorld: min, maximumWorld: max } = mesh.getBoundingInfo().boundingBox;
    const eye = camera.globalPosition;
    const margin = camera.minZ + 1;
    const inside =
      eye.x > min.x - margin &&
      eye.x < max.x + margin &&
      eye.y > min.y - margin &&
      eye.y < max.y + margin &&
      eye.z > min.z - margin &&
      eye.z < max.z + margin;
    mesh.occlusionType = inside ? AbstractMesh.OCCLUSION_TYPE_NONE : AbstractMesh.OCCLUSION_TYPE_STRICT;
  }

  /**
   * The top of the water, when every surface is flat and the view is above
   * it all; null otherwise. Through a flat surface seen from above only what
   * lies below it shows, so the depth and colour passes need nothing higher.
   * A view under the surface looks up through it, and a waterfall has no top.
   */
  private captureCeiling(camera: Camera): number | null {
    let top = Number.NEGATIVE_INFINITY;
    for (const { mesh } of this.claimed) {
      if (mesh.isDisposed()) continue;
      const box = mesh.getBoundingInfo().boundingBox;
      if (box.maximumWorld.y - box.minimumWorld.y > 2 * OCCLUSION_PAD + FLAT_TOLERANCE) return null;
      top = Math.max(top, box.maximumWorld.y);
    }
    if (!Number.isFinite(top) || camera.globalPosition.y <= top) return null;
    return top;
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
      if (!surface.mesh.isDisposed()) {
        surface.mesh.material = surface.original;
        surface.mesh.occlusionType = AbstractMesh.OCCLUSION_TYPE_NONE;
      }
    }
    this.claimed.length = 0;
    this.claimedMeshes.clear();

    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();

    this.probes.dispose();
    clearWaterDisturbances(this.scene);
    this.lighting.dispose();
    this.mapLights = [];

    const disposed = new Set<BaseTexture>();
    for (const environment of this.environments.values()) {
      if (environment.owned && !disposed.has(environment.texture)) {
        environment.texture.dispose();
        disposed.add(environment.texture);
      }
    }
    this.environments.clear();
    this.fallbackEnvironment = null;
    this.failedKinds.clear();

    // Water's own depth pass, and only water's. Left behind, every map load
    // adds another full-scene depth pass to a scene that may no longer have
    // water in it at all.
    this.depth.dispose();
    this.refraction.dispose();
    this.actorReflection.dispose();

    disposeWaterNoise(this.scene);
    this.elapsed = 0;
    this.lastReport = "";
    this.lastReportFields.quality = Number.NaN;
  }
}
