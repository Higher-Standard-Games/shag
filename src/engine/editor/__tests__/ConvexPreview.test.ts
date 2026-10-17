import { Ray } from "@babylonjs/core/Culling/ray";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { rotateBrush } from "../ConvexBrush";
import { createConvexPreview, hullEdges } from "../ConvexPreview";
import { naturalFace } from "../FaceUv";
import { shaderBatches } from "../TexturedPreview";

it("previews and picks the actual diagonal solid rather than its bounding box", () => {
  const brush = rotateBrush(
    {
      id: "diagonal",
      min: { x: -128, y: -16, z: 0 },
      max: { x: 128, y: 16, z: 16 },
      shader: "metal",
      faces: { "+Z": naturalFace("top", [512, 256]) },
    },
    "z",
    45,
  );
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const mesh = createConvexPreview(brush, scene);
    mesh.material = new StandardMaterial("solid", scene);
    mesh.computeWorldMatrix(true);
    expect(mesh.intersects(new Ray(new Vector3(50, 100, 50), new Vector3(0, -1, 0)), false).hit).toBe(true);
    const picked = mesh.intersects(new Ray(new Vector3(50, 100, 50), new Vector3(0, -1, 0)), false);
    expect(mesh.metadata.convexFaceIndices[picked.faceId]).toBe(1);
    expect(mesh.metadata.convexFaceIndices).toHaveLength(12);
    expect(mesh.intersects(new Ray(new Vector3(90, 100, -90), new Vector3(0, -1, 0)), false).hit).toBe(false);
    expect(hullEdges(brush).length).toBe(12);
    const batches = shaderBatches([brush]);
    expect(batches.map((b) => b.shader)).toEqual(["metal", "top"]);
    expect(batches.reduce((n, b) => n + b.indices.length, 0)).toBe(36);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
