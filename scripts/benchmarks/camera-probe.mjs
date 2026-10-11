/** Diagnostic only: inclusive active-mesh evaluation per camera. */
export function installCameraProbe(scene, readContext, limit = 60000) {
  const records = [];
  let dropped = 0;
  const name = '_evaluateActiveMeshes';
  const descriptor = Object.getOwnPropertyDescriptor(scene, name);
  const original = scene[name];
  if (typeof original !== 'function') throw new Error('Missing active-mesh evaluation method');
  const replacement = function (...args) {
    let context;
    try { context = readContext() ?? {}; } catch { context = {}; }
    const camera = scene.activeCamera;
    const record = { ...context, frameId: scene.getEngine().frameId, camera: camera?.name ?? null,
      cameraId: camera?.uniqueId ?? null, layerMask: camera?.layerMask ?? null,
      candidateCalls: 0, candidates: 0, matchingLayer: 0, actionCandidates: 0, activeMeshes: null, cpuMs: 0 };
    const provider = scene.getActiveMeshCandidates;
    const providerDescriptor = Object.getOwnPropertyDescriptor(scene, 'getActiveMeshCandidates');
    const observed = function (...providerArgs) {
      const value = provider.apply(this, providerArgs);
      record.candidateCalls++;
      record.candidates += value.length;
      for (let i = 0; i < value.length; i++) {
        const mesh = value.data[i];
        if (camera && (mesh.layerMask & camera.layerMask) !== 0) record.matchingLayer++;
        if (mesh.actionManager) record.actionCandidates++;
      }
      return value;
    };
    scene.getActiveMeshCandidates = observed;
    const started = performance.now();
    try { return original.apply(this, args); }
    finally {
      record.cpuMs = performance.now() - started;
      try { record.activeMeshes = scene.getActiveMeshes().length; } catch { /* Do not mask evaluation errors. */ }
      if (scene.getActiveMeshCandidates === observed) {
        if (providerDescriptor) Object.defineProperty(scene, 'getActiveMeshCandidates', providerDescriptor);
        else delete scene.getActiveMeshCandidates;
      }
      if (records.length < limit) records.push(record); else dropped++;
    }
  };
  Object.defineProperty(scene, name, { configurable: true, writable: true, ...descriptor, value: replacement });
  return {
    snapshot: () => ({ records, dropped, limit,
      scope: 'Inclusive Scene._evaluateActiveMeshes CPU and candidate-provider output, per active camera.',
      limitations: ['CPU clocks, provider counting, allocations and wrappers add overhead; use timing-only runs for FPS comparisons.',
        'Matching-layer count includes disabled/unready/culled meshes; active count does not prove pixel visibility.',
        'Only the owned scene is wrapped; provider changes inside evaluation may bypass candidate observation.'] }),
    restore() {
      if (scene[name] !== replacement) return;
      if (descriptor) Object.defineProperty(scene, name, descriptor); else delete scene[name];
    },
  };
}
