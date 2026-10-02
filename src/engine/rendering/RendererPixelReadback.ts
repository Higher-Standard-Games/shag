/** Normalize RGBA/BGRA canvas readback into comparable RGB channel means. */
export function meanRGB(bytes: ArrayBufferView, format = "rgba8unorm"): number[] {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length % 4 !== 0) {
    throw new Error("Expected non-empty RGBA8 GPU readback");
  }
  if (!/^(rgba|bgra)8unorm(-srgb)?$/.test(format)) throw new Error(`Unsupported QA readback format: ${format}`);
  const order = format.startsWith("bgra") ? [2, 1, 0] : [0, 1, 2];
  const result = [0, 0, 0];
  for (let i = 0; i < bytes.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) result[channel] += bytes[i + order[channel]];
  }
  return result.map((value) => value / (bytes.length / 4));
}
