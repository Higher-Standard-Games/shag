import jpeg from "jpeg-js";
import { PNG } from "pngjs";

/** Build a small opaque lobby preview; the packaged PNG remains the original. */
export function levelshotPreview(source: Buffer): Uint8Array {
  if (source.length < 24 || source.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error("Invalid levelshot PNG");
  const sourceWidth = source.readUInt32BE(16);
  const sourceHeight = source.readUInt32BE(20);
  if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > 32_000_000)
    throw new Error("Levelshot dimensions exceed preview limits");
  const image = PNG.sync.read(source);
  const scale = Math.min(1, 960 / image.width, 540 / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, ((y + 0.5) * image.height) / height - 0.5);
    const y0 = Math.floor(sy),
      y1 = Math.min(y0 + 1, image.height - 1),
      fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, ((x + 0.5) * image.width) / width - 0.5);
      const x0 = Math.floor(sx),
        x1 = Math.min(x0 + 1, image.width - 1),
        fx = sx - x0;
      const out = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top =
          image.data[(y0 * image.width + x0) * 4 + c] * (1 - fx) + image.data[(y0 * image.width + x1) * 4 + c] * fx;
        const bottom =
          image.data[(y1 * image.width + x0) * 4 + c] * (1 - fx) + image.data[(y1 * image.width + x1) * 4 + c] * fx;
        data[out + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
      data[out + 3] = 255;
    }
  }
  return Uint8Array.from(jpeg.encode({ width, height, data }, 85).data);
}
