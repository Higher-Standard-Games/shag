/**
 * TGA Texture Decoder
 *
 * Decodes TGA (Targa) format textures and converts them to data URLs
 * for browser compatibility. TGA is commonly used in Quake-era games.
 */

/**
 * Decode a TGA file buffer and return a data URL
 */
export async function decodeTGA(buffer: ArrayBuffer): Promise<string> {
  const { width, height, pixels } = decodeTGAPixels(buffer);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Decode a TGA file buffer to top-down RGBA pixels, without the DOM. Callers
 * that only need pixels (e.g. thumbnails via createImageBitmap) skip the PNG
 * re-encode that decodeTGA does.
 */
export function decodeTGAPixels(buffer: ArrayBuffer): {
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
} {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // TGA Header (18 bytes)
  const idLength = data[0];
  const colorMapType = data[1];
  const imageType = data[2];
  // Color map spec (5 bytes: 3-7)
  // colorMapOrigin, xOrigin, yOrigin are in spec but unused
  const colorMapLength = view.getUint16(5, true);
  const colorMapDepth = data[7];
  // Image spec (10 bytes: 8-17)
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const bitsPerPixel = data[16];
  const descriptor = data[17];

  // Support: uncompressed true-color (2), uncompressed grayscale (3), RLE true-color (10), RLE grayscale (11)
  if (imageType !== 2 && imageType !== 3 && imageType !== 10 && imageType !== 11) {
    throw new Error(`Unsupported TGA image type: ${imageType}`);
  }

  const isGrayscale = imageType === 3 || imageType === 11;
  const bytesPerPixel = bitsPerPixel / 8;

  if (isGrayscale) {
    if (bytesPerPixel !== 1 && bytesPerPixel !== 2) {
      throw new Error(`Unsupported TGA grayscale bit depth: ${bitsPerPixel}`);
    }
  } else if (bytesPerPixel !== 3 && bytesPerPixel !== 4) {
    throw new Error(`Unsupported TGA bit depth: ${bitsPerPixel}`);
  }

  // Calculate data offset
  let offset = 18 + idLength;
  if (colorMapType !== 0) {
    offset += colorMapLength * (colorMapDepth / 8);
  }

  const pixels = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));

  // Decode pixels
  if (isGrayscale && imageType === 3) {
    decodeGrayscaleUncompressed(data, offset, pixels, width, height, bytesPerPixel, descriptor);
  } else if (isGrayscale && imageType === 11) {
    decodeGrayscaleRLE(data, offset, pixels, width, height, bytesPerPixel, descriptor);
  } else if (imageType === 2) {
    decodeUncompressed(data, offset, pixels, width, height, bytesPerPixel, descriptor);
  } else if (imageType === 10) {
    decodeRLE(data, offset, pixels, width, height, bytesPerPixel, descriptor);
  }

  return { width, height, pixels };
}

function decodeGrayscaleUncompressed(
  data: Uint8Array,
  offset: number,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  bytesPerPixel: number,
  descriptor: number,
): void {
  const flipVertical = (descriptor & 0x20) === 0;

  for (let y = 0; y < height; y++) {
    const destY = flipVertical ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const srcIdx = offset + (y * width + x) * bytesPerPixel;
      const destIdx = (destY * width + x) * 4;
      const lum = data[srcIdx];
      pixels[destIdx] = lum; // R
      pixels[destIdx + 1] = lum; // G
      pixels[destIdx + 2] = lum; // B
      pixels[destIdx + 3] = bytesPerPixel === 2 ? data[srcIdx + 1] : 255; // A
    }
  }
}

