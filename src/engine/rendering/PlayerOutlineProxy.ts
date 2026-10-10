import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Rendering/outlineRenderer";

/** Experimental opaque, single-submesh player outlines. Never changes the ordinary body draw. */
export class PlayerOutlineProxy {
  enabled = false;
  routedPasses = 0;
  routedIndices = 0;
  fallbackPasses = 0;
  unsupportedPasses = 0;
  private readonly meshes = new Map<Mesh, Mesh>();
  private readonly disposeObservers = new Map<Mesh, ReturnType<Mesh["onDisposeObservable"]["add"]>>();
  private readonly renderer;
  private readonly original;
  private readonly wrapper;

  constructor(scene: Scene) {
    this.renderer = scene.getOutlineRenderer();
    this.original = this.renderer.render;
    this.wrapper = ((subMesh, batch, overlay, pass) => {
      const body = subMesh.getRenderingMesh(),
        proxy = this.meshes.get(body);
      if (!this.enabled || !proxy || overlay) return this.original.call(this.renderer, subMesh, batch, overlay, pass);
      const material = subMesh.getMaterial();
      if (
        !material ||
        material.needAlphaBlendingForMesh(body) ||
        material.needAlphaTestingForMesh(body) ||
        material.fillMode !== Material.TriangleFillMode ||
        body.hasThinInstances ||
        batch.visibleInstances[subMesh._id] != null ||
        !body.computeBonesUsingShaders ||
        body.morphTargetManager ||
        body.bakedVertexAnimationManager ||
        body.skeleton?.needInitialSkinMatrix
      ) {
        this.unsupportedPasses++;
        return this.original.call(this.renderer, subMesh, batch, overlay, pass);
      }
      proxy.material = material;
      proxy.outlineWidth = body.outlineWidth;
      proxy.outlineColor = body.outlineColor;
      proxy.freezeWorldMatrix(body.getWorldMatrix());
      const replacement = proxy.subMeshes[0];
      if (!this.renderer.isReady(replacement, false, pass)) {
        this.fallbackPasses++;
        return this.original.call(this.renderer, subMesh, batch, overlay, pass);
      }
      this.routedPasses++;
      this.routedIndices += replacement.indexCount;
      return this.original.call(this.renderer, replacement, batch, false, pass);
    }) as typeof this.renderer.render;
    this.renderer.render = this.wrapper;
  }

  attach(body: Mesh, template: Mesh): void {
    if (this.meshes.has(body)) throw new Error("Body already has an outline proxy");
    if (
      body.subMeshes.length !== 1 ||
      template.subMeshes.length !== 1 ||
      body.subMeshes[0]._id !== 0 ||
      !body.skeleton ||
      !template.skeleton ||
      body.skeleton.needInitialSkinMatrix ||
      body.numBoneInfluencers !== template.numBoneInfluencers ||
      body.skeleton.bones.length !== template.skeleton.bones.length
    )
      throw new Error("Unsupported outline proxy mesh/rig");
    for (let i = 0; i < body.skeleton.bones.length; i++) {
      const a = body.skeleton.bones[i],
        b = template.skeleton.bones[i];
      if (
        a.name !== b.name ||
        a.getIndex() !== b.getIndex() ||
        !a.getAbsoluteInverseBindMatrix().equalsWithEpsilon(b.getAbsoluteInverseBindMatrix(), 1e-6)
      )
        throw new Error(`Outline proxy bone mismatch: ${i}`);
    }
    const proxy = template.clone(`${body.name}/outlineProxy`, null, true);
    if (!proxy) throw new Error("Outline proxy clone failed");
    // Stay outside the actor hierarchy: production style/disposal walks must not clone
    // materials for an outline-only part. Each submission explicitly uses the body's
    // world matrix (including glTF handedness/root scale) and its live skeleton.
    proxy.parent = null;
    proxy.position.setAll(0);
    proxy.rotationQuaternion = null;
    proxy.rotation.setAll(0);
    proxy.scaling.setAll(1);
    proxy.skeleton = body.skeleton;
    proxy.material = body.material;
    proxy.renderOutline = false;
    proxy.renderOverlay = false;
    proxy.isPickable = false;
    proxy.setEnabled(false);
    body.getScene().removeMesh(proxy); // Explicit outline submissions only; no ordinary draw/active-mesh work.
    this.meshes.set(body, proxy);
    this.disposeObservers.set(
      body,
      body.onDisposeObservable.add(() => this.detach(body)),
    );
  }

  attachContainer(bodies: Mesh[], container: AssetContainer): void {
    for (const body of bodies) {
      const name = body.name.slice(body.name.indexOf("/") + 1);
      const candidates = container.meshes.filter((m) => m.name === name && m.getTotalVertices() > 0);
      if (candidates.length !== 1 || !(candidates[0] instanceof Mesh)) throw new Error(`Missing proxy part: ${name}`);
      this.attach(body, candidates[0]);
    }
  }

  resetCounters(): void {
    this.routedPasses = this.routedIndices = this.fallbackPasses = this.unsupportedPasses = 0;
  }

  detach(body: Mesh): void {
    body.onDisposeObservable.remove(this.disposeObservers.get(body) ?? null);
    this.disposeObservers.delete(body);
    this.meshes.get(body)?.dispose(true, false);
    this.meshes.delete(body);
  }

  inventory() {
    return [...this.meshes].map(([body, proxy]) => ({
      body: body.name,
      indices: proxy.getTotalIndices(),
      vertices: proxy.getTotalVertices(),
    }));
  }

  get attachedParts(): number {
    return this.meshes.size;
  }

  expectedIndices(): number {
    let indices = 0;
    for (const [body, proxy] of this.meshes)
      if (body.isEnabled() && body.renderOutline) indices += proxy.getTotalIndices() * 2;
    return indices;
  }

  dispose(): void {
    if (this.renderer.render === this.wrapper) this.renderer.render = this.original;
    for (const body of this.meshes.keys()) this.detach(body);
  }
}
