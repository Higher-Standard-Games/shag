// Only self-contained runtime GLBs go into a package: every image and buffer
// embedded, none fetched from beside the archive.
export function validateEmbeddedGlb(bytes, name) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a)
    throw new Error(`Invalid GLB: ${name}`);
  const length = bytes.readUInt32LE(12);
  if (20 + length > bytes.length) throw new Error(`Truncated GLB JSON: ${name}`);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  for (const entry of [...(json.images ?? []), ...(json.buffers ?? [])])
    if (entry.uri && !entry.uri.startsWith('data:')) throw new Error(`External GLB resource in ${name}: ${entry.uri}`);
}
