/**
 * Q3ShaderRegistry Tests
 *
 * Tests the shader registry's lookup, material resolution, and caching.
 * Uses directly injected shaders (bypassing PK3Loader) for pure unit testing.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import { Q3ShaderRegistry } from "../loader/shader/Q3ShaderRegistry";
import type { Q3Shader } from "../loader/shader/Q3ShaderTypes";

// ─── Helpers ────────────────────────────────────────────────────

/** Access private state for testing */
function getRegistry(): Q3ShaderRegistry {
  return Q3ShaderRegistry.getInstance();
}

/** Inject a shader directly into the registry (bypasses PK3 loading) */
function injectShader(shader: Q3Shader): void {
  const reg = getRegistry();
  // biome-ignore lint/suspicious/noExplicitAny: accessing private state for test injection
  const shaders = (reg as any).shaders as Map<string, Q3Shader>;
  const name = shader.name.toLowerCase().replace(/\.(tga|jpg|jpeg|png|ktx)$/i, "");
  shaders.set(name, shader);
}

function injectPk3Files(paths: string[]): void {
  const pk3 = PK3Loader.getInstance();
  // biome-ignore lint/suspicious/noExplicitAny: accessing private state for test injection
  const fileIndex = (pk3 as any).fileIndex as Map<string, string>;
  fileIndex.clear();
  for (const path of paths) {
    const normalized = path.toLowerCase().replace(/\\/g, "/");
    fileIndex.set(normalized, "test.pk3");
  }
}

