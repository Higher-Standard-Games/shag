import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import { applySafeMaxSimultaneousLights, getSafeMaxSimultaneousLights } from "../DynamicLightSafety";

describe("WebGPU light-layout transitions", () => {
  it.each(
    (
      [
        ["GLSL Standard", StandardMaterial, false, false],
        ["GLSL PBR", PBRMaterial, false, false],
        ["frozen GLSL Standard", StandardMaterial, true, false],
        ["frozen GLSL PBR", PBRMaterial, true, false],
        ["WGSL Standard", StandardMaterial, false, true],
        ["WGSL PBR", PBRMaterial, false, true],
        ["frozen WGSL Standard", StandardMaterial, true, true],
        ["frozen WGSL PBR", PBRMaterial, true, true],
      ] as const
    ).flatMap(([name, MaterialType, frozen, nativeWGSL]) =>
      [false, true].map((clusters) => [name, MaterialType, frozen, nativeWGSL, clusters] as const),
    ),
  )(
    "waits for replacement %s (frozen=%s, WGSL=%s, clusters=%s)",
    async (_name, MaterialType, frozen, nativeWGSL, clusters) => {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      try {
        if (nativeWGSL) Object.defineProperty(engine, "isWebGPU", { value: true });
        for (let i = 0; i < 11; i++) new PointLight(`light-${i}`, new Vector3(i, 2, 0), scene);
        const mesh = CreateBox("lit", {}, scene);
        const material = new MaterialType("lit", scene);
        material.maxSimultaneousLights = 11;
        mesh.material = material;
        await material.forceCompilationAsync(mesh);
        const subMesh = mesh.subMeshes[0];
        if (frozen) material.freeze();
        expect(material.isReadyForSubMesh(mesh, subMesh)).toBe(true);
        const oldEffect = subMesh.effect!;
        expect(oldEffect.defines).toContain("#define LIGHT10");
        expect(material.shaderLanguage).toBe(nativeWGSL ? 1 : 0);

        // Real Babylon readiness/define logic, with only the replacement compiler
        // held pending. This does not execute a WebGPU draw.
        if (!nativeWGSL) Object.defineProperty(engine, "isWebGPU", { value: true });
        engine.getCaps().texelFetch = clusters;
        applySafeMaxSimultaneousLights(material);
        scene.incrementRenderId();
        const createEffect = engine.createEffect.bind(engine);
        const readySpies: ReturnType<typeof vi.spyOn>[] = [];
        const compile = vi.spyOn(engine, "createEffect").mockImplementation((...args) => {
          const effect = createEffect(...args);
          readySpies.push(vi.spyOn(effect, "isReady").mockReturnValue(false));
          return effect;
        });
        try {
          expect(material.isReadyForSubMesh(mesh, subMesh)).toBe(false);
          expect(compile).toHaveBeenCalled();
          expect(subMesh.effect).not.toBe(oldEffect);
        } finally {
          compile.mockRestore();
          for (const spy of readySpies) spy.mockRestore();
        }
        await material.forceCompilationAsync(mesh);
        expect(material.isReadyForSubMesh(mesh, subMesh)).toBe(true);
        expect(subMesh.effect?.defines).not.toContain(`#define LIGHT${getSafeMaxSimultaneousLights(material)}`);
        expect(material.isFrozen).toBe(frozen);
      } finally {
        scene.dispose();
        engine.dispose();
      }
    },
  );
});
