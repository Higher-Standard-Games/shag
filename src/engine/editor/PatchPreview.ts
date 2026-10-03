import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { PatchGenerator } from "../loader/map/PatchGenerator";
import type { PatchSurface, Vec3q } from "./EditorDocument";
import { type EditorPlane, PLANE_AXES } from "./EditorViewTools";

/** Bounds include handles, not just the tessellated surface, so Frame never crops a control point. */
export function patchBounds(patch: PatchSurface): { min: Vec3q; max: Vec3q } {
  const first = patch.controlPoints[0][0];
  const min = { x: first.x, y: first.y, z: first.z };
  const max = { ...min };
  for (const row of patch.controlPoints) {
    for (const control of row) {
      for (const axis of ["x", "y", "z"] as const) {
        min[axis] = Math.min(min[axis], control[axis]);
        max[axis] = Math.max(max[axis], control[axis]);
      }
    }
  }
  return { min, max };
}

/** A 2D patch is selected at its control lattice, avoiding an oversized empty bounds hit. */
export function patchLatticeHit(
  patch: PatchSurface,
  plane: EditorPlane,
  u: number,
  v: number,
  tolerance: number,
): boolean {
  const axes = PLANE_AXES[plane];
  const near = (a: Vec3q, b: Vec3q): boolean => {
    const du = b[axes.u] - a[axes.u];
    const dv = b[axes.v] - a[axes.v];
    const length2 = du * du + dv * dv;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((u - a[axes.u]) * du + (v - a[axes.v]) * dv) / length2));
    return Math.hypot(u - a[axes.u] - t * du, v - a[axes.v] - t * dv) <= tolerance;
  };
  for (const row of patch.controlPoints) {
    for (let col = 1; col < row.length; col++) if (near(row[col - 1], row[col])) return true;
  }
  for (let row = 1; row < patch.height; row++) {
    for (let col = 0; col < patch.width; col++) {
      if (near(patch.controlPoints[row - 1][col], patch.controlPoints[row][col])) return true;
    }
  }
  return false;
}

/** Matches MapRenderer's Quake Z-up to Babylon Y-up conversion. Editor preview owns its material. */
export function createPatchPreview(patch: PatchSurface, scene: Scene, selected: boolean, wireframe: boolean): Mesh {
  const mesh = PatchGenerator.buildMesh(
    {
      texture: patch.shader,
      width: patch.width,
      height: patch.height,
      controlPoints: patch.controlPoints.map((row) =>
        row.map((control) => ({
          position: new Vector3(control.x, control.z, control.y),
          u: control.u,
          v: control.v,
        })),
      ),
    },
    scene,
  );
  if (!mesh) throw new Error(`Could not preview patch ${patch.id}`);
  mesh.name = patch.id;
  mesh.metadata = { editorPatchId: patch.id };
  mesh.isPickable = true;
  const material = new StandardMaterial(`editor-patch-${patch.id}`, scene);
  material.diffuseColor = selected ? new Color3(1, 0.75, 0.2) : new Color3(0.1, 0.8, 0.9);
  material.backFaceCulling = false;
  material.wireframe = wireframe;
  material.alpha = wireframe ? 1 : 0.82;
  mesh.material = material;
  mesh.enableEdgesRendering();
  mesh.edgesWidth = selected ? 3 : 1;
  mesh.edgesColor = selected ? new Color4(1, 0.85, 0.28, 1) : new Color4(0.02, 0.08, 0.13, 1);
  return mesh;
}

/** Project the actual control grid, not the bounding rectangle, into one orthographic pane. */
export function drawPatchLattice(
  ctx: CanvasRenderingContext2D,
  patch: PatchSurface,
  plane: EditorPlane,
  originX: number,
  originY: number,
  zoom: number,
  selected: boolean,
): void {
  const axes = PLANE_AXES[plane];
  const point = (control: Vec3q): [number, number] => [
    originX + control[axes.u] * zoom,
    originY - control[axes.v] * zoom,
  ];
  ctx.strokeStyle = selected ? "#ffc61a" : "#41deeb";
  ctx.lineWidth = selected ? 2 : 1;
  for (const row of patch.controlPoints) {
    ctx.beginPath();
    row.forEach((control, index) => {
      const [x, y] = point(control);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  for (let col = 0; col < patch.width; col++) {
    ctx.beginPath();
    patch.controlPoints.forEach((row, index) => {
      const [x, y] = point(row[col]);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  if (selected) {
    ctx.fillStyle = "#fff3bd";
    for (const row of patch.controlPoints) {
      for (const control of row) {
        const [x, y] = point(control);
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
    }
  }
}