/** Create a minimal shader */
function makeShader(name: string, overrides: Partial<Q3Shader> = {}): Q3Shader {
  return {
    name: name.toLowerCase(),
    surfaceParms: new Set(),
    cull: "back",
    stages: [],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("Q3ShaderRegistry", () => {
  beforeEach(() => {
    getRegistry().clear();
    PK3Loader.getInstance().unloadAll();
  });

  afterEach(() => {
    getRegistry().clear();
    PK3Loader.getInstance().unloadAll();
  });

  // ── Singleton ─────────────────────────────────────────────

  describe("singleton", () => {
    it("returns same instance", () => {
      expect(Q3ShaderRegistry.getInstance()).toBe(Q3ShaderRegistry.getInstance());
    });
  });

  // ── Lookup ────────────────────────────────────────────────

  describe("getShader", () => {
    it("finds shader by exact name", () => {
      injectShader(makeShader("textures/base/floor"));
      expect(getRegistry().getShader("textures/base/floor")).toBeDefined();
    });

    it("case-insensitive lookup", () => {
      injectShader(makeShader("textures/base/floor"));
      expect(getRegistry().getShader("TEXTURES/BASE/FLOOR")).toBeDefined();
    });

    it("strips file extension", () => {
      injectShader(makeShader("textures/base/floor"));
      expect(getRegistry().getShader("textures/base/floor.tga")).toBeDefined();
      expect(getRegistry().getShader("textures/base/floor.jpg")).toBeDefined();
    });

    it("returns undefined for missing shader", () => {
      expect(getRegistry().getShader("textures/nonexistent")).toBeUndefined();
    });

    it("underscore-to-slash fallback for BSP texture names", () => {
      injectShader(makeShader("textures/base/floor"));
      // BSP may encode "textures/base/floor" as "textures_base_floor"
      const result = getRegistry().getShader("textures_base_floor");
      expect(result).toBeDefined();
    });
  });

  // ── hasShader ─────────────────────────────────────────────

  describe("hasShader", () => {
    it("returns true for existing shader", () => {
      injectShader(makeShader("textures/base/wall"));
      expect(getRegistry().hasShader("textures/base/wall")).toBe(true);
    });

    it("returns false for missing shader", () => {
      expect(getRegistry().hasShader("textures/nope")).toBe(false);
    });
  });

  // ── Material Resolution ───────────────────────────────────

  describe("resolveMaterialProps", () => {
    it("returns defaults for unknown texture", () => {
      const props = getRegistry().resolveMaterialProps("textures/unknown");
      expect(props.useLightmap).toBe(true);
      expect(props.alphaMode).toBe("opaque");
      expect(props.backFaceCulling).toBe(true);
      expect(props.isTransparent).toBe(false);
      expect(props.isSky).toBe(false);
      expect(props.isFullbright).toBe(false);
    });

    it("synthesizes material metadata from implicit companion-map filenames", () => {
      injectPk3Files([
        "textures/blx_wtest3/blx_wt3_wall1.tga",
        "textures/blx_wtest3/blx_wt3_wall1_norm.tga",
        "textures/blx_wtest3/blx_wt3_wall1_gloss.tga",
        "textures/blx_wtest3/blx_wt3_wall1_glow.tga",
      ]);

      const props = getRegistry().resolveMaterialProps("textures/blx_wtest3/blx_wt3_wall1");
      expect(props.hasMaterialMetadata).toBe(true);
      expect(props.diffuseTexture).toBe("textures/blx_wtest3/blx_wt3_wall1.tga");
      expect(props.normalTexture).toBe("textures/blx_wtest3/blx_wt3_wall1_norm.tga");
      expect(props.glossTexture).toBe("textures/blx_wtest3/blx_wt3_wall1_gloss.tga");
      expect(props.glowTexture).toBe("textures/blx_wtest3/blx_wt3_wall1_glow.tga");
      expect(props.materialTokens).toEqual([
        "textures/blx_wtest3/blx_wt3_wall1.tga",
        "textures/blx_wtest3/blx_wt3_wall1_norm.tga",
        "textures/blx_wtest3/blx_wt3_wall1_gloss.tga",
        "textures/blx_wtest3/blx_wt3_wall1_glow.tga",
      ]);
    });

    it("uses placeholder tokens for implicit gloss/glow without a normal map", () => {
      injectPk3Files([
        "textures/test/panel.tga",
        "textures/test/panel_gloss.tga",
        "textures/test/panel_add.tga",
      ]);

      const props = getRegistry().resolveMaterialProps("textures/test/panel");
      expect(props.hasMaterialMetadata).toBe(true);
      expect(props.diffuseTexture).toBe("textures/test/panel.tga");
      expect(props.normalTexture).toBeUndefined();
      expect(props.glossTexture).toBe("textures/test/panel_gloss.tga");
      expect(props.glowTexture).toBe("textures/test/panel_add.tga");
      expect(props.materialTokens).toEqual([
        "textures/test/panel.tga",
        "-",
        "textures/test/panel_gloss.tga",
        "textures/test/panel_add.tga",
      ]);
    });

    it("resolves sky shader", () => {
      injectShader(
        makeShader("textures/skies/blue", {
          surfaceParms: new Set(["sky"]),
          skyParms: { farbox: "env/sky", cloudHeight: 200, nearbox: "" },
        }),
      );
      const props = getRegistry().resolveMaterialProps("textures/skies/blue");
      expect(props.isSky).toBe(true);
      expect(props.useLightmap).toBe(false);
    });

    it("resolves cull none (double-sided)", () => {
      injectShader(makeShader("textures/base/glass", { cull: "none" }));
      const props = getRegistry().resolveMaterialProps("textures/base/glass");
      expect(props.backFaceCulling).toBe(false);
      expect(props.twoSidedLighting).toBe(true);
    });

    it("resolves transparent surfaceparm", () => {
      injectShader(
        makeShader("textures/base/glass", {
          surfaceParms: new Set(["trans"]),
        }),
      );
      const props = getRegistry().resolveMaterialProps("textures/base/glass");
      expect(props.isTransparent).toBe(true);
    });

    it("resolves additive blend", () => {
      injectShader(
        makeShader("textures/effects/glow", {
          stages: [
            {
              map: "textures/effects/glow.tga",
              blendFunc: ["GL_ONE", "GL_ONE"],
            },
          ],
        }),
      );
      const props = getRegistry().resolveMaterialProps("textures/effects/glow");
      expect(props.alphaMode).toBe("add");
      expect(props.isTransparent).toBe(true);
      expect(props.depthWrite).toBe(false);
    });

    it("resolves alpha blend", () => {
      injectShader(
        makeShader("textures/effects/smoke", {
          stages: [
            {
              map: "textures/effects/smoke.tga",
              blendFunc: ["GL_SRC_ALPHA", "GL_ONE_MINUS_SRC_ALPHA"],
            },
          ],
        }),
      );
      const props = getRegistry().resolveMaterialProps("textures/effects/smoke");
      expect(props.alphaMode).toBe("blend");
      expect(props.isTransparent).toBe(true);
    });

    it("resolves filter/multiply blend", () => {
      injectShader(
        makeShader("textures/base/decal", {
          stages: [
            {
              map: "textures/base/decal.tga",
              blendFunc: ["GL_DST_COLOR", "GL_ZERO"],
            },
          ],
        }),
      );
      const props = getRegistry().resolveMaterialProps("textures/base/decal");
      expect(props.alphaMode).toBe("multiply");
    });

    it("resolves fullbright (nolightmap)", () => {
      injectShader(
        makeShader("textures/base/lamp", {
          surfaceParms: new Set(["nolightmap"]),
        }),
      );
      const props = getRegistry().resolveMaterialProps("textures/base/lamp");
      expect(props.isFullbright).toBe(true);
      expect(props.useLightmap).toBe(false);
    });

    it("resolves polygon offset", () => {
      injectShader(makeShader("textures/base/decal", { polygonOffset: true }));
      const props = getRegistry().resolveMaterialProps("textures/base/decal");
      expect(props.polygonOffset).toBe(true);
    });

    it("resolves autosprite from deformVertexes", () => {
      injectShader(
        makeShader("textures/effects/spark", {
          deformVertexes: [{ type: "autosprite" }],
          stages: [{ map: "textures/effects/spark.tga" }],
        }),
      );
      const props = getRegistry().resolveMaterialProps("textures/effects/spark");
      expect(props.autosprite).toBe(true);
    });

    it("resolves alpha cutoff from alphaFunc GT0", () => {
      injectShader(
        makeShader("textures/base/grate", {
          stages: [
            {
              map: "textures/base/grate.tga",
              alphaFunc: "GT0",
            },
          ],
        }),
      );
      const props = getRegistry().resolveMaterialProps("textures/base/grate");
      expect(props.isTransparent).toBe(true);
      expect(props.alphaCutoff).toBeCloseTo(0.01);
    });

    it("detects lightmap usage", () => {
      injectShader(
        makeShader("textures/base/brick", {
          stages: [{ map: "textures/base/brick.tga" }, { map: "$lightmap", blendFunc: ["GL_DST_COLOR", "GL_ZERO"] }],
        }),
      );
      const props = getRegistry().resolveMaterialProps("textures/base/brick");
      expect(props.useLightmap).toBe(true);
      expect(props.diffuseTexture).toBe("textures/base/brick.tga");
    });

    it("detects animation from tcMod", () => {
      injectShader(
        makeShader("textures/base/water", {
          stages: [
            {
              map: "textures/base/water.tga",
              tcMod: [{ type: "scroll", sSpeed: 0.5, tSpeed: 0.2 }],
            },
          ],
        }),
      );
      const props = getRegistry().resolveMaterialProps("textures/base/water");
      expect(props.needsAnimation).toBe(true);
    });

    it("normalizes structured material metadata and placeholder channels", () => {
      injectShader(
        makeShader("textures/test/material", {
          stages: [
            {
              map: "textures/test/fallback.tga",
              material: {
                rawTokens: [
                  "textures\\test\\diffuse.tga",
                  "textures/test/diffuse_norm.tga",
                  "-",
                  "$whiteimage",
                ],
                diffuse: "textures\\test\\diffuse.tga",
                normal: "textures/test/diffuse_norm.tga",
                gloss: "-",
                glow: "$whiteimage",
              },
            },
          ],
          unconditionalStages: [
            {
              map: "textures/test/fallback.tga",
              material: {
                rawTokens: [
                  "textures\\test\\diffuse.tga",
                  "textures/test/diffuse_norm.tga",
                  "-",
                  "$whiteimage",
                ],
                diffuse: "textures\\test\\diffuse.tga",
                normal: "textures/test/diffuse_norm.tga",
                gloss: "-",
                glow: "$whiteimage",
              },
            },
          ],
        }),
      );

      const props = getRegistry().resolveMaterialProps("textures/test/material");
      expect(props.hasMaterialMetadata).toBe(true);
      expect(props.diffuseTexture).toBe("textures/test/diffuse.tga");
      expect(props.normalTexture).toBe("textures/test/diffuse_norm.tga");
      expect(props.glossTexture).toBeUndefined();
      expect(props.glowTexture).toBe("$whiteimage");
      expect(props.glossTextureExplicitlyBlank).toBe(true);
      expect(props.materialTokens).toEqual([
        "textures/test/diffuse.tga",
        "textures/test/diffuse_norm.tga",
        "-",
        "$whiteimage",
      ]);
    });

    it("selects conditional deluxe branches without losing unconditional stages", () => {
      injectShader(
        makeShader("textures/test/deluxe", {
          stages: [
            { map: "textures/test/common.tga" },
            { map: "$lightmap" },
            {
              map: "textures/test/non_deluxe.tga",
              blendFunc: ["GL_DST_COLOR", "GL_ZERO"],
            },
            {
              map: "textures/test/deluxe.tga",
              material: {
                rawTokens: [
                  "textures/test/deluxe.tga",
                  "textures/test/deluxe_norm.tga",
                  "textures/test/deluxe_gloss.tga",
                ],
                diffuse: "textures/test/deluxe.tga",
                normal: "textures/test/deluxe_norm.tga",
                gloss: "textures/test/deluxe_gloss.tga",
              },
            },
          ],
          unconditionalStages: [{ map: "textures/test/common.tga" }],
          conditionalBlocks: [
            {
              condition: "!deluxe",
              stages: [
                { map: "$lightmap" },
                {
                  map: "textures/test/non_deluxe.tga",
                  blendFunc: ["GL_DST_COLOR", "GL_ZERO"],
                },
              ],
            },
            {
              condition: "deluxe",
              stages: [
                {
                  map: "textures/test/deluxe.tga",
                  material: {
                    rawTokens: [
                      "textures/test/deluxe.tga",
                      "textures/test/deluxe_norm.tga",
                      "textures/test/deluxe_gloss.tga",
                    ],
                    diffuse: "textures/test/deluxe.tga",
                    normal: "textures/test/deluxe_norm.tga",
                    gloss: "textures/test/deluxe_gloss.tga",
                  },
                },
              ],
            },
          ],
        }),
      );

      const nonDeluxe = getRegistry().resolveMaterialProps("textures/test/deluxe", { deluxe: false });
      expect(nonDeluxe.resolvedBranch).toBe("!deluxe");
      expect(nonDeluxe.useLightmap).toBe(true);
      expect(nonDeluxe.diffuseTexture).toBe("textures/test/common.tga");
      expect(nonDeluxe.alphaMode).toBe("opaque");

      const deluxe = getRegistry().resolveMaterialProps("textures/test/deluxe", { deluxe: true });
      expect(deluxe.resolvedBranch).toBe("deluxe");
      expect(deluxe.useLightmap).toBe(false);
      expect(deluxe.diffuseTexture).toBe("textures/test/deluxe.tga");
      expect(deluxe.normalTexture).toBe("textures/test/deluxe_norm.tga");
      expect(deluxe.glossTexture).toBe("textures/test/deluxe_gloss.tga");
    });
  });

  // ── Caching ───────────────────────────────────────────────

  describe("caching", () => {
    it("caches resolved material props", () => {
      injectShader(makeShader("textures/base/floor"));
      const reg = getRegistry();
      const a = reg.resolveMaterialProps("textures/base/floor");
      const b = reg.resolveMaterialProps("textures/base/floor");
      expect(a).toBe(b); // Same reference = cached
    });

    it("keys cache by deluxe mode", () => {
      injectShader(
        makeShader("textures/test/cache", {
          stages: [{ map: "textures/test/default.tga" }],
          unconditionalStages: [],
          conditionalBlocks: [
            {
              condition: "!deluxe",
              stages: [{ map: "textures/test/default.tga" }],
            },
            {
              condition: "deluxe",
              stages: [{ map: "textures/test/deluxe.tga" }],
            },
          ],
        }),
      );

      const reg = getRegistry();
      const nonDeluxeA = reg.resolveMaterialProps("textures/test/cache", { deluxe: false });
      const nonDeluxeB = reg.resolveMaterialProps("textures/test/cache", { deluxe: false });
      const deluxe = reg.resolveMaterialProps("textures/test/cache", { deluxe: true });

      expect(nonDeluxeA).toBe(nonDeluxeB);
      expect(nonDeluxeA).not.toBe(deluxe);
      expect(nonDeluxeA.diffuseTexture).toBe("textures/test/default.tga");
      expect(deluxe.diffuseTexture).toBe("textures/test/deluxe.tga");
    });
  });

  // ── Utility Methods ───────────────────────────────────────

  describe("utility methods", () => {
    it("getShaderCount returns count", () => {
      expect(getRegistry().getShaderCount()).toBe(0);
      injectShader(makeShader("textures/a"));
      injectShader(makeShader("textures/b"));
      expect(getRegistry().getShaderCount()).toBe(2);
    });

    it("getShaderNames returns all names", () => {
      injectShader(makeShader("textures/a"));
      injectShader(makeShader("textures/b"));
      const names = getRegistry().getShaderNames();
      expect(names).toContain("textures/a");
      expect(names).toContain("textures/b");
    });

    it("clear removes all shaders", () => {
      injectShader(makeShader("textures/a"));
      getRegistry().clear();
      expect(getRegistry().getShaderCount()).toBe(0);
      expect(getRegistry().isLoaded()).toBe(false);
    });
  });
});
