import { describe, expect, it } from "vitest";
import { BotNavGraph } from "../BotNavGraph";
import type { BotVision } from "../BotVision";

function makeVision(triggerType: "teleport" | "push"): BotVision {
  return {
    mapKnowledge: {
      mapName: "testmap",
      spawnPoints: [{ x: 0, y: 0, z: 0 }],
      pickupPositions: [{ classname: "item_health_mega", position: { x: 3100, y: 0, z: 0 } }],
      triggerVolumes: [
        {
          id: 0,
          type: triggerType,
          min: { x: 80, y: -16, z: -16 },
          max: { x: 120, y: 16, z: 16 },
          dest: { x: 3000, y: 0, z: 0 },
          destYaw: triggerType === "teleport" ? 0 : undefined,
        },
      ],
    },
    collisionWorld: {
      trace: () => ({ hit: false, fraction: 1 }),
    },
    isPathClear: () => true,
    canSee: () => true,
    isInsideSolid: () => false,
  } as unknown as BotVision;
}

describe("BotNavGraph trigger awareness", () => {
  it("routes through teleporter volumes", () => {
    const graph = new BotNavGraph("testmap");
    graph.buildFromVision(makeVision("teleport"));

    expect(graph.nodes.some((n) => n.type === "teleporter")).toBe(true);
    expect(graph.edges.some((e) => e.type === "teleporter")).toBe(true);

    const path = graph.findPath({ x: 0, y: 0, z: 0 }, { x: 3100, y: 0, z: 0 });
    expect(path).not.toBeNull();
    expect(path!.nodes.some((n) => n.type === "teleporter")).toBe(true);
  });

  it("routes through jumppad volumes", () => {
    const graph = new BotNavGraph("testmap");
    graph.buildFromVision(makeVision("push"));

    expect(graph.nodes.some((n) => n.type === "jumppad")).toBe(true);
    expect(graph.edges.some((e) => e.type === "jumppad")).toBe(true);

    const path = graph.findPath({ x: 0, y: 0, z: 0 }, { x: 3100, y: 0, z: 0 });
    expect(path).not.toBeNull();
    expect(path!.nodes.some((n) => n.type === "jumppad")).toBe(true);
  });

  it("rebuilds without accumulating stale trigger edges", () => {
    const graph = new BotNavGraph("testmap");
    graph.buildFromVision(makeVision("teleport"));
    const firstEdgeCount = graph.edgeCount;

    graph.buildFromVision(makeVision("teleport"));
    expect(graph.edgeCount).toBe(firstEdgeCount);
  });
});
