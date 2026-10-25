/** Bounded, map-authored water highlights with cached static visibility. */

import { Ray } from "@babylonjs/core/Culling/ray";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Effect } from "@babylonjs/core/Materials/effect";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { EmissiveSurface } from "../../lighting/MapEmissiveSurfaces";
import type { BspEntity } from "../../loader/bsp/BspLoader";
import { StaticVisibilityIndex } from "./StaticVisibilityIndex";
import type { WaterPatch } from "./WaterProbeCache";

export const MAX_WATER_LIGHTS = 4;
const MASK_SIZE = 16;
const MAX_LIT_PATCHES = 4;
export interface WaterMapLight {
  position: Vector3;
  range: number;
  colour: number[];
  normal?: Vector3;
  sampleEnvironment?: boolean;
}

/** Approximate shader-authored emitting panels, not arbitrary fullbright paint. */
export function waterSurfaceLights(surfaces: readonly EmissiveSurface[]): WaterMapLight[] {
  return surfaces
    .filter((s) => s.surfaceLight > 0 && Number.isFinite(s.surfaceLight))
    .map((s) => ({
      position: s.position.add(s.normal.scale(2)),
      normal: s.normal,
      range: Math.min(768, Math.max(160, Math.sqrt(s.area) * 6)),
      colour: Array(3).fill(Math.min(3, s.surfaceLight / 150)),
      sampleEnvironment: true,
    }));
}

/** Deliberately never reads scene.lights: weapon/projectile pools cannot enter. */
export function waterMapLights(entities: readonly BspEntity[]): WaterMapLight[] {
  const result: WaterMapLight[] = [];
  for (const entity of entities) {
    const p = entity.properties;
    // Targeted lights need spot/sun semantics; do not pretend they are points.
    if (entity.classname !== "light" || p.target || !p.origin) continue;
    const xyz = p.origin.trim().split(/\s+/).map(Number);
    const intensity = Number(p.light ?? 300);
    const range = Number(p.range ?? intensity);
    const rgb = (p._color ?? "1 1 1").trim().split(/\s+/).map(Number);
    if (
      xyz.length !== 3 ||
      rgb.length !== 3 ||
      ![...xyz, ...rgb, intensity, range].every(Number.isFinite) ||
      intensity <= 0 ||
      range <= 0
    )
      continue;
    const scale = rgb.some((c) => c > 1) ? 1 / 255 : 1;
    result.push({
      position: new Vector3(xyz[0], xyz[2], xyz[1]),
      range: Math.min(range, 2048),
      colour: rgb.map((c) => Math.max(0, Math.min(1, c * scale)) * Math.min(4, intensity / 100)),
    });
  }
  return result;
}

interface PatchLighting {
  mask: RawTexture;
  lights: Float32Array;
  colours: Float32Array;
  count: number;
}

export class WaterSurfaceLighting {
  private readonly entries = new Map<WaterPatch, PatchLighting>();
  private readonly empty = new Float32Array(MAX_WATER_LIGHTS * 4);
  private fallback: RawTexture | null = null;
  constructor(private readonly scene: Scene) {}

  prepare(root: AbstractMesh, patches: readonly WaterPatch[], sources: readonly WaterMapLight[]): void {
    const blockers = [root, ...root.getChildMeshes(false)].filter(
      (mesh) =>
        mesh.getTotalVertices() > 0 &&
        mesh.isEnabled() &&
        !mesh.infiniteDistance &&
        !mesh.metadata?.liquidKind &&
        !mesh.metadata?.effectOwned &&
        !mesh.metadata?.excludeFromWaterCapture &&
        !mesh.metadata?.autosprite &&
        !mesh.metadata?.autosprite2 &&
        !(mesh.layerMask & 0x10000000) &&
        !mesh.material?.needAlphaBlendingForMesh(mesh),
    );
    // One acceleration structure per bake; no scene mutation or per-frame retention.
    let visibility: StaticVisibilityIndex | undefined;
    for (const patch of new Set(patches)) {
      if (this.entries.has(patch) || this.entries.size >= MAX_LIT_PATCHES) continue;
      const nearest = sources
        .filter(
          (light) =>
            light.position.y > patch.min.y + 1 &&
            (!light.normal || Vector3.Dot(light.normal, patch.position.subtract(light.position)) > 0),
        )
        .map((light) => {
          const near = Vector3.Clamp(light.position, patch.min, patch.max);
          return { light, distance: Vector3.Distance(light.position, near) };
        })
        .filter(({ light, distance }) => distance < light.range)
        .sort((a, b) => a.distance / a.light.range - b.distance / b.light.range)
        .slice(0, MAX_WATER_LIGHTS);
      if (!nearest.length) continue;
      visibility ??= new StaticVisibilityIndex(blockers);
      const lights = new Float32Array(MAX_WATER_LIGHTS * 4),
        colours = lights.slice();
      nearest.forEach(({ light }, i) => {
        lights.set([...light.position.asArray(), light.range], i * 4);
        colours.set([...light.colour, light.sampleEnvironment ? 1 : 0], i * 4);
      });
      // Each RGBA channel is visibility of one light. Trace only at map claim,
      // never per frame. Includes hidden/PVS-culled static geometry.
      const data = new Uint8Array(MASK_SIZE * MASK_SIZE * 4);
      for (let y = 0; y < MASK_SIZE; y++)
        for (let x = 0; x < MASK_SIZE; x++) {
          const point = new Vector3(
            patch.min.x + ((x + 0.5) / MASK_SIZE) * (patch.max.x - patch.min.x),
            patch.min.y,
            patch.min.z + ((y + 0.5) / MASK_SIZE) * (patch.max.z - patch.min.z),
          );
          if (!patch.contains(point.x, point.y, point.z)) continue;
          point.y += 0.5;
          nearest.forEach(({ light }, i) => {
            const delta = light.position.subtract(point),
              distance = delta.length();
            if (distance >= light.range) return;
            const ray = new Ray(point, delta.scale(1 / distance), Math.max(0, distance - 0.5));
            const facing = light.normal ? Math.max(0, -Vector3.Dot(light.normal, ray.direction)) : 1;
            if (facing > 0 && !visibility!.hits(ray)) data[(y * MASK_SIZE + x) * 4 + i] = Math.round(255 * facing);
          });
        }
      const mask = RawTexture.CreateRGBATexture(
        data,
        MASK_SIZE,
        MASK_SIZE,
        this.scene,
        false,
        false,
        Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      );
      mask.name = "water-static-light-visibility";
      mask.wrapU = mask.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
      this.entries.set(patch, { mask, lights, colours, count: nearest.length });
    }
  }

  bind(effect: Effect, patch?: WaterPatch | null): void {
    const entry = patch ? this.entries.get(patch) : undefined;
    this.fallback ??= RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, this.scene, false, false);
    effect.setTexture("uLightVisibility", entry?.mask ?? this.fallback);
    effect.setFloatArray4("uWaterLights", entry?.lights ?? this.empty);
    effect.setFloatArray4("uWaterLightColours", entry?.colours ?? this.empty);
    effect.setVector3("uLightMaskMin", patch?.min ?? Vector3.Zero());
    effect.setVector3("uLightMaskMax", patch?.max ?? Vector3.One());
  }

  get lightCount(): number {
    return [...this.entries.values()].reduce((n, entry) => n + entry.count, 0);
  }
  dispose(): void {
    for (const entry of this.entries.values()) entry.mask.dispose();
    this.entries.clear();
    this.fallback?.dispose();
    this.fallback = null;
  }
}
