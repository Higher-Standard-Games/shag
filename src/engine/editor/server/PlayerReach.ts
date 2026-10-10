/**
 * Where can a player actually go? The shared walk flood over the compiled map
 * (`WalkFlood`), with standing hops onto ledges within jump height and
 * teleporters and jump pads followed.
 *
 * Game space is Y up; findings are reported in Quake coordinates (Z up).
 */

import { type FloodTrigger, type FloodVec3, type FloodWorld, walkFlood } from "../../../shared/collision/WalkFlood";
import type { ReachabilityReport, ReachNode } from "../api/Reachability";
import { analyzeReachability } from "../api/Reachability";
import type { EditorDocumentData } from "../EditorDocument";

type Vec3 = FloodVec3;

/** Jump apex: velocity 270 against gravity 800 rises about 45.6 units. */
const HOP = 45;
/** A position counts as at an item or spawn when this close. */
const TOUCH = 48;

/** A teleporter or jump pad volume and where it sends a player (game space). */
export type ReachTrigger = FloodTrigger;

/**
 * Every standing position a player starting at `start` can reach, hopping onto
 * ledges within jump height. Walking into a teleporter or jump pad adds its
 * destination (a jump pad's target is where its throw lands).
 */
export function floodFrom(world: FloodWorld, start: Vec3, triggers: readonly ReachTrigger[] = []): Vec3[] {
  return walkFlood(world, start, { hop: HOP, triggers });
}

export interface PlayerReachInput {
  world: FloodWorld;
  /** Spawn origins, game space (already at standing height). */
  spawns: Vec3[];
  /** Pickup positions with classnames, game space. */
  items: Array<{ classname: string; position: Vec3 }>;
  /** Teleporter and jump pad volumes. */
  triggers?: readonly ReachTrigger[];
}

/** Spawn→item and spawn→spawn reachability for players, in the shared report shape. */
export function playerReachability(
  input: PlayerReachInput,
  doc?: EditorDocumentData,
): ReachabilityReport & { positions: number } {
  const nodes: ReachNode[] = [
    ...input.spawns.map((position, id) => ({ id, type: "spawn", position })),
    ...input.items.map((item, i) => ({
      id: input.spawns.length + i,
      type: "item",
      position: item.position,
      classname: item.classname,
    })),
  ];
  const edges: Array<{ from: number; to: number }> = [];
  let positions = 0;
  input.spawns.forEach((spawn, from) => {
    const reached = floodFrom(input.world, spawn, input.triggers);
    positions = Math.max(positions, reached.length);
    for (const node of nodes) {
      if (node.id === from) continue;
      const near = reached.some(
        (p) =>
          Math.hypot(p.x - node.position.x, p.z - node.position.z) <= TOUCH && Math.abs(p.y - node.position.y) <= 64,
      );
      if (near) edges.push({ from, to: node.id });
    }
  });
  return { ...analyzeReachability(nodes, edges, doc), positions };
}
