import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { modelBounds, searchModelCatalog } from "../ModelLookup";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("model discovery", () => {
  it("resolves package overrides and loose precedence, pages paths and refreshes after asset changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shagged-models-"));
    roots.push(root);
    for (const [name, vertices] of [
      ["a.pk3", "v 0 0 0\nv 1 1 1"],
      ["z.pk3", "v -2 0 0\nv 8 4 6"],
    ]) {
      const zip = new JSZip();
      zip.file("models/props/rail.obj", vertices);
      zip.file("models/props/lamp.glb", "unsupported");
      zip.file("models/../bad.obj", "v 0 0 0");
      await writeFile(path.join(root, name), await zip.generateAsync({ type: "nodebuffer" }));
    }
    const query = await searchModelCatalog(root, { search: "PROPS rail", includeBounds: true });
    expect(query.total).toBe(1);
    expect(query.models[0]).toMatchObject({ package: "z.pk3", bounds: { dimensions: [10, 4, 6] } });
    expect((await searchModelCatalog(root, { limit: 1 })).nextOffset).toBe(1);
    const unavailable = await searchModelCatalog(root, { search: "lamp", includeBounds: true });
    expect(unavailable.models[0].bounds).toBeNull();
    expect(unavailable.models[0].boundsIssue).toContain("unavailable");
    await mkdir(path.join(root, "models/props"), { recursive: true });
    await writeFile(path.join(root, "models/props/rail.obj"), "v 0 0 0\nv 100 20 30");
    expect((await searchModelCatalog(root, { search: "rail", includeBounds: true })).models[0]).toMatchObject({
      package: null,
      bounds: { dimensions: [100, 20, 30] },
    });
  });
  it("reads ASE vertices and rejects corrupt MD3 and non-finite coordinates", () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(modelBounds(encode("*MESH_VERTEX 0 -10 5 2\n*MESH_VERTEX 1 20 8 12"), "a.ase")?.dimensions).toEqual([
      30, 3, 10,
    ]);
    expect(() => modelBounds(encode("bad"), "bad.md3")).toThrow("MD3");
    expect(() => modelBounds(encode("v NaN 0 0"), "bad.obj")).toThrow("Non-finite");
  });
});
