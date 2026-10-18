/**
 * NodePk3 — headless map resolution through the PK3 index.
 *
 * Uses the real pk3 library under public/data to prove a server/CLI can resolve
 * a map's BSP the same way the game does, instead of ad-hoc path searches.
 */

import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { publishBuild } from "../../../editor/server/PublishedBuild";
import { resolveMapBspViaIndex } from "../NodePk3";
import { PK3Loader } from "../PK3Loader";

const dataDir = path.resolve("public/data");
const hasMaps = fs.existsSync(path.join(dataDir, "map_washoidm2.pk3"));

// Skip gracefully if the pk3 library isn't present in this checkout.
const maybe = hasMaps ? it : it.skip;

function magic(ab: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(ab, 0, 4));
}

describe("resolveMapBspViaIndex", () => {
  it("reopens indexed maps for transient owners and releases unrelated fallback archives", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shagged-transient-pk3-"));
    const shared = PK3Loader.getInstance().getPackageInfo();
    const name = `transient_${Date.now()}`;
    try {
      for (const [filename, map, bytes] of [
        ["map_a.pk3", `other_${name}`, [1, 2]],
        ["map_z.pk3", name, [3, 4, 5]],
      ] as const) {
        const zip = new JSZip();
        zip.file(`maps/${map}.bsp`, Uint8Array.from(bytes));
        await fs.promises.writeFile(
          path.join(dir, filename),
          new Uint8Array(await zip.generateAsync({ type: "arraybuffer" })),
        );
      }
      for (let i = 0; i < 2; i++) {
        const loader = PK3Loader.createTransient();
        expect(new Uint8Array((await resolveMapBspViaIndex([dir], name, loader))!)).toEqual(Uint8Array.of(3, 4, 5));
        expect(loader.getPackageInfo().map((p) => p.filename)).toEqual(["map_z.pk3"]);
        expect(PK3Loader.getInstance().getPackageInfo()).toEqual(shared);
      }
      const unknown = PK3Loader.createTransient();
      expect(await resolveMapBspViaIndex([dir], `missing_${name}`, unknown)).toBeNull();
      expect(unknown.getPackageInfo()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("uses the current numbered SHAGGED build instead of the first map package", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shagged-nodepk3-"));
    const name = `testmap_${Date.now()}`;
    try {
      const input = { mapName: name, buildId: "one", sourceRevision: 1, sourceHash: "source", quality: "fast" };
      await publishBuild(dir, input, Uint8Array.from([1]));
      expect(new Uint8Array((await resolveMapBspViaIndex([dir], name))!)).toEqual(Uint8Array.from([1]));
      await publishBuild(dir, { ...input, buildId: "two", sourceRevision: 2 }, Uint8Array.from([2]));
      expect(new Uint8Array((await resolveMapBspViaIndex([dir], name))!)).toEqual(Uint8Array.from([2]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  maybe("resolves a map's BSP bytes through the pk3 index", async () => {
    const bsp = await resolveMapBspViaIndex([dataDir], "washoidm2");
    expect(bsp).not.toBeNull();
    expect(bsp!.byteLength).toBeGreaterThan(1000);
    // Quake3/Warsow BSP magic
    expect(["IBSP", "FBSP", "RBSP"]).toContain(magic(bsp!));
  });

  maybe("is case-insensitive on the map name", async () => {
    const bsp = await resolveMapBspViaIndex([dataDir], "WASHOIDM2");
    expect(bsp).not.toBeNull();
  });

  it("returns null for an unknown map", async () => {
    const bsp = await resolveMapBspViaIndex([dataDir], "no_such_map_xyz");
    expect(bsp).toBeNull();
  });
});
