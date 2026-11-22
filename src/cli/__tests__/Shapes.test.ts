import { describe, expect, it } from "vitest";
import { compileBlockMap } from "../blockmap/BspWriter";
import type { BlockMap, Box, Vec3 } from "../blockmap/MapSpec";
import { arch, stairs } from "../blockmap/Shapes";

const textures = { top: "textures/t/stone", side: "textures/t/stone" };
const inside = (boxes: Box[], p: Vec3) =>
  boxes.some((box) => [0, 1, 2].every((a) => p[a] > box.mins[a] && p[a] < box.maxs[a]));

describe("stairs", () => {
  it("climbs one rise per run, each step solid to the base", () => {
    const boxes = stairs({ origin: [0, 0, 0], climb: "+x", width: 32, steps: 4, rise: 8, run: 16, textures });
    expect(boxes).toHaveLength(4);
    expect(boxes.map((box) => box.maxs[2])).toEqual([8, 16, 24, 32]);
    expect(boxes.map((box) => box.mins[0])).toEqual([0, 16, 32, 48]);
    expect(boxes.every((box) => box.mins[2] === 0)).toBe(true);
  });

  it("climbs the other way with -y", () => {
    const boxes = stairs({ origin: [0, 0, 0], climb: "-y", width: 32, steps: 3, rise: 8, run: 16, textures });
    // The highest step sits at the smallest y
    expect(boxes[2].mins[1]).toBe(0);
    expect(boxes[2].maxs[2]).toBe(24);
    expect(boxes[0].mins[1]).toBe(32);
  });
});

describe("arch", () => {
  const boxes = arch({ origin: [0, 0, 0], along: "x", span: 64, spring: 32, thickness: 16, depth: 24, textures });

  it("leaves the opening clear and closes the wall around it", () => {
    // Under the crown and between the piers: open
    expect(inside(boxes, [0, 0, 40])).toBe(false);
    expect(inside(boxes, [-28, 0, 20])).toBe(false);
    // Piers and the wall above the crown: solid
    expect(inside(boxes, [-36, 0, 20])).toBe(true);
    expect(inside(boxes, [36, 0, 20])).toBe(true);
    expect(inside(boxes, [2, 0, 70])).toBe(true);
    // Through the wall only as deep as asked
    expect(inside(boxes, [2, 13, 70])).toBe(false);
  });

  it("rounds the top: lower at the sides than at the crown", () => {
    const columns = boxes.slice(2).sort((a, b) => a.mins[0] - b.mins[0]);
    const middle = columns[Math.floor(columns.length / 2)];
    expect(columns[0].mins[2]).toBeLessThan(middle.mins[2]);
    expect(middle.mins[2]).toBeLessThanOrEqual(32 + 32);
  });
});

describe("shapes in a block map", () => {
  it("compiles a map that has stairs and an arch", () => {
    const map: BlockMap = {
      name: "shapes",
      title: "Shapes",
      boxes: [{ mins: [-128, -128, -16], maxs: [128, 128, 0], textures }],
      shapes: [
        { type: "stairs", origin: [-96, -96, 0], climb: "+y", width: 32, steps: 4, rise: 8, run: 16, textures },
        { type: "arch", origin: [32, 32, 0], along: "x", span: 48, spring: 24, thickness: 12, depth: 16, textures },
      ],
      lighting: {
        sunDirection: [0, 0, -1],
        sunColor: [1, 1, 1],
        skyAmbient: [0.2, 0.2, 0.2],
        groundAmbient: [0.1, 0.1, 0.1],
        points: [],
      },
      entities: [{ classname: "info_player_start", origin: "0 0 24" }],
      luxelSize: 16,
      gridSize: [64, 64, 64],
      textureScale: 64,
    };
    const compiled = compileBlockMap(map);
    // The floor, 4 steps, 2 piers and one column per 4 units of the 48-unit span
    expect(compiled.stats.brushes).toBe(1 + 4 + 2 + 12);
  });
});
