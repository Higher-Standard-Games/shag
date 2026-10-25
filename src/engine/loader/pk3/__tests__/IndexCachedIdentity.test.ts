import { afterEach, expect, it, vi } from "vitest";
import { PackageStore } from "../PackageStore";
import { PK3Index } from "../PK3Index";

afterEach(() => {
  vi.restoreAllMocks();
  PK3Index.getInstance().clear();
  PackageStore.shared.registerSnapshot([]);
});
it("registers content hashes when using the validated cached index without published metadata", async () => {
  const index = PK3Index.getInstance();
  const hash = "a".repeat(64);
  Object.assign(index, {
    index: {
      version: 2,
      listChecksum: "same",
      lastUpdated: Date.now(),
      files: { "textures/test.tga": "test.pk3" },
      shaders: {},
      maps: {},
      packages: [{ pk3: "test.pk3", path: "data/test.pk3", fileCount: 1, sha256: hash }],
    },
  });
  const internals = index as unknown as {
    loadPublishedIndex(): Promise<null>;
    computeCurrentChecksum(): Promise<string>;
  };
  vi.spyOn(internals, "loadPublishedIndex").mockResolvedValue(null);
  vi.spyOn(internals, "computeCurrentChecksum").mockResolvedValue("same");
  expect(await index.ensureIndex()).toBe(false);
  expect(PackageStore.shared.sourceKey("data/test.pk3")).toContain(`#${hash}`);
});
