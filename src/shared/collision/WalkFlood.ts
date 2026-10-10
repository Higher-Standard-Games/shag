/**
 * Where can a player get to on foot? A flood fill over a collision world using
 * the game's own movement: `stepSlideMove` with the player hull (steps up to 18
 * units, slides along walls), then a drop onto whatever is below. Because it
 * explores in short steps it walks around crates and finds doorways that a
 * straight line between two points misses.
 *
 * Game space, Y up. Positions are hull origins, 24 units above the feet.
 */

export interface FloodVec3 {
  x: number;
  y: number;
  z: number;
}

export interface FloodWorld {
  trace(
    start: FloodVec3,
    end: FloodVec3,
    bounds?: { min: FloodVec3; max: FloodVec3 },
  ): {
    fraction: number;
    hitPoint?: FloodVec3;
  };
  stepSlideMove(
    start: FloodVec3,
    velocity: FloodVec3,
    dt: number,
    bounds: { min: FloodVec3; max: FloodVec3 },
  ): { endPos: FloodVec3 };
}

/** A teleporter or jump pad volume and where it sends a player. */
export interface FloodTrigger {
  min: FloodVec3;
  max: FloodVec3;
  dest: FloodVec3;
}

/** A reached standing position and the distance travelled to it. */
export interface FloodPosition extends FloodVec3 {
  distance: number;
}

export interface WalkFloodOptions {
  /** Length of one exploration step. Default 32. */
  step?: number;
  /** Visited positions are told apart on a grid this fine, horizontally. Default 16. */
  cell?: number;
  /** Standing hop height tried when a step is blocked; 0 disables hops. Default 0. */
  hop?: number;
  /** Deepest drop a step may end in; anything deeper is a ledge, not a step. Default 1024. */
  maxDrop?: number;
  /** Horizontal distance from the start the flood stays within. Default unlimited. */
  radius?: number;
  /** Cap on visited positions, so a huge map cannot run forever. Default 60,000. */
  maxStates?: number;
  /** Teleporter and jump pad volumes; touching one adds its destination. */
  triggers?: readonly FloodTrigger[];
}

/** The player hull as the collision world expects it (its origin is 24 above the feet). */
export const PLAYER_HULL = { min: { x: -15, y: -24, z: -15 }, max: { x: 15, y: 40, z: 15 } };

const DIRECTIONS = Array.from({ length: 8 }, (_, i) => {
  const angle = (i * Math.PI) / 4;
  return { x: Math.cos(angle), z: Math.sin(angle) };
});

/** Lower a hull standing at `p` onto the surface below, at most `maxDrop`; null over a deeper drop. */
export function settle(world: FloodWorld, p: FloodVec3, maxDrop = 1024): FloodVec3 | null {
  const from = { x: p.x, y: p.y + 1, z: p.z };
  const hit = world.trace(from, { x: p.x, y: p.y - maxDrop, z: p.z }, PLAYER_HULL);
  if (hit.fraction >= 1 || !hit.hitPoint) return null;
  return { x: hit.hitPoint.x, y: hit.hitPoint.y + 0.25, z: hit.hitPoint.z };
}

const touches = (p: FloodVec3, t: FloodTrigger) =>
  p.x + PLAYER_HULL.max.x > t.min.x &&
  p.x + PLAYER_HULL.min.x < t.max.x &&
  p.y + PLAYER_HULL.max.y > t.min.y &&
  p.y + PLAYER_HULL.min.y < t.max.y &&
  p.z + PLAYER_HULL.max.z > t.min.z &&
  p.z + PLAYER_HULL.min.z < t.max.z;

/** Every standing position reachable from `start`, nearest first. */
export function walkFlood(world: FloodWorld, start: FloodVec3, options: WalkFloodOptions = {}): FloodPosition[] {
  const step = options.step ?? 32;
  const cell = options.cell ?? 16;
  const hop = options.hop ?? 0;
  const maxDrop = options.maxDrop ?? 1024;
  const radius = options.radius ?? Number.POSITIVE_INFINITY;
  const maxStates = options.maxStates ?? 60_000;
  const triggers = options.triggers ?? [];

  const settled = settle(world, start);
  if (!settled) return [];
  const first: FloodPosition = { ...settled, distance: 0 };
  const key = (p: FloodVec3) => `${Math.round(p.x / cell)},${Math.round(p.z / cell)},${Math.round(p.y / 8)}`;
  const seen = new Set([key(first)]);
  const reached = [first];
  const queue = [first];
  const move = (from: FloodVec3, dir: { x: number; z: number }) =>
    world.stepSlideMove(from, { x: dir.x * step * 8, y: 0, z: dir.z * step * 8 }, 1 / 8, PLAYER_HULL).endPos;
  const visit = (landed: FloodVec3, distance: number) => {
    if (Math.hypot(landed.x - first.x, landed.z - first.z) > radius) return;
    const k = key(landed);
    if (seen.has(k)) return;
    seen.add(k);
    const position = { ...landed, distance };
    reached.push(position);
    queue.push(position);
  };

  for (let head = 0; head < queue.length && reached.length < maxStates; head++) {
    const p = queue[head];
    for (const trigger of triggers) {
      if (!touches(p, trigger)) continue;
      const arrived = settle(world, trigger.dest);
      if (arrived) visit(arrived, p.distance);
    }
    for (const dir of DIRECTIONS) {
      let end = move(p, dir);
      let moved = Math.hypot(end.x - p.x, end.z - p.z);
      let hopped = false;
      if (moved < step / 2) {
        if (hop <= 0) continue;
        // Blocked: try a standing hop onto a ledge within jump height.
        const up = world.trace(p, { x: p.x, y: p.y + hop, z: p.z }, PLAYER_HULL);
        const top = up.hitPoint ?? { x: p.x, y: p.y + hop, z: p.z };
        if (top.y - p.y < hop / 2) continue;
        end = move(top, dir);
        moved = Math.hypot(end.x - p.x, end.z - p.z);
        if (moved < step / 2) continue;
        hopped = true;
      }
      const landed = settle(world, end, maxDrop + (hopped ? hop : 0));
      if (!landed) continue;
      // The movement step can stair-step a further 18 units at the apex; count
      // only landings within jump height, so the flood never overstates.
      if (hopped && landed.y - p.y > hop) continue;
      visit(landed, p.distance + moved);
    }
  }
  return reached;
}
