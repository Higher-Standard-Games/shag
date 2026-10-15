import type { BspFile, BspLightVol } from "./BspLoader";

/** Trilinear RGB with invalid compressed sites omitted and weights renormalized. Coordinates are Q3 space. */
export function sampleLightGrid(bsp: BspFile, position: [number, number, number]): BspLightVol | null {
  const origin = bsp.lightGridOrigin,
    size = bsp.lightGridSize,
    step = bsp.lightGridStep;
  if (!origin || !size || !step || !bsp.lightVols.length) return null;
  const grid = position.map((value, axis) => (value - origin[axis]) / step[axis]);
  if (grid.some((value, axis) => !Number.isFinite(value) || value < -1 || value > size[axis])) return null;
  const clamped = grid.map((value, axis) => Math.max(0, Math.min(size[axis] - 1, value)));
  const base = clamped.map(Math.floor);
  const fraction = clamped.map((value, axis) => value - base[axis]);
  const ambient: [number, number, number] = [0, 0, 0];
  const directional: [number, number, number] = [0, 0, 0];
  let weight = 0,
    nearestWeight = -1;
  let direction: [number, number] = [0, 0];
  for (let z = 0; z < 2; z++)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const w =
          (x ? fraction[0] : 1 - fraction[0]) *
          (y ? fraction[1] : 1 - fraction[1]) *
          (z ? fraction[2] : 1 - fraction[2]);
        if (w <= 0) continue;
        const ix = Math.min(base[0] + x, size[0] - 1),
          iy = Math.min(base[1] + y, size[1] - 1),
          iz = Math.min(base[2] + z, size[2] - 1);
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
  if (weight === 0) return null;
  for (let channel = 0; channel < 3; channel++) {
    ambient[channel] /= weight;
    directional[channel] /= weight;
  }
  return { ambient, directional, direction };
}
