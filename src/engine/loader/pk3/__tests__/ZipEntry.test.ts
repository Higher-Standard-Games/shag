import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { readZipEntry } from "../ZipEntry";

let dir: string | undefined;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function pk3(files: Record<string, Uint8Array>, compression: "STORE" | "DEFLATE"): Promise<string> {
  dir ??= fs.mkdtempSync(path.join(os.tmpdir(), "shag-zip-entry-"));
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  const file = path.join(dir, `${compression}.pk3`);
  fs.writeFileSync(file, await zip.generateAsync({ type: "uint8array", compression }));
  return file;
}

const bsp = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31) % 251);

describe("one file out of a pk3 on disk", () => {
  it.each(["STORE", "DEFLATE"] as const)("reads a %s entry by its pk3 name, byte for byte", async (compression) => {
    const file = await pk3({ "maps/Test_Map.bsp": bsp, "textures/a.tga": new Uint8Array(10) }, compression);
    const read = readZipEntry(file, "maps/test_map.bsp");
    expect(read).not.toBeNull();
    expect(new Uint8Array(read!)).toEqual(bsp);
    // Its own store, exactly its size
    expect(read!.byteLength).toBe(bsp.length);
  });

  it("answers null for an entry that is not there, or a file that is no zip", async () => {
    const file = await pk3({ "maps/other.bsp": bsp }, "DEFLATE");
    expect(readZipEntry(file, "maps/test_map.bsp")).toBeNull();
    const junk = path.join(dir!, "junk.pk3");
    fs.writeFileSync(junk, "not a zip at all");
    expect(readZipEntry(junk, "maps/test_map.bsp")).toBeNull();
    expect(readZipEntry(path.join(dir!, "missing.pk3"), "maps/test_map.bsp")).toBeNull();
  });
});
