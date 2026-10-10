import assert from 'node:assert/strict';
import test from 'node:test';
import { installPlaybackProbe } from '../playback-probe.mjs';

function setup() {
  class Viewer {
    skippedFrames = 0; elapsedMs = 0; callbacks = 0;
    getInfo() { return { state:'playing', skippedFrames:this.skippedFrames,
      playheadTick:this.elapsedMs / 8, elapsedMs:this.elapsedMs, currentFrame:this.callbacks }; }
    update(delta, callback) {
      this.elapsedMs += delta; this.skippedFrames += delta > 250 ? 2 : 0; this.callbacks++;
      if (callback) return callback();
      return 42;
    }
  }
  return {Viewer,viewer:new Viewer()};
}
test('preserves delivery, arguments, callbacks and descriptors while recording the first skipped transition', () => {
  const {Viewer,viewer} = setup(), descriptor = Object.getOwnPropertyDescriptor(Viewer.prototype,'update');
  const probe = installPlaybackProbe(Viewer, () => ({progress:'measure',seconds:-4}));
  try {
    assert.equal(viewer.update(10),42);
    let calls = 0;
    assert.equal(viewer.update(400,()=>{calls++;return 17;}),17);
    assert.equal(calls,1); assert.equal(viewer.elapsedMs,410); assert.equal(viewer.callbacks,2);
    assert.equal(viewer.skippedFrames,2);
    const [first,event] = probe.snapshot().events;
    assert.equal(first.firstUpdate,true); assert.equal(first.inputDeltaMs,10);
    assert.equal(event.skipped,2); assert.equal(event.before.skippedFrames,0);
    assert.equal(event.after.skippedFrames,2); assert.equal(event.inputDeltaMs,400);
    assert.equal(event.previousUpdate.inputDeltaMs,10); assert.equal(event.context.seconds,-4);
    assert.match(event.stack,/Playback skipped frames/);
  } finally {probe.restore();}
  assert.deepEqual(Object.getOwnPropertyDescriptor(Viewer.prototype,'update'),descriptor);
});
test('retains original failures, caps records and handles diagnostic context failure', () => {
  const {Viewer,viewer} = setup(), probe=installPlaybackProbe(Viewer,()=>{throw Error('context');},1);
  try {
    const error = new Error('original');
    assert.throws(()=>viewer.update(1,()=>{throw error;}),value=>value===error);
    viewer.update(400);
    assert.equal(viewer.skippedFrames,2);
    const snapshot=probe.snapshot();
    assert.equal(snapshot.events.length,1); assert.equal(snapshot.dropped,1);
    assert.equal(snapshot.events[0].failed,true); assert.equal(snapshot.events[0].context,null);
  } finally {probe.restore();}
});
