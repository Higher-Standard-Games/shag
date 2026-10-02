import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { ClusteredLightContainer } from "@babylonjs/core/Lights/Clustered/clusteredLightContainer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { beginRendererValidation, type RendererDiagnostics, waitForRendererGPU } from "./RendererDiagnostics";
import { meanRGB } from "./RendererPixelReadback";

/** Isolated experiment with explicit budgets, independent of gameplay services. */
export function createClusteredLightingFixture(scene: Scene, multipleClusters = false) {
  scene.clearColor = new Color4(0.02, 0.02, 0.02, 1);
  const camera = new FreeCamera("cluster-qa-camera", new Vector3(0, 0, -9), scene);
  camera.minZ = 0.1;
  camera.maxZ = 100;
  camera.fovMode = FreeCamera.FOVMODE_HORIZONTAL_FIXED;
  camera.setTarget(Vector3.Zero());
  scene.activeCamera = camera;
  const ambient = new HemisphericLight("cluster-qa-ambient", Vector3.Up(), scene);
  ambient.intensity = 0.05;
  const sun = new DirectionalLight("cluster-qa-sun", new Vector3(0, -1, 1), scene);
  sun.intensity = 0.05;
  const cluster = new ClusteredLightContainer("cluster-qa", [], scene);
  if (!cluster.isSupported) throw new Error("Clustered lighting unsupported by this backend's capabilities");
  cluster.horizontalTiles = 16;
  cluster.verticalTiles = 16;
  cluster.depthSlices = 8;
  cluster.maxRange = 40;
  const lights: PointLight[] = [];
  const grow = () => {
    // Equal depth preserves insertion order in Babylon's stable depth sort.
    // Indices 32/39 therefore exercise the second 32-bit WebGPU light batch.
    while (lights.length < 40) {
      const light = new PointLight(`cluster-qa-point-${lights.length}`, new Vector3(0, 2, -3), scene);
      light.range = 30;
      light.intensity = 0;
      cluster.addLight(light);
      lights.push(light);
    }
  };
  const first = new PointLight("cluster-qa-point-0", new Vector3(0, 2, -3), scene);
  first.range = 30;
  first.intensity = 0;
  cluster.addLight(first);
  lights.push(first);
  const clusters = [cluster];
  let secondaryLight: PointLight | undefined;
  if (multipleClusters) {
    const secondary = new ClusteredLightContainer("cluster-qa-secondary", [], scene);
    secondary.horizontalTiles = 16;
    secondary.verticalTiles = 16;
    secondary.depthSlices = 8;
    secondary.maxRange = 40;
    secondaryLight = new PointLight("cluster-qa-secondary-point", new Vector3(0, 2, -3), scene);
    secondaryLight.range = 30;
    secondaryLight.intensity = 0;
    secondary.addLight(secondaryLight);
    clusters.push(secondary);
  }

  const fixtures = ["standard", "pbr", "skinned-pbr"].map((name, index) => {
    const mesh = CreateBox(`cluster-qa-${name}`, { size: 1.4 }, scene);
    mesh.position.x = (index - 1) * 2.1;
    const material = index === 0 ? new StandardMaterial(name, scene) : new PBRMaterial(name, scene);
    if (material instanceof PBRMaterial) {
      material.albedoColor = Color3.White();
      material.metallic = 0;
      material.roughness = 1;
      material.maxSimultaneousLights = 4;
    } else {
      material.diffuseColor = Color3.White();
      material.specularColor = Color3.Black();
      material.maxSimultaneousLights = 6;
    }
    material.allowShaderHotSwapping = false;
    mesh.material = material;
    if (index === 2) {
      const skeleton = new Skeleton("cluster-qa-skeleton", "cluster-qa-skeleton", scene);
      skeleton.useTextureToStoreBoneMatrices = false;
      new Bone("root", skeleton, null, Matrix.Identity());
      const vertices = mesh.getTotalVertices();
      mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, new Float32Array(vertices * 4));
      mesh.setVerticesData(
        VertexBuffer.MatricesWeightsKind,
        Float32Array.from({ length: vertices * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)),
      );
      mesh.skeleton = skeleton;
      mesh.numBoneInfluencers = 4;
    }
    return { mesh, material };
  });
  return { camera, cluster, clusters, secondaryLight, lights, fixtures, grow };
}

/** Babylon owns this proxy. Access is confined to the QA adapter for explicit warmup. */
function clusterProxy(cluster: ClusteredLightContainer) {
  return cluster as unknown as { _proxyMesh: Mesh; _proxyMaterial: ShaderMaterial };
}

