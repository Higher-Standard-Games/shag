import { describe, expect, it } from "vitest";
import { type BspFile, BspLoader } from "../BspLoader";
import { sampleLightGrid } from "../LightGridSampling";

function fixture(index = 1): ArrayBuffer {
  const entities = new TextEncoder().encode('{ "classname" "worldspawn" "gridsize" "64 64 128" }');
  const parts = new Map<number, Uint8Array>();
  parts.set(0, entities);
  const model = new Uint8Array(40),
    modelView = new DataView(model.buffer);
  [-65, -65, -129, 127, 127, 255].forEach((n, i) => {
    modelView.setFloat32(i * 4, n, true);
  });
  parts.set(7, model);
  const grid = new Uint8Array(60);
  for (let record = 0; record < 2; record++) {
    const offset = record * 30;
    grid.set([255, 255, 255, 255], offset + 24);
    grid[offset + 24] = 0;
    grid.set([10 + record, 20, 30], offset);
    grid.set([40, 50 + record, 60], offset + 12);
    grid.set([70, 80 + record], offset + 28);
  }
  parts.set(15, grid);
  const array = new Uint8Array(54),
    view = new DataView(array.buffer);
  for (let i = 0; i < 27; i++) view.setUint16(i * 2, i === 0 ? 0xffff : index, true);
  parts.set(17, array);
  const bytes = new ArrayBuffer(152 + [...parts.values()].reduce((sum, part) => sum + part.length, 0));
  const data = new DataView(bytes);
  data.setUint32(0, 0x50534246, true);
  data.setInt32(4, 1, true);
  let offset = 152;
  for (const [lump, part] of parts) {
    data.setInt32(8 + lump * 8, offset, true);
    data.setInt32(12 + lump * 8, part.length, true);
    new Uint8Array(bytes, offset, part.length).set(part);
    offset += part.length;
  }
  return bytes;
}
describe("FBSP compressed model lightgrid", () => {
  it("decodes 30-byte records through the uint16 site table and computes inward grid bounds", () => {
    const bsp = BspLoader.load(fixture());
    expect(bsp.lumps).toHaveLength(18);
    expect(bsp.lightVols).toHaveLength(27);
    expect(bsp.lightVols[0].valid).toBe(false);
    expect(bsp.lightVols[1]).toMatchObject({ ambient: [11, 20, 30], directional: [40, 51, 60], direction: [70, 81] });
    expect(bsp.lightGridOrigin).toEqual([-64, -64, -128]);
    expect(bsp.lightGridSize).toEqual([3, 3, 3]);
    expect(sampleLightGrid(bsp, [-64, -64, -128])).toBeNull();
    expect(sampleLightGrid(bsp, [-32, -32, -64])?.ambient).toEqual([11, 20, 30]);
    expect(sampleLightGrid(bsp, [64, 64, 128])?.directional).toEqual([40, 51, 60]);
  });
  it("rejects out-of-range compressed references", () =>
    expect(() => BspLoader.load(fixture(99))).toThrow(/lightarray index/));
  it("handles an absent grid without indexing undefined neighbors", () => {
    expect(sampleLightGrid({ lightVols: [] } as unknown as BspFile, [0, 0, 0])).toBeNull();
  });
});
