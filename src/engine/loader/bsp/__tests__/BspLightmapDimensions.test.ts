import { describe, expect, it } from "vitest";
import { BspLoader } from "../BspLoader";

function bsp({
  size = 512,
  key,
  value,
  fbsp = true,
  extraBytes = 0,
}: {
  size?: number;
  key?: string;
  value?: string;
  fbsp?: boolean;
  extraBytes?: number;
} = {}) {
  const entities = new TextEncoder().encode(`{\n"classname" "worldspawn"\n${key ? `"${key}" "${value}"\n` : ""}}\n`);
  const headerSize = 8 + 18 * 8;
  const pageBytes = size * size * 3;
  const bytes = new ArrayBuffer(headerSize + entities.length + pageBytes * 2 + extraBytes);
  const view = new DataView(bytes);
  view.setUint32(0, fbsp ? 0x50534246 : 0x50534249, true);
  view.setInt32(4, fbsp ? 1 : 46, true);
  view.setInt32(8, headerSize, true);
  view.setInt32(12, entities.length, true);
  view.setInt32(8 + 14 * 8, headerSize + entities.length, true);
  view.setInt32(12 + 14 * 8, pageBytes * 2 + extraBytes, true);
  new Uint8Array(bytes, headerSize, entities.length).set(entities);
  new Uint8Array(bytes, headerSize + entities.length, pageBytes).fill(17);
  new Uint8Array(bytes, headerSize + entities.length + pageBytes, pageBytes).fill(203);
  return bytes;
}

describe("BSP authored lightmap page dimensions", () => {
  it.each([512, 1024, 2048])("preserves complete %i-pixel FBSP page boundaries", (size) => {
    const parsed = BspLoader.load(bsp({ size, key: "_lightmapImageSize", value: String(size) }));
    expect(parsed.lightmapSize).toBe(size);
    expect(parsed.lightmaps).toHaveLength(2);
    expect(parsed.lightmaps[0]).toHaveLength(size * size * 3);
    expect(parsed.lightmaps[0].at(-1)).toBe(17);
    expect(parsed.lightmaps[1][0]).toBe(203);
  });
  it("defaults FBSP to 512 when the worldspawn key is absent", () => {
    expect(BspLoader.load(bsp()).lightmapSize).toBe(512);
  });
  it("matches Qfusion's case-insensitive worldspawn lookup", () => {
    expect(BspLoader.load(bsp({ key: "_LIGHTMAPIMAGESIZE", value: "512" })).lightmapSize).toBe(512);
  });
  it("retains the IBSP 128 default independently of the FBSP extension", () => {
    const parsed = BspLoader.load(bsp({ fbsp: false, size: 128, key: "_lightmapImageSize", value: "2048" }));
    expect(parsed.lightmapSize).toBe(128);
    expect(parsed.lightmaps).toHaveLength(2);
  });
  it.each(["0", "-512", "768", "NaN", "512oops", "", "1073741824"])("rejects invalid declared size %j", (value) => {
    expect(() => BspLoader.load(bsp({ key: "_lightmapImageSize", value }))).toThrow(/_lightmapImageSize/);
  });
  it("rejects incomplete pages instead of silently discarding bytes", () => {
    expect(() => BspLoader.load(bsp({ extraBytes: 1 }))).toThrow(/complete 512x512 RGB pages/);
  });
});
