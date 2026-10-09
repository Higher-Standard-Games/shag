import assert from 'node:assert/strict';
import test from 'node:test';
import { sliceCpuProfile, summarizeCpuProfile } from '../cpu-profile.mjs';

const frame = name => ({ functionName: name, url: 'http://localhost/src/example.ts', lineNumber: 0, columnNumber: 0 });
const profile = () => ({
  startTime: 10000, endTime: 20000,
  nodes: [
    { id: 1, callFrame: frame('(root)'), children: [2] },
    { id: 2, callFrame: frame('render'), children: [3] },
    { id: 3, callFrame: frame('render'), children: [4] },
    { id: 4, callFrame: frame('draw') },
  ],
  samples: [4, 3], timeDeltas: [6000, 2000],
});

test('weights self time and deduplicates recursive inclusive attribution', () => {
  const result = summarizeCpuProfile(profile(), 2);
  assert.equal(result.durationMs, 10);
  assert.equal(result.sampledMs, 8);
  assert.equal(result.unsampledMs, 2);
  const render = result.bySelf.find(x => x.functionName === 'render');
  assert.equal(render.selfMs, 2);
  assert.equal(render.inclusiveMs, 8);
  assert.equal(render.inclusiveMsPerFrame, 4);
  assert.equal(result.bySelf[0].functionName, 'draw');
  assert.equal(result.bySelf[0].selfPercent, 75);
});
test('does not invent per-frame costs without observed frames', () => {
  assert.equal(summarizeCpuProfile(profile()).bySelf[0].selfMsPerFrame, null);
});
test('rejects corrupt sample references, durations and ancestry', () => {
  const unknown = profile(); unknown.samples[0] = 9;
  assert.throws(() => summarizeCpuProfile(unknown), /unknown node/);
  const negative = profile(); negative.timeDeltas[0] = -1;
  assert.throws(() => summarizeCpuProfile(negative), /outside capture/);
  const overflow = profile(); overflow.timeDeltas[0] = 30000;
  assert.throws(() => summarizeCpuProfile(overflow), /outside capture/);
  const cycle = profile(); cycle.nodes[3].children = [1];
  assert.throws(() => summarizeCpuProfile(cycle), /Cycle/);
});
test('sorts actual sample timestamps rather than treating a negative delta as negative work', () => {
  const p = profile(); p.samples = [4, 3, 4]; p.timeDeltas = [6000, -1000, 2000];
  const result = summarizeCpuProfile(p);
  assert.equal(result.reorderedSamples, true);
  assert.equal(result.sampledMs, 7);
  assert.equal(result.bySelf.find(x => x.functionName === 'render').selfMs, 5);
  assert.equal(result.bySelf.find(x => x.functionName === 'draw').selfMs, 2);
});
test('phase slices retain valid tree links and recompute hit counts without whole-tour line ticks', () => {
  const p = profile(); p.nodes[3].hitCount = 99; p.nodes[3].positionTicks = [{ line: 1, ticks: 99 }];
  const slice = sliceCpuProfile(p, 15000, 17000);
  assert.deepEqual(slice.samples, [4]);
  assert.deepEqual(slice.timeDeltas, [1000]);
  assert.equal(slice.nodes[3].hitCount, 1);
  assert.equal(slice.nodes[3].positionTicks, undefined);
  assert.equal(summarizeCpuProfile(slice).sampledMs, 1);
  assert.equal(p.nodes[3].hitCount, 99);
  assert.throws(() => sliceCpuProfile(p, 17000, 16000), /Invalid/);
});
test('attributes only clipped slow-frame windows, without charging the gaps to a sample', () => {
  const windows = [{ start: 12000, end: 14000 }, { start: 17000, end: 17500 }];
  const result = summarizeCpuProfile(profile(), 2, windows);
  assert.equal(result.durationMs, 2.5);
  assert.equal(result.sampledMs, 2.5);
  assert.equal(result.bySelf.find(x => x.functionName === 'draw').selfMs, 2);
  assert.equal(result.bySelf.find(x => x.functionName === 'render').selfMs, 0.5);
  assert.throws(() => summarizeCpuProfile(profile(), 2, [{ start: 12000, end: 16000 }, { start: 14000, end: 18000 }]), /Invalid CPU windows/);
});
