import type { BspFile } from "./BspLoader";

/** Qfusion's default overbright settings, expressed without pre-clipping bytes. */
export interface BspLightingProfile {
  gain: number;
  ambient: [number, number, number];
  deluxe: boolean;
}

export function scaleBspLighting(profile: BspLightingProfile, gain: number): BspLightingProfile {
  return {
    ...profile,
    gain,
    ambient: profile.ambient.map((channel) => (channel * gain) / profile.gain) as [number, number, number],
  };
}

export function bspLightingProfile(
  bsp: Pick<BspFile, "header" | "entities" | "faces" | "lightmaps">,
): BspLightingProfile {
  const world = bsp.entities.find((entity) => entity.classname.toLowerCase() === "worldspawn");
  const keys = new Map(Object.entries(world?.properties ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const positive = (value: string | undefined, fallback: number) => {
    const n = value === undefined ? NaN : Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const gain = positive(keys.get("_lightingintensity"), 2);
  const ambient = positive(keys.get("_ambient") ?? keys.get("ambient"), 0);
  let color = (keys.get("_color") ?? keys.get("color") ?? "1 1 1").trim().split(/\s+/).map(Number);
  if (color.length !== 3 || color.some((n) => !Number.isFinite(n) || n < 0) || color.every((n) => n === 0))
    color = [1, 1, 1];
  const used = bsp.faces.map((face) => face.lightmapIndex).filter((index) => index >= 0);
  return {
    gain,
    ambient: color.map((channel) => (channel * ambient * gain) / 255) as [number, number, number],
    deluxe:
      bsp.header.isFBSP &&
      used.length > 0 &&
      used.every((index) => index % 2 === 0 && index + 1 < bsp.lightmaps.length),
  };
}
