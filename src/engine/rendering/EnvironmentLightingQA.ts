import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SphericalPolynomial } from "@babylonjs/core/Maths/sphericalPolynomial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { beginRendererValidation, type RendererDiagnostics, waitForRendererGPU } from "./RendererDiagnostics";
import { meanRGB } from "./RendererPixelReadback";
import { applySceneRendererPolicy } from "./SceneRendererPolicy";

// Raw upload order verified in Babylon's WebGL upload and WebGPU permutation +
// inverse permutation: +X, -X, +Y, -Y, +Z, -Z. No Q3 sky-loader mapping involved.
export const ENVIRONMENT_QA_FACES = [
  { name: "+x", direction: [1, 0, 0], channels: [1, 0, 0] },
  { name: "-x", direction: [-1, 0, 0], channels: [0, 1, 1] },
  { name: "+y", direction: [0, 1, 0], channels: [0, 1, 0] },
  { name: "-y", direction: [0, -1, 0], channels: [1, 0, 1] },
  { name: "+z", direction: [0, 0, 1], channels: [0, 0, 1] },
  { name: "-z", direction: [0, 0, -1], channels: [1, 1, 0] },
] as const;

/**
 * Roughness for the mip-response phase. Reflection brightness falls smoothly
 * with roughness and reaches black at 1 for these sparse faces, so the phase
 * samples partway up the mip chain, where dimming is large but measurable.
 */
export const ENVIRONMENT_QA_ROUGHNESS = 0.75;

/** Sparse face centers become dimmer in generated mips: an explicit LOD signal. */
export function createEnvironmentFaceData(): Uint8Array[] {
  return ENVIRONMENT_QA_FACES.map(({ channels }) => {
    const data = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const offset = (y * 32 + x) * 4;
        const center = x >= 12 && x < 20 && y >= 12 && y < 20;
        for (let c = 0; c < 3; c++) data[offset + c] = center ? channels[c] * 160 : 0;
        data[offset + 3] = 255;
      }
    return data;
  });
}

export function assertEnvironmentChannels(rgb: number[], expected: readonly number[]): void {
  if (rgb.length !== 3 || rgb.some((v) => !Number.isFinite(v))) throw new Error("Invalid environment pixel sample");
  for (let c = 0; c < 3; c++) {
    if ((expected[c] === 1 && rgb[c] < 40) || (expected[c] === 0 && rgb[c] > 8)) {
      throw new Error(`Wrong cubemap face/channel: expected ${expected}, got ${rgb}`);
    }
  }
}

