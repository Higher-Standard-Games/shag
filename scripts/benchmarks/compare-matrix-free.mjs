import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const reference = process.argv[2] ?? "3196debb";
if (!/^[a-f0-9]{7,40}$/.test(reference)) throw new Error("Expected a commit hash");
let pairs = 0;
for (const backend of ["webgl2", "webgpu"]) {
  const read = (stem) => JSON.parse(fs.readFileSync(`.cache/renderer-groundwork/${stem}-${reference}.json`, "utf8"));
  const before = read(`effects-${backend}-reference`);
  const after = read(`matrix-free-effects-${backend}`);
  assert.equal(before.reference, reference);
  assert.equal(after.prototype.reference, reference);
  for (const record of [before, after]) {
    assert.equal(record.result.passed, true);
    assert.equal(record.failed.length, 0);
    assert(!record.logs.some((line) => /error|EXCEPTION/.test(line)));
    assert.equal(record.result.measuredDrawCalls, 240);
    assert.equal(record.result.emptyDrawCalls, 0);
    assert.equal(record.result.reuseDrawCalls, 2);
    assert.equal(record.result.lifecycle.length, 8);
    assert.equal(record.result.capacityCounts.remote, 32);
    assert.equal(record.result.capacityCounts.chain, 24);
    assert.equal(record.result.swapCounts.remote, 31);
  }
  const a = before.result, b = after.result;
  assert.equal(a.imageHash, b.imageHash);
  pairs++;
  assert.equal(a.submittedBytes, b.submittedBytes);
  assert.equal(a.writeCalls, b.writeCalls);
  assert.equal(a.matrixCpuBytes, 3584);
  assert.equal(a.matrixGpuBytes, 7168);
  assert.equal(b.matrixCpuBytes, 0);
  assert.equal(b.matrixGpuBytes, 0);
  assert.equal(a.sceneActiveIndices, 480);
  assert.equal(b.sceneActiveIndices, 0);
  assert.equal(a.statisticsMatchControlledDraws, true);
  assert.equal(b.statisticsMatchControlledDraws, false);
  assert(b.layouts.every((layout) => !layout.matrixBuffer && layout.alwaysActive && layout.finiteBounds && layout.activeAttributes.every((name) => !/^world[0-3]$/.test(name))));
  for (let i = 0; i < a.lifecycle.length; i++) {
    assert.equal(a.lifecycle[i].label, b.lifecycle[i].label);
    assert.equal(a.lifecycle[i].hash, b.lifecycle[i].hash);
    assert.equal(b.lifecycle[i].draws, b.lifecycle[i].expectedDraws);
    pairs++;
  }
  assert.notEqual(b.lifecycle[0].hash, b.lifecycle[1].hash, "Transform must change the image");
  assert.notEqual(b.lifecycle[2].hash, b.lifecycle[3].hash, "Depth control must occlude the effect");
  assert.notEqual(b.lifecycle[4].hash, b.lifecycle[5].hash, "Swap-removal must affect the image");
  if (backend === "webgl2") assert.equal(b.restoration, "identical pixels");
}
console.log(`PASS: ${pairs} matched image pairs, resource removal, draws, depth and lifecycle. Gameplay adoption deferred: forced-draw statistics are inaccurate.`);
