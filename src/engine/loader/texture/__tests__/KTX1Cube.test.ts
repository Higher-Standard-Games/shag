import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { InternalTexture, InternalTextureSource } from "@babylonjs/core/Materials/Textures/internalTexture";
import { Scene } from "@babylonjs/core/scene";
import { expect, it, vi } from "vitest";
import { PK3Loader } from "../../pk3/PK3Loader";
import { parseKTX1CubeFaces } from "../KTX1Loader";
import { SkyboxLoader } from "../SkyboxLoader";

function cube(little = true): ArrayBuffer {
  const bytes = new Uint8Array(64 + 4 + 6 * 8);
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  [0x04030201, 0, 1, 0, 0x8d64, 0x1907, 4, 4, 0, 0, 6, 1, 0].forEach((value, index) => {
    view.setUint32(12 + index * 4, value, little);
  });
  view.setUint32(64, 8, little);
  for (let i = 0; i < 6; i++) bytes.fill(i + 1, 68 + i * 8, 76 + i * 8);
  return bytes.buffer;
}

it.each([true, false])("splits six compressed faces with byte order %s", (little) => {
  const faces = parseKTX1CubeFaces(cube(little));
  expect(faces).toHaveLength(6);
  for (let i = 0; i < 6; i++) {
    expect(faces[i].header.numberOfFaces).toBe(1);
    expect(faces[i].mipLevels[0].data).toEqual(new Uint8Array(8).fill(i + 1));
  }
});

it("rejects incomplete cubes instead of accepting a partial environment", () => {
  expect(() => parseKTX1CubeFaces(cube().slice(0, -1))).toThrow(/Truncated/);
  const wrong = cube();
  new DataView(wrong).setUint32(52, 1, true);
  expect(() => parseKTX1CubeFaces(wrong)).toThrow(/six square/);
});

it("loads a single-file ETC1 cubemap through the real environment loader", async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const upload = vi.spyOn(engine, "createRawCubeTexture").mockImplementation((_data, size) => {
    const texture = new InternalTexture(engine, InternalTextureSource.CubeRaw);
    texture.width = texture.height = size;
    texture.isReady = texture.isCube = true;
    return texture;
  });
  const load = vi
    .spyOn(PK3Loader.getInstance(), "getFile")
    .mockImplementation(async (path) => (path === "env/test.ktx" ? cube() : null));
  try {
    const loader = SkyboxLoader.getInstance();
    loader.init(scene);
    const result = await loader.loadEnvironmentCubemap("env/test");
    expect(result.success).toBe(true);
    expect(result.loadedFaces).toEqual(["env/test.ktx"]);
    expect(result.texture?.isCube).toBe(true);
    expect(upload.mock.calls[0][0]).toHaveLength(6);
    result.texture?.dispose();
  } finally {
    load.mockRestore();
    scene.dispose();
    engine.dispose();
  }
});
