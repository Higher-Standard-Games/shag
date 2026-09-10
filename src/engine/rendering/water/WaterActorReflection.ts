/** Single-view actor overlay. Static scenery writes black/zero coverage
 * and depth, never reflected colour. No dependency on the main view's PVS list. */
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { MirrorTexture } from "@babylonjs/core/Materials/Textures/mirrorTexture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Frustum } from "@babylonjs/core/Maths/math.frustum";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { Matrix, type Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { WaterPatch } from "./WaterProbeCache";

const WEAPON_LAYER = 0x10000000;
export const ACTOR_REFLECTION_RANGE = 240;
const MAX_ACTORS = 2;
const MAX_ACTOR_MESHES = 32;
const MAX_OCCLUDER_DRAWS = 256;
const providers = new WeakMap<Scene, WaterActorReflection>();

export function waterNeedsLocalReflection(scene: Scene): boolean {
  return providers.get(scene)?.localBodyWanted ?? false;
}

export function waterActorReflectionStatus(scene: Scene): string {
  const provider = providers.get(scene);
  return provider
    ? `Actor reflection: ${provider.status}; selected=${provider.actorCount}.`
    : "Actor reflection: no water renderer.";
}

export function isReflectionOnlyActor(mesh: AbstractMesh): boolean {
  for (let node = mesh as import("@babylonjs/core/node").Node | null; node; node = node.parent) {
    if (node.metadata?.waterReflectionOnly === true) return true;
  }
  return false;
}

export function distanceToWater(p: Vector3, patch: WaterPatch): number {
  return Math.hypot(
    Math.max(patch.min.x - p.x, 0, p.x - patch.max.x),
    p.y - patch.min.y,
    Math.max(patch.min.z - p.z, 0, p.z - patch.max.z),
  );
}

/** Explicit opt-in metadata on a model root; effects/weapon layers never inherit it. */
export function waterActorId(mesh: AbstractMesh): string | null {
  if (
    mesh.metadata?.effectOwned ||
    mesh.metadata?.excludeFromWaterCapture ||
    mesh.metadata?.liquidKind ||
    (mesh.layerMask & WEAPON_LAYER) !== 0
  )
    return null;
  for (let node = mesh as import("@babylonjs/core/node").Node | null; node; node = node.parent) {
    if (typeof node.metadata?.waterReflectionActorId === "string") return node.metadata.waterReflectionActorId;
  }
  return null;
}

export class WaterActorReflection {
  texture: MirrorTexture | null = null;
  patch: WaterPatch | null = null;
  actorCount = 0;
  localBodyWanted = false;
  status = "waiting for a frame";
  private camera: Camera | null = null;
  private readonly occluders = new Set<AbstractMesh>();
  private blocker: ShaderMaterial | null = null;
  private readonly matrix = Matrix.Identity();
  private readonly cullMatrix = Matrix.Identity();
  private readonly frustum = Frustum.GetPlanes(Matrix.Identity());
  private readonly hidden: AbstractMesh[] = [];
  private readonly overridden = new Set<AbstractMesh>();
  private readonly actorStyles: Array<{ mesh: Mesh; outline: boolean; overlay: boolean }> = [];
  private ready = false;
  private failed = false;

  constructor(private readonly scene: Scene) {
    providers.set(scene, this);
  }

  claim(root: AbstractMesh): void {
    for (const mesh of [root, ...root.getChildMeshes(false)]) {
      if (
        !mesh.getTotalVertices() ||
        mesh.infiniteDistance ||
        mesh.metadata?.liquidKind ||
        mesh.metadata?.effectOwned ||
        mesh.metadata?.excludeFromWaterCapture ||
        mesh.metadata?.autosprite ||
        mesh.metadata?.autosprite2 ||
        (mesh.layerMask & WEAPON_LAYER) !== 0 ||
        waterActorId(mesh)
      )
        continue;
      // Alpha-tested geometry is conservatively solid in this prototype.
      if (!mesh.material?.needAlphaBlendingForMesh(mesh)) this.occluders.add(mesh);
    }
  }

