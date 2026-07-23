#!/usr/bin/env node

import * as fs from "node:fs";
import JSZip from "jszip";
import { BspLoader } from "../engine/loader/bsp/BspLoader";

async function main(): Promise<void> {
  const pk3Path = "./public/games/default/map_wdm2.pk3";
  const pk3Data = new Uint8Array(fs.readFileSync(pk3Path));
  const zip = await JSZip.loadAsync(pk3Data);

  const bspFileName = Object.keys(zip.files).find((name) => name.endsWith(".bsp"));
  if (!bspFileName) {
    throw new Error(`No BSP file found in ${pk3Path}`);
  }

  const bspEntry = zip.file(bspFileName);
  if (!bspEntry) {
    throw new Error(`Failed to read BSP entry: ${bspFileName}`);
  }

  const bspBuffer = await bspEntry.async("arraybuffer");
  const bsp = BspLoader.load(bspBuffer);
  const spawns = bsp.entities.filter((entity) => entity.classname === "info_player_deathmatch");

  console.log("\n=== WDM2 Spawn Points ===");
  spawns.slice(0, 6).forEach((spawn, i) => {
    const origin = spawn.properties.origin?.split(" ").map(Number);
    if (!origin) return;
    const [x, y, z] = origin;
    console.log(`\nSpawn ${i}:`);
    console.log(`  Quake origin (x, y, z-up) = (${x}, ${y}, ${z})`);
    console.log(`  Babylon Y (from Q3 Z) = ${z}`);
    console.log(`  Server adds +24 offset -> Y = ${z + 24}`);
  });

  console.log("\n=== Analysis ===");
  console.log("If server shows Y=167.9 for player standing on floor,");
  console.log("and spawn has Q3 Z=144 (feet level), then:");
  console.log("  Server spawn Y = 144 + 24 = 168 (origin level)");
  console.log("  After physics settles = 167.9 (correct)");
  console.log("\nBut if client expects Y=191.9, then client is calculating:");
  console.log("  Client ground Y = 167.9 + 24 = 191.9?");
  console.log("  This suggests client thinks origin is 24 units higher than server");
}

main().catch((error) => {
  console.error("[test-spawn-coords] Error:", error);
  process.exitCode = 1;
});
