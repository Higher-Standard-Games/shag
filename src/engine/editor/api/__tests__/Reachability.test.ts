import { describe, expect, it } from "vitest";
import { applyOperations, emptyDocument } from "../Operations";
import { analyzeReachability, type ReachEdge, type ReachNode, toQuake } from "../Reachability";

// Game space is Y up: Quake (x, y, z) is (x, z, y) here.
const node = (id: number, type: string, x: number, y: number, z: number, classname?: string): ReachNode => ({
  id,
  type,
  position: { x, y: z, z: y },
  classname,
});

const doc = applyOperations(emptyDocument(), [
  { op: "entity.place", id: "spawn-a", classname: "info_player_deathmatch", origin: { x: 0, y: 0, z: 24 } },
  { op: "entity.place", id: "spawn-b", classname: "info_player_deathmatch", origin: { x: 512, y: 0, z: 24 } },
  { op: "entity.place", id: "rl", classname: "weapon_rocketlauncher", origin: { x: 256, y: 0, z: 16 } },
]).doc;

const nodes = [
  node(1, "spawn", 0, 0, 24),
  node(2, "spawn", 512, 0, 24),
  node(3, "item", 256, 0, 4, "weapon_rocketlauncher"),
  node(4, "floor", 128, 0, 0),
];

describe("analyzeReachability", () => {
  it("passes when every spawn reaches every item and spawn", () => {
    const edges: ReachEdge[] = [
      { from: 1, to: 4 },
      { from: 4, to: 1 },
      { from: 4, to: 3 },
      { from: 3, to: 4 },
      { from: 3, to: 2 },
      { from: 2, to: 3 },
    ];
    const report = analyzeReachability(nodes, edges, doc);
    expect(report).toMatchObject({ ok: true, spawns: 2, items: 1, unreachableItems: [], cutOffSpawns: [] });
  });

  it("follows edge direction: a one-way drop does not make the way back reachable", () => {
    const edges: ReachEdge[] = [
      { from: 1, to: 3 },
      { from: 3, to: 2 },
      { from: 2, to: 3 },
    ];
    const report = analyzeReachability(nodes, edges, doc);
    expect(report.ok).toBe(false);
    expect(report.unreachableItems).toEqual([]);
    expect(report.cutOffSpawns).toEqual([
      { classname: "info_player_deathmatch", origin: { x: 512, y: 0, z: 24 }, objectId: "spawn-b", reaches: 0 },
    ]);
  });

  it("maps findings back to editor entities and Quake coordinates", () => {
    const report = analyzeReachability(nodes, [{ from: 2, to: 3 }], doc);
    expect(report.unreachableItems).toEqual([
      { classname: "weapon_rocketlauncher", origin: { x: 256, y: 0, z: 4 }, objectId: "rl", reachableFrom: 1 },
    ]);
    expect(toQuake({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 3, z: 2 });
  });

  it("is never ok without a spawn", () => {
    expect(analyzeReachability([node(3, "item", 0, 0, 0, "weapon_rocketlauncher")], []).ok).toBe(false);
  });
});
