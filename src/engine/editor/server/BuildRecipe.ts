import { getGameCompilerProfile } from "./GameCompilerProfile";

export type BuildQuality = "fast" | "default" | "release";

export const BUILD_QUALITIES: readonly BuildQuality[] = ["fast", "default", "release"];

export function isBuildQuality(value: unknown): value is BuildQuality {
  return typeof value === "string" && BUILD_QUALITIES.includes(value as BuildQuality);
}

/** Selected game's compiler arguments, expressed as argv instead of shell text. */
export function buildRecipe(
  quality: BuildQuality,
  mediaRoot: string,
  mapFile: string,
): {
  bsp: string[];
  light: string[];
} {
  const profile = getGameCompilerProfile();
  if (!profile) throw new Error("No game compiler profile registered");
  return profile.buildRecipe(quality, mediaRoot, mapFile);
}
