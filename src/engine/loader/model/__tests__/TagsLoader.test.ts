import { afterEach, expect, it, vi } from "vitest";
import { readIndexedModelAsset } from "../ModelAsset";
import { loadTags } from "../TagsLoader";

vi.mock("../ModelAsset", () => ({ readIndexedModelAsset: vi.fn() }));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("reads the plasma attachment override from its indexed package without a loose fetch", async () => {
  const bytes = new TextEncoder().encode('tag "tag_barrel2" "tag_barrel" 0 0 0 0 0 0');
  vi.mocked(readIndexedModelAsset).mockResolvedValue(bytes.buffer);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const tags = await loadTags("/data/models/weapons/plasmagun/");
  expect(readIndexedModelAsset).toHaveBeenCalledWith("/data/models/weapons/plasmagun/tags.txt");
  expect(tags).toMatchObject([{ boneName: "tag_barrel2", tagName: "tag_barrel" }]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps optional loose tags available for unindexed custom models", async () => {
  vi.mocked(readIndexedModelAsset).mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('tag "" "tag_barrel" 1 2 3 0 0 0')));
  expect(await loadTags("/custom/")).toMatchObject([{ offset: { x: 1, y: 2, z: 3 } }]);
});

it("treats absent optional tags as no attachment override", async () => {
  vi.mocked(readIndexedModelAsset).mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
  expect(await loadTags("/custom/")).toEqual([]);
});
