/**
 * A texture named with its source extension (`foo.tga`) resolves to its
 * packaged WebP when the package has one, and to the named file otherwise.
 */
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Cvar } from "../../../core/Cvar";
import { PK3Index } from "../PK3Index";
import { PK3Loader } from "../PK3Loader";
import { PK3TextureLoader } from "../PK3TextureLoader";

const loader = PK3TextureLoader.getInstance();
const pk3 = PK3Loader.getInstance();
const packaged = (files: string[]) => vi.spyOn(pk3, "hasFile").mockImplementation((path) => files.includes(path));

beforeEach(() => {
  vi.spyOn(PK3Index.getInstance(), "findFile").mockReturnValue(null);
  vi.spyOn(Cvar, "get").mockReturnValue(0);
  vi.spyOn(Cvar, "getBool").mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());

it("loads the packaged WebP before the TGA a shader names", async () => {
  packaged(["textures/wall.webp", "textures/wall.tga"]);
  const load = vi.spyOn(loader, "loadTexture").mockResolvedValue({} as Texture);
  await loader.resolveAndLoadTexture("textures/wall.tga");
  expect(load).toHaveBeenCalledWith("textures/wall.webp", 0);
});

it("loads the named file when the package has no WebP of it", async () => {
  packaged(["textures/wall.tga", "textures/wall.ktx"]);
  const load = vi.spyOn(loader, "loadTexture").mockResolvedValue({} as Texture);
  await loader.resolveAndLoadTexture("textures/wall.tga");
  expect(load).toHaveBeenCalledWith("textures/wall.tga", 0);
});