  update(camera: Camera, patches: readonly WaterPatch[], enabled: boolean, disabledReason = "disabled"): void {
    this.detach();
    this.patch = null;
    this.actorCount = 0;
    this.ready = false;
    this.localBodyWanted = false;
    this.status = this.failed ? "capture failed" : disabledReason;
    if (!enabled || this.failed) return;
    camera.getViewMatrix();
    const position = camera.globalPosition;
    const patch = [...new Set(patches)]
      .filter(
        (p) =>
          position.y > p.min.y + 1 &&
          distanceToWater(position, p) < ACTOR_REFLECTION_RANGE &&
          p.meshes.some((m) => m.isEnabled() && m.isVisible && camera.isInFrustum(m)),
      )
      .sort((a, b) => distanceToWater(position, a) - distanceToWater(position, b))[0];
    this.status = "no nearby visible pool above water (range 240u)";
    if (!patch) return;
    this.localBodyWanted = true;
    const groups = new Map<string, { meshes: AbstractMesh[]; distance: number }>();
    for (const mesh of this.scene.meshes) {
      const id = waterActorId(mesh);
      if (
        !id ||
        !mesh.isEnabled() ||
        (!mesh.isVisible && !isReflectionOnlyActor(mesh)) ||
        mesh.visibility <= 0 ||
        !mesh.getTotalVertices() ||
        mesh.material?.needAlphaBlendingForMesh(mesh) ||
        (mesh.layerMask & camera.layerMask) === 0
      )
        continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      const distance = distanceToWater(box.centerWorld, patch);
      if (distance > 160 || box.maximumWorld.y <= patch.min.y) continue;
      const group = groups.get(id) ?? { meshes: [], distance };
      group.meshes.push(mesh);
      group.distance = Math.min(group.distance, distance);
      groups.set(id, group);
    }
    const actors = [...groups.values()].sort((a, b) => a.distance - b.distance).slice(0, MAX_ACTORS);
    const meshes = actors.flatMap((a) => a.meshes);
    this.status = "no eligible model (loading, hidden, submerged or beyond 160u)";
    if (!meshes.length) return;
    this.status = "actor geometry budget exceeded";
    if (meshes.reduce((n, m) => n + (m.subMeshes?.length ?? 0), 0) > MAX_ACTOR_MESHES) return;
    // patch.position is a cubemap anchor lifted 2u above water, NOT its plane.
    Matrix.ReflectionToRef(new Plane(0, -1, 0, patch.min.y), this.cullMatrix);
    this.cullMatrix.multiplyToRef(camera.getViewMatrix(), this.cullMatrix);
    this.cullMatrix.multiplyToRef(camera.getProjectionMatrix(), this.cullMatrix);
    Frustum.GetPlanesToRef(this.cullMatrix, this.frustum);
    const blockers = [...this.occluders].filter((mesh) => {
      if (mesh.isDisposed() || !mesh.isEnabled() || (mesh.layerMask & camera.layerMask) === 0) return false;
      mesh.computeWorldMatrix(true);
      return mesh.getBoundingInfo().boundingBox.maximumWorld.y >= patch.min.y && mesh.isInFrustum(this.frustum);
    });
    // Never truncate occluders to hit a budget: that could reveal hidden actors.
    this.status = "occluder budget exceeded";
    if (blockers.reduce((n, m) => n + (m.subMeshes?.length ?? 0), 0) > MAX_OCCLUDER_DRAWS) return;
    try {
      this.ensureTexture();
      const target = this.texture!;
      const renderWidth = this.scene.getEngine().getRenderWidth(true);
      const renderHeight = this.scene.getEngine().getRenderHeight(true);
      const scale = Math.min(0.25, 320 / Math.max(1, renderWidth), 320 / Math.max(1, renderHeight));
      const width = Math.max(1, Math.floor(renderWidth * scale));
      const height = Math.max(1, Math.floor(renderHeight * scale));
      if (target.getSize().width !== width || target.getSize().height !== height) target.resize({ width, height });
      target.activeCamera = camera;
      target.mirrorPlane = new Plane(0, -1, 0, patch.min.y);
      this.blocker!.setFloat("waterY", patch.min.y);
      this.status = "waiting for occlusion shader/geometry";
      if (blockers.some((mesh) => !mesh.isReady(true) || !this.blocker!.isReady(mesh))) return;
      for (const mesh of blockers)
        if (!this.overridden.has(mesh)) {
          target.setMaterialForRendering(mesh, this.blocker!);
          this.overridden.add(mesh);
        }
      target.renderList = [...blockers, ...meshes];
      this.patch = patch;
      this.actorCount = actors.length;
      this.status = "capture scheduled";
      this.camera = camera;
      camera.customRenderTargets.push(target);
    } catch (error) {
      console.warn("[Water] Actor reflection disabled after capture setup failure", error);
      this.failed = true;
      this.dispose();
    }
  }

