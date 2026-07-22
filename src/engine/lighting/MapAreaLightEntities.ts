/**
 * MapAreaLightEntities — parse `light_area` BSP entities into AreaLightPanel
 * specs. Pure (no Babylon scene) so the coordinate + orientation conventions are
 * unit-tested and easy to confirm against a real map.
 *
 * `light_area` is a mapper-placed textured/flat area light (a glowing sign, LED
 * panel, holo-screen) that physically illuminates nearby surfaces. Keys:
 *   origin            "x y z"        (required) panel center, Quake space
 *   angle             yaw degrees; -1 = up, -2 = down (Q3 convention)
 *   _arealight_dir    "x y z"        explicit emit direction (overrides angle)
 *   _size             "W H"          panel size (default 64 40)
 *   _color            "r g b"        tint (0-1 or 0-255; default white)
 *   light             intensity      (default 4; `_intensity` also accepted)
 *   _arealight_image  url            optional image projected as the light
 *
 * Area lights are NOT clustered — each consumes a real per-surface light slot —
 * so callers must cap the count (see AreaLightManager / r_arealights_max).
 */

import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { BspEntity } from "../loader/bsp/BspLoader";
import { parseEntityColor, parseQuakeOrigin } from "./MapGodRayEntities";

export interface AreaLightSpec {
  name: string;
  position: Vector3;
  /** World direction the panel emits toward (into the room). */
  faceDir: Vector3;
  width: number;
  height: number;
  color?: Color3;
  intensity: number;
  emissionTextureUrl?: string;
  /** A ready-made source texture to project (e.g. the surface's own BSP texture). */
  emissionSource?: BaseTexture;
}

const DEFAULT_WIDTH = 64;
const DEFAULT_HEIGHT = 40;
const DEFAULT_INTENSITY = 4;

/** Q3 `angle`/explicit-dir → Babylon emit direction. */
function parseFaceDir(props: Record<string, string>): Vector3 {
  const explicit = parseQuakeOrigin(props._arealight_dir);
  if (explicit && explicit.lengthSquared() > 1e-6) return explicit.normalize();

  const raw = props.angle;
  if (raw !== undefined) {
    const a = Number(raw);
    if (a === -1) return new Vector3(0, 1, 0); // straight up
    if (a === -2) return new Vector3(0, -1, 0); // straight down
    if (Number.isFinite(a)) {
      const rad = (a * Math.PI) / 180;
      return new Vector3(Math.cos(rad), 0, Math.sin(rad)).normalize();
    }
  }
  return new Vector3(0, 0, -1);
}

function parseSize(raw: string | undefined): [number, number] {
  if (!raw) return [DEFAULT_WIDTH, DEFAULT_HEIGHT];
  const p = raw.trim().split(/\s+/).map(Number);
  if (p.length >= 2 && p[0] > 0 && p[1] > 0 && p.every((n) => Number.isFinite(n))) {
    return [p[0], p[1]];
  }
  return [DEFAULT_WIDTH, DEFAULT_HEIGHT];
}

/** Parse `light_area` entities into panel specs (skips ones without an origin). */
export function resolveAreaLightEntities(entities: readonly BspEntity[]): AreaLightSpec[] {
  const specs: AreaLightSpec[] = [];
  let i = 0;
  for (const e of entities) {
    if (e.classname !== "light_area") continue;
    const position = parseQuakeOrigin(e.properties.origin);
    if (!position) continue;

    const [width, height] = parseSize(e.properties._size);
    const intensityRaw = Number(e.properties.light ?? e.properties._intensity);
    const spec: AreaLightSpec = {
      name: `light_area_${i++}`,
      position,
      faceDir: parseFaceDir(e.properties),
      width,
      height,
      intensity: Number.isFinite(intensityRaw) && intensityRaw > 0 ? intensityRaw : DEFAULT_INTENSITY,
    };
    const color = parseEntityColor(e.properties._color);
    if (color) spec.color = color;
    if (e.properties._arealight_image) spec.emissionTextureUrl = e.properties._arealight_image;

    specs.push(spec);
  }
  return specs;
}

/** Re-exported for convenience (the flat-color fallback tint). */
export const DEFAULT_AREA_LIGHT_COLOR = new Color3(1, 1, 1);
