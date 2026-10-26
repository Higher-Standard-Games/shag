import { ActionManager } from "@babylonjs/core/Actions/actionManager";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import type { BspFile } from "../../loader/bsp/BspLoader";
import { PVSCuller } from "../../loader/bsp/PVSCuller";
import { getSinglePvsCamera, installPvsMeshCandidates } from "../PvsMeshCandidates";
import { createRenderingEngine, type RenderingBackend } from "../RenderingEngineFactory";
import { installWeaponCameraCandidates } from "../WeaponCameraCandidates";

/** Isolated synthetic view/culling comparison; not a gameplay entry point. */
export async function runPvsCandidatesFixture(backend: RenderingBackend) {
  document.body.innerHTML = '<canvas width="256" height="256"></canvas>';
  const result = await createRenderingEngine(document.querySelector("canvas")!, backend);
  const engine = result.engine;
  if (result.backend !== backend) {
    engine.dispose();
    throw new Error(`Backend fallback: ${result.backend}`);
  }
  const scene = new Scene(engine);
  const eye = new FreeCamera("eye", new Vector3(2, 0, -3), scene);
  eye.setTarget(new Vector3(0, 0, 5));
  eye.layerMask = 1;
  const weapon = new FreeCamera("weapon", eye.position.clone(), scene);
  weapon.setTarget(new Vector3(0, 0, 5));
  weapon.layerMask = 0x10000000;
  const reflection = new FreeCamera("reflection", eye.position.clone(), scene);
  reflection.setTarget(new Vector3(0, 0, 5));
  reflection.layerMask = 1;
  scene.activeCameras = [eye, weapon];
  scene.activeCamera = eye;
  const box = (name: string, x: number, layer: number, color: Color3) => {
    const mesh = CreateBox(name, { size: 1.5 }, scene);
    mesh.position.set(x, 0, 5);
    mesh.layerMask = layer;
    const material = new StandardMaterial(name, scene);
    material.disableLighting = true;
    material.emissiveColor = color;
    mesh.material = material;
    return mesh;
  };
  const visible = box("visible", 2, 1, new Color3(0.8, 0.15, 0.1));
  const hidden = box("hidden", -2, 1, new Color3(0.1, 0.2, 0.8));
  box("gun", 0, weapon.layerMask, new Color3(0.1, 0.8, 0.2));
  const culler = new PVSCuller({
    planes: [{ normal: [1, 0, 0], dist: 0 }],
    nodes: [{ planeIndex: 0, children: [-1, -2] }],
    leafs: [{ cluster: 0 }, { cluster: 1 }],
    visData: { numClusters: 2, bytesPerCluster: 1, bitVectors: new Uint8Array([1, 2]) },
  } as BspFile);
  culler.registerClusterMeshes([
    { cluster: 0, meshes: [visible] },
    { cluster: 1, meshes: [hidden] },
  ]);
  culler.update(eye.position);
  let enabled = false;
  const releasePvs = installPvsMeshCandidates(
    scene,
    culler,
    () => eye,
    () => enabled,
  );
  const releaseWeapon = installWeaponCameraCandidates(scene, weapon, () => true);
  const provider = scene.getActiveMeshCandidates;
  let candidateCounts: Record<string, number> = {};
  let readyCalls = 0;
  const ready = hidden.isReady;
  hidden.isReady = function (...args) {
    readyCalls++;
    return ready.apply(this, args);
  };
  scene.getActiveMeshCandidates = () => {
    const list = provider.call(scene);
    candidateCounts[scene.activeCamera!.name] = list.length;
    return list;
  };
  const active: Record<string, string[]> = {};
  const observer = scene.onAfterCameraRenderObservable.add((camera) => {
    const list = scene.getActiveMeshes();
    active[camera.name] = list.data.slice(0, list.length).map((mesh) => mesh.name);
  });
  const frame = async (on: boolean) => {
    enabled = on;
    await scene.whenReadyAsync();
    candidateCounts = {};
    readyCalls = 0;
    for (const key of Object.keys(active)) delete active[key];
    scene.render();
    const read = await engine.readPixels(0, 0, 256, 256);
    const bytes = new Uint8Array(read.byteLength);
    bytes.set(new Uint8Array(read.buffer, read.byteOffset, read.byteLength));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    let signal = 0;
    for (let i = 0; i < bytes.length; i += 4)
      if (bytes[i] !== bytes[0] || bytes[i + 1] !== bytes[1] || bytes[i + 2] !== bytes[2]) signal++;
    return {
      hash: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
      active: structuredClone(active),
      candidates: { ...candidateCounts },
      readyCalls,
      indices: scene.getActiveIndices(),
      signal,
    };
  };
  type Capture = Awaited<ReturnType<typeof frame>>;
  const cases: { label: string; before: Capture; after: Capture; passed: boolean }[] = [];
  const pair = async (label: string) => {
    const before = await frame(false),
      after = await frame(true);
    cases.push({
      label,
      before,
      after,
      passed:
        before.hash === after.hash &&
        JSON.stringify(before.active) === JSON.stringify(after.active) &&
        before.indices === after.indices,
    });
  };
  try {
    await scene.whenReadyAsync();
    scene.render();
    await pair("world-and-weapon");
    scene.activeCameras = null;
    scene.activeCamera = eye;
    await pair("primary-only");
    scene.activeCamera = reflection;
    await pair("foreign-single-view");
    scene.activeCameras = [eye, reflection, weapon];
    culler.update(null);
    await pair("multiple-primary-views");
    scene.activeCameras = [eye, weapon];
    culler.update(eye.position);
    hidden.actionManager = new ActionManager(scene);
    await pair("action-mesh");
    hidden.actionManager.dispose();
    hidden.actionManager = null;
    const selector = scene.customLODSelector;
    scene.customLODSelector = (mesh) => mesh;
    await pair("custom-lod");
    scene.customLODSelector = selector;
    const late = box("late", 0, 1, new Color3(0.8, 0.8, 0.2));
    await pair("late-mesh");
    late.dispose();
    culler.update(new Vector3(-2, 0, 0));
    await pair("cluster-transition");
    culler.setEnabled(false);
    await pair("pvs-disabled");
    culler.setEnabled(true);
    culler.update(null);
    hidden.isVisible = false;
    await pair("unknown-cluster");
    const first = cases.find((item) => item.label === "world-and-weapon")!;
    const single = cases.find((item) => item.label === "primary-only")!;
    return {
      backend,
      cases,
      passed:
        cases.every((item) => item.passed && item.before.signal > 0 && item.after.signal > 0) &&
        first.before.candidates.eye - first.after.candidates.eye === 1 &&
        single.before.readyCalls === 1 &&
        single.after.readyCalls === 0,
    };
  } finally {
    hidden.isReady = ready;
    scene.getActiveMeshCandidates = provider;
    scene.onAfterCameraRenderObservable.remove(observer);
    releasePvs();
    releaseWeapon();
    culler.dispose();
    scene.dispose();
    engine.dispose();
  }
}

