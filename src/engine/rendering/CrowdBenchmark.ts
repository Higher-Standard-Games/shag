import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { VANGUARD_ROOT } from "../animation/PlayerModelAssets";
import { type PlayerModelInstance, type PlayerModelManager, wrapFrame } from "../animation/PlayerModelManager";

export interface CrowdRecipe {
  schemaVersion: 1;
  id: string;
  model: { root: string; file: string; scale: number };
  animation: { name: string; file: string; presentationHz: number; poseHz: number };
  render: { width: number; height: number; fov: number };
  camera: { position: number[]; target: number[] };
  positions: number[][];
  style: { tint: number[]; outlineColor: number[]; outlineWidth: number };
  counts: number[];
  outlines: number[];
  outlineGeometry?: ("full" | "proxy")[];
  warmupFrames: number;
  measuredFrames: number;
  repeats: number;
}

export function validateCrowdRecipe(value: unknown): asserts value is CrowdRecipe {
  const r = value as CrowdRecipe | undefined;
  const vector = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const integer = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (
    r?.schemaVersion !== 1 ||
    !/^[a-z0-9-]+$/.test(r.id) ||
    (r.model?.root !== VANGUARD_ROOT && !r.model?.root?.startsWith("/games/")) ||
    !/^[\w-]+\.glb$/.test(r.model.file) ||
    !Number.isFinite(r.model.scale) ||
    r.model.scale <= 0 ||
    !r.animation?.name ||
    !r.animation.file?.endsWith(".glb") ||
    r.animation.file.includes("/") ||
    !integer(r.animation.presentationHz, 1, 240) ||
    !integer(r.animation.poseHz, 1, r.animation.presentationHz) ||
    r.animation.presentationHz % r.animation.poseHz !== 0 ||
    !integer(r.render?.width, 320, 3840) ||
    !integer(r.render?.height, 240, 2160) ||
    !Number.isFinite(r.render.fov) ||
    r.render.fov < 30 ||
    r.render.fov > 120 ||
    !vector(r.camera?.position) ||
    !vector(r.camera?.target) ||
    !Array.isArray(r.positions) ||
    !integer(r.positions.length, 1, 10) ||
    !r.positions.every(vector) ||
    !vector(r.style?.tint) ||
    !vector(r.style?.outlineColor) ||
    !Number.isFinite(r.style.outlineWidth) ||
    r.style.outlineWidth <= 0 ||
    !Array.isArray(r.counts) ||
    !r.counts.length ||
    r.counts.some((n) => !integer(n, 0, r.positions.length)) ||
    new Set(r.counts).size !== r.counts.length ||
    !Array.isArray(r.outlines) ||
    !r.outlines.length ||
    r.outlines.some((n) => n !== 0 && n !== 1) ||
    new Set(r.outlines).size !== r.outlines.length ||
    (r.outlineGeometry !== undefined &&
      (!Array.isArray(r.outlineGeometry) ||
        !r.outlineGeometry.length ||
        r.outlineGeometry.some((v) => v !== "full" && v !== "proxy") ||
        new Set(r.outlineGeometry).size !== r.outlineGeometry.length)) ||
    !integer(r.warmupFrames, 60, 1200) ||
    !integer(r.measuredFrames, 120, 3600) ||
    !integer(r.repeats, 1, 10)
  )
    throw new Error("Invalid player crowd recipe");
}

export function crowdSchedule(
  recipe: CrowdRecipe,
): { repetition: number; count: number; outline: number; geometry?: "full" | "proxy" }[] {
  validateCrowdRecipe(recipe);
  const plan = [];
  for (let repetition = 1; repetition <= recipe.repeats; repetition++) {
    const counts = repetition % 2 ? recipe.counts : [...recipe.counts].reverse();
    const outlines = repetition % 2 ? recipe.outlines : [...recipe.outlines].reverse();
    const geometries =
      recipe.outlineGeometry && (repetition % 2 ? recipe.outlineGeometry : [...recipe.outlineGeometry].reverse());
    for (const count of counts)
      for (const outline of outlines) {
        if (geometries) for (const geometry of geometries) plan.push({ repetition, count, outline, geometry });
        else plan.push({ repetition, count, outline });
      }
  }
  return plan;
}

