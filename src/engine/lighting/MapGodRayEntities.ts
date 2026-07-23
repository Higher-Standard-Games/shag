/**
 * MapGodRayEntities — parse BSP entities that drive god rays into engine data.
 *
 * Pure functions (no Babylon scene), so the coordinate + sun-direction
 * conventions are unit-tested and easy to confirm against a real Warsow map.
 *
 * Two map hooks:
 *  - **Warsow/Q3 sun entity** (`resolveMapSunDirection`): a targeted "sun" light
 *    authored in the map. In Radiant a directional/sun light is a `light` entity
 *    with `target "<name>"` plus a marker entity with `targetname "<name>"`; the
 *    light points at the marker, so the marker sits toward the sun and sunlight
 *    travels from the marker toward the light. Warsow names that link `sun` or
 *    `_sun`. This gives shafts that match the map's authored sky, instead of the
 *    engine's synthetic day/night sun.
 *  - **`light_volumetric`** (`resolveVolumetricEmitters`): a mapper-placed point
 *    emitter for a localized god-ray source (reactor, portal, bright fixture).
 */

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { BspEntity } from "../loader/bsp/BspLoader";

/** Names a Warsow/Q3 map uses to link a sun light to its direction marker. */
const SUN_TARGET_NAMES = new Set(["sun", "_sun"]);

export interface VolumetricEmitter {
  /** World position (Babylon space) of the emitter. */
  position: Vector3;
  color?: Color3;
  exposure?: number;
  size?: number;
}

/**
 * Quake `"x y z"` (Z-up) → Babylon `Vector3` (Y-up): (qx, qz, qy). Matches the
 * `light`→PointLight conversion in MapRenderer. Returns null if unparseable.
 */
export function parseQuakeOrigin(origin: string | undefined): Vector3 | null {
  if (!origin) return null;
  const p = origin.trim().split(/\s+/).map(Number);
  if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
  return new Vector3(p[0], p[2], p[1]);
}

/** Parse a `"r g b"` entity color (0-1 or 0-255). Returns null if unparseable. */
export function parseEntityColor(raw: string | undefined): Color3 | null {
  if (!raw) return null;
  const p = raw.trim().split(/\s+/).map(Number);
  if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
  const scale = p.some((c) => c > 1.0) ? 1 / 255 : 1;
  return new Color3(p[0] * scale, p[1] * scale, p[2] * scale);
}

/**
 * Resolve the map's authored sun direction (Warsow/Q3 targeted-sun compat), in
 * Babylon space, as the direction **sunlight travels** (from the sun toward the
 * scene — the sense `SunGodRays`/`DirectionalLight.direction` expect). Returns
 * null when the map has no recognizable sun entity.
 *
 * The sign convention (marker sits toward the sun) is the common Radiant one but
 * is worth a browser check against a real map — flip here if shafts point the
 * wrong way.
 */
export function resolveMapSunDirection(entities: readonly BspEntity[]): Vector3 | null {
  for (const light of entities) {
    const target = light.properties.target?.toLowerCase();
    if (!target || !SUN_TARGET_NAMES.has(target)) continue;

    const marker = entities.find((e) => e.properties.targetname?.toLowerCase() === target);
    if (!marker) continue;

    const lightPos = parseQuakeOrigin(light.properties.origin);
    const markerPos = parseQuakeOrigin(marker.properties.origin);
    if (!lightPos || !markerPos) continue;

    // Light points at the marker → sun is toward the marker → sunlight travels
    // from the marker toward the light: normalize(light - marker).
    const dir = lightPos.subtract(markerPos);
    if (dir.lengthSquared() < 1e-6) continue;
    return dir.normalize();
  }
  return null;
}

/**
 * Parse `light_volumetric` point entities into anchored god-ray emitters.
 * Keys: `origin` (required), `_color`/`color`, `godrays_exposure`, `size`.
 */
export function resolveVolumetricEmitters(entities: readonly BspEntity[]): VolumetricEmitter[] {
  const emitters: VolumetricEmitter[] = [];
  for (const e of entities) {
    if (e.classname !== "light_volumetric") continue;
    const position = parseQuakeOrigin(e.properties.origin);
    if (!position) continue;

    const emitter: VolumetricEmitter = { position };
    const color = parseEntityColor(e.properties._color ?? e.properties.color);
    if (color) emitter.color = color;
    const exposure = Number(e.properties.godrays_exposure);
    if (Number.isFinite(exposure)) emitter.exposure = exposure;
    const size = Number(e.properties.size);
    if (Number.isFinite(size) && size > 0) emitter.size = size;

    emitters.push(emitter);
  }
  return emitters;
}
