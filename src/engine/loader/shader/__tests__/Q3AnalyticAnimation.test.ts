import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { Q3AnalyticAnimationPlugin } from "../Q3AnalyticAnimationPlugin";

describe("analytic animation comparison boundary", () => {
  it("rejects stateful/random wave semantics and keeps program identity distinct from time", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      expect(
        () =>
          new Q3AnalyticAnimationPlugin(new StandardMaterial("noise", scene), null, {
            func: "noise",
            base: 1,
            amplitude: 1,
            phase: 0,
            frequency: 1,
          }),
      ).toThrow("sine waves only");
      const plugin = new Q3AnalyticAnimationPlugin(
        new StandardMaterial("scroll", scene),
        {
          type: "scroll",
          sSpeed: -1,
          tSpeed: 0.2,
        },
        null,
      );
      const glsl = plugin.getCustomCode("vertex", ShaderLanguage.GLSL);
      const wgsl = plugin.getCustomCode("vertex", ShaderLanguage.WGSL);
      plugin.setTime(1234);
      expect(plugin.getCustomCode("vertex", ShaderLanguage.GLSL)).toEqual(glsl);
      expect(wgsl.CUSTOM_VERTEX_MAIN_END).toContain("trunc");
      expect(glsl.CUSTOM_VERTEX_MAIN_END).toContain("sign");
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
