import type { BspFile, BspLightVol } from "./BspLoader";

/** Trilinear RGB with invalid compressed sites omitted and weights renormalized. Coordinates are Q3 space. */
export function sampleLightGrid(bsp: BspFile, position: [number, number, number]): BspLightVol | null {
  return sampleLightGridInto(bsp, position[0], position[1], position[2], {
    ambient: [0, 0, 0],
    directional: [0, 0, 0],
    direction: [0, 0],
  });
}

/**
 * `sampleLightGrid` into a caller-owned result, returned (null where the grid
 * has no light), so a caller sampling every frame makes no garbage. The view
 * weapon samples at the camera every frame.
 */
export function sampleLightGridInto(
  bsp: BspFile,
  px: number,
  py: number,
  pz: number,
  out: BspLightVol,
): BspLightVol | null {
  const origin = bsp.lightGridOrigin,
    size = bsp.lightGridSize,
    step = bsp.lightGridStep;
  if (!origin || !size || !step || !bsp.lightVols.length) return null;
  const gx = (px - origin[0]) / step[0],
    gy = (py - origin[1]) / step[1],
    gz = (pz - origin[2]) / step[2];
  if (!inGrid(gx, size[0]) || !inGrid(gy, size[1]) || !inGrid(gz, size[2])) return null;
  const cx = Math.max(0, Math.min(size[0] - 1, gx)),
    cy = Math.max(0, Math.min(size[1] - 1, gy)),
    cz = Math.max(0, Math.min(size[2] - 1, gz));
  const bx = Math.floor(cx),
    by = Math.floor(cy),
    bz = Math.floor(cz);
  const fx = cx - bx,
    fy = cy - by,
    fz = cz - bz;
  const { ambient, directional } = out;
  ambient[0] = ambient[1] = ambient[2] = 0;
  directional[0] = directional[1] = directional[2] = 0;
  let weight = 0,
    nearestWeight = -1;
  let direction: readonly [number, number] | null = null;
  for (let z = 0; z < 2; z++)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const w = (x ? fx : 1 - fx) * (y ? fy : 1 - fy) * (z ? fz : 1 - fz);
        if (w <= 0) continue;
        const ix = Math.min(bx + x, size[0] - 1),
          iy = Math.min(by + y, size[1] - 1),
          iz = Math.min(bz + z, size[2] - 1);
        const site = bsp.lightVols[ix + size[0] * (iy + size[1] * iz)];
        if (!site || site.valid === false) continue;
        for (let channel = 0; channel < 3; channel++) {
          ambient[channel] += site.ambient[channel] * w;
          directional[channel] += site.directional[channel] * w;
        }
        weight += w;
        if (w > nearestWeight) {
          nearestWeight = w;
          direction = site.direction;
        }
      }
  if (weight === 0 || !direction) return null;
  for (let channel = 0; channel < 3; channel++) {
    ambient[channel] /= weight;
    directional[channel] /= weight;
  }
  out.direction[0] = direction[0];
  out.direction[1] = direction[1];
  return out;
}

function inGrid(value: number, size: number): boolean {
  return Number.isFinite(value) && value >= -1 && value <= size;
}
