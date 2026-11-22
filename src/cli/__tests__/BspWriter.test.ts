import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BspLoader, findLeafForPoint } from "../../engine/loader/bsp/BspLoader";
import { compileBlockMap } from "../blockmap/BspWriter";
import { LightBaker } from "../blockmap/Lighting";
import type { BlockMap } from "../blockmap/MapSpec";

/** Deterministic random numbers in [0, 1) (mulberry32). */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A floor and a few hundred random blocks, for testing the shadow grid walk. */
function scatteredBlocks(): BlockMap {
  const rand = seededRandom(3);
  const map = twoBoxes();
  map.boxes = [
    { mins: [-1100, -850, -64], maxs: [1100, 850, 0], textures: { top: "textures/t/floor", side: "textures/t/wall" } },
  ];
  for (let i = 0; i < 300; i++) {
    const x = Math.round((rand() - 0.5) * 2000);
    const y = Math.round((rand() - 0.5) * 1600);
    const w = 16 + Math.round(rand() * 96);
    const d = 16 + Math.round(rand() * 96);
    const h = 16 + Math.round(rand() * 160);
    map.boxes.push({
      mins: [x, y, 0],
      maxs: [x + w, y + d, h],
      textures: { top: "textures/t/wall", side: "textures/t/wall" },
    });
  }
  return map;
}

const lighting: BlockMap["lighting"] = {
  sunDirection: [0, 0, -1],
  sunColor: [1, 1, 1],
  skyAmbient: [0.2, 0.2, 0.2],
  groundAmbient: [0.1, 0.1, 0.1],
  points: [],
};

function twoBoxes(): BlockMap {
  return {
    name: "test",
    title: "Test",
    boxes: [
      { mins: [0, 0, -64], maxs: [128, 128, 0], textures: { top: "textures/t/floor", side: "textures/t/wall" } },
      { mins: [32, 32, 0], maxs: [64, 64, 32], textures: { top: "textures/t/wall", side: "textures/t/wall" } },
    ],
    lighting,
    entities: [{ classname: "info_player_start", origin: "100 100 24" }],
    luxelSize: 16,
    gridSize: [64, 64, 64],
    textureScale: 64,
  };
}

