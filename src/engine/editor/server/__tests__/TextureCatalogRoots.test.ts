import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { expect, it } from "vitest";
import { loadTextureCatalog } from "../TextureLookup";

it("separates catalogs whose packages have identical names, sizes and timestamps in different roots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shagged-texture-roots-"));
  try {
    for (const name of ["one", "two"]) {
      await mkdir(path.join(root, name));
      const zip = new JSZip();
      zip.file("scripts/test.shader", `textures/test/${name}\n{\n{\nmap $whiteimage\n}\n}\n`, { date: new Date(0) });
      const file = path.join(root, name, "assets.pk3");
      await writeFile(file, await zip.generateAsync({ type: "uint8array" }));
      await utimes(file, new Date(100000), new Date(100000));
    }
    const cache = path.join(root, "catalog.json");
    const first = await loadTextureCatalog(path.join(root, "one"), cache);
    const second = await loadTextureCatalog(path.join(root, "two"), cache);
    expect(first.map((entry) => entry.name)).toEqual(["test/one"]);
    expect(second.map((entry) => entry.name)).toEqual(["test/two"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
