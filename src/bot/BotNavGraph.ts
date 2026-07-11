/**
 * BotNavGraph — Smart Waypoint Network
 *
 * Provides intelligent map navigation via a waypoint graph with A* pathfinding.
 *
 * Architecture (4 layers):
 *   Layer 0: Per-tick feelers (immediate wall avoidance — in StateMachineBrain)
 *   Layer 1: Waypoint nodes (where can the bot stand)
 *   Layer 2: Edge connections (how to get between nodes)
 *   Layer 3: A* pathfinding (optimal routes)
 *
 * Node sources:
 *   - Item/weapon pickup positions from BSP
 *   - Player spawn points from BSP
 *   - Floor-grid sampling (fills navigation gaps)
 *
 * Edge types:
 *   - Walk: flat path clear, height diff < 40
 *   - Jump:  height diff 40-80, horizontal clear
 *   - Fall:  height diff > 80, high→low only
 *
 * One instance per map, shared by all bots.
 */

import type { Vec3 } from "../shared/bsp/BspDataLoader";
import { vec3Distance } from "./BotGameState";
import type { BotVision, MapKnowledgeData } from "./BotVision";

// ── Nav Types ───────────────────────────────────────────────────────

export type NavNodeType = "item" | "spawn" | "floor" | "jumppad" | "teleporter";

export interface NavNode {
  id: number;
  position: Vec3;
  type: NavNodeType;
  /** BSP classname for items (e.g. 'item_health_mega', 'weapon_rocketlauncher') */
  classname?: string;
}

export type NavEdgeType = "walk" | "jump" | "fall" | "jumppad" | "teleporter";

export interface NavEdge {
  from: number; // NavNode id
  to: number; // NavNode id
  type: NavEdgeType;
  cost: number;
}

// ── Path Result ─────────────────────────────────────────────────────

export interface NavPath {
  /** Ordered list of nodes from start to goal */
  nodes: NavNode[];
  /** Total traversal cost */
  totalCost: number;
}

// ── Constants ───────────────────────────────────────────────────────

/** Max distance between nodes to test for edges */
const MAX_EDGE_DISTANCE = 1500;

/** Max height diff for walk edges */
const WALK_HEIGHT_MAX = 40;

/** Max height diff for jump edges */
const JUMP_HEIGHT_MAX = 80;

/** Cost multiplier for jump edges */
const JUMP_COST_MULT = 1.3;

/** Cost multiplier for fall edges (falling is fast!) */
const FALL_COST_MULT = 0.8;

/** Grid spacing for floor sampling (units) */
const FLOOR_GRID_SPACING = 256;

/** Raycast height for floor sampling (cast downward from this height) */
const FLOOR_SAMPLE_HEIGHT = 500;

/** Min distance between any two nodes (dedup threshold) */
const MIN_NODE_DISTANCE = 64;

/** Teleporters are effectively instant, but keep a small cost so A* stays stable. */
const TELEPORT_COST = 32;

/** Jump pads cost roughly their flight commitment, cheaper than walking the same distance. */
const JUMPPAD_COST_MULT = 0.45;

// ── BotNavGraph ─────────────────────────────────────────────────────

export class BotNavGraph {
  private _nodes: NavNode[] = [];
  private _edges: NavEdge[] = [];
  private _adjacency: Map<number, NavEdge[]> = new Map();
  private _triggerLinks: Array<{ from: number; to: number; type: "jumppad" | "teleporter" }> = [];
  private _mapName: string;

  constructor(mapName: string) {
    this._mapName = mapName;
  }

  // ── Accessors ───────────────────────────────────────────────────

  get nodes(): ReadonlyArray<NavNode> {
    return this._nodes;
  }
  get edges(): ReadonlyArray<NavEdge> {
    return this._edges;
  }
  get nodeCount(): number {
    return this._nodes.length;
  }
  get edgeCount(): number {
    return this._edges.length;
  }

  // ── Graph Building ──────────────────────────────────────────────