/** Compile AND read pixels; successful shader compilation alone cannot pass this case. */
export async function runClusteredLightingQA(
  scene: Scene,
  diagnostics: RendererDiagnostics,
  stopped: () => boolean,
  multipleClusters = false,
): Promise<void> {
  const engine = scene.getEngine();
  const setupValidation = beginRendererValidation(engine);
  const fixture = await diagnostics.runStage("cluster-setup", async () => {
    try {
      const result = createClusteredLightingFixture(scene, multipleClusters);
      await setupValidation();
      return result;
    } finally {
      void setupValidation().catch((error) => diagnostics.fail(error));
    }
  });
  const dark = new Map<string, number[]>();
  const phases = ["dark", "first-batch-red", "second-batch-green", "last-light-blue-frozen", "all-lights-frozen"];
  if (multipleClusters) phases[3] = "second-container-blue-frozen";
  for (const [phaseIndex, phase] of phases.entries()) {
    if (stopped()) return;
    const context = { pass: phase };
    const closeValidation = beginRendererValidation(engine);
    const pixels = new Map<string, ArrayBufferView>();
    let readbackFormat = "rgba8unorm";
    try {
      if (phaseIndex === 2) fixture.grow();
      for (const light of fixture.lights) light.intensity = 0;
      if (fixture.secondaryLight) fixture.secondaryLight.intensity = 0;
      if (phaseIndex > 0) {
        const index = phaseIndex === 1 ? 0 : phaseIndex === 2 ? 32 : 39;
        fixture.lights[index].diffuse =
          phaseIndex === 1 ? Color3.Red() : phaseIndex === 2 ? Color3.Green() : Color3.Blue();
        fixture.lights[index].intensity = 3;
      }
      if (phaseIndex === 3 && fixture.secondaryLight) {
        fixture.lights[39].intensity = 0;
        fixture.secondaryLight.diffuse = Color3.Blue();
        fixture.secondaryLight.intensity = 3;
      }
      if (phaseIndex === 4)
        for (const light of fixture.lights) {
          light.diffuse = new Color3(0.3, 0.3, 0.3);
          light.intensity = 0.25;
        }
      if (phaseIndex === 3) for (const item of fixture.fixtures) item.material.freeze();
      await diagnostics.runStage(
        "cluster-compilation",
        async () => {
          for (const cluster of fixture.clusters) {
            const proxy = clusterProxy(cluster);
            await proxy._proxyMaterial.forceCompilationAsync(proxy._proxyMesh, { useInstances: true });
          }
          for (const { material, mesh } of fixture.fixtures) await material.forceCompilationAsync(mesh);
        },
        context,
      );
      await diagnostics.runStage(
        "cluster-render",
        async () => {
          for (let frame = 0; frame < 4; frame++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 16));
            if (stopped() || diagnostics.report.status === "failed") return;
            engine.beginFrame();
            try {
              scene.render();
              if (frame === 3) {
                // Read the actual attachment format, not a browser-dependent
                // preferred-canvas-format guess. Confined to this QA adapter.
                if (engine.isWebGPU) {
                  readbackFormat = (engine as unknown as { _colorFormat: string })._colorFormat;
                }
                // Queue every read in the same task as rendering, before the
                // canvas is presented/discarded. Neither backend promises to
                // retain default-framebuffer pixels across an event-loop turn.
                const width = engine.getRenderWidth();
                const height = engine.getRenderHeight();
                if (width < 16 || height < 16) throw new Error("QA canvas is too small for pixel evidence");
                const viewport = fixture.camera.viewport.toGlobal(width, height);
                const captures = fixture.fixtures.map(({ mesh, material }) => {
                  const center = Vector3.Project(
                    mesh.getAbsolutePosition(),
                    Matrix.Identity(),
                    scene.getTransformMatrix(),
                    viewport,
                  );
                  const x = Math.max(0, Math.min(width - 16, Math.round(center.x) - 8));
                  // All faces are vertically centered, independent of origin.
                  return engine.readPixels(x, Math.floor(height / 2) - 8, 16, 16).then((bytes) => {
                    pixels.set(material.name, bytes);
                  });
                });
                await Promise.all(captures);
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
      await diagnostics.runStage("cluster-gpu-validation", closeValidation, context);
      await diagnostics.runStage(
        "cluster-pixel-evidence",
        async () => {
          for (const { material, mesh } of fixture.fixtures) {
            const captured = pixels.get(material.name);
            if (!captured) throw new Error(`${material.name}: no pixel readback`);
            const rgb = meanRGB(captured, readbackFormat);
            const effect = mesh.subMeshes[0].effect;
            if (!effect?.isReady()) throw new Error(`${material.name}: no ready draw effect`);
            const compiledClusters = (effect.defines.match(/^#define CLUSTLIGHT\d+\s*$/gm) ?? []).length;
            const compiledLights = (effect.defines.match(/^#define LIGHT\d+\s*$/gm) ?? []).length;
            diagnostics.fixture({
              material: material.name,
              phase,
              cap: material.maxSimultaneousLights,
              activeLights: mesh.lightSources.length,
              compiledLights,
              frozen: material.isFrozen,
              clusterLights: fixture.lights.length + (fixture.secondaryLight ? 1 : 0),
              compiledClusters,
              rgb,
              skinned: !!mesh.skeleton,
              readbackFormat,
            });
            if (compiledClusters !== fixture.clusters.length || compiledLights !== 2 + fixture.clusters.length)
              throw new Error(`${material.name}: expected ambient + sun + ${fixture.clusters.length} clusters`);
            if (phaseIndex === 0) dark.set(material.name, rgb);
            else {
              const channel = phaseIndex === 1 ? 0 : phaseIndex === 2 ? 1 : 2;
              if (rgb[channel] - dark.get(material.name)![channel] < 2) {
                throw new Error(`${material.name}: ${phase} did not increase the expected pixel channel`);
              }
            }
          }
        },
        context,
      );
    } finally {
      void closeValidation().catch((error) => diagnostics.fail(error));
    }
  }
}
