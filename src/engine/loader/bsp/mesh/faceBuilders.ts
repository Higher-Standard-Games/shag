import type { BspFace, BspFile, BspVertex } from "../BspLoader";
import type { FaceGeometry } from "./types";
import {
  getVertexColor,
  getVertexLightmapCoord,
  getVertexNormal,
  getVertexPosition,
  getVertexTexCoord,
} from "./vertices";

/**
 * Build polygon face (type 1).
 * Vertices are referenced directly, meshverts provide triangle indices.
 */
export function buildPolygonFace(bsp: BspFile, face: BspFace): FaceGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const uv2s: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < face.numVertices; i++) {
    const v = bsp.vertices[face.firstVertex + i];
    const pos = getVertexPosition(v);
    const normal = getVertexNormal(v);
    const uv = getVertexTexCoord(v);
    const uv2 = getVertexLightmapCoord(v);
    const color = getVertexColor(v);

    positions.push(pos[0], pos[1], pos[2]);
    normals.push(normal[0], normal[1], normal[2]);
    uvs.push(uv[0], uv[1]);
    uv2s.push(uv2[0], uv2[1]);
    colors.push(color[0], color[1], color[2], color[3]);
  }

  const rawIndices: number[] = [];
  for (let i = 0; i < face.numMeshVerts; i++) {
    rawIndices.push(bsp.meshVerts[face.firstMeshVert + i]);
  }

  for (let i = 0; i < rawIndices.length; i += 3) {
    indices.push(rawIndices[i], rawIndices[i + 2], rawIndices[i + 1]);
  }

  return { positions, normals, uvs, uv2s, colors, indices };
}

/**
 * Build mesh face (type 3).
 * Same as polygon, vertices + meshverts define triangles.
 */
export function buildMeshFace(bsp: BspFile, face: BspFace): FaceGeometry {
  return buildPolygonFace(bsp, face);
}

/**
 * Build patch face (type 2) - Bezier surface.
 *
 * Uses a shared vertex grid across all sub-patches to eliminate gaps.
 */
export function buildPatchFace(bsp: BspFile, face: BspFace): FaceGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const uv2s: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const width = face.patchSize[0];
  const height = face.patchSize[1];

  if (width < 3 || height < 3) {
    console.warn(`[BspMeshBuilder] Skipping patch with invalid size: ${width}x${height}`);
    return { positions, normals, uvs, uv2s, colors, indices };
  }

  const controlPoints: BspVertex[][] = [];
  for (let row = 0; row < height; row++) {
    const rowPoints: BspVertex[] = [];
    for (let col = 0; col < width; col++) {
      const idx = face.firstVertex + row * width + col;
      rowPoints.push(bsp.vertices[idx]);
    }
    controlPoints.push(rowPoints);
  }

  const tessLevel = 8;
  const numPatchesX = Math.floor((width - 1) / 2);
  const numPatchesY = Math.floor((height - 1) / 2);

  if (numPatchesX <= 0 || numPatchesY <= 0) {
    console.warn(`[BspMeshBuilder] Invalid patch size: ${width}x${height}`);
    return { positions, normals, uvs, uv2s, colors, indices };
  }

  const gridW = numPatchesX * tessLevel + 1;
  const gridH = numPatchesY * tessLevel + 1;

  type TessVert = {
    pos: [number, number, number];
    normal: [number, number, number];
    uv: [number, number];
    uv2: [number, number];
    color: [number, number, number, number];
  };
  const grid: TessVert[] = new Array(gridW * gridH);

  for (let py = 0; py < numPatchesY; py++) {
    for (let px = 0; px < numPatchesX; px++) {
      const ctrl: BspVertex[][] = [];
      for (let j = 0; j < 3; j++) {
        const row: BspVertex[] = [];
        for (let i = 0; i < 3; i++) {
          row.push(controlPoints[py * 2 + j][px * 2 + i]);
        }
        ctrl.push(row);
      }

      const uStart = px === 0 ? 0 : 1;
      const vStart = py === 0 ? 0 : 1;

      for (let v = vStart; v <= tessLevel; v++) {
        for (let u = uStart; u <= tessLevel; u++) {
          const s = u / tessLevel;
          const t = v / tessLevel;
          const gridX = px * tessLevel + u;
          const gridY = py * tessLevel + v;
          grid[gridY * gridW + gridX] = evaluateBezierPatch(ctrl, s, t);
        }
      }
    }
  }

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const vert = grid[gy * gridW + gx];
      positions.push(vert.pos[0], vert.pos[1], vert.pos[2]);
      normals.push(vert.normal[0], vert.normal[1], vert.normal[2]);
      uvs.push(vert.uv[0], vert.uv[1]);
      uv2s.push(vert.uv2[0], vert.uv2[1]);
      colors.push(vert.color[0], vert.color[1], vert.color[2], vert.color[3]);
    }
  }

  for (let gy = 0; gy < gridH - 1; gy++) {
    for (let gx = 0; gx < gridW - 1; gx++) {
      const i00 = gy * gridW + gx;
      const i10 = i00 + 1;
      const i01 = i00 + gridW;
      const i11 = i01 + 1;

      indices.push(i00, i10, i01);
      indices.push(i10, i11, i01);
    }
  }

  return { positions, normals, uvs, uv2s, colors, indices };
}

/**
 * Evaluate bezier patch at (s, t) parameter.
 *
 * Normals are interpolated from control point normals using the same bezier
 * basis functions, matching Q3/ioquake3 behavior.
 */
export function evaluateBezierPatch(
  ctrl: BspVertex[][],
  s: number,
  t: number,
): {
  pos: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
  uv2: [number, number];
  color: [number, number, number, number];
} {
  const b0s = (1 - s) * (1 - s);
  const b1s = 2 * s * (1 - s);
  const b2s = s * s;

  const b0t = (1 - t) * (1 - t);
  const b1t = 2 * t * (1 - t);
  const b2t = t * t;

  let px = 0,
    py = 0,
    pz = 0;
  let nx = 0,
    ny = 0,
    nz = 0;
  let u = 0,
    v = 0;
  let lu = 0,
    lv = 0;
  let cr = 0,
    cg = 0,
    cb = 0,
    ca = 0;

  const bs = [b0s, b1s, b2s];
  const bt = [b0t, b1t, b2t];

  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const cp = ctrl[j][i];
      const w = bs[i] * bt[j];

      const pos = getVertexPosition(cp);
      const norm = getVertexNormal(cp);
      const tex = getVertexTexCoord(cp);
      const lm = getVertexLightmapCoord(cp);
      const col = getVertexColor(cp);

      px += pos[0] * w;
      py += pos[1] * w;
      pz += pos[2] * w;

      nx += norm[0] * w;
      ny += norm[1] * w;
      nz += norm[2] * w;

      u += tex[0] * w;
      v += tex[1] * w;

      lu += lm[0] * w;
      lv += lm[1] * w;

      cr += col[0] * w;
      cg += col[1] * w;
      cb += col[2] * w;
      ca += col[3] * w;
    }
  }

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len > 0.0001) {
    nx /= len;
    ny /= len;
    nz /= len;
  } else {
    nx = 0;
    ny = 1;
    nz = 0;
  }

  return {
    pos: [px, py, pz],
    normal: [nx, ny, nz],
    uv: [u, v],
    uv2: [lu, lv],
    color: [cr, cg, cb, ca],
  };
}
