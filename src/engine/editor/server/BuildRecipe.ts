export type BuildQuality = "fast" | "default" | "release";

export const BUILD_QUALITIES: readonly BuildQuality[] = ["fast", "default", "release"];

export function isBuildQuality(value: unknown): value is BuildQuality {
  return typeof value === "string" && BUILD_QUALITIES.includes(value as BuildQuality);
}

/** Washoi's NetRadiant build menu, expressed as argv instead of shell text. */
export function buildRecipe(
  quality: BuildQuality,
  mediaRoot: string,
  mapFile: string,
): {
  bsp: string[];
  light: string[];
} {
  const common = ["-game", "washoi", "-fs_basepath", mediaRoot];
  const bsp = [...common];
  const light = [...common];
  if (quality === "fast") {
    bsp.push("-leaktest", "-fast", "-samplesize", "8");
    light.push("-fast");
  } else if (quality === "release") {
    light.push("-upscale");
  }
  bsp.push(mapFile);
  light.push(mapFile);
  return { bsp, light };
}
