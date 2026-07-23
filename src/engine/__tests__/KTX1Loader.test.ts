import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { describe, expect, it, vi } from "vitest";
import { createTextureFromKTX1, GL_FORMATS, type KTX1ParseResult } from "../loader/texture/KTX1Loader";

function rawKTX(baseFormat: number, data: number[], width = 1): KTX1ParseResult {
  return {
    header: {
      glType: 0x1401,
      glTypeSize: 1,
      glFormat: baseFormat,
      glInternalFormat: baseFormat,
      glBaseInternalFormat: baseFormat,
      pixelWidth: width,
      pixelHeight: 1,
      pixelDepth: 0,
      numberOfArrayElements: 0,
      numberOfFaces: 1,
      numberOfMipmapLevels: 1,
      bytesOfKeyValueData: 0,
    },
    mipLevels: [{ width, height: 1, data: new Uint8Array(data) }],
    isCompressed: false,
    formatName: "test raw",
  };
}

describe("KTX1Loader uncompressed uploads", () => {
  it.each([
    {
      name: "alpha",
      format: GL_FORMATS.ALPHA,
      source: [0, 128, 255],
      expected: [255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 255],
    },
    {
      name: "luminance",
      format: GL_FORMATS.LUMINANCE,
      source: [37],
      expected: [37, 37, 37, 255],
    },
    {
      name: "luminance alpha",
      format: GL_FORMATS.LUMINANCE_ALPHA,
      source: [37, 91],
      expected: [37, 37, 37, 91],
    },
    {
      name: "RGB",
      format: GL_FORMATS.RGB,
      source: [1, 2, 3],
      expected: [1, 2, 3, 255],
    },
    {
      name: "RGBA",
      format: GL_FORMATS.RGBA,
      source: [1, 2, 3, 4],
      expected: [1, 2, 3, 4],
    },
  ])("expands $name pixels to a WebGPU-compatible RGBA upload", ({ format, source, expected }) => {
    const engine = new NullEngine();
    const createRawTexture = vi.spyOn(engine, "createRawTexture");

    const texture = createTextureFromKTX1(engine, rawKTX(format, source, expected.length / 4), "test.ktx");

    expect(texture).not.toBeNull();
    expect(createRawTexture).toHaveBeenCalledOnce();
    expect(createRawTexture.mock.calls[0][0]).toEqual(new Uint8Array(expected));

    texture?.dispose();
    engine.dispose();
  });
});
