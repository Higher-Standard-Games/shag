import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyOperations, type EditOp, emptyDocument } from "../../api/Operations";
import { withTextureSizes } from "../AgentPipeline";
import { loadTextureCatalog, type TextureInfo } from "../TextureLookup";

vi.mock("../TextureLookup", async (actual) => ({
  ...(await actual<typeof import("../TextureLookup")>()),
  loadTextureCatalog: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTextureCatalog).mockResolvedValue([
    { name: "bricks/wall", size: [512, 256] },
    { name: "tiles/floor", size: [256, 128] },
  ] as TextureInfo[]);
});

describe("creation catalog resolution", () => {
  it("resolves each room material without mutating caller operations", async () => {
    const ops: EditOp[] = [
      {
        op: "gen.room",
        id: "room",
        min: { x: 0, y: 0, z: 0 },
        max: { x: 256, y: 256, z: 256 },
        shader: "bricks/wall",
        floorShader: "tiles/floor",
        ceilingShader: "common/caulk",
        alignment: "natural",
      },
    ];
    const snapshot = structuredClone(ops);
    const resolved = await withTextureSizes(ops);
    const doc = applyOperations(emptyDocument(), resolved).doc;
    expect(doc.brushes.find((b) => b.id === "room-floor")?.faces?.["+Z"]?.size).toEqual([256, 128]);
    expect(doc.brushes.find((b) => b.id === "room-east")?.faces?.["+X"]?.size).toEqual([512, 256]);
    expect(ops).toEqual(snapshot);
    expect(loadTextureCatalog).toHaveBeenCalledTimes(1);
  });
  it("keeps supplied sizes and avoids loading the catalog for legacy or tool-only creation", async () => {
    const base = {
      op: "box.create" as const,
      min: { x: 0, y: 0, z: 0 },
      max: { x: 16, y: 16, z: 16 },
      shader: "bricks/wall",
    };
    const ops: EditOp[] = [
      base,
      { ...base, alignment: "legacy" },
      { ...base, alignment: "natural", textureSizes: { "BRICKS/WALL": [1024, 512] } },
      { ...base, shader: "common/caulk", alignment: "natural" },
    ];
    expect(await withTextureSizes(ops)).toEqual(ops);
    expect(loadTextureCatalog).not.toHaveBeenCalled();
    const [resolved] = await withTextureSizes([
      { ...base, alignment: "natural", textureSizes: { "bricks/wall": [1024, 512] } },
      { ...base, shader: "missing", alignment: "natural" },
    ]);
    expect(resolved).toMatchObject({ textureSizes: { "bricks/wall": [1024, 512] } });
  });
});
