import type { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../../core/Cvar";
import { createTextureArray, textureArrayShape } from "../../rendering/TextureArrays";
import { excludeBspFillLights } from "./BspBakedLightingPlugin";
import { BspSurfaceArrayPlugin, SURFACE_LAYER_KIND, type SurfaceArrays } from "./BspSurfaceArrayPlugin";
import type { BspMeshBuildResult } from "./mesh/types";

/**
 * Merges plain opaque map surfaces that differ only in their base, normal-map
 * and gloss images into one mesh and one draw, the images becoming layers of
 * texture arrays ({@link BspSurfaceArrayPlugin}). Standard and PBR surfaces
 * merge with their own kind.
 *
 * Every map surface is a mesh of its own texture, and each costs a draw. Two
 * surfaces merge only when everything else that decides how they draw, light,
 * collide or are hit is the same: every material setting Babylon serializes, the plugins, lightmap,
 * fog, flags, vertex attributes, and images of one size, format and sampling.
 * A texture whose name marks an effect (flare, halo, glow, sprite...) keeps its
 * mesh, since shot and collision tests judge a mesh by its texture name.
 */
Cvar.register("r_surface_arrays", 1, {
  type: "int",
  min: 0,
  max: 1,
  persist: false,
  description: "Texture-array merging of map surfaces on the next map load (0 for diagnostics)",
});

/** Plugins a merged material may carry: ours, and Babylon's built-in sub-plugins */
const SHARED_PLUGINS = new Set([
  "AtmosphericFog",
  "BspBakedLighting",
  "DetailMap",
  "PBRAnisotropic",
  "PBRBRDF",
  "PBRClearCoat",
  "PBRIridescence",
  "PBRSheen",
  "Sheen",
  "PBRSubSurface",
]);
const EFFECT_NAME = /flare|halo|glow|billboard|sprite|particle|effect|light|sfx/;

/** A material class's image slots that arrays replace, and the slots that must stay empty. */
interface Slots {
  base: string;
  gloss: string;
  empty: string[];
}
const STANDARD_SLOTS: Slots = {
  base: "diffuseTexture",
  gloss: "specularTexture",
  empty: ["emissiveTexture", "opacityTexture", "ambientTexture", "refractionTexture"],
};
const PBR_SLOTS: Slots = {
  base: "albedoTexture",
  gloss: "reflectivityTexture",
  empty: [
    "emissiveTexture",
    "opacityTexture",
    "ambientTexture",
    "refractionTexture",
    "metallicTexture",
    "microSurfaceTexture",
    "metallicReflectanceTexture",
    "reflectanceTexture",
  ],
};
const slotsOf = (material: Material | null): Slots | null =>
  material instanceof PBRMaterial ? PBR_SLOTS : material instanceof StandardMaterial ? STANDARD_SLOTS : null;
const image = (material: Material, slot: string) =>
  ((material as unknown as Record<string, BaseTexture | null>)[slot] ?? null) as BaseTexture | null;

/**
 * Every setting of the material except its identity and its images, as
 * Babylon serializes it; other images enter by identity.
 */
function settings(material: Material): unknown {
  let data: Record<string, unknown>;
  try {
    data = material.serialize() as Record<string, unknown>;
  } catch {
    return undefined;
  }
  for (const key of ["name", "id", "uniqueId", "tags", "metadata"]) delete data[key];
  for (const key of Object.keys(data)) {
    if (/texture$/i.test(key)) data[key] = image(material, key)?.uniqueId ?? null;
  }
  return data;
}

const METADATA_FIELDS = [
  "contentFlags",
  "surfaceFlags",
  "lightmapIndex",
  "lightmapLayered",
  "usesVertexRgb",
  "preserveVertexLighting",
  "usesLightmap",
  "glossIntensity",
  "glossExponent",
  "bspSpatialCell",
  "bspBakedLighting",
  "bakedVertexRgbNeutralized",
  "isFullbright",
  "preserveEmissive",
  "isGlowOverlay",
  "needsAnimation",
  "materialPass",
  "generatedCubemap",
  "liquidKind",
  "usesBspPbr",
] as const;

/** Everything a texture must share with the others in its array besides its image. */
function imageSampling(texture: BaseTexture | null, scene: Scene): unknown {
  if (!texture) return null;
  const shape = textureArrayShape(texture, scene.getEngine());
  if (!shape) return undefined;
  const t = texture as BaseTexture & Record<string, unknown>;
  return [
    shape,
    texture.wrapU,
    texture.wrapV,
    texture.coordinatesIndex,
    texture.level,
    texture.hasAlpha,
    texture.getAlphaFromRGB,
    texture.gammaSpace,
    texture.anisotropicFilteringLevel,
    texture.getInternalTexture()?.samplingMode,
    t.uScale,
    t.vScale,
    t.uOffset,
    t.vOffset,
    t.uAng,
    t.vAng,
    t.wAng,
  ];
}

/** The key of the surfaces this mesh can share a draw with, or null when it keeps its own. */
function signature(mesh: Mesh): string | null {
  const material = mesh.material;
  const metadata = mesh.metadata ?? {};
  const slots = slotsOf(material);
  if (!metadata.surfaceArrayEligible || !material || !slots) return null;
  if (EFFECT_NAME.test(String(metadata.textureName ?? "").toLowerCase())) return null;
  if (!image(material, slots.base) || slots.empty.some((slot) => image(material, slot))) return null;
  const detail = (material as StandardMaterial | PBRMaterial).detailMap;
  if (detail?.isEnabled) return null;
  const plugins = material.pluginManager?._plugins ?? [];
  if (plugins.some((plugin) => !SHARED_PLUGINS.has(plugin.name))) return null;
  const scene = mesh.getScene();
  const base = imageSampling(image(material, slots.base), scene);
  const bump = imageSampling(image(material, "bumpTexture"), scene);
  const gloss = imageSampling(image(material, slots.gloss), scene);
  const rest = settings(material);
  if (base === undefined || bump === undefined || gloss === undefined || rest === undefined) return null;
  const baked = plugins.find((plugin) => plugin.name === "BspBakedLighting") as unknown as
    | Record<string, unknown>
    | undefined;
  const id = (texture: BaseTexture | null | undefined) => texture?.uniqueId ?? null;
  return JSON.stringify([
    material.getClassName(),
    // Images the arrays replace count by sampling alone
    { ...(rest as Record<string, unknown>), [slots.base]: null, bumpTexture: null, [slots.gloss]: null },
    plugins.map((plugin) => plugin.name).sort(),
    baked
      ? [
          (baked.profile as { gain?: number })?.gain,
          (baked.profile as { ambient?: number[] })?.ambient,
          id(baked.direction as BaseTexture | null),
          id(baked.layers as BaseTexture | null),
          // Its gloss is the material's own, which the gloss array replaces
          baked.gloss === image(material, slots.gloss),
          baked.strength,
          baked.exponent,
        ]
      : null,
    base,
    bump,
    gloss,
    mesh.getVerticesDataKinds().sort(),
    [mesh.hasVertexAlpha, mesh.alphaIndex, mesh.renderingGroupId, mesh.layerMask, mesh.isPickable],
    [mesh.checkCollisions, mesh.receiveShadows, mesh.infiniteDistance, mesh.parent?.uniqueId],
    METADATA_FIELDS.map((field) => metadata[field]),
    JSON.stringify(metadata.fogParams ?? null),
  ]);
}

export interface SurfaceArrayResult {
  /** Meshes merged away */
  merged: number;
  /** Meshes drawing them now */
  meshes: number;
  /** Texture arrays built */
  arrays: number;
}

/**
 * Merge eligible surfaces of the world mesh. Run once textures and lightmaps
 * are on the materials, before anything holds on to individual surfaces.
 */
export function mergeBspSurfaceArrays(result: BspMeshBuildResult): SurfaceArrayResult {
  const outcome: SurfaceArrayResult = { merged: 0, meshes: 0, arrays: 0 };
  if (!Cvar.getBool("r_surface_arrays")) return outcome;
  const world = result.worldMesh;
  const scene = world.getScene();
  const groups = new Map<string, Mesh[]>();
  for (const mesh of world.getChildMeshes(true)) {
    if (!(mesh instanceof Mesh) || !mesh.name.startsWith("bsp_tex_")) continue;
    const key = signature(mesh);
    if (!key) continue;
    const members = groups.get(key);
    if (members) members.push(mesh);
    else groups.set(key, [mesh]);
  }

  const arrays: BaseTexture[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const materials = members.map((mesh) => mesh.material as StandardMaterial | PBRMaterial);
    const slots = slotsOf(materials[0])!;
    const index = arrays.length;
    const build = (slot: string, role: string) =>
      image(materials[0], slot)
        ? createTextureArray(
            materials.map((material) => image(material, slot)!),
            scene,
            `bsp_surface_${role}_${index}`,
          )
        : null;
    const surface = {
      base: build(slots.base, "base"),
      bump: build("bumpTexture", "bump"),
      gloss: build(slots.gloss, "gloss"),
    };
    const missing =
      !surface.base ||
      (image(materials[0], "bumpTexture") && !surface.bump) ||
      (image(materials[0], slots.gloss) && !surface.gloss);
    const built = [surface.base, surface.bump, surface.gloss].filter((array) => array !== null);
    if (missing) {
      for (const array of built) array.dispose();
      continue;
    }
    arrays.push(...built);

    const mesh = mergeMeshes(members, scene);
    new BspSurfaceArrayPlugin(materials[0], surface as SurfaceArrays);
    mesh.material = materials[0];
    for (const member of members) member.dispose(false, false);
    for (const material of materials.slice(1)) disposeMaterial(material);
    outcome.merged += members.length;
    outcome.meshes++;
  }
  outcome.arrays = arrays.length;
  if (arrays.length)
    world.onDisposeObservable.addOnce(() => {
      for (const array of arrays) array.dispose();
    });
  return outcome;
}

function disposeMaterial(material: Material): void {
  // The images stay with the texture cache, which may hand them to other surfaces
  material.dispose(false, false);
}

/** One mesh drawing every member, each vertex naming its member's layer. */
function mergeMeshes(members: Mesh[], scene: Scene): Mesh {
  const first = members[0];
  const merged = new Mesh(`${first.name}_array`, scene);
  const vertexCounts = members.map((mesh) => mesh.getTotalVertices());
  const total = vertexCounts.reduce((sum, count) => sum + count, 0);
  for (const kind of first.getVerticesDataKinds()) {
    const size = first.getVertexBuffer(kind)!.getSize();
    const data = new Float32Array(total * size);
    let offset = 0;
    for (const mesh of members) {
      const source = mesh.getVerticesData(kind)!;
      data.set(source, offset);
      offset += source.length;
    }
    merged.setVerticesData(kind, data, false, size);
  }
  const layers = new Float32Array(total);
  const indices: number[] = [];
  let start = 0;
  members.forEach((mesh, layer) => {
    layers.fill(layer, start, start + vertexCounts[layer]);
    for (const index of mesh.getIndices() ?? []) indices.push(index + start);
    start += vertexCounts[layer];
  });
  merged.setVerticesData(SURFACE_LAYER_KIND, layers, false, 1);
  merged.setIndices(indices, total);

  merged.parent = first.parent;
  merged.isPickable = first.isPickable;
  merged.checkCollisions = first.checkCollisions;
  merged.receiveShadows = first.receiveShadows;
  merged.hasVertexAlpha = first.hasVertexAlpha;
  merged.alphaIndex = first.alphaIndex;
  merged.renderingGroupId = first.renderingGroupId;
  merged.layerMask = first.layerMask;
  const clusters = new Set<number>();
  for (const mesh of members) for (const cluster of mesh.metadata?.bspPvsClusters ?? []) clusters.add(cluster);
  merged.metadata = {
    ...first.metadata,
    bspPvsClusters: [...clusters],
    surfaceArrayTextures: members.map((mesh) => mesh.metadata?.textureName),
    bspBakedLighting: false,
  };
  if (first.metadata?.bspBakedLighting) excludeBspFillLights(merged);
  return merged;
}
