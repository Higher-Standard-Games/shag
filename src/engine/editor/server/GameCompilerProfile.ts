import type { BuildQuality } from "./BuildRecipe";

export interface CompilerRecipe {
  bsp: string[];
  light: string[];
}

/** Selected game's trusted Node-side compiler policy; install before resolving configurations or creating jobs. */
export interface GameCompilerProfile {
  id: string;
  displayName: string;
  localToolchainRoot(repoRoot: string): string;
  buildRecipe(quality: BuildQuality, mediaRoot: string, mapFile: string): CompilerRecipe;
}

let profile: GameCompilerProfile | null = null;

export function registerGameCompilerProfile(value: GameCompilerProfile): void {
  profile = value;
}

export function getGameCompilerProfile(): GameCompilerProfile | null {
  return profile;
}

export function clearGameCompilerProfile(): void {
  profile = null;
}
