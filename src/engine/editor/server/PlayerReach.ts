/**
 * Where can a player actually go? A flood fill over the compiled map using the
 * game's own movement: `stepSlideMove` with the player hull (steps up to 18
 * units, slides along walls), drops onto whatever is below, and hops onto
 * ledges within jump height. Unlike the bots' navigation graph it walks stairs
 * and narrow doorways, so it answers the player's question, not the bot's.
 *
 * Game space is Y up; findings are reported in Quake coordinates (Z up).
 */

import type { ReachabilityReport, ReachNode } from "../api/Reachability";
import { analyzeReachability } from "../api/Reachability";
import type { EditorDocumentData } from "../EditorDocument";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface World {
  trace(start: Vec3, end: Vec3, bounds?: { min: Vec3; max: Vec3 }): { fraction: number; hitPoint?: Vec3 };
  stepSlideMove(start: Vec3, velocity: Vec3, dt: number, bounds: { min: Vec3; max: Vec3 }): { endPos: Vec3 };
}

/** The player hull as the collision world expects it (its origin is 24 above the feet). */
const HULL = { min: { x: -15, y: -24, z: -15 }, max: { x: 15, y: 40, z: 15 } };
/** One flood step, in units. */
const STEP = 32;
/** Jump apex: velocity 270 against gravity 800 rises about 45.6 units. */
const HOP = 45;
/** Deepest drop followed before a fall counts as into the void. */
const MAX_DROP = 1024;
/** A position counts as at an item or spawn when this close. */
const TOUCH = 48;
/** Cap on visited positions per spawn, so a huge map cannot run forever. */
const MAX_STATES = 60_000;

const DIRECTIONS = Array.from({ length: 8 }, (_, i) => {
  const angle = (i * Math.PI) / 4;
  return { x: Math.cos(angle), z: Math.sin(angle) };
});

/** Lower a hull standing at `p` onto the surface below; null over the void. */
function settle(world: World, p: Vec3): Vec3 | null {
  const from = { x: p.x, y: p.y + 1, z: p.z };
  const hit = world.trace(from, { x: p.x, y: p.y - MAX_DROP, z: p.z }, HULL);
  if (hit.fraction >= 1 || !hit.hitPoint) return null;
  return { x: hit.hitPoint.x, y: hit.hitPoint.y + 0.25, z: hit.hitPoint.z };
}

const key = (p: Vec3) => `${Math.round(p.x / 16)},${Math.round(p.z / 16)},${Math.round(p.y / 8)}`;

/** Every standing position a player starting at `start` can reach. */
export function floodFrom(world: World, start: Vec3): Vec3[] {
  const first = settle(world, start);
  if (!first) return [];
  const seen = new Set([key(first)]);
  const reached = [first];
  const queue = [first];
  const move = (from: Vec3, dir: { x: number; z: number }) =>
    world.stepSlideMove(from, { x: dir.x * STEP * 8, y: 0, z: dir.z * STEP * 8 }, 1 / 8, HULL).endPos;
  while (queue.length && reached.length < MAX_STATES) {
    const p = queue.shift()!;
    for (const dir of DIRECTIONS) {
      let end = move(p, dir);
      let moved = Math.hypot(end.x - p.x, end.z - p.z);
      let hopped = false;
      if (moved < STEP / 2) {
        // Blocked: try a standing hop onto a ledge within jump height.
        const up = world.trace(p, { x: p.x, y: p.y + HOP, z: p.z }, HULL);
        const top = up.hitPoint ?? { x: p.x, y: p.y + HOP, z: p.z };
        if (top.y - p.y < HOP / 2) continue;
        end = move(top, dir);
        moved = Math.hypot(end.x - p.x, end.z - p.z);
        if (moved < STEP / 2) continue;
        hopped = true;
      }
      const landed = settle(world, end);
      if (!landed) continue;
      // The movement step can stair-step a further 18 units at the apex; count
      // only landings within jump height, so the report never overstates.
      if (hopped && landed.y - p.y > HOP) continue;
      const k = key(landed);
      if (seen.has(k)) continue;
      seen.add(k);
      reached.push(landed);
      queue.push(landed);
    }
  }
  return reached;
}

export interface PlayerReachInput {
  world: World;
  /** Spawn origins, game space (already at standing height). */
  spawns: Vec3[];
  /** Pickup positions with classnames, game space. */
  items: Array<{ classname: string; position: Vec3 }>;
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
    const reached = floodFrom(input.world, spawn);
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
