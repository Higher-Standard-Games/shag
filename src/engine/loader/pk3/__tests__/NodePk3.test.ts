/**
 * NodePk3 — headless map resolution through the PK3 index.
 *
 * Uses the real pk3 library under public/data to prove a server/CLI can resolve
 * a map's BSP the same way the game does, instead of ad-hoc path searches.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMapBspViaIndex } from "../NodePk3";

const dataDir = path.resolve("public/data");
const hasMaps = fs.existsSync(path.join(dataDir, "map_wdm12.pk3"));

// Skip gracefully if the pk3 library isn't present in this checkout.
const maybe = hasMaps ? it : it.skip;

function magic(ab: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(ab, 0, 4));
}

describe("resolveMapBspViaIndex", () => {
  maybe("resolves a map's BSP bytes through the pk3 index", async () => {
    const bsp = await resolveMapBspViaIndex([dataDir], "wdm12");
    expect(bsp).not.toBeNull();
    expect(bsp!.byteLength).toBeGreaterThan(1000);
    // Quake3/Warsow BSP magic
    expect(["IBSP", "FBSP", "RBSP"]).toContain(magic(bsp!));
  });

  maybe("is case-insensitive on the map name", async () => {
    const bsp = await resolveMapBspViaIndex([dataDir], "WDM12");
    expect(bsp).not.toBeNull();
  });

  it("returns null for an unknown map", async () => {
    const bsp = await resolveMapBspViaIndex([dataDir], "no_such_map_xyz");
    expect(bsp).toBeNull();
  });
});
