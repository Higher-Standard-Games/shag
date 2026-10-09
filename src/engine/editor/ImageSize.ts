/**
 * Image dimensions from file headers alone: TGA, PNG, JPEG, KTX and KTX2.
 * Texture alignment needs only the size, and reading the header avoids
 * decoding the whole image. Pure; returns null for anything it can't read.
 */
export function imageSize(bytes: Uint8Array, path = ""): [number, number] | null {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  const u16be = (o: number) => (bytes[o] << 8) | bytes[o + 1];
  const u32 = (o: number, little: boolean) =>
    little
      ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
      : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const valid = (w: number, h: number): [number, number] | null => (w > 0 && h > 0 ? [w, h] : null);

  // PNG: signature, then IHDR's width and height.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return valid(u32(16, false), u32(20, false));
  }
  // JPEG: walk the segments to the first start-of-frame.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = bytes[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return valid(u16be(o + 7), u16be(o + 5));
      o += 2 + u16be(o + 2);
    }
    return null;
  }
  // KTX 1: «KTX 11», then an endianness word; pixelWidth/Height at 36/40.
  if (bytes.length >= 44 && bytes[0] === 0xab && bytes[1] === 0x4b && bytes[5] === 0x31 && bytes[6] === 0x31) {
    const little = u32(12, true) === 0x04030201;
    return valid(u32(36, little), u32(40, little));
  }
  // KTX 2: «KTX 20»; pixelWidth/Height at 20/24, little-endian.
  if (bytes.length >= 28 && bytes[0] === 0xab && bytes[1] === 0x4b && bytes[5] === 0x32 && bytes[6] === 0x30) {
    return valid(u32(20, true), u32(24, true));
  }
  // TGA has no signature: trust the extension; width/height at 12/14, little-endian.
  if (ext === "tga" && bytes.length >= 18) {
    return valid(bytes[12] | (bytes[13] << 8), bytes[14] | (bytes[15] << 8));
  }
  return null;
}
