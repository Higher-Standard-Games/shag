import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { InternalTexture, InternalTextureSource } from "@babylonjs/core/Materials/Textures/internalTexture";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import {
  assertEnvironmentChannels,
  createEnvironmentFaceData,
  createEnvironmentLightingFixture,
  ENVIRONMENT_QA_FACES,
  ENVIRONMENT_QA_ROUGHNESS,
  runEnvironmentLightingQA,
} from "../rendering/EnvironmentLightingQA";
import { RendererDiagnostics } from "../rendering/RendererDiagnostics";

function fixtureEngine(webgpu: boolean) {
  const engine = new NullEngine({
    renderWidth: 256,
    renderHeight: 256,
    textureSize: 256,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  Object.defineProperty(engine, "isWebGPU", { value: webgpu });
  Object.defineProperty(engine, "version", { value: 2 });
  Object.assign(engine.getCaps(), { textureLOD: true, texelFetch: true });
  // NullEngine has no GL context to upload a raw cube into. Only that
  // allocation is stubbed; Babylon owns the texture, material and defines.
  vi.spyOn(engine, "createRawCubeTexture").mockImplementation((_data, size) => {
    const texture = new InternalTexture(engine, InternalTextureSource.CubeRaw);
    texture.isCube = true;
    texture.width = texture.height = texture.baseWidth = texture.baseHeight = size;
    texture.generateMipMaps = true;
    texture.isReady = true;
    return texture;
  });
  return engine;
}

/**
 * The face a camera on `position` looks at, by its dominant axis. Babylon's
 * setTarget nudges an axis-aligned camera a millimetre off the axis.
 */
function faceSeenFrom(position: { x: number; y: number; z: number }) {
  const axes = [position.x, position.y, position.z];
  const axis = axes.reduce((best, value, index) => (Math.abs(value) > Math.abs(axes[best]) ? index : best), 0);
  return ENVIRONMENT_QA_FACES.find(({ direction }) => direction[axis] === Math.sign(axes[axis]))!;
}

/** A 4x4 RGBA readback filled with one colour. */
function solid(rgb: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(16 * 4);
  for (let i = 0; i < bytes.length; i += 4) bytes.set([rgb[0], rgb[1], rgb[2], 255], i);
  return bytes;
}

describe("environment lighting fixture", () => {
  it("paints a distinct colour in each face's centre and nothing at the edges", () => {
    const faces = createEnvironmentFaceData();
    expect(faces).toHaveLength(6);
    for (const [index, data] of faces.entries()) {
      expect(data).toHaveLength(32 * 32 * 4);
      const centre = (16 * 32 + 16) * 4;
      expect([...data.slice(centre, centre + 3)]).toEqual(ENVIRONMENT_QA_FACES[index].channels.map((c) => c * 160));
      expect([...data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    }
    // Six different colours: a face read from the wrong slot cannot pass.
    expect(new Set(ENVIRONMENT_QA_FACES.map(({ channels }) => channels.join())).size).toBe(6);
  });

  it("accepts the expected channels and rejects a wrong face or a non-sample", () => {
    expect(() => assertEnvironmentChannels([150, 2, 3], [1, 0, 0])).not.toThrow();
    expect(() => assertEnvironmentChannels([2, 150, 150], [1, 0, 0])).toThrow("Wrong cubemap face");
    expect(() => assertEnvironmentChannels([150, 2, Number.NaN], [1, 0, 0])).toThrow("Invalid environment pixel");
    expect(() => assertEnvironmentChannels([150, 2], [1, 0, 0])).toThrow("Invalid environment pixel");
  });

  it.each([false, true])("compiles a cubic reflection on Standard and metal PBR (WebGPU=%s)", async (webgpu) => {
    const engine = fixtureEngine(webgpu);
    const scene = new Scene(engine);
    try {
      const fixture = createEnvironmentLightingFixture(scene);
      expect(scene.environmentTexture).toBe(fixture.cube);
      expect(fixture.cube.isCube).toBe(true);
      for (const material of [fixture.standard, fixture.pbr]) {
        fixture.mesh.material = material;
        await material.forceCompilationAsync(fixture.mesh);
        // Rendering attaches the effect to the submesh; readiness does the same here.
        expect(material.isReadyForSubMesh(fixture.mesh, fixture.mesh.subMeshes[0])).toBe(true);
        expect(fixture.mesh.subMeshes[0].effect?.defines).toContain("#define REFLECTIONMAP_CUBIC");
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("passes when every face reads back its own colour and roughness dims the reflection", async () => {
    const engine = fixtureEngine(false);
    const scene = new Scene(engine);
    const diagnostics = new RendererDiagnostics("webgl2");
    diagnostics.attachEngine(engine);
    vi.spyOn(engine, "readPixels").mockImplementation(async () => {
      const face = faceSeenFrom(scene.activeCamera!.position);
      const mesh = scene.getMeshByName("environment-qa-box")!;
      const rough = (mesh.material as PBRMaterial | null)?.roughness === ENVIRONMENT_QA_ROUGHNESS;
      return solid(face.channels.map((c) => c * (rough ? 60 : 150)));
    });
    try {
      await runEnvironmentLightingQA(scene, diagnostics, () => false);
      expect(diagnostics.report.firstFailure).toBeUndefined();
      expect(diagnostics.report.fixtures).toHaveLength(13);
      expect(diagnostics.report.fixtures.at(-1)).toMatchObject({
        phase: "rough-+z",
        rgb: [0, 0, 60],
        roughness: ENVIRONMENT_QA_ROUGHNESS,
      });
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("fails on a mirrored face, at the pixel-evidence stage", async () => {
    const engine = fixtureEngine(false);
    const scene = new Scene(engine);
    const diagnostics = new RendererDiagnostics("webgl2");
    diagnostics.attachEngine(engine);
    // +X and -X swapped: the classic handedness mistake.
    vi.spyOn(engine, "readPixels").mockImplementation(async () => {
      const face = faceSeenFrom(scene.activeCamera!.position);
      const mirrored = ENVIRONMENT_QA_FACES.find(
        ({ direction }) =>
          direction[0] === -face.direction[0] &&
          direction[1] === face.direction[1] &&
          direction[2] === face.direction[2],
      )!;
      return solid(mirrored.channels.map((c) => c * 150));
    });
    try {
      await expect(runEnvironmentLightingQA(scene, diagnostics, () => false)).rejects.toThrow("Wrong cubemap face");
      expect(diagnostics.report.firstFailure).toMatchObject({
        stage: "environment-pixel-evidence",
        pass: "polished-+x",
      });
      expect(diagnostics.report.status).toBe("failed");
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
