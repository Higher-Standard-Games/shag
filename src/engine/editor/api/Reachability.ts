/**
 * Can every spawn reach every item and every other spawn? Answered from the
 * bot navigation graph of the compiled map (walk, jump, fall, jump-pad and
 * teleporter edges), so it reflects what a player can actually traverse.
 * Pure: the caller builds the graph.
 */
import type { EditorDocumentData, Vec3q } from "../EditorDocument";

/** The parts of a bot nav graph this needs; positions are game space (Y up). */
export interface ReachNode {
  id: number;
  type: string;
  position: { x: number; y: number; z: number };
  classname?: string;
}
export interface ReachEdge {
  from: number;
  to: number;
}

export interface ReachTarget {
  classname: string;
  /** Quake coordinates (Z up), as in the editor. */
  origin: Vec3q;
  /** The editor entity this most likely is, when one is near. */
  objectId: string | null;
}

export interface ReachabilityReport {
  ok: boolean;
  spawns: number;
  items: number;
  /** Items some spawn cannot reach; reachableFrom counts spawns that can. */
  unreachableItems: Array<ReachTarget & { reachableFrom: number }>;
  /** Spawns that cannot reach every other spawn. */
  cutOffSpawns: Array<ReachTarget & { reaches: number }>;
}

/** Game space is Babylon's Y up; the editor is Quake's Z up. */
export const toQuake = (p: { x: number; y: number; z: number }): Vec3q => ({ x: p.x, y: p.z, z: p.y });

const round = (p: Vec3q): Vec3q => ({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) });

/** How far a compiled entity may sit from its editor origin and still be matched (items settle to the floor). */
const MATCH_DISTANCE = 96;

export function analyzeReachability(
  nodes: readonly ReachNode[],
  edges: readonly ReachEdge[],
  doc?: EditorDocumentData,
): ReachabilityReport {
  const out = new Map<number, number[]>();
  for (const edge of edges) {
    const list = out.get(edge.from);
    if (list) list.push(edge.to);
    else out.set(edge.from, [edge.to]);
  }
  const reach = (start: number): Set<number> => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      for (const next of out.get(queue.pop()!) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  const spawns = nodes.filter((n) => n.type === "spawn");
  const items = nodes.filter((n) => n.type === "item");
  const reached = new Map(spawns.map((s) => [s.id, reach(s.id)]));

  const describe = (node: ReachNode): ReachTarget => {
    const origin = toQuake(node.position);
    // Spawn nodes carry no classname; match them to any player start.
    const matches =
      node.type === "spawn"
        ? (classname: string) => classname.startsWith("info_player")
        : (classname: string) => classname === node.classname;
    const objectId = matchEntity(doc, matches, origin);
    const classname = doc?.entities.find((e) => e.id === objectId)?.classname ?? node.classname ?? node.type;
    return { classname, origin: round(origin), objectId };
  };
  const unreachableItems = items
    .map((item) => ({ item, from: spawns.filter((s) => reached.get(s.id)!.has(item.id)).length }))
    .filter(({ from }) => from < spawns.length)
    .map(({ item, from }) => ({ ...describe(item), reachableFrom: from }));
  const cutOffSpawns = spawns
    .map((spawn) => ({ spawn, reaches: spawns.filter((o) => o !== spawn && reached.get(spawn.id)!.has(o.id)).length }))
    .filter(({ reaches }) => reaches < spawns.length - 1)
    .map(({ spawn, reaches }) => ({ ...describe(spawn), reaches }));
  return {
    ok: spawns.length > 0 && unreachableItems.length === 0 && cutOffSpawns.length === 0,
    spawns: spawns.length,
    items: items.length,
    unreachableItems,
    cutOffSpawns,
  };
}

function matchEntity(
  doc: EditorDocumentData | undefined,
  matches: (classname: string) => boolean,
  origin: Vec3q,
): string | null {
  if (!doc) return null;
  let best: { id: string; distance: number } | null = null;
  for (const entity of doc.entities) {
    if (!matches(entity.classname)) continue;
    const distance = Math.hypot(entity.origin.x - origin.x, entity.origin.y - origin.y, entity.origin.z - origin.z);
    if (distance <= MATCH_DISTANCE && (!best || distance < best.distance)) best = { id: entity.id, distance };
  }
  return best?.id ?? null;
}
