import { describe, expect, it } from "vitest";
import type { BspFile } from "../../../loader/bsp/BspLoader";
import { inspectInstalledMap, summarizeInstalledMap } from "../InstalledMapInspection";

const bsp = {
  header: { isFBSP: true },
  models: [{ mins: [-100, -100, -20], maxs: [100, 100, 500] }],
  entities: [
    { classname: "worldspawn", properties: {} },
    { classname: "info_player_deathmatch", properties: { origin: "1 2 3", angle: "90" } },
  ],
  brushes: [],
  textures: [{ name: "textures/metal/wall" }, { name: "textures/brick/red" }, { name: "unused" }],
  faces: [{ textureIndex: 0 }, { textureIndex: 1 }, { textureIndex: 0 }],
} as unknown as BspFile;

describe("installed reference inspection", () => {
  it("counts used faces, excludes unused shaders and pages a deterministic palette", () => {
    const first = summarizeInstalledMap(bsp, "reference", { limit: 1 });
    expect(first.palette).toEqual({
      total: 2,
      offset: 0,
      nextOffset: 1,
      materials: [{ name: "metal/wall", faces: 2 }],
    });
    expect(summarizeInstalledMap(bsp, "reference", { offset: 1 }).palette.materials).toEqual([
      { name: "brick/red", faces: 1 },
    ]);
    expect(summarizeInstalledMap(bsp, "reference", { search: "METAL wall" }).palette.total).toBe(1);
    expect(first.spawns[0]).toMatchObject({ origin: "1 2 3", angle: "90" });
    expect(first.worldBounds?.max).toEqual([100, 100, 500]);
  });
  it("rejects invalid pagination and map paths before loading", async () => {
    expect(() => summarizeInstalledMap(bsp, "ref", { limit: NaN })).toThrow();
    await expect(inspectInstalledMap("missing", "../outside")).rejects.toThrow("Invalid installed map name");
  });
});