function decodeGrayscaleRLE(
  data: Uint8Array,
  offset: number,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  bytesPerPixel: number,
  descriptor: number,
): void {
  const flipVertical = (descriptor & 0x20) === 0;
  const totalPixels = width * height;
  let pixelIdx = 0;
  let srcIdx = offset;

  while (pixelIdx < totalPixels) {
    const header = data[srcIdx++];
    const count = (header & 0x7f) + 1;

    if (header & 0x80) {
      // RLE packet - repeat single value
      const lum = data[srcIdx];
      const a = bytesPerPixel === 2 ? data[srcIdx + 1] : 255;
      srcIdx += bytesPerPixel;

      for (let i = 0; i < count; i++) {
        const y = Math.floor(pixelIdx / width);
        const x = pixelIdx % width;
        const destY = flipVertical ? height - 1 - y : y;
        const destIdx = (destY * width + x) * 4;

        pixels[destIdx] = lum;
        pixels[destIdx + 1] = lum;
        pixels[destIdx + 2] = lum;
        pixels[destIdx + 3] = a;
        pixelIdx++;
      }
    } else {
      // Raw packet
      for (let i = 0; i < count; i++) {
        const lum = data[srcIdx];
        const a = bytesPerPixel === 2 ? data[srcIdx + 1] : 255;
        srcIdx += bytesPerPixel;

        const y = Math.floor(pixelIdx / width);
        const x = pixelIdx % width;
        const destY = flipVertical ? height - 1 - y : y;
        const destIdx = (destY * width + x) * 4;

        pixels[destIdx] = lum;
        pixels[destIdx + 1] = lum;
        pixels[destIdx + 2] = lum;
        pixels[destIdx + 3] = a;
        pixelIdx++;
      }
    }
  }
}

function decodeUncompressed(
  data: Uint8Array,
  offset: number,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  bytesPerPixel: number,
  descriptor: number,
): void {
  const flipVertical = (descriptor & 0x20) === 0; // Bit 5: origin

  for (let y = 0; y < height; y++) {
    const destY = flipVertical ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const srcIdx = offset + (y * width + x) * bytesPerPixel;
      const destIdx = (destY * width + x) * 4;

      // TGA uses BGR(A) order
      pixels[destIdx] = data[srcIdx + 2]; // R
      pixels[destIdx + 1] = data[srcIdx + 1]; // G
      pixels[destIdx + 2] = data[srcIdx]; // B
      pixels[destIdx + 3] = bytesPerPixel === 4 ? data[srcIdx + 3] : 255; // A
    }
  }
}

function decodeRLE(
  data: Uint8Array,
  offset: number,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  bytesPerPixel: number,
  descriptor: number,
): void {
  const flipVertical = (descriptor & 0x20) === 0;
  const totalPixels = width * height;
  let pixelIdx = 0;
  let srcIdx = offset;

  while (pixelIdx < totalPixels) {
    const header = data[srcIdx++];
    const count = (header & 0x7f) + 1;

    if (header & 0x80) {
      // RLE packet - repeat single color
      const b = data[srcIdx++];
      const g = data[srcIdx++];
      const r = data[srcIdx++];
      const a = bytesPerPixel === 4 ? data[srcIdx++] : 255;

      for (let i = 0; i < count; i++) {
        const y = Math.floor(pixelIdx / width);
        const x = pixelIdx % width;
        const destY = flipVertical ? height - 1 - y : y;
        const destIdx = (destY * width + x) * 4;

        pixels[destIdx] = r;
        pixels[destIdx + 1] = g;
        pixels[destIdx + 2] = b;
        pixels[destIdx + 3] = a;
        pixelIdx++;
      }
    } else {
      // Raw packet - copy pixels directly
      for (let i = 0; i < count; i++) {
        const b = data[srcIdx++];
        const g = data[srcIdx++];
        const r = data[srcIdx++];
        const a = bytesPerPixel === 4 ? data[srcIdx++] : 255;

        const y = Math.floor(pixelIdx / width);
        const x = pixelIdx % width;
        const destY = flipVertical ? height - 1 - y : y;
        const destIdx = (destY * width + x) * 4;

        pixels[destIdx] = r;
        pixels[destIdx + 1] = g;
        pixels[destIdx + 2] = b;
        pixels[destIdx + 3] = a;
        pixelIdx++;
      }
    }
  }
}
