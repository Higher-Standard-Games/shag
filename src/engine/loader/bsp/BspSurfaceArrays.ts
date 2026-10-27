import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../../core/Cvar";
import { createTextureArray, textureArrayShape } from "../../rendering/TextureArrays";
import { excludeBspFillLights } from "./BspBakedLightingPlugin";
import { BspSurfaceArrayPlugin, SURFACE_LAYER_KIND } from "./BspSurfaceArrayPlugin";
import type { BspMeshBuildResult } from "./mesh/types";

/**
 * Merges plain opaque map surfaces that differ only in their base and
 * normal-map images into one mesh and one draw, the images becoming layers of
 * texture arrays ({@link BspSurfaceArrayPlugin}).
 *
 * Every map surface is a mesh of its own texture, and each costs a draw. Two
 * surfaces merge only when everything else that decides how they draw, light,
 * collide or are hit is the same: material settings and plugins, lightmap,
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

const SHARED_PLUGINS = new Set(["AtmosphericFog", "BspBakedLighting", "DetailMap"]);
const EFFECT_NAME = /flare|halo|glow|billboard|sprite|particle|effect|light|sfx/;

const MATERIAL_FIELDS = [
  "alpha",
  "backFaceCulling",
  "twoSidedLighting",
  "disableLighting",
  "specularPower",
  "useSpecularOverAlpha",
  "useReflectionOverAlpha",
  "useEmissiveAsIllumination",
  "linkEmissiveWithDiffuse",
  "useAlphaFromDiffuseTexture",
  "alphaMode",
  "transparencyMode",
  "alphaCutOff",
  "zOffset",
  "zOffsetUnits",
  "disableDepthWrite",
  "forceDepthWrite",
  "fogEnabled",
  "maxSimultaneousLights",
  "invertNormalMapX",
  "invertNormalMapY",
  "useParallax",
  "useParallaxOcclusion",
  "parallaxScaleBias",
  "useLightmapAsShadowmap",
  "useObjectSpaceNormalMap",
  "sideOrientation",
  "wireframe",
  "pointsCloud",
  "separateCullingPass",
  "needDepthPrePass",
] as const;

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
  if (!metadata.surfaceArrayEligible || !(material instanceof StandardMaterial)) return null;
  if (EFFECT_NAME.test(String(metadata.textureName ?? "").toLowerCase())) return null;
  if (!material.diffuseTexture || material.specularTexture || material.emissiveTexture) return null;
  if (material.opacityTexture || material.ambientTexture || material.refractionTexture) return null;
  if (material.detailMap?.isEnabled) return null;
  const plugins = material.pluginManager?._plugins ?? [];
  if (plugins.some((plugin) => !SHARED_PLUGINS.has(plugin.name))) return null;
  const scene = mesh.getScene();
  const base = imageSampling(material.diffuseTexture, scene);
  const bump = imageSampling(material.bumpTexture, scene);
  if (base === undefined || bump === undefined) return null;
  const record = material as unknown as Record<string, unknown>;
  const baked = plugins.find((plugin) => plugin.name === "BspBakedLighting") as unknown as
    | Record<string, unknown>
    | undefined;
  const id = (texture: BaseTexture | null | undefined) => texture?.uniqueId ?? null;
  return JSON.stringify([
    MATERIAL_FIELDS.map((field) => record[field]),
    [material.diffuseColor, material.specularColor, material.emissiveColor, material.ambientColor].map((c) =>
      c.asArray(),
    ),
    id(material.lightmapTexture),
    id(material.reflectionTexture),
    plugins.map((plugin) => plugin.name).sort(),
    baked
      ? [
          (baked.profile as { gain?: number })?.gain,
          (baked.profile as { ambient?: number[] })?.ambient,
          id(baked.direction as BaseTexture | null),
          id(baked.layers as BaseTexture | null),
          id(baked.gloss as BaseTexture | null),
          baked.strength,
          baked.exponent,
        ]
      : null,
    base,
    bump,
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
    const materials = members.map((mesh) => mesh.material as StandardMaterial);
    const baseImages = materials.map((material) => material.diffuseTexture!);
    const bumpImages = materials[0].bumpTexture ? materials.map((material) => material.bumpTexture!) : null;
    const index = arrays.length;
    const baseArray = createTextureArray(baseImages, scene, `bsp_surface_base_${index}`);
    const bumpArray = bumpImages ? createTextureArray(bumpImages, scene, `bsp_surface_bump_${index}`) : null;
    if (!baseArray || (bumpImages && !bumpArray)) {
      baseArray?.dispose();
      bumpArray?.dispose();
      continue;
    }
    arrays.push(baseArray);
    if (bumpArray) arrays.push(bumpArray);

    const mesh = mergeMeshes(members, scene);
    new BspSurfaceArrayPlugin(materials[0], baseArray, bumpArray, false);
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
