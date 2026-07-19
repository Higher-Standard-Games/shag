import { VOLTAIC_PART } from "./VoltaicProfiles";

export type VoltaicBeamProfile = "hero" | "world" | "chain";

export interface VoltaicTemplateData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
}

interface StripDefinition {
  part: number;
  nodes: number;
}

const HERO_VOLUME_LAYERS = 2;
const VOLUME_LAYER_PART_OFFSET = 16;

const HERO_STRIPS: readonly StripDefinition[] = [
  { part: VOLTAIC_PART.SHEATH, nodes: 24 },
  { part: VOLTAIC_PART.CORE, nodes: 2 },
  { part: VOLTAIC_PART.DOMINANT, nodes: 32 },
  { part: VOLTAIC_PART.SECONDARY_A, nodes: 28 },
  { part: VOLTAIC_PART.SECONDARY_B, nodes: 24 },
  { part: VOLTAIC_PART.GHOST, nodes: 32 },
  { part: VOLTAIC_PART.FORK_A, nodes: 8 },
  { part: VOLTAIC_PART.FORK_B, nodes: 8 },
  { part: VOLTAIC_PART.FORK_C, nodes: 9 },
  { part: VOLTAIC_PART.FORK_D, nodes: 9 },
];

const WORLD_STRIPS: readonly StripDefinition[] = [
  { part: VOLTAIC_PART.SHEATH, nodes: 20 },
  { part: VOLTAIC_PART.CORE, nodes: 2 },
  { part: VOLTAIC_PART.DOMINANT, nodes: 24 },
  { part: VOLTAIC_PART.SECONDARY_A, nodes: 20 },
  { part: VOLTAIC_PART.FORK_A, nodes: 7 },
];

const CHAIN_STRIPS: readonly StripDefinition[] = [
  { part: VOLTAIC_PART.CORE, nodes: 2 },
  { part: VOLTAIC_PART.DOMINANT, nodes: 24 },
  { part: VOLTAIC_PART.SECONDARY_A, nodes: 20 },
];

function appendStrip(
  definition: StripDefinition,
  positions: number[],
  uvs: number[],
  indices: number[],
  volumeLayer = 0,
): void {
  const baseVertex = positions.length / 3;
  const divisor = Math.max(1, definition.nodes - 1);
  const encodedPart = definition.part + volumeLayer * VOLUME_LAYER_PART_OFFSET;

  for (let node = 0; node < definition.nodes; node++) {
    const along = node / divisor;
    positions.push(along, -1, encodedPart, along, 1, encodedPart);
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

export function buildVoltaicBeamTemplate(profile: VoltaicBeamProfile): VoltaicTemplateData {
  const definitions = profile === "hero" ? HERO_STRIPS : profile === "world" ? WORLD_STRIPS : CHAIN_STRIPS;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const volumeLayers = profile === "hero" ? HERO_VOLUME_LAYERS : 1;
  for (let volumeLayer = 0; volumeLayer < volumeLayers; volumeLayer++) {
    for (const definition of definitions) {
      appendStrip(definition, positions, uvs, indices, volumeLayer);
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 3,
  };
}

export function buildVoltaicImpactTemplate(): VoltaicTemplateData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Endpoint nucleus + surface crown, muzzle corona + axial petals, then eight
  // ballistic contact streaks. All twelve analytic quads remain one mesh/draw;
  // the vertex shader turns the last eight into a procedural spark shower.
  const partCount = 12;
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