/** Temporary live-scene counters; the driver owns the PVS view and lease. */
export function createLivePvsProbe(scene: Scene, culler: PVSCuller) {
  let enabled = false;
  let view = getSinglePvsCamera(scene);
  const viewObserver = scene.onBeforeRenderObservable.add(() => {
    view = getSinglePvsCamera(scene);
  });
  const release = installPvsMeshCandidates(
    scene,
    culler,
    () => view,
    () => enabled,
  );
  return {
    setEnabled(value: boolean) {
      enabled = value;
    },
    async capture(value: boolean, frames = 120) {
      enabled = value;
      const provider = scene.getActiveMeshCandidates;
      const counts: Record<string, { passes: number; candidates: number; hiddenWorld: number }> = {};
      let observed = 0;
      scene.getActiveMeshCandidates = () => {
        const list = provider.call(scene);
        const key = scene.activeCamera?.name ?? "none";
        counts[key] ??= { passes: 0, candidates: 0, hiddenWorld: 0 };
        const counter = counts[key];
        counter.passes++;
        counter.candidates += list.length;
        for (let i = 0; i < list.length; i++) if (culler.canSkipCandidate(list.data[i])) counter.hiddenWorld++;
        return list;
      };
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            scene.onAfterRenderObservable.remove(observer);
            reject(new Error("PVS counter window timed out"));
          }, 15000);
          const observer = scene.onAfterRenderObservable.add(() => {
            if (++observed >= frames) {
              clearTimeout(timeout);
              scene.onAfterRenderObservable.remove(observer);
              resolve();
            }
          });
        });
        return { frames: observed, counts, stats: culler.getStats(), sceneMeshes: scene.meshes.length };
      } finally {
        scene.getActiveMeshCandidates = provider;
      }
    },
    dispose() {
      release();
      scene.onBeforeRenderObservable.remove(viewObserver);
    },
  };
}
