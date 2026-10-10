import test from 'node:test';
import assert from 'node:assert/strict';
import { installOutlineProbe } from '../outline-probe.mjs';

function fixture() {
  const callbacks = new Set();
  const engine = { frameId: 1, color: true, scenes: [],
    getColorWrite() { return this.color; },
    onBeginFrameObservable: { add(fn) { callbacks.add(fn); return fn; }, remove(fn) { callbacks.delete(fn); } },
    drawElementsType(...args) { assert.equal(this, engine); return args[2]; },
    drawArraysType(...args) { assert.equal(this, engine); return args[2]; } };
  const scene = { getEngine: () => engine, activeCamera: { name: 'main' }, meshes: [] };
  class Mesh {
    name = 'player_1/body'; uniqueId = 1; skeleton = {};
    getScene() { return scene; }
    getTotalVertices() { return 12; }
    _draw(sub, mode, instances) { return engine.drawElementsType(mode, 0, 36, instances); }
  }
  const mesh = new Mesh(); scene.meshes.push(mesh); engine.scenes.push(scene);
  const sub = { getRenderingMesh: () => mesh, getMaterial: () => ({ needAlphaBlendingForMesh: () => false }) };
  class OutlineRenderer {
    scene = scene;
    ready = true;
    render(...args) { if (!this.ready) return 'not-ready'; return mesh._draw(args[0], 0, args[1]); }
  }
  return { engine, scene, mesh, sub, Mesh, OutlineRenderer, renderer: new OutlineRenderer(), callbacks };
}

test('counts body/outline colour/depth/stencil/overlay submissions, not unready calls, and restores methods', () => {
  const f = fixture(), drawDescriptor = Object.getOwnPropertyDescriptor(f.engine, 'drawElementsType');
  const originalRender = f.OutlineRenderer.prototype.render, originalDraw = f.Mesh.prototype._draw;
  const probe = installOutlineProbe(f.engine, f.OutlineRenderer, () => ({ progress: 'measure', phase: 'crowd', seconds: 2 }));
  assert.equal(f.mesh._draw(f.sub, 0, 2), 36);
  assert.equal(f.renderer.render(f.sub, 1), 36);
  f.engine.color = false;
  f.renderer.render(f.sub, 1);
  f.renderer.render(f.sub, 1, true);
  f.engine.color = true;
  f.renderer.render(f.sub, 1, true);
  f.renderer.ready = false;
  assert.equal(f.renderer.render(f.sub, 1), 'not-ready');
  const result = probe.snapshot(), frame = result.frames[0];
  assert.equal(frame.totalDraws, 5); assert.equal(frame.bodyDraws, 1);
  assert.equal(frame.outlineDraws, 4); assert.equal(frame.outlineCalls, 5);
  for (const kind of ['body-color', 'outline-color', 'outline-depth', 'stencil', 'overlay'])
    assert.equal(frame.passes[`player-body:${kind}:main`].draws, 1);
  assert.equal(frame.passes['player-body:body-color:main'].elements, 72);
  assert.equal(result.meshDrawHookInstalled, true);
  probe.restore();
  assert.equal(f.OutlineRenderer.prototype.render, originalRender);
  assert.equal(f.Mesh.prototype._draw, originalDraw);
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.engine, 'drawElementsType'), drawDescriptor);
  assert.equal(f.callbacks.size, 0);
});

test('preserves draw errors, isolates another engine, tolerates context failure and reports bounded drops', () => {
  const f = fixture(), error = new Error('draw failed');
  f.engine.drawElementsType = () => { throw error; };
  const probe = installOutlineProbe(f.engine, f.OutlineRenderer, () => { throw new Error('context'); }, 1);
  assert.throws(() => f.renderer.render(f.sub, 1), value => value === error);
  assert.equal(probe.snapshot().frames[0].totalDraws, 0);
  f.renderer.ready = false; f.engine.frameId++;
  f.renderer.render(f.sub, 1);
  assert.equal(probe.snapshot().dropped, 1);
  const other = Object.create(f.OutlineRenderer.prototype);
  other.scene = { getEngine: () => ({}) }; other.ready = false;
  assert.equal(other.render(f.sub, 1), 'not-ready');
  assert.equal(probe.snapshot().frames.length, 1);
  probe.restore();
});
