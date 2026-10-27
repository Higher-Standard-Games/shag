// Read-only metadata estimate. Run from the assembled root; writes JSON to stdout.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import JSZip from "jszip";

const config = JSON.parse(await fs.readFile("config/player-model-vanguard.json", "utf8"));
const pack = await fs.readFile(`public/data/${config.package}`);
const zip = await JSZip.loadAsync(pack);
const sampleRate = 30;

async function readGlbJson(file) {
  const entry = zip.file(`${config.root}${file}`);
  if (!entry) return null;
  const bytes = await entry.async("nodebuffer");
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `GLB magic: ${file}`);
  assert.equal(bytes.readUInt32LE(4), 2, `GLB version: ${file}`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `GLB length: ${file}`);
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + length <= bytes.length, `GLB chunk: ${file}`);
    if (type === 0x4e4f534a) {
      return JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString("utf8"));
    }
    offset += 8 + length;
  }
  throw new Error(`No GLB JSON chunk: ${file}`);
}

const model = await readGlbJson(config.model);
assert.ok(model?.skins?.[0]?.joints?.length, "Expected first model skin");
const skinJointCount = model.skins[0].joints.length;
const clips = [];
for (const clip of config.animations) {
  const glb = await readGlbJson(clip.file);
  const item = { name: clip.name, file: clip.file, optional: clip.optional === true, present: !!glb };
  if (!glb) {
    assert.ok(item.optional, `Missing required clip: ${clip.file}`);
  } else {
    const animation = glb.animations?.[0];
    assert.ok(animation?.samplers?.length, `Expected first clip animation: ${clip.file}`);
    let durationSeconds = 0;
    for (const sampler of animation.samplers) {
      const input = glb.accessors[sampler.input];
      assert.ok(Number.isFinite(input.min?.[0]) && Number.isFinite(input.max?.[0]), clip.file);
      durationSeconds = Math.max(durationSeconds, input.max[0] - input.min[0]);
    }
    Object.assign(item, {
      durationSeconds,
      estimatedFrames30Hz: Math.ceil(durationSeconds * sampleRate) + 1,
      sourceChannels: animation.channels.length,
    });
  }
  clips.push(item);
}

const frameSum = (items) => items.reduce((sum, clip) => sum + (clip.estimatedFrames30Hz ?? 0), 0);
const coreFrames = frameSum(clips.filter((clip) => !clip.optional));
const allFrames = frameSum(clips);
const bytesPerFrameF32 = (skinJointCount + 1) * 16 * 4;
const report = {
  date: "2026-10-27",
  package: config.package,
  packageSha256: createHash("sha256").update(pack).digest("hex"),
  skinJointCount,
  sampleRate,
  clips,
  estimate: {
    coreFrames,
    allFrames,
    bytesPerFrameF32,
    coreF32Bytes: coreFrames * bytesPerFrameF32,
    coreF16Bytes: coreFrames * bytesPerFrameF32 / 2,
    allF32Bytes: allFrames * bytesPerFrameF32,
  },
  limitation:
    "Metadata-only budget at 30 Hz, not an actual retargeted bake. Excludes atlas padding, socket data, copies and compressed-download size; raw source durations may differ from a final clip policy.",
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
