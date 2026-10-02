import { Constants } from "@babylonjs/core/Engines/constants";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PK3Loader } from "../../pk3/PK3Loader";
import { PK3TextureLoader } from "../../pk3/PK3TextureLoader";
import { createTextureFromKTX1, GL_FORMATS, isFormatSupported, parseKTX1 } from "../KTX1Loader";

/** Real Babylon container/loading lifecycle; only the hardware upload is stubbed. */
class UploadEngine extends NullEngine {
  uploads: Parameters<NullEngine["_uploadCompressedDataToTextureDirectly"]>[] = [];
  override _uploadCompressedDataToTextureDirectly(
    ...args: Parameters<NullEngine["_uploadCompressedDataToTextureDirectly"]>
  ): void {
    this.uploads.push(args);
  }
  override createTexture(...args: Parameters<NullEngine["createTexture"]>) {
    const [url, noMipmap, invertY, scene, sampling, onLoad, onError, buffer, fallback, format, extension, mime] = args;
    return this._createTextureBase(
      url,
      noMipmap,
      invertY,
      scene,
      sampling,
      onLoad,
      onError,
      (texture, ext, _scene, img, _invert, _noMip, _compressed, process) => {
        texture.width = texture.baseWidth = img.width;
        texture.height = texture.baseHeight = img.height;
        process(img.width, img.height, img, ext, texture, () => {});
        texture.isReady = true;
        texture.onLoadedObservable.notifyObservers(texture);
        texture.onLoadedObservable.clear();
      },
      () => false,
      buffer,
      fallback,
      format,
      extension,
      mime,
    );
  }
}

function fixture(format = GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT1_EXT, levels = 3, littleEndian = true): ArrayBuffer {
  const blockBytes =
    format === GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT5_EXT || format === GL_FORMATS.COMPRESSED_RGBA_ASTC_4x4_KHR ? 16 : 8;
  const bytes = new Uint8Array(64 + levels * (4 + blockBytes));
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  const fields = [0x04030201, 0, 1, 0, format, 0x1908, 4, 4, 0, 0, 1, levels, 0];
  fields.forEach((value, i) => {
    view.setUint32(12 + 4 * i, value, littleEndian);
  });
  for (let level = 0; level < levels; level++) {
    const offset = 64 + level * (4 + blockBytes);
    view.setUint32(offset, blockBytes, littleEndian);
    // DXT1: black/red endpoints, rows using palette indices 0, 1, 2, 3.
    // Index 3 is transparent, giving a useful orientation + alpha fixture.
    bytes.set([0, 0, 0, 0xf8, 0, 0x55, 0xaa, 0xff], offset + 4);
  }
  return bytes.buffer;
}

const engines: NullEngine[] = [];
afterEach(() => {
  PK3TextureLoader.getInstance().clearCache();
  for (const engine of engines.splice(0)) engine.dispose();
  vi.restoreAllMocks();
});
function engine(webgpu = false): UploadEngine {
  const result = new UploadEngine();
  engines.push(result);
  Object.defineProperty(result, "isWebGPU", { value: webgpu });
  // Babylon exposes booleans for these features on WebGPU and extension objects
  // on WebGL. The production loader must only depend on capability truthiness.
  Object.assign(result.getCaps(), { s3tc: true, astc: true });
  return result;
}