function parse(map: BlockMap) {
  const { bytes } = compileBlockMap(map);
  return BspLoader.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

describe("compileBlockMap", () => {
  it("writes an IBSP that the engine loader reads back", () => {
    const bsp = parse(twoBoxes());
    expect(bsp.header.isFBSP).toBe(false);
    expect(bsp.header.version).toBe(46);
    expect(bsp.textures.map((t) => t.name)).toEqual(["textures/t/floor", "textures/t/wall"]);
    expect(bsp.textures.every((t) => t.contentFlags === 1)).toBe(true);
    expect(bsp.brushes).toHaveLength(2);
    expect(bsp.models[0].mins).toEqual([0, 0, -64]);
    expect(bsp.models[0].maxs).toEqual([128, 128, 32]);
    expect(bsp.entities.map((e) => e.classname)).toEqual(["worldspawn", "info_player_start"]);
    expect(bsp.visData?.numClusters).toBe(1);
  });

  it("skips bottoms and faces covered by a neighbour", () => {
    // Floor: top + 4 sides. Block on top: top + 4 sides; its bottom is not emitted
    expect(parse(twoBoxes()).faces).toHaveLength(10);
  });

  it("orders brush sides -X +X -Y +Y -Z +Z with matching plane distances", () => {
    const bsp = parse(twoBoxes());
    const sides = bsp.brushSides.slice(bsp.brushes[1].firstSide, bsp.brushes[1].firstSide + 6);
    const planes = sides.map((side) => bsp.planes[side.planeIndex]);
    expect(planes.map((p) => p.normal)).toEqual([
      [-1, 0, 0],
      [1, 0, 0],
      [0, -1, 0],
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, 1],
    ]);
    expect(planes.map((p) => p.dist)).toEqual([-32, 64, -32, 64, 0, 32]);
  });

  it("puts every point of the world in the one visible leaf", () => {
    const bsp = parse(twoBoxes());
    const leaf = findLeafForPoint([100, 100, 24], bsp.nodes, bsp.leafs, bsp.planes);
    expect(leaf?.cluster).toBe(0);
    expect(leaf?.numLeafBrushes).toBe(2);
    expect(leaf?.numLeafFaces).toBe(bsp.faces.length);
  });

  it("sizes the light grid as the loader predicts", () => {
    const bsp = parse(twoBoxes());
    const [x, y, z] = bsp.lightGridSize!;
    expect(bsp.lightVols).toHaveLength(x * y * z);
  });

  it("bakes shadow from the block onto the floor", () => {
    const bsp = parse(twoBoxes());
    const floor = bsp.faces.find((f) => f.normal[2] === 1 && bsp.textures[f.textureIndex].name.endsWith("floor"))!;
    const page = bsp.lightmaps[floor.lightmapIndex];
    const luxel = (i: number, j: number) => page[((floor.lightmapStart[1] + j) * 128 + floor.lightmapStart[0] + i) * 3];
    // The block covers x/y 32..64; with the sun straight down the floor under it is unlit
    expect(luxel(0, 0)).toBeGreaterThan(luxel(3, 3));
  });

  it("compiles the example map", () => {
    const json = readFileSync(new URL("../blockmap/examples/tiny.json", import.meta.url), "utf8");
    const map = {
      luxelSize: 8,
      gridSize: [64, 64, 64],
      textureScale: 64,
      title: "Tiny",
      ...JSON.parse(json),
    } as BlockMap;
    const bsp = parse(map);
    expect(bsp.faces.length).toBeGreaterThan(5);
    expect(bsp.entities.find((e) => e.classname === "info_player_start")).toBeDefined();
  });

  it("gives liquid boxes water contents, and keeps the faces behind water", () => {
    const map = twoBoxes();
    map.boxes = [
      { mins: [0, 0, -64], maxs: [64, 64, -32], textures: { top: "textures/t/sand", side: "textures/t/wall" } },
      { mins: [64, 0, -64], maxs: [128, 64, 0], textures: { top: "textures/t/floor", side: "textures/t/wall" } },
      {
        mins: [0, 0, -32],
        maxs: [64, 64, -8],
        textures: { top: "textures/t/water", side: "textures/t/water" },
        liquid: true,
      },
    ];
    const bsp = parse(map);
    const water = bsp.textures.findIndex((t) => t.name === "textures/t/water");
    expect(bsp.textures[water].contentFlags).toBe(0x20);
    expect(bsp.brushes[2].shaderIndex).toBe(water);
    // The bank's west side, behind the water, is still drawn
    expect(bsp.faces.some((f) => f.normal[0] === -1 && f.lightmapOrigin[0] === 64)).toBe(true);
    expect(() =>
      parse({
        ...map,
        boxes: [...map.boxes, { ...map.boxes[0], textures: { top: "textures/t/water", side: "textures/t/wall" } }],
      }),
    ).toThrow(/both liquid and solid/);
  });

  it("finds the same shadows with the grid walk as by testing every box", () => {
    const map = scatteredBlocks();
    const baker = new LightBaker(map.boxes, map.lighting);
    const solid = map.boxes.filter((box) => !box.liquid);
    const brute = (o: [number, number, number], d: [number, number, number], max: number) =>
      solid.some((box) => {
        let near = 1e-3;
        let far = max;
        for (let a = 0; a < 3; a++) {
          if (Math.abs(d[a]) < 1e-9) {
            if (o[a] <= box.mins[a] || o[a] >= box.maxs[a]) return false;
            continue;
          }
          let t0 = (box.mins[a] - o[a]) / d[a];
          let t1 = (box.maxs[a] - o[a]) / d[a];
          if (t0 > t1) [t0, t1] = [t1, t0];
          near = Math.max(near, t0);
          far = Math.min(far, t1);
          if (near > far) return false;
        }
        return true;
      });
    const rand = seededRandom(7);
    let hits = 0;
    for (let i = 0; i < 3000; i++) {
      const o: [number, number, number] = [(rand() - 0.5) * 2200, (rand() - 0.5) * 1700, 1 + rand() * 200];
      const z = -rand();
      const a = rand() * Math.PI * 2;
      const h = Math.sqrt(1 - z * z);
      const d: [number, number, number] = [Math.cos(a) * h, Math.sin(a) * h, z];
      const max = 50 + rand() * 1500;
      const expected = brute(o, d, max);
      expect(baker.occluded(o, d, max)).toBe(expected);
      if (expected) hits++;
    }
    expect(hits).toBeGreaterThan(100);
  });

  it("puts point lights in the light grid, pointing at the lamp", () => {
    const map = twoBoxes();
    const lamp = {
      origin: [100, 100, 40] as [number, number, number],
      color: [1, 0.5, 0] as [number, number, number],
      radius: 200,
    };
    const baker = new LightBaker(map.boxes, { ...lighting, sunColor: [0, 0, 0], points: [lamp] });
    const near = baker.gridSample([100, 100, 8]);
    const far = baker.gridSample([0, 0, 8]);
    expect(near.directional[0]).toBeGreaterThan(far.directional[0]);
    expect(near.directional[0]).toBeGreaterThan(near.directional[2]);
    // Straight below the lamp the light comes from above
    expect(near.direction[2]).toBeGreaterThan(0.9);
  });

  it("darkens ambient light at the foot of a wall (baked occlusion)", () => {
    const map = twoBoxes();
    const open = new LightBaker(map.boxes, { ...lighting, sunColor: [0, 0, 0] });
    const occluded = new LightBaker(map.boxes, {
      ...lighting,
      sunColor: [0, 0, 0],
      occlusion: { radius: 32, strength: 1 },
    });
    // Floor right next to the block versus floor far from it
    const foot = occluded.shade([66, 48, 0], [0, 0, 1]);
    const clear = occluded.shade([120, 120, 0], [0, 0, 1]);
    expect(foot[0]).toBeLessThan(clear[0]);
    expect(open.shade([66, 48, 0], [0, 0, 1])[0]).toBeCloseTo(clear[0], 5);
  });

  it("writes the baked sun direction into worldspawn", () => {
    const bsp = parse(twoBoxes());
    const worldspawn = bsp.entities.find((e) => e.classname === "worldspawn")!;
    expect(worldspawn.properties._sun_direction).toBe("0 0 -1");
  });
});
