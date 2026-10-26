import { ActionManager } from "@babylonjs/core/Actions/actionManager";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { registerPooledMeshCandidate } from "../PooledMeshCandidates";
import { createRenderingEngine, type RenderingBackend } from "../RenderingEngineFactory";

/** Isolated comparison; full scene readiness runs before the counted render. */
export async function runPooledCandidatesFixture(backend: RenderingBackend) {
  document.body.innerHTML = '<canvas width="128" height="128"></canvas>';
  const result = await createRenderingEngine(document.querySelector("canvas")!, backend);
  const engine = result.engine;
  if (result.backend !== backend) {
    engine.dispose();
    throw new Error("Backend fallback");
  }
  const scene = new Scene(engine);
  const eye = new FreeCamera("eye", new Vector3(0, 0, -6), scene);
  eye.layerMask = 1;
  const weapon = new FreeCamera("weapon", eye.position.clone(), scene);
  weapon.layerMask = 0x10000000;
  scene.activeCameras = [eye, weapon];
  scene.activeCamera = eye;
  const material = new StandardMaterial("red", scene);
  material.disableLighting = true;
  material.emissiveColor = new Color3(0.8, 0.1, 0.1);
  const pool = Array.from({ length: 8 }, (_, i) => {
    const mesh = CreateBox(`pooled-${i}`, {}, scene);
    mesh.position.x = (i - 1) * 1.5;
    mesh.material = material;
    mesh.layerMask = 1;
    mesh.setEnabled(i === 0);
    return mesh;
  });
  const gun = CreateBox("gun", { size: 0.5 }, scene);
  gun.position.y = -1;
  gun.layerMask = weapon.layerMask;
  gun.material = material;
  const active: Record<string, string[]> = {};
  const observer = scene.onAfterCameraRenderObservable.add((camera) => {
    const list = scene.getActiveMeshes();
    active[camera.name] = list.data.slice(0, list.length).map((mesh) => mesh.name);
  });
  let readyCalls = 0;
  const originalReady = pool.map((mesh) => mesh.isReady);
  for (let i = 1; i < pool.length; i++)
    pool[i].isReady = function (...args) {
      readyCalls++;
      return originalReady[i].apply(this, args);
    };
  let releases: (() => void)[] = [];
  const frame = async (enabled: boolean) => {
    for (const release of releases) release();
    releases = [];
    if (enabled) releases = pool.map(registerPooledMeshCandidate);
    await scene.whenReadyAsync();
    readyCalls = 0;
    for (const key of Object.keys(active)) delete active[key];
    scene.render();
    const read = await engine.readPixels(0, 0, 128, 128);
    const bytes = new Uint8Array(read.byteLength);
    bytes.set(new Uint8Array(read.buffer, read.byteOffset, read.byteLength));
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    let signal = 0;
    for (let i = 0; i < bytes.byteLength; i += 4)
      if (bytes[i] !== bytes[0] || bytes[i + 1] !== bytes[1] || bytes[i + 2] !== bytes[2]) signal++;
    return { hash, signal, active: structuredClone(active), indices: scene.getActiveIndices(), readyCalls };
  };
  const cases: {
    label: string;
    before: Awaited<ReturnType<typeof frame>>;
    after: Awaited<ReturnType<typeof frame>>;
    passed: boolean;
  }[] = [];
  const pair = async (label: string) => {
    const before = await frame(false),
      after = await frame(true);
    cases.push({
      label,
      before,
      after,
      passed:
        before.hash === after.hash &&
        before.indices === after.indices &&
        JSON.stringify(before.active) === JSON.stringify(after.active) &&
        before.signal > 0 &&
        after.signal > 0,
    });
  };
  try {
    await scene.whenReadyAsync();
    scene.render();
    await pair("idle-pool");
    pool[1].setEnabled(true);
    await pair("external-enable");
    pool[1].setEnabled(false);
    pool[1].actionManager = new ActionManager(scene);
    await pair("action-manager");
    pool[1].actionManager.dispose();
    pool[1].actionManager = null;
    const selector = scene.customLODSelector;
    scene.customLODSelector = (mesh) => mesh;
    await pair("custom-lod");
    scene.customLODSelector = selector;
    return {
      backend,
      cases,
      passed:
        cases.every((c) => c.passed) &&
        cases[0].before.readyCalls === 14 &&
        cases[0].after.readyCalls === 0 &&
        cases[2].after.readyCalls === 2 &&
        cases[3].after.readyCalls === 14,
    };
  } finally {
    for (let i = 0; i < pool.length; i++) pool[i].isReady = originalReady[i];
    for (const release of releases) release();
    scene.onAfterCameraRenderObservable.remove(observer);
    scene.dispose();
    engine.dispose();
  }
}
