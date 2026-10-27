import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Material } from "@babylonjs/core/Materials/material";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { type Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer";
import type { Scene } from "@babylonjs/core/scene";
import { RenderVars } from "../../rendering/RenderVars";
import { SceneDepthCapture } from "../../rendering/SceneDepthCapture";

const providers = new WeakMap<Scene, Q3SoftParticleDepth>();
const WEAPON_LAYER = 0x10000000;

/** A soft surface fades fully in over 1 / rate view-depth units in front of the scene behind it. */
export const Q3_SOFT_FADE_RATE = 0.02;
const FADE_DEPTH = 1 / Q3_SOFT_FADE_RATE;
/** View depth in front of which a box corner counts as at or behind the camera. */
const NEAR = 0.01;

/** An InstancedMesh: its material is its source mesh's. */
function isInstance(mesh: AbstractMesh): boolean {
  return "sourceMesh" in mesh;
}

const viewCorner = new Vector3();
const clipCorner = new Vector3();

/**
 * Writes a box's screen rectangle (clip-space x and y) and view-depth range to
 * `out` from `at`: min x, min y, max x, max y, min depth, max depth. A box
 * reaching behind the camera covers the whole screen.
 */
function screenBounds(mesh: AbstractMesh, view: Matrix, projection: Matrix, out: number[], at: number): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let behind = false;
  for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
    Vector3.TransformCoordinatesToRef(corner, view, viewCorner);
    minZ = Math.min(minZ, viewCorner.z);
    maxZ = Math.max(maxZ, viewCorner.z);
    if (viewCorner.z <= NEAR) {
      behind = true;
      continue;
    }
    Vector3.TransformCoordinatesToRef(viewCorner, projection, clipCorner);
    minX = Math.min(minX, clipCorner.x);
    minY = Math.min(minY, clipCorner.y);
    maxX = Math.max(maxX, clipCorner.x);
    maxY = Math.max(maxY, clipCorner.y);
  }
  if (behind) {
    minX = minY = -Infinity;
    maxX = maxY = Infinity;
  }
  out[at] = minX;
  out[at + 1] = minY;
  out[at + 2] = maxX;
  out[at + 3] = maxY;
  out[at + 4] = minZ;
  out[at + 5] = maxZ;
}

/** A camera-owned view-Z capture, independent of outline and water encodings. */
export class Q3SoftParticleDepth {
  private readonly materials = new Set<Material>();
  private renderer: DepthRenderer | null = null;
  private camera: Camera | null = null;
  /** The camera whose depth this frame comes from its main pass instead of a pass of our own. */
  private sharedCamera: Camera | null = null;
  private unavailable = false;
  /**
   * Each soft surface in view as `screenBounds` writes it, its depth range
   * extended by the fade depth: the pixels where the scene can fade it, and
   * the depth past which it cannot.
   */
  private readonly reach: number[] = [];
  private readonly meshBounds: number[] = [];
  readonly fallback: RawTexture;
  private readonly observer;

  static acquire(material: Material): Q3SoftParticleDepth {
    const scene = material.getScene();
    let provider = providers.get(scene);
    if (!provider) {
      provider = new Q3SoftParticleDepth(scene);
      providers.set(scene, provider);
    }
    provider.materials.add(material);
    // Babylon keeps a material's meshMap current through every mesh's material
    // setter and disposal once the map exists; seed it with meshes assigned
    // before this point. An instance takes its source's material and is not listed.
    if (!material.meshMap) {
      material.meshMap = {};
      for (const mesh of scene.meshes) {
        if (mesh.material === material && !isInstance(mesh)) material.meshMap[mesh.uniqueId] = mesh;
      }
    }
    material.onDisposeObservable.addOnce(() => {
      provider.materials.delete(material);
      if (!provider.materials.size) provider.dispose();
    });
    return provider;
  }

  private constructor(private readonly scene: Scene) {
    this.fallback = RawTexture.CreateRGBATexture(new Uint8Array([0, 0, 0, 255]), 1, 1, scene, false, false);
    this.observer = scene.onBeforeCameraRenderObservable.add((camera) => this.prepare(camera));
  }

