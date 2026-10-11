import test from 'node:test';
import assert from 'node:assert/strict';
import { installCameraProbe } from '../camera-probe.mjs';

function fixture() {
  const meshes = [{ layerMask: 1 }, { layerMask: 2 }, { layerMask: 1, actionManager: {} }];
  const candidates = { data: meshes, length: meshes.length };
  const engine = { frameId: 1 };
  const proto = { _evaluateActiveMeshes(arg) {
    assert.equal(arg, 'preserved');
    assert.equal(this.getActiveMeshCandidates(), candidates);
    return 'result';
  } };
  const scene = Object.assign(Object.create(proto), {
    activeCamera: { name: 'weapon', uniqueId: 7, layerMask: 2 },
    getEngine: () => engine, getActiveMeshes: () => ({ length: 1 }),
    getActiveMeshCandidates() { assert.equal(this, scene); return candidates; },
  });
  return { scene, proto, engine };
}

test('records camera evaluation and returned candidate counts while preserving descriptors and results', () => {
  const f = fixture(), provider = Object.getOwnPropertyDescriptor(f.scene, 'getActiveMeshCandidates');
  const probe = installCameraProbe(f.scene, () => ({ progress: 'measure', phase: 'gunplay' }));
  assert.equal(f.scene._evaluateActiveMeshes('preserved'), 'result');
  const row = probe.snapshot().records[0];
  assert.equal(row.camera, 'weapon'); assert.equal(row.phase, 'gunplay');
  assert.equal(row.candidates, 3); assert.equal(row.matchingLayer, 1);
  assert.equal(row.actionCandidates, 1); assert.equal(row.activeMeshes, 1);
  assert.equal(row.candidateCalls, 1); assert.ok(row.cpuMs >= 0);
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.scene, 'getActiveMeshCandidates'), provider);
  probe.restore();
  assert.equal(Object.hasOwn(f.scene, '_evaluateActiveMeshes'), false);
  assert.equal(f.scene._evaluateActiveMeshes, f.proto._evaluateActiveMeshes);
});

test('preserves errors, bounds records and does not overwrite a provider replaced by the application', () => {
  const f = fixture(), error = new Error('evaluation failed'), next = () => ({ data: [], length: 0 });
  f.scene._evaluateActiveMeshes = function () { this.getActiveMeshCandidates = next; throw error; };
  const original = Object.getOwnPropertyDescriptor(f.scene, '_evaluateActiveMeshes');
  const probe = installCameraProbe(f.scene, () => { throw error; }, 1);
  assert.throws(() => f.scene._evaluateActiveMeshes(), value => value === error);
  assert.equal(f.scene.getActiveMeshCandidates, next);
  assert.throws(() => f.scene._evaluateActiveMeshes(), value => value === error);
  assert.equal(probe.snapshot().records.length, 1); assert.equal(probe.snapshot().dropped, 1);
  probe.restore();
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.scene, '_evaluateActiveMeshes'), original);
});