export function createEnvironmentLightingFixture(scene: Scene) {
  scene.clearColor = new Color4(0, 0, 0, 1);
  scene.imageProcessingConfiguration.isEnabled = false;
  applySceneRendererPolicy(scene);
  const camera = new FreeCamera("environment-qa-camera", new Vector3(0, 0, -5), scene);
  camera.minZ = 0.1;
  camera.maxZ = 20;
  scene.activeCamera = camera;
  const cube = new RawCubeTexture(
    scene,
    createEnvironmentFaceData(),
    32,
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  cube.name = "environment-qa-local-cube";
  cube.coordinatesMode = Texture.CUBIC_MODE;
  cube.gammaSpace = false;
  cube.linearSpecularLOD = true;
  cube.lodGenerationScale = 1;
  cube.lodGenerationOffset = 0;
  // Isolate specular sampling; avoid asynchronous irradiance readback/precompute.
  cube.sphericalPolynomial = new SphericalPolynomial();
  scene.environmentTexture = cube;
  const mesh = CreateBox("environment-qa-box", { size: 2 }, scene);
  const standard = new StandardMaterial("environment-standard", scene);
  standard.disableLighting = true;
  standard.diffuseColor = Color3.Black();
  standard.specularColor = Color3.Black();
  standard.reflectionTexture = cube;
  const pbr = new PBRMaterial("environment-pbr-metal", scene);
  pbr.albedoColor = Color3.White();
  pbr.metallic = 1;
  pbr.roughness = 0;
  pbr.directIntensity = 0;
  pbr.environmentBRDFTexture = null;
  for (const material of [standard, pbr]) material.allowShaderHotSwapping = false;
  return { camera, cube, mesh, standard, pbr };
}

/** Actual pixel evidence for cube face selection and PBR mip/roughness response. */
export async function runEnvironmentLightingQA(
  scene: Scene,
  diagnostics: RendererDiagnostics,
  stopped: () => boolean,
): Promise<void> {
  const engine = scene.getEngine();
  const setupValidation = beginRendererValidation(engine);
  const fixture = await diagnostics.runStage("environment-setup", async () => {
    try {
      const result = createEnvironmentLightingFixture(scene);
      await setupValidation();
      return result;
    } finally {
      void setupValidation().catch((error) => diagnostics.fail(error));
    }
  });
  const { camera, mesh, standard, pbr } = fixture;
  let polishedBlue = 0;
  const phases = [
    ...[standard, pbr].flatMap((material) => ENVIRONMENT_QA_FACES.map((face) => ({ material, face, rough: false }))),
    { material: pbr, face: ENVIRONMENT_QA_FACES[4], rough: true },
  ];
  for (const { material, face, rough } of phases) {
    if (stopped()) return;
    const phase = `${rough ? "rough" : "polished"}-${face.name}`;
    const context = { material: material.name, mesh: mesh.name, pass: phase };
    const closeValidation = beginRendererValidation(engine);
    try {
      mesh.material = material;
      const [dx, dy, dz] = face.direction;
      camera.position.copyFromFloats(dx, dy, dz).scaleInPlace(5);
      camera.upVector = Math.abs(face.direction[1]) === 1 ? Vector3.Forward() : Vector3.Up();
      camera.setTarget(Vector3.Zero());
      if (rough) pbr.roughness = ENVIRONMENT_QA_ROUGHNESS;
      await diagnostics.runStage("environment-compilation", () => material.forceCompilationAsync(mesh), context);
      let rgb: number[] = [];
      let readbackFormat = "rgba8unorm";
      const width = engine.getRenderWidth();
      const height = engine.getRenderHeight();
      await diagnostics.runStage(
        "environment-render",
        async () => {
          if (width < 128 || height < 128) throw new Error("Environment QA requires a canvas at least 128x128");
          for (let frame = 0; frame < 3; frame++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 16));
            if (stopped() || diagnostics.report.status === "failed") return;
            engine.beginFrame();
            try {
              scene.render();
              if (frame === 2) {
                if (engine.isWebGPU) readbackFormat = (engine as unknown as { _colorFormat: string })._colorFormat;
                const bytes = await engine.readPixels(Math.floor(width / 2) - 2, Math.floor(height / 2) - 2, 4, 4);
                rgb = meanRGB(bytes, readbackFormat);
              }
            } finally {
              if (!stopped()) engine.endFrame();
            }
            diagnostics.frame();
          }
          await waitForRendererGPU(engine);
        },
        context,
      );
      await diagnostics.runStage("environment-gpu-validation", closeValidation, context);
      await diagnostics.runStage(
        "environment-pixel-evidence",
        async () => {
          const effect = mesh.subMeshes[0].effect;
          if (!effect?.isReady() || !effect.defines.includes("#define REFLECTIONMAP_CUBIC")) {
            throw new Error("Expected a ready cubic-reflection effect");
          }
          diagnostics.fixture({
            material: material.name,
            phase,
            cap: material.maxSimultaneousLights,
            activeLights: mesh.lightSources.length,
            compiledLights: 0,
            frozen: material.isFrozen,
            rgb,
            readbackFormat,
            expectedChannels: [...face.channels],
            roughness: material === pbr ? pbr.roughness! : undefined,
            viewport: { width, height },
          });
          if (!rough) assertEnvironmentChannels(rgb, face.channels);
          else if (
            rgb.length !== 3 ||
            !Number.isFinite(rgb[2]) ||
            rgb[2] < 1 ||
            polishedBlue - rgb[2] < 20 ||
            rgb[0] > 8 ||
            rgb[1] > 8
          ) {
            throw new Error(`Expected dimmer blue rough reflection; polished=${polishedBlue}, rough=${rgb}`);
          }
          if (material === pbr && face.name === "+z" && !rough) polishedBlue = rgb[2];
        },
        context,
      );
    } finally {
      void closeValidation().catch((error) => diagnostics.fail(error));
    }
  }
}
