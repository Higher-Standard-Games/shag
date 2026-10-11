import test from 'node:test';
import assert from 'node:assert/strict';
import { readEngineGraphics } from '../graphics-probe.mjs';

test('uses each backend public adapter API and preserves the receiver', () => {
  for (const webgpu of [false, true]) {
    const expected = { vendor: webgpu ? 'nvidia' : 'Google Inc. (NVIDIA)', renderer: 'adapter', version: 'driver' };
    const engine = { isWebGPU: webgpu };
    engine[webgpu ? 'getInfo' : 'getGlInfo'] = function () { assert.equal(this, engine); return expected; };
    engine[webgpu ? 'getGlInfo' : 'getInfo'] = () => { throw Error('Wrong backend API'); };
    assert.equal(readEngineGraphics(engine), expected);
  }
});

test('retains unavailable adapter descriptions without substituting another adapter', () => {
  assert.equal(readEngineGraphics({ isWebGPU: true, getGlInfo: () => ({ renderer: 'wrong' }) }), null);
  assert.equal(readEngineGraphics({}), null);
});