describe("KTX1 Babylon-managed upload", () => {
  it.each([
    false,
    true,
  ])("retains source bytes and uploads all authored mips (WebGPU capability mode: %s)", async (webgpu) => {
    const target = engine(webgpu);
    const source = fixture();
    const texture = await createTextureFromKTX1(target, parseKTX1(source), "test.ktx");
    expect(texture?.isReady).toBe(true);
    expect(texture?._buffer).toBe(source);
    expect(target.uploads.map((args) => [args[2], args[3], args[6]])).toEqual([
      [4, 4, 0],
      [2, 2, 1],
      [1, 1, 2],
    ]);
    expect(target.uploads.every((args) => args[1] === GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT1_EXT)).toBe(true);
    expect(texture?.generateMipMaps).toBe(true);
    texture?.dispose();
  });

  it("uses the retained container again during Babylon's rebuild lifecycle", async () => {
    const target = engine();
    const texture = await createTextureFromKTX1(target, parseKTX1(fixture()), "recover.ktx");
    texture!._rebuild();
    await vi.waitFor(() => expect(target.uploads).toHaveLength(6));
    expect(texture?.isReady).toBe(true);
    texture?.dispose();
  });

  it("uses only the base level for a partial mip chain", async () => {
    const target = engine();
    const texture = await createTextureFromKTX1(target, parseKTX1(fixture(undefined, 2)), "partial.ktx");
    expect(target.uploads).toHaveLength(1);
    expect(texture?.generateMipMaps).toBe(false);
    expect(texture?.samplingMode).toBe(Constants.TEXTURE_BILINEAR_SAMPLINGMODE);
    texture?.dispose();
  });

  it("uses WebGPU ETC2 capability for Babylon's ETC1-to-ETC2 mapping", async () => {
    const target = engine(true);
    Object.assign(target.getCaps(), { etc1: null, etc2: true });
    const texture = await createTextureFromKTX1(target, parseKTX1(fixture(GL_FORMATS.ETC1_RGB8_OES)), "etc1.ktx");
    expect(target.uploads).toHaveLength(3);
    expect(target.uploads[0][1]).toBe(GL_FORMATS.ETC1_RGB8_OES);
    texture?.dispose();
  });

  it.each([false, true])("avoids native NPOT mip chains (WebGPU mode: %s)", async (webgpu) => {
    const target = engine(webgpu);
    const bytes = fixture();
    new DataView(bytes).setUint32(36, 3, true);
    const texture = await createTextureFromKTX1(target, parseKTX1(bytes), "npot.ktx");
    expect(target.uploads).toHaveLength(0);
    expect(texture?.width).toBe(3);
    texture?.dispose();
  });

  it("avoids a WebGPU compressed base extent smaller than its block", async () => {
    const target = engine(true);
    const bytes = fixture(undefined, 1);
    new DataView(bytes).setUint32(36, 2, true);
    const texture = await createTextureFromKTX1(target, parseKTX1(bytes), "small.ktx");
    expect(target.uploads).toHaveLength(0);
    expect(texture?.width).toBe(2);
    texture?.dispose();
  });

  it("lets the public Texture wrapper apply compressed orientation before PK3 returns it", async () => {
    const target = engine();
    const scene = new Scene(target);
    const loader = PK3TextureLoader.getInstance();
    loader.init(target, scene);
    vi.spyOn(PK3Loader.getInstance(), "getFile").mockResolvedValue(fixture());
    const texture = await loader.loadTexture("textures/test.ktx");
    expect(texture?.vScale).toBe(-1);
    expect(texture?.vOffset).toBe(1);
    expect(texture?.getInternalTexture()?.isReady).toBe(true);
    expect(await loader.loadTexture("textures/test.ktx")).toBe(texture);
    expect(target.uploads).toHaveLength(3);
  });

  it.each([
    true,
    false,
  ])("software-decodes unsupported or big-endian DXT with preserved alpha/orientation (%s)", async (littleEndian) => {
    const target = engine();
    if (littleEndian) target.getCaps().s3tc = undefined;
    const upload = vi.spyOn(target, "createRawTexture");
    const texture = await createTextureFromKTX1(target, parseKTX1(fixture(undefined, 1, littleEndian)), "software.ktx");
    expect(target.uploads).toHaveLength(0);
    const rgba = upload.mock.calls[0][0] as Uint8Array;
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(rgba.slice(-4))).toEqual([0, 0, 0, 255]);
    expect(upload.mock.calls[0][4]).toBe(true); // regenerate mip chain
    texture?.dispose();
  });

  it("disposes a rejected native upload before trying software decode", async () => {
    const target = engine();
    const create = target.createTexture.bind(target);
    let failedTexture: ReturnType<UploadEngine["createTexture"]>;
    vi.spyOn(target, "createTexture").mockImplementation((...args) => {
      // A loader rejection before upload, via Babylon's normal error callback.
      const broken = new Uint8Array(64);
      args[7] = broken;
      failedTexture = create(...args);
      return failedTexture;
    });
    const texture = await createTextureFromKTX1(target, parseKTX1(fixture()), "reject.ktx");
    expect(texture).not.toBeNull();
    // NullEngine's hardware release is a no-op (including cache removal).
    // InternalTexture itself still clears its resource and load observers.
    expect(failedTexture!._hardwareTexture).toBeNull();
    expect(failedTexture!.onLoadedObservable.observers).toHaveLength(0);
    expect(texture).not.toBe(failedTexture!);
    texture?.dispose();
  });

  it("returns null for unsupported ASTC so PK3 can choose an image fallback", async () => {
    const target = engine();
    target.getCaps().astc = null;
    expect(
      await createTextureFromKTX1(target, parseKTX1(fixture(GL_FORMATS.COMPRESSED_RGBA_ASTC_4x4_KHR)), "astc.ktx"),
    ).toBeNull();
    expect(isFormatSupported(target, GL_FORMATS.COMPRESSED_RGBA_ASTC_4x4_KHR)).toBe(false);
  });
});

describe("KTX1 container validation", () => {
  it("preserves raw base images when legacy files have incomplete trailing mips", () => {
    const data = new ArrayBuffer(97);
    new Uint8Array(data).set(new Uint8Array(fixture()).slice(0, 64));
    const view = new DataView(data);
    view.setUint32(16, 0x1401, true);
    view.setUint32(24, GL_FORMATS.ALPHA, true);
    view.setUint32(28, 0x803c, true);
    view.setUint32(32, GL_FORMATS.ALPHA, true);
    view.setUint32(64, 16, true);
    view.setUint32(84, 4, true);
    view.setUint32(92, 4, true); // claims four bytes, only one remains
    const parsed = parseKTX1(data);
    expect(parsed.mipLevels).toHaveLength(2);
    expect(parsed.mipLevels[0].data).toHaveLength(16);
  });
  it.each([8, 63, 67, 80, 99])("rejects truncated data of length %s", (length) => {
    expect(() => parseKTX1(fixture().slice(0, length))).toThrow();
  });
  it("rejects truncated blocks before a native upload can mark them ready", () => {
    const data = fixture();
    new DataView(data).setUint32(64, 4, true);
    expect(() => parseKTX1(data)).toThrow("payload size");
  });
  it.each([44, 48, 52])("rejects unsupported depth, arrays or face counts at header offset %s", (offset) => {
    const data = fixture();
    new DataView(data).setUint32(offset, 6, true);
    expect(() => parseKTX1(data)).toThrow("non-array 2D");
  });
});
