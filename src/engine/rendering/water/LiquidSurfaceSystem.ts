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

import type { Material } from "@babylonjs/core/Materials/material";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { createUnifiedWaterMaterial, disposeWaterNoise, type WaterKind } from "./UnifiedWaterMaterial";

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

  constructor(private readonly scene: Scene) {}

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
      count++;
    }

    if (count > 0) this.start();
    return count;
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
      for (const material of this.materials.values()) {
        material.setFloat("uTime", this.elapsed);
        if (camera) material.setVector3("uCameraPosition", camera.globalPosition);
      }
    });
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

    for (const surface of this.claimed) {
      if (!surface.mesh.isDisposed()) surface.mesh.material = surface.original;
    }
    this.claimed.length = 0;

    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();

    disposeWaterNoise(this.scene);
    this.elapsed = 0;
  }
}