/** Owns only benchmark clones. The production manager's import/rig/style path is reused. */
export class CrowdActors {
  readonly instances: PlayerModelInstance[] = [];
  private readonly parts = new Map<AbstractMesh, number>();
  private activeCount = 0;
  private outline = 0;

  constructor(
    private readonly manager: PlayerModelManager,
    readonly recipe: CrowdRecipe,
  ) {
    validateCrowdRecipe(recipe);
    try {
      for (const [index, position] of recipe.positions.entries()) {
        const instance = manager.createInstance(`player_${index}`, recipe.model.scale);
        if (!instance) throw new Error("Player crowd model is not loaded");
        this.instances.push(instance);
        instance.anchor.position.set(position[0], position[1], position[2]);
        // Face the camera; positions/poses never depend on network or elapsed wall time.
        instance.anchor.rotation.y = Math.PI;
        if (!manager.playAnimation(instance, recipe.animation.name) || !instance.masterGroup)
          throw new Error(`Missing crowd clip: ${recipe.animation.name}`);
        instance.masterGroup.pause();
        manager.useConservativeBounds(instance);
        for (const mesh of [instance.mesh, ...instance.mesh.getChildMeshes()]) {
          if (mesh.getTotalVertices() > 0 && mesh.skeleton) this.parts.set(mesh, index);
        }
        instance.anchor.setEnabled(false);
      }
      if (!this.parts.size) throw new Error("Player crowd has no skinned body parts");
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  configure(count: number, outline: number): void {
    if (!this.recipe.counts.includes(count) || !this.recipe.outlines.includes(outline))
      throw new Error("Crowd case is outside the saved recipe");
    this.activeCount = count;
    this.outline = outline;
    for (const [index, instance] of this.instances.entries()) {
      instance.anchor.setEnabled(index < count);
      this.manager.applyVisualStyle(instance, {
        tintColor: Color3.FromArray(this.recipe.style.tint),
        fullbrightEnabled: false,
        fullbrightIntensity: 0,
        outlineEnabled: outline === 1,
        outlineColor: Color3.FromArray(this.recipe.style.outlineColor),
        outlineWidth: this.recipe.style.outlineWidth,
      });
    }
    this.pose(0, true);
  }

  pose(tick: number, force = false): void {
    if (!force && tick % (this.recipe.animation.presentationHz / this.recipe.animation.poseHz) !== 0) return;
    for (let index = 0; index < this.activeCount; index++) {
      const instance = this.instances[index],
        group = instance.masterGroup!;
      const fps = group.targetedAnimations[0].animation.framePerSecond;
      group.goToFrame(
        wrapFrame(
          group.from + (tick / this.recipe.animation.presentationHz + index * 0.13) * fps,
          group.from,
          group.to,
        ),
      );
      this.manager.resetRootMotion(instance);
    }
  }

  expectedBodyParts(): number {
    let count = 0;
    for (const index of this.parts.values()) if (index < this.activeCount) count++;
    return count;
  }

  expectedDraws(backgroundDraws: number): number {
    return backgroundDraws + this.expectedBodyParts() * (this.outline ? 3 : 1);
  }

  coverage(scene: Scene): { actors: number; bodyParts: number } {
    let mask = 0,
      bodyParts = 0;
    const active = scene.getActiveMeshes();
    for (let n = 0; n < active.length; n++) {
      const index = this.parts.get(active.data[n]);
      if (index !== undefined && index < this.activeCount) {
        mask |= 1 << index;
        bodyParts++;
      }
    }
    let actors = 0;
    while (mask) {
      actors += mask & 1;
      mask >>>= 1;
    }
    return { actors, bodyParts };
  }

  inventory() {
    return [...this.parts].map(([mesh, actor]) => ({
      actor,
      name: mesh.name,
      vertices: mesh.getTotalVertices(),
      indices: mesh.getTotalIndices(),
      bones: mesh.skeleton?.bones.length,
      material: mesh.material?.getClassName(),
    }));
  }

  bodyMeshes(): Mesh[] {
    return [...this.parts.keys()].filter((mesh): mesh is Mesh => mesh instanceof Mesh);
  }

  dispose(): void {
    for (const instance of this.instances.splice(0)) this.manager.disposeInstance(instance);
    this.parts.clear();
  }
}