  /**
   * Build the waypoint graph from map knowledge + collision probing.
   * Call once per map load.
   */
  buildFromVision(vision: BotVision): void {
    const startTime = Date.now();
    const knowledge = vision.mapKnowledge;

    console.log(`[NavGraph] Building nav graph for "${this._mapName}"...`);

    this._nodes = [];
    this._edges = [];
    this._adjacency.clear();
    this._triggerLinks = [];

    // Step 1: Extract nodes from known positions
    this._extractNodes(knowledge, vision);

    // Step 2: Probe edges between nearby nodes
    this._probeEdges(vision);

    // Step 3: Build adjacency list
    this._buildAdjacency();

    const elapsed = Date.now() - startTime;
    console.log(`[NavGraph] Built: ${this._nodes.length} nodes, ${this._edges.length} edges (${elapsed}ms)`);

    // Debug: type breakdown
    const typeCounts = new Map<string, number>();
    for (const node of this._nodes) {
      typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
    }
    const edgeTypeCounts = new Map<string, number>();
    for (const edge of this._edges) {
      edgeTypeCounts.set(edge.type, (edgeTypeCounts.get(edge.type) || 0) + 1);
    }

    console.log(`[NavGraph] Nodes: ${[...typeCounts.entries()].map(([t, c]) => `${t}=${c}`).join(", ")}`);
    console.log(`[NavGraph] Edges: ${[...edgeTypeCounts.entries()].map(([t, c]) => `${t}=${c}`).join(", ")}`);
  }

  // ── A* Pathfinding ──────────────────────────────────────────────

  /**
   * Find the shortest path between two positions.
   * Returns null if no path exists.
   */
  findPath(from: Vec3, to: Vec3): NavPath | null {
    const startNode = this.findNearestNode(from);
    const goalNode = this.findNearestNode(to);
    if (!startNode || !goalNode) return null;
    if (startNode.id === goalNode.id) {
      return { nodes: [startNode], totalCost: 0 };
    }

    return this._astar(startNode.id, goalNode.id);
  }

  /**
   * Find shortest path to nearest item of a given type.
   * Searches all item nodes and returns path to the closest one.
   */
  findPathToItem(from: Vec3, itemType: string): NavPath | null {
    const startNode = this.findNearestNode(from);
    if (!startNode) return null;

    // Find all matching item nodes
    const targets = this._nodes.filter((n) => {
      if (n.type !== "item" || !n.classname) return false;
      return this._matchesItemType(n.classname, itemType);
    });

    if (targets.length === 0) return null;

    // Find path to each target, return cheapest
    let bestPath: NavPath | null = null;
    for (const target of targets) {
      const path = this._astar(startNode.id, target.id);
      if (path && (!bestPath || path.totalCost < bestPath.totalCost)) {
        bestPath = path;
      }
    }

    return bestPath;
  }

  /**
   * Find the nearest NavNode to a world position.
   */
  findNearestNode(pos: Vec3): NavNode | null {
    let best: NavNode | null = null;
    let bestDist = Infinity;

    for (const node of this._nodes) {
      const dist = vec3Distance(pos, node.position);
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }

    return best;
  }

  /**
   * Get the next waypoint to walk toward on a path.
   * Skips nodes the bot has already passed.
   *
   * @param botPos Bot's current position
   * @param path Previously computed path
   * @param arrivedThreshold Distance to consider "arrived" at a node
   * @returns Next node to walk toward, or null if path complete
   */
  getNextWaypoint(botPos: Vec3, path: NavPath, arrivedThreshold: number = 100): NavNode | null {
    for (const node of path.nodes) {
      const dist = vec3Distance(botPos, node.position);
      if (dist > arrivedThreshold) {
        return node;
      }
    }
    return null; // Arrived at destination
  }

  // ── Private: Node Extraction ────────────────────────────────────

  private _extractNodes(knowledge: MapKnowledgeData, vision: BotVision): void {
    let nextId = 0;

    const addNode = (position: Vec3, type: NavNodeType, classname?: string): NavNode => {
      const existing = this._findNearbyNode(position, MIN_NODE_DISTANCE);
      if (existing) return existing;
      const node: NavNode = {
        id: nextId++,
        position: { ...position },
        type,
        classname,
      };
      this._nodes.push(node);
      return node;
    };

    // 1. Item pickup positions
    for (const item of knowledge.pickupPositions) {
      addNode(item.position, "item", item.classname);
    }

    // 2. Spawn points
    for (const sp of knowledge.spawnPoints) {
      addNode(sp, "spawn");
    }

    // 3. Trigger volumes. Source nodes sit at trigger AABB centers; destination
    // nodes sit at the resolved TriggerTable target so A* can route through them.
    for (const trigger of knowledge.triggerVolumes ?? []) {
      const type = trigger.type === "push" ? "jumppad" : "teleporter";
      const source = addNode(this._triggerCenter(trigger), type, `trigger_${trigger.type}`);
      const dest = addNode(trigger.dest, type, `trigger_${trigger.type}_dest`);
      this._triggerLinks.push({ from: source.id, to: dest.id, type });
    }

    // 4. Floor grid sampling (fills gaps)
    this._sampleFloorGrid(vision, nextId);
  }

