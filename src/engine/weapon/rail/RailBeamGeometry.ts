import { RAIL_PART } from "./RailProfiles";

/** Immutable vertex data for a rail template mesh (positions/uvs/indices). */
export interface RailTemplateData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
}

interface StripDefinition {
  part: number;
  nodes: number;
}

// Straight parts (core/glow) only need their two endpoints — the shader
// billboards a quad between them. The helix parts need many nodes so the
// analytic spiral reads as a smooth curve rather than a chorded polyline.
const RAIL_STRIPS: readonly StripDefinition[] = [
  { part: RAIL_PART.GLOW, nodes: 2 },
  { part: RAIL_PART.CORE, nodes: 2 },
  { part: RAIL_PART.HELIX_A, nodes: 56 },
  { part: RAIL_PART.HELIX_B, nodes: 56 },
];

/**
 * A longitudinal strip: `nodes` pairs of vertices at (along, ±1, part). The
 * shader reads `position.x` as the 0..1 length parameter, `position.y` as the
 * ribbon side, and `position.z` as the presentation-part id.
 */
function appendStrip(definition: StripDefinition, positions: number[], uvs: number[], indices: number[]): void {
  const baseVertex = positions.length / 3;
  const divisor = Math.max(1, definition.nodes - 1);

  for (let node = 0; node < definition.nodes; node++) {
    const along = node / divisor;
    positions.push(along, -1, definition.part, along, 1, definition.part);
    uvs.push(along, 0, along, 1);
  }

  for (let node = 0; node < definition.nodes - 1; node++) {
    const lower = baseVertex + node * 2;
    const upper = lower + 1;
    const nextLower = lower + 2;
    const nextUpper = lower + 3;
    indices.push(lower, upper, nextLower, nextLower, upper, nextUpper);
  }
}

/** Build the single rail-beam template (glow + core + twin helix). */
export function buildRailBeamTemplate(): RailTemplateData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const definition of RAIL_STRIPS) {
    appendStrip(definition, positions, uvs, indices);
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 3,
  };
}

/**
 * Endpoint + muzzle template: four analytic quads at (±1, ±1, part) with
 * part ∈ {0,1,2,3}. The shader turns part 0/1 into the terminal nucleus/crown
 * at the impact point and part 2/3 into the muzzle crack at the start.
 */
export function buildRailImpactTemplate(): RailTemplateData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const partCount = 4;
  for (let part = 0; part < partCount; part++) {
    const base = positions.length / 3;
    positions.push(-1, -1, part, 1, -1, part, -1, 1, part, 1, 1, part);
    uvs.push(-1, -1, 1, -1, -1, 1, 1, 1);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 3,
  };
}
