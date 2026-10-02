import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { InternalTexture, InternalTextureSource } from "@babylonjs/core/Materials/Textures/internalTexture";
import type { IDecodedData } from "@babylonjs/core/Materials/Textures/ktx2decoderTypes";
import { _KTXTextureLoader } from "@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader";
import { _GetCompatibleTextureLoader } from "@babylonjs/core/Materials/Textures/Loaders/textureLoaderManager";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";
import { AutoReleaseWorkerPool } from "@babylonjs/core/Misc/workerPool";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KTX2_SIDECAR_EXTENSION, KTX2SidecarLoader, registerKTX2SidecarLoader } from "../KTX2SidecarLoader";

const identifier = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 13, 10, 26, 10]);
let engine: NullEngine;
let pool: AutoReleaseWorkerPool;

beforeEach(() => {
  engine = new NullEngine();
});

afterEach(() => {
  pool?.dispose();
  KhronosTextureContainer2.WorkerPool = undefined;
  (KhronosTextureContainer2 as unknown as { _WorkerPoolPromise?: unknown })._WorkerPoolPromise = undefined;
  engine.dispose();
  vi.restoreAllMocks();
});

/** Only transcoding is stubbed; Babylon's container/mip upload loop is real. */
function decodedFixture(format = 0x8058, errors?: string): IDecodedData {
  const data: IDecodedData = {
    width: 4,
    height: 4,
    transcodedFormat: format,
    mipmaps: [4, 2, 1].map((size, level) => ({
      width: size,
      height: size,
      // Distinct mips and asymmetric rows expose replacing a mip with base data.
      data: Uint8Array.from({ length: size * size * 4 }, (_, i) => level * 80 + i),
    })),
    isInGammaSpace: true,
    hasAlpha: true,
    transcoderName: "fixture",
    errors,
  };
  const listeners = new Set<(event: MessageEvent) => void>();
  const worker = {
    addEventListener: (type: string, fn: (event: MessageEvent) => void) => type === "message" && listeners.add(fn),
    removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
    postMessage: (message: { action: string }) => {
      if (message.action !== "decode") return;
      queueMicrotask(() => {
        for (const fn of [...listeners])
          fn({ data: { action: "decoded", success: true, decodedData: data } } as MessageEvent);
      });
    },
    terminate: () => listeners.clear(),
  };
  pool = new AutoReleaseWorkerPool(1, async () => worker as unknown as Worker);
  KhronosTextureContainer2.WorkerPool = pool;
  return data;
}

function load(loader: _KTXTextureLoader, texture: InternalTexture, bytes = identifier) {
  return new Promise<{ width: number; height: number; mips: boolean; failed?: boolean }>((resolve) => {
    loader.loadData(bytes, texture, (width, height, mips, _compressed, done, failed) => {
      done();
      resolve({ width, height, mips, failed });
    });
  });
}

describe("KTX2 sidecar uploads", () => {
  it("reproduces upstream's last-mip extent and invert-Y request", async () => {
    decodedFixture();
    const texture = new InternalTexture(engine, InternalTextureSource.Url);
    texture.invertY = true;
    const upload = vi.spyOn(engine, "_uploadDataToTextureDirectly");
    expect(await load(new _KTXTextureLoader(), texture)).toMatchObject({ width: 1, height: 1, failed: false });
    expect(upload).toHaveBeenCalledTimes(3);
    expect(texture.invertY).toBe(true);
  });

  it.each([
    0x8058, 0x8229, 0x822b,
  ])("preserves every raw mip and reports the base extent (format %i)", async (format) => {
    const decoded = decodedFixture(format);
    const texture = new InternalTexture(engine, InternalTextureSource.Url);
    texture.invertY = true;
    const uploads: unknown[] = [];
    vi.spyOn(engine, "_uploadDataToTextureDirectly").mockImplementation(
      (
        target: InternalTexture,
        bytes: ArrayBufferView,
        face?: number,
        lod?: number,
        _format?: number,
        exactSize?: boolean,
      ) => {
        uploads.push({
          width: target.width,
          height: target.height,
          bytes,
          face,
          lod,
          exactSize,
          invertY: target.invertY,
        });
      },
    );
    expect(await load(new KTX2SidecarLoader(), texture)).toEqual({ width: 4, height: 4, mips: true, failed: false });
    expect(uploads).toEqual(
      decoded.mipmaps.map((mip, lod) => ({
        width: mip.width,
        height: mip.height,
        bytes: mip.data,
        face: 0,
        lod,
        exactSize: true,
        invertY: false,
      })),
    );
    expect(texture.width).toBe(4);
    expect(texture.height).toBe(4);
    expect(texture._gammaSpace).toBe(true);
    expect(texture.isReady).toBe(true);
    expect(texture._extension).toBe(KTX2_SIDECAR_EXTENSION);

    // Babylon's real restoration method must select this loader again.
    texture.url = "data/ktx2cache/fixture.ktx2";
    const create = vi.spyOn(engine, "createTexture");
    texture._rebuild();
    expect(create.mock.calls[0][2]).toBe(false);
    expect(create.mock.calls[0][10]).toBe(KTX2_SIDECAR_EXTENSION);
  });

  it("preserves compressed mips without routing them through raw upload", async () => {
    const data = decodedFixture(33779);
    const texture = new InternalTexture(engine, InternalTextureSource.Url);
    const compressed = vi.spyOn(engine, "_uploadCompressedDataToTextureDirectly");
    const raw = vi.spyOn(engine, "_uploadDataToTextureDirectly");
    expect(await load(new KTX2SidecarLoader(), texture)).toMatchObject({ width: 4, height: 4, failed: false });
    expect(raw).not.toHaveBeenCalled();
    for (const [lod, mip] of data.mipmaps.entries()) {
      expect(compressed).toHaveBeenNthCalledWith(lod + 1, texture, 33779, mip.width, mip.height, mip.data, 0, lod);
    }
  });

  it("reports corrupt containers and decoder errors as failures for source fallback", async () => {
    decodedFixture(0x8058, "invalid mip");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const texture = new InternalTexture(engine, InternalTextureSource.Url);
    const loader = new KTX2SidecarLoader();
    expect(await load(loader, texture, new Uint8Array(12))).toMatchObject({ failed: true });
    expect(await load(loader, texture)).toMatchObject({ failed: true });
    expect(texture.isReady).toBe(false);
  });

  it("keeps the sidecar registry entry separate from Babylon's normal KTX loaders", async () => {
    registerKTX2SidecarLoader();
    registerKTX2SidecarLoader();
    expect(await _GetCompatibleTextureLoader(".ktx2")).toBeInstanceOf(_KTXTextureLoader);
    expect(await _GetCompatibleTextureLoader(KTX2_SIDECAR_EXTENSION)).toBeInstanceOf(KTX2SidecarLoader);
  });
});