  private ensureTexture(): void {
    if (this.texture) return;
    this.blocker = new ShaderMaterial(
      "water-actor-occluder",
      this.scene,
      {
        vertexSource: `precision highp float; attribute vec3 position;
        uniform mat4 world; uniform mat4 viewProjection; varying float height;
        void main(){ vec4 p=world*vec4(position,1.0); height=p.y; gl_Position=viewProjection*p; }`,
        fragmentSource: `precision highp float; varying float height; uniform float waterY;
        void main(){ if(height<waterY) discard; gl_FragColor=vec4(0.0); }`,
      },
      { attributes: ["position"], uniforms: ["world", "viewProjection", "waterY"], needAlphaBlending: false },
    );
    this.blocker.backFaceCulling = false;
    this.blocker.disableDepthWrite = false;
    this.blocker.onError = (_effect, error) => {
      console.warn("[Water] Actor occlusion shader failed; disabling overlay", error);
      this.failed = true;
      this.ready = false;
      this.detach();
    };
    this.texture = new MirrorTexture("water-actor-reflection", 1, this.scene, false);
    const target = this.texture;
    target.clearColor = new Color4(0, 0, 0, 0);
    target.renderParticles = false;
    target.renderSprites = false;
    target.useCameraPostProcesses = false;
    target.forceLayerMaskCheck = true;
    target.ignoreCameraViewport = false;
    target.refreshRate = 1;
    // Share depth between rendering groups (players need not be in world group 0).
    for (let group = 0; group < 4; group++) target.setRenderingAutoClearDepthStencil(group, false);
    target.onBeforeBindObservable.add(() => {
      for (const mesh of this.occluders) {
        if (!mesh.isDisposed() && !mesh.isVisible) {
          this.hidden.push(mesh);
          mesh.isVisible = true;
        }
      }
      // Gameplay outlines/overlays are not part of a soft physical silhouette.
      // Some use depth/stencil tricks that are inappropriate in an occlusion mask.
      for (const mesh of target.renderList ?? [])
        if (waterActorId(mesh)) {
          if (isReflectionOnlyActor(mesh) && !mesh.isVisible) {
            this.hidden.push(mesh);
            mesh.isVisible = true;
          }
          const drawable = mesh as Mesh;
          this.actorStyles.push({ mesh: drawable, outline: drawable.renderOutline, overlay: drawable.renderOverlay });
          drawable.renderOutline = false;
          drawable.renderOverlay = false;
        }
    });
    target.onBeforeRenderObservable.add(() => this.matrix.copyFrom(this.scene.getTransformMatrix()));
    target.onAfterUnbindObservable.add(() => {
      this.restoreVisibility();
      this.ready = !this.failed;
      this.status = this.failed ? "capture failed" : "captured";
    });
  }

  bind(effect: Effect, patch: WaterPatch | null | undefined): void {
    const active = !!patch && patch === this.patch && this.ready && !this.failed && !!this.texture;
    effect.setFloat("uHasActorReflection", active ? 1 : 0);
    if (!active) return;
    effect.setTexture("uActorReflection", this.texture!);
    effect.setMatrix("uActorReflectionMatrix", this.matrix);
    const size = this.texture!.getSize();
    effect.setFloat2("uActorReflectionTexel", 1 / size.width, 1 / size.height);
    const processing = this.scene.imageProcessingConfiguration;
    effect.setFloat("uActorReflectionLinear", processing.isEnabled && processing.applyByPostProcess ? 1 : 0);
  }

  private restoreVisibility(): void {
    for (const mesh of this.hidden) if (!mesh.isDisposed()) mesh.isVisible = false;
    this.hidden.length = 0;
    for (const { mesh, outline, overlay } of this.actorStyles)
      if (!mesh.isDisposed()) {
        mesh.renderOutline = outline;
        mesh.renderOverlay = overlay;
      }
    this.actorStyles.length = 0;
  }

  private detach(): void {
    if (this.camera && this.texture) {
      const i = this.camera.customRenderTargets.indexOf(this.texture);
      if (i >= 0) this.camera.customRenderTargets.splice(i, 1);
    }
    this.camera = null;
  }

  dispose(): void {
    if (providers.get(this.scene) === this) providers.delete(this.scene);
    this.localBodyWanted = false;
    this.detach();
    this.restoreVisibility();
    this.texture?.dispose();
    this.blocker?.dispose();
    this.texture = null;
    this.blocker = null;
    this.patch = null;
    this.ready = false;
    this.occluders.clear();
    this.overridden.clear();
  }
}
