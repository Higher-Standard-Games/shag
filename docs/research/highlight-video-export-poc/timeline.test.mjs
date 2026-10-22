import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timestamps, sourceAt, outputAt } from './timeline.mjs';

test('60 FPS timestamps end exactly at 60 seconds without cumulative rounding', () => {
  const times = timestamps(3600, 60);
  assert.equal(times[0], 0);
  assert.equal(times.at(-1), 60e6);
  assert.ok(times.slice(1).every((v, i) => [16666, 16667].includes(v - times[i])));
});
test('source/output mapping handles a slow interval and a linear speed ramp', () => {
  const segments = [
    { start: 0, end: 2, from: 1, to: 1 },
    { start: 2, end: 4, from: 0.5, to: 0.5 },
    { start: 4, end: 6, from: 0.5, to: 1.5 },
  ];
  assert.equal(sourceAt(4, segments), 3);
  assert.equal(sourceAt(6, segments), 5);
  for (const t of [0, 1, 2, 2.5, 3.9, 4, 5.5, 6]) {
    assert.ok(Math.abs(outputAt(sourceAt(t, segments), segments) - t) < 1e-9);
  }
  assert.throws(() => outputAt(6, segments));
});