  private prepare(camera: Camera): void {
    if ((camera.layerMask & WEAPON_LAYER) !== 0) return;
    this.reach.length = 0;
    this.sharedCamera = null;
    if ((RenderVars.getInstance().get("r_softhalos") ?? 1) < 0.5) {
      this.setRendering(false);
      return;
    }
    // The meshes drawn with a soft material, from each material's own list
    // instead of a pass over every mesh in the scene
    for (const material of this.materials) {
      const meshes = material.meshMap;
      if (!meshes) continue;
      for (const id in meshes) {
        const mesh = meshes[id];
        // A mesh using the material for one render pass only is listed too
        if (!mesh || mesh.material !== material) continue;
        this.addReach(mesh, camera);
        const instances = (mesh as Mesh).instances;
        if (instances) for (const instance of instances) this.addReach(instance, camera);
      }
    }
    if (!this.reach.length || this.unavailable) {
      this.setRendering(false);
      return;
    }
    const shared = SceneDepthCapture.for(this.scene);
    if (shared.supports(camera)) {
      this.release();
      shared.request(camera);
      this.sharedCamera = camera;
      return;
    }
    if (this.camera === camera) {
      this.setRendering(true);
      return;
    }
    this.release();
    const caps = this.scene.getEngine().getCaps();
    const type = caps.textureHalfFloatRender
      ? Constants.TEXTURETYPE_HALF_FLOAT
      : caps.textureFloatRender
        ? Constants.TEXTURETYPE_FLOAT
        : null;
    if (type === null) {
      this.unavailable = true;
      return;
    }
    const renderer = new DepthRenderer(
      this.scene,
      type,
      camera,
      false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      true,
      "q3-soft-depth",
    );
    const map = renderer.getDepthMap();
    map.renderList = null;
    map.forceLayerMaskCheck = true;
    map.getCustomRenderList = (_pass, list, length) =>
      (list ?? [])
        .slice(0, length)
        .filter(
          (mesh) =>
            mesh.isVisible &&
            mesh.isEnabled() &&
            !mesh.infiniteDistance &&
            (mesh.layerMask & WEAPON_LAYER) === 0 &&
            !this.materials.has(mesh.material!) &&
            this.withinReach(mesh),
        );
    // DepthRenderer excludes alpha-blended submeshes and retains alpha-tested cutouts.
    camera.customRenderTargets.push(map);
    this.renderer = renderer;
    this.camera = camera;
  }

  /** Record a soft mesh's screen reach when this camera draws it. */
  private addReach(mesh: AbstractMesh, camera: Camera): void {
    if (!mesh.isVisible || !mesh.isEnabled() || (mesh.layerMask & camera.layerMask) === 0 || !camera.isInFrustum(mesh))
      return;
    const at = this.reach.length;
    screenBounds(mesh, camera.getViewMatrix(), camera.getProjectionMatrix(), this.reach, at);
    this.reach[at + 5] += FADE_DEPTH;
  }

  /**
   * Only a mesh that shares screen with a soft surface in view, and reaches
   * nearer than the fade depth behind it, can fade one; past the fade depth
   * the surface reads no fade either way. A mesh in front of the surface counts:
   * flares drawn without a depth test fade out behind it rather than being
   * hidden.
   */
  private withinReach(mesh: AbstractMesh): boolean {
    if (!this.camera) return true;
    const m = this.meshBounds;
    screenBounds(mesh, this.camera.getViewMatrix(), this.camera.getProjectionMatrix(), m, 0);
    const r = this.reach;
    for (let i = 0; i < r.length; i += 6) {
      if (m[2] >= r[i] && m[0] <= r[i + 2] && m[3] >= r[i + 1] && m[1] <= r[i + 3] && m[4] <= r[i + 5]) return true;
    }
    return false;
  }

  mapFor(camera: Camera | null): Texture | null {
    if (this.sharedCamera) return SceneDepthCapture.for(this.scene).textureFor(camera);
    const map = this.renderer?.getDepthMap();
    return map && camera && camera === this.camera && camera.customRenderTargets.includes(map) ? map : null;
  }

  private setRendering(enabled: boolean): void {
    if (!this.renderer) return;
    const map = this.renderer.getDepthMap();
    const targets = this.camera!.customRenderTargets;
    const index = targets.indexOf(map);
    if (enabled && index === -1) targets.push(map);
    else if (!enabled && index !== -1) targets.splice(index, 1);
  }

  private release(): void {
    if (!this.renderer) return;
    const map = this.renderer.getDepthMap();
    const targets = this.camera!.customRenderTargets;
    const index = targets.indexOf(map);
    if (index !== -1) targets.splice(index, 1);
    map.dispose();
    this.renderer.dispose();
    this.renderer = null;
    this.camera = null;
  }

  private dispose(): void {
    this.scene.onBeforeCameraRenderObservable.remove(this.observer);
    this.release();
    this.fallback.dispose();
    providers.delete(this.scene);
  }
}
