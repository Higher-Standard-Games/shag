import type { Effect } from "@babylonjs/core/Materials/effect";
import { describe, expect, it, vi } from "vitest";
import { captureShaderCompiles, describeNewEffect, formatShaderCompileReport } from "../ShaderCompileCapture";

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
      released: { pbr: 1 },
      rebuilt: [{ name: "pbr", times: 2 }],
    });
    expect(text).toContain("Shader compiles: 3 in 20s, 1 released");
    expect(text).toContain("Released: pbr 1");
    expect(text).toContain("rebuilt 2x: pbr");
    expect(text).toContain("  pbr: 2");
    expect(text).toContain("  pbr: +LIGHT1");
    expect(text).toContain("  pbr: -FOG");
    expect(text).toContain("  particles: (first of its kind)");
  });

  it("catches an effect built, released and built again inside the window", async () => {
    vi.useFakeTimers();
    // The engine's cache semantics: one effect per key until it is released
    const cache: Record<string, Effect> = { "sky@": effect("sky", []) };
    (cache["sky@"] as unknown as { _key: string })._key = "sky@";
    const engine = {
      _compiledEffects: cache,
      createEffect(name: string, defines: string[]) {
        const key = `${name}@${defines.join(",")}`;
        if (!cache[key]) {
          cache[key] = effect(name, defines);
          (cache[key] as unknown as { _key: string })._key = key;
        }
        return cache[key];
      },
      _releaseEffect(e: Effect) {
        delete cache[(e as unknown as { _key: string })._key];
      },
    };
    const capture = captureShaderCompiles(engine as never, 1);
    const blast = engine.createEffect("default", ["OPACITY"]);
    engine.createEffect("default", ["OPACITY"]); // shared, not a compile
    engine._releaseEffect(blast);
    engine.createEffect("default", ["OPACITY"]); // the next shot's material
    engine.createEffect("sky", []); // cached before the capture
    vi.advanceTimersByTime(1000);
    const report = await capture;
    vi.useRealTimers();

    expect(report.shaders).toHaveLength(2);
    expect(report.released).toEqual({ default: 1 });
    expect(report.rebuilt).toEqual([{ name: "default", times: 2 }]);
  });
});