  /**
   * Sample a sparse floor grid to find walkable positions in
   * corridors/hallways that have no items or spawns.
   */
  private _sampleFloorGrid(vision: BotVision, startId: number): void {
    // Determine bounds from existing nodes
    if (this._nodes.length === 0) return;

    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;

    for (const node of this._nodes) {
      minX = Math.min(minX, node.position.x);
      maxX = Math.max(maxX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxY = Math.max(maxY, node.position.y);
      minZ = Math.min(minZ, node.position.z);
      maxZ = Math.max(maxZ, node.position.z);
    }

    // Expand bounds slightly
    const pad = FLOOR_GRID_SPACING;
    minX -= pad;
    maxX += pad;
    minZ -= pad;
    maxZ += pad;

    let nextId = startId;
    const collision = vision.collisionWorld;

    for (let x = minX; x <= maxX; x += FLOOR_GRID_SPACING) {
      for (let z = minZ; z <= maxZ; z += FLOOR_GRID_SPACING) {
        // Cast ray downward from height to find floor
        const from: Vec3 = { x, y: maxY + FLOOR_SAMPLE_HEIGHT, z };
        const to: Vec3 = { x, y: minY - 100, z };

        const result = collision.trace(from, to);
        if (!result.hit || !result.hitPoint) continue;

        // Floor found — check it's a valid standing position
        const floorPos: Vec3 = {
          x: result.hitPoint.x,
          y: result.hitPoint.y + 1, // Slightly above floor
          z: result.hitPoint.z,
        };

        // Skip if inside solid geometry
        if (vision.isInsideSolid(floorPos)) continue;

        // Skip if too close to existing node
        if (this._isTooCloseToExisting(floorPos)) continue;

        this._nodes.push({
          id: nextId++,
          position: floorPos,
          type: "floor",
        });
      }
    }
  }

  // ── Private: Edge Probing ───────────────────────────────────────

  private _probeEdges(vision: BotVision): void {
    const nodeCount = this._nodes.length;

    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const a = this._nodes[i];
        const b = this._nodes[j];

        const dist = vec3Distance(a.position, b.position);
        if (dist > MAX_EDGE_DISTANCE) continue;

        const heightDiff = Math.abs(a.position.y - b.position.y);
        const horizontalDist = Math.sqrt((a.position.x - b.position.x) ** 2 + (a.position.z - b.position.z) ** 2);

        // Walk edge: low height diff + path clear
        if (heightDiff < WALK_HEIGHT_MAX) {
          if (vision.isPathClear(a.position, b.position)) {
            const cost = dist;
            this._edges.push({ from: a.id, to: b.id, type: "walk", cost });
            this._edges.push({ from: b.id, to: a.id, type: "walk", cost });
          }
          continue;
        }

        // Jump edge: medium height diff
        if (heightDiff < JUMP_HEIGHT_MAX && horizontalDist < 400) {
          // Check if horizontal path is roughly clear
          if (vision.canSee(a.position, b.position)) {
            const cost = dist * JUMP_COST_MULT;
            // Bidirectional — bot can jump both ways
            this._edges.push({ from: a.id, to: b.id, type: "jump", cost });
            this._edges.push({ from: b.id, to: a.id, type: "jump", cost });
          }
          continue;
        }

        // Fall edge: large height diff, one-way high→low
        if (heightDiff >= JUMP_HEIGHT_MAX) {
          const higher = a.position.y > b.position.y ? a : b;
          const lower = a.position.y > b.position.y ? b : a;

          // Check LOS between nodes (can see = can fall)
          if (vision.canSee(higher.position, lower.position)) {
            const cost = dist * FALL_COST_MULT;
            this._edges.push({ from: higher.id, to: lower.id, type: "fall", cost });
          }
        }
      }
    }
    this._addTriggerEdges();
  }

  // ── Private: Trigger Edges ─────────────────────────────────────

  private _addTriggerEdges(): void {
    for (const link of this._triggerLinks) {
      const from = this._nodes[link.from];
      const to = this._nodes[link.to];
      if (!from || !to || from.id === to.id) continue;

      const dist = vec3Distance(from.position, to.position);
      const cost = link.type === "teleporter" ? TELEPORT_COST : Math.max(TELEPORT_COST, dist * JUMPPAD_COST_MULT);
      this._edges.push({ from: from.id, to: to.id, type: link.type, cost });
    }
  }

  // ── Private: Adjacency List ─────────────────────────────────────

  private _buildAdjacency(): void {
    this._adjacency.clear();
    for (const node of this._nodes) {
      this._adjacency.set(node.id, []);
    }
    for (const edge of this._edges) {
      this._adjacency.get(edge.from)!.push(edge);
    }
  }

  // ── Private: A* ─────────────────────────────────────────────────

  private _astar(startId: number, goalId: number): NavPath | null {
    const goalNode = this._nodes[goalId];
    if (!goalNode) return null;

    // Open set: priority queue (simple array sorted by fScore)
    const openSet = new Set<number>([startId]);
    const cameFrom = new Map<number, number>();

    const gScore = new Map<number, number>();
    gScore.set(startId, 0);

    const fScore = new Map<number, number>();
    fScore.set(startId, this._heuristic(this._nodes[startId], goalNode));

    while (openSet.size > 0) {
      // Find node in openSet with lowest fScore
      let current = -1;
      let lowestF = Infinity;
      for (const id of openSet) {
        const f = fScore.get(id) ?? Infinity;
        if (f < lowestF) {
          lowestF = f;
          current = id;
        }
      }

      if (current === goalId) {
        // Reconstruct path
        return this._reconstructPath(cameFrom, current, gScore.get(current) ?? 0);
      }

      openSet.delete(current);
      const neighbors = this._adjacency.get(current) || [];

      for (const edge of neighbors) {
        const tentativeG = (gScore.get(current) ?? Infinity) + edge.cost;
        const currentG = gScore.get(edge.to) ?? Infinity;

        if (tentativeG < currentG) {
          cameFrom.set(edge.to, current);
          gScore.set(edge.to, tentativeG);
          fScore.set(edge.to, tentativeG + this._heuristic(this._nodes[edge.to], goalNode));
          openSet.add(edge.to);
        }
      }
    }

    return null; // No path found
  }

  private _heuristic(node: NavNode, goal: NavNode): number {
    return vec3Distance(node.position, goal.position);
  }

  private _reconstructPath(cameFrom: Map<number, number>, current: number, totalCost: number): NavPath {
    const path: NavNode[] = [this._nodes[current]];
    while (cameFrom.has(current)) {
      current = cameFrom.get(current)!;
      path.unshift(this._nodes[current]);
    }
    return { nodes: path, totalCost };
  }

  // ── Private: Utilities ──────────────────────────────────────────

  private _isTooCloseToExisting(pos: Vec3): boolean {
    return this._findNearbyNode(pos, MIN_NODE_DISTANCE) !== null;
  }

  private _findNearbyNode(pos: Vec3, radius: number): NavNode | null {
    for (const node of this._nodes) {
      if (vec3Distance(pos, node.position) < radius) {
        return node;
      }
    }
    return null;
  }

  private _triggerCenter(trigger: MapKnowledgeData["triggerVolumes"][number]): Vec3 {
    return {
      x: (trigger.min.x + trigger.max.x) / 2,
      y: (trigger.min.y + trigger.max.y) / 2,
      z: (trigger.min.z + trigger.max.z) / 2,
    };
  }

  private _matchesItemType(classname: string, type: string): boolean {
    switch (type) {
      case "health":
        return classname.includes("health");
      case "armor":
        return classname.includes("armor");
      case "weapon":
        return classname.startsWith("weapon_");
      default:
        return classname === type;
    }
  }
}
