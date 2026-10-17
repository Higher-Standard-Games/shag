/** Picmip operates before upload, leaving full-quality cache entries independent. */
export function reducedTextureSize(width: number, height: number, level: number): { width: number; height: number } {
  const mip = Math.max(0, Math.min(8, Math.round(level)));
  return {
    width: mip === 8 ? 1 : Math.max(1, Math.floor(width / 2 ** mip)),
    height: mip === 8 ? 1 : Math.max(1, Math.floor(height / 2 ** mip)),
  };
}

/** Area-average every source pixel, including rectangular and odd-sized images. */
export function reduceTexturePixels(pixels: Uint8Array, width: number, height: number, level: number) {
  const size = reducedTextureSize(width, height, level);
  if (size.width === width && size.height === height) return { pixels, ...size };
  const output = new Uint8Array(size.width * size.height * 4);
  for (let y = 0; y < size.height; y++) {
    const y0 = Math.floor((y * height) / size.height),
      y1 = Math.floor(((y + 1) * height) / size.height);
    for (let x = 0; x < size.width; x++) {
      const x0 = Math.floor((x * width) / size.width),
        x1 = Math.floor(((x + 1) * width) / size.width);
      const sums = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const source = (sy * width + sx) * 4;
          for (let c = 0; c < 4; c++) sums[c] += pixels[source + c];
        }
      const count = (x1 - x0) * (y1 - y0);
      for (let c = 0; c < 4; c++) output[(y * size.width + x) * 4 + c] = Math.round(sums[c] / count);
    }
  }
  return { pixels: output, ...size };
}
