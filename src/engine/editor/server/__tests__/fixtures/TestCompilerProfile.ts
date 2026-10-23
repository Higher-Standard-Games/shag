import path from "node:path";
import { registerGameCompilerProfile } from "../../GameCompilerProfile";

/** Synthetic compiler for tests of the engine job runner and persistence. */
export function registerTestCompilerProfile(): void {
  registerGameCompilerProfile({
    id: "synthetic",
    displayName: "Synthetic",
    localToolchainRoot: (root) => path.join(root, "test-toolchain"),
    buildRecipe: (quality, media, map) => ({
      bsp: ["-game", "synthetic", "-fs_basepath", media, map],
      light: ["-game", "synthetic", "-quality", quality, "-fs_basepath", media, map],
    }),
  });
}
