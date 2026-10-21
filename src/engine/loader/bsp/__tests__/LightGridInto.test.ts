import { expect, it } from "vitest";
import type { BspFile, BspLightVol } from "../BspLoader";
import { sampleLightGrid, sampleLightGridInto } from "../LightGridSampling";

it("fills a reused result exactly as a fresh sample, point after point", () => {
  const size: [number, number, number] = [3, 3, 2];
  const lightVols: BspLightVol[] = [];
  for (let i = 0; i < size[0] * size[1] * size[2]; i++) {
    lightVols.push({
      valid: i % 7 !== 3,
      ambient: [i * 3, 100 - i, (i * 37) % 255],
      directional: [(i * 11) % 200, i, 5],
      direction: [i % 4, (i * 3) % 5],
    });
  }
  const bsp = {
    lightGridOrigin: [0, 0, 0],
    lightGridSize: size,
    lightGridStep: [64, 64, 128],
    lightVols,
  } as unknown as BspFile;
  const out: BspLightVol = { ambient: [0, 0, 0], directional: [0, 0, 0], direction: [0, 0] };
  for (const point of [
    [10, 20, 30],
    [100, 70, 120],
    [127, 127, 200],
    [-50, 0, 0],
    [0, 0, 9999],
  ] as [number, number, number][]) {
    const fresh = sampleLightGrid(bsp, point);
    const reused = sampleLightGridInto(bsp, point[0], point[1], point[2], out);
    if (fresh === null) expect(reused).toBeNull();
    else expect(reused).toEqual({ ambient: fresh.ambient, directional: fresh.directional, direction: fresh.direction });
  }
});
