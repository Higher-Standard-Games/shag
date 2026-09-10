import type { BspFile } from "../../loader/bsp/BspLoader";

/** A 128-wide platform, authored at z=100; optional solid ceiling. Q3 coordinates. */
export function liftBsp(ceiling = false): BspFile {
  const boxes = [{ min: [-64, -64, 92], max: [64, 64, 100] }];
  if (ceiling) boxes.push({ min: [-100, -100, 90], max: [100, 100, 100] });
  const planes: BspFile["planes"] = [];
  const sides: BspFile["brushSides"] = [];
  for (const b of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [1, -1]) {
        const normal: [number, number, number] = [0, 0, 0];
        normal[axis] = sign;
        sides.push({ planeIndex: planes.length, shaderIndex: 0 });
        planes.push({ normal, dist: sign > 0 ? b.max[axis] : -b.min[axis] });
      }
    }
  }
  const model = { mins: [-64, -64, 92], maxs: [64, 64, 100], firstFace: 0, numFaces: 0, firstBrush: 0, numBrushes: 1 };
  return {
    header: { isFBSP: false },
    entities: [{ classname: "func_plat", properties: { model: "*1", height: "100", speed: "100" } }],
    textures: [{ name: "solid", contentFlags: 1, surfaceFlags: 0 }],
    planes,
    brushSides: sides,
    brushes: boxes.map((_, i) => ({ firstSide: i * 6, numSides: 6, shaderIndex: 0 })),
    // Deliberately include the platform in a world leaf: it must be excluded from the static trace.
    nodes: [{ planeIndex: 0, children: [-1, -1] }],
    leafs: [{ firstLeafBrush: 0, numLeafBrushes: boxes.length, firstLeafFace: 0, numLeafFaces: 0 }],
    leafBrushes: boxes.map((_, i) => i),
    leafFaces: [],
    models: [{ ...model, numBrushes: 0 }, model],
    faces: [],
    vertices: [],
    meshVerts: [],
  } as unknown as BspFile;
}
