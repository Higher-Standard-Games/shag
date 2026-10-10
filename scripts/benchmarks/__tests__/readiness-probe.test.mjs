import assert from 'node:assert/strict';
import test from 'node:test';
import { installReadinessProbe } from '../readiness-probe.mjs';

function setup() {
  class Scene {
    constructor() { this.meshes = []; this.cameras = [{ name: 'world' }]; this.pending = [];
      this.onReadyObservable = { observers: [] }; this.onReadyTimeoutDuration = 120000; }
    getWaitingItemsCount() { return this.pending.length; }
    isReady() { return !this.pending.length; }
    executeWhenReady(callback, check) { this.lastCheck = check;
      if (this.isReady()) return callback(); this.onReadyObservable.observers.push(callback); return 7; }
    addPendingData(data) { this.pending.push(data); return 11; }
    removePendingData(data) { const index = this.pending.indexOf(data); if (index >= 0) this.pending.splice(index, 1); return 12; }
  }
  const scene = new Scene(), other = new Scene();
  return { Scene, scene, other, engine: { scenes: [scene, other] } };
}

test('preserves callbacks, arguments, return values and prototype descriptors across scenes', () => {
  const s = setup(), before = Object.getOwnPropertyDescriptor(s.Scene.prototype, 'isReady');
  const probe = installReadinessProbe(s.engine, () => 'measure 1/1');
  const token = { name: 'texture' }, callback = () => 42;
  try {
    assert.equal(s.scene.addPendingData(token), 11);
    assert.equal(s.scene.executeWhenReady(callback, true), 7);
    assert.equal(s.scene.onReadyObservable.observers[0], callback);
    assert.equal(s.scene.lastCheck, true);
    assert.equal(s.other.executeWhenReady(callback, false), 42);
    const snapshot = probe.snapshot();
    assert.equal(snapshot.registrations.length, 2);
    assert.notEqual(snapshot.registrations[0].scene, snapshot.registrations[1].scene);
    assert.deepEqual(snapshot.checks.map(check => check.ready), [false, true]);
    assert.match(snapshot.registrations[0].stack, /readiness-probe.test.mjs/);
    assert.equal(snapshot.activePending[0].name, 'texture');
    assert.equal(s.scene.removePendingData(token), 12);
    assert.equal(probe.snapshot().activePending.length, 0);
  } finally { probe.restore(); }
  assert.deepEqual(Object.getOwnPropertyDescriptor(s.Scene.prototype, 'isReady'), before);
});

test('bounds diagnostics and does not initiate scene-readiness checks', () => {
  const s = setup(), probe = installReadinessProbe(s.engine, () => { throw new Error('No progress'); }, 1);
  try {
    assert.equal(probe.snapshot().checks.length, 0);
    s.scene.isReady(); s.scene.isReady();
    assert.equal(probe.snapshot().checks.length, 1);
    assert.equal(probe.snapshot().checks[0].progress, 'unavailable');
    assert.equal(probe.snapshot().dropped, 1);
    assert.equal(probe.snapshot().droppedByKind.checks, 1);
    assert.equal(probe.snapshot().droppedByKind.pendingEvents, 0);
  } finally { probe.restore(); }
});
