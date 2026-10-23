import type { Effect } from "@babylonjs/core/Materials/effect";
import { describe, expect, it } from "vitest";
import { describeNewEffect, formatShaderCompileReport } from "../ShaderCompileCapture";

const effect = (name: string, defines: string[]) =>
  ({ name, defines: defines.map((d) => `#define ${d}`).join("\n") }) as unknown as Effect;

describe("shader compile capture", () => {
  it("names the defines a new effect differs by from its closest sibling", () => {
    const before = [effect("pbr", ["NORMAL", "LIGHT0", "POINTLIGHT0"]), effect("pbr", ["NORMAL"]), effect("sky", [])];
    expect(
      describeNewEffect(effect("pbr", ["NORMAL", "LIGHT0", "POINTLIGHT0", "LIGHT1", "POINTLIGHT1"]), before),
    ).toEqual({ name: "pbr", added: ["LIGHT1", "POINTLIGHT1"], removed: [], hadSibling: true });
    expect(describeNewEffect(effect("particles", ["BILLBOARD"]), before)).toMatchObject({ hadSibling: false });
  });

  it("summarises by shader, then lists each compile", () => {
    const text = formatShaderCompileReport({
      durationSeconds: 20,
      shaders: [
        { name: "pbr", added: ["LIGHT1"], removed: [], hadSibling: true },
        { name: "pbr", added: [], removed: ["FOG"], hadSibling: true },
        { name: "particles", added: [], removed: [], hadSibling: false },
      ],
    });
    expect(text).toContain("Shader compiles: 3 new in 20s");
    expect(text).toContain("  pbr: 2");
    expect(text).toContain("  pbr: +LIGHT1");
    expect(text).toContain("  pbr: -FOG");
    expect(text).toContain("  particles: (first of its kind)");
  });
});
