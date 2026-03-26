/**
 * BspTest - Test utilities for BSP loading
 *
 * Usage from browser console:
 *   import { testBspLoading } from './src/engine/loader/BspTest';
 *   await testBspLoading();
 */

import type { Scene } from "@babylonjs/core/scene";
import { PK3Loader } from "../pk3/PK3Loader";
import { type BspFile, BspLoader } from "./BspLoader";
import { BspMeshBuilder } from "./BspMeshBuilder";

/**
 * Test loading a BSP file from a PK3
 */
export async function testBspLoading(mapName: string = "wdm11"): Promise<BspFile | null> {
  console.log(`\n========== BSP LOADING TEST: ${mapName} ==========\n`);

  const pk3Loader = PK3Loader.getInstance();

  // Check if map PK3 is loaded
  const pk3Name = `map_${mapName}.pk3`;
  const packages = pk3Loader.getPackageInfo();
  const isLoaded = packages.some((p) => p.filename === pk3Name);

  if (!isLoaded) {
    console.log(`[BspTest] Loading PK3: ${pk3Name}...`);
    try {
      await pk3Loader.loadPK3(pk3Name);
    } catch (e) {
      console.error(`[BspTest] Failed to load PK3: ${pk3Name}`, e);
      return null;
    }
  }

  // List files in the PK3
  const files = pk3Loader.listFiles(`maps/*.bsp`);
  console.log(`[BspTest] BSP files in PK3:`, files);

  // Load the BSP
  const bspPath = `maps/${mapName}.bsp`;
  console.log(`[BspTest] Loading BSP: ${bspPath}...`);

  const bsp = await BspLoader.loadFromPK3(pk3Loader, bspPath);

  if (!bsp) {
    console.error(`[BspTest] Failed to load BSP: ${bspPath}`);
    return null;
  }

  // Print statistics
  printBspStats(bsp);

  return bsp;
}

/**
 * Print BSP statistics
 */
export function printBspStats(bsp: BspFile): void {
  console.log("\n----- BSP Statistics -----");
  console.log(`Format: ${bsp.header.isFBSP ? "FBSP" : "IBSP"} v${bsp.header.version}`);
  console.log(`Lightmap size: ${bsp.lightmapSize}x${bsp.lightmapSize}`);
  console.log("");
  console.log(`Entities: ${bsp.entities.length}`);
  console.log(`Textures: ${bsp.textures.length}`);
  console.log(`Planes: ${bsp.planes.length}`);
  console.log(`Nodes: ${bsp.nodes.length}`);
  console.log(`Leafs: ${bsp.leafs.length}`);
  console.log(`Models: ${bsp.models.length}`);
  console.log(`Brushes: ${bsp.brushes.length}`);
  console.log(`Vertices: ${bsp.vertices.length}`);
  console.log(`Faces: ${bsp.faces.length}`);
  console.log(`MeshVerts: ${bsp.meshVerts.length}`);
  console.log(`Lightmaps: ${bsp.lightmaps.length}`);
  console.log(`LightVols: ${bsp.lightVols.length}`);
  console.log(`VisData: ${bsp.visData ? `${bsp.visData.numClusters} clusters` : "none"}`);
  console.log("");

  // Face type breakdown
  const faceTypes = { polygon: 0, patch: 0, mesh: 0, billboard: 0 };
  for (const face of bsp.faces) {
    switch (face.faceType) {
      case 1:
        faceTypes.polygon++;
        break;
      case 2:
        faceTypes.patch++;
        break;
      case 3:
        faceTypes.mesh++;
        break;
      case 4:
        faceTypes.billboard++;
        break;
    }
  }
  console.log(
    `Face types: ${faceTypes.polygon} polygons, ${faceTypes.patch} patches, ${faceTypes.mesh} meshes, ${faceTypes.billboard} billboards`,
  );

  // Texture list (first 20)
  console.log("\n----- Textures (first 20) -----");
  for (let i = 0; i < Math.min(20, bsp.textures.length); i++) {
    console.log(`  ${i}: ${bsp.textures[i].name}`);
  }
  if (bsp.textures.length > 20) {
    console.log(`  ... and ${bsp.textures.length - 20} more`);
  }

  // Entity types
  console.log("\n----- Entity Types -----");
  const entityTypes: Record<string, number> = {};
  for (const ent of bsp.entities) {
    entityTypes[ent.classname] = (entityTypes[ent.classname] || 0) + 1;
  }
  for (const [type, count] of Object.entries(entityTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Worldspawn properties
  const worldspawn = bsp.entities.find((e) => e.classname === "worldspawn");
  if (worldspawn) {
    console.log("\n----- Worldspawn Properties -----");
    for (const [key, value] of Object.entries(worldspawn.properties)) {
      if (key !== "classname") {
        console.log(`  ${key}: ${value}`);
      }
    }
  }

  // Model 0 (world) info
  if (bsp.models.length > 0) {
    const world = bsp.models[0];
    console.log("\n----- World Model -----");
    console.log(`  Bounds: (${world.mins.join(", ")}) to (${world.maxs.join(", ")})`);
    console.log(`  Faces: ${world.numFaces} (starting at ${world.firstFace})`);
    console.log(`  Brushes: ${world.numBrushes} (starting at ${world.firstBrush})`);
  }

  console.log("\n========================================\n");
}

/**
 * Build BSP geometry and add to scene
 */
export async function testBspRendering(scene: Scene, mapName: string = "wdm11"): Promise<void> {
  console.log(`\n========== BSP RENDERING TEST: ${mapName} ==========\n`);

  const bsp = await testBspLoading(mapName);
  if (!bsp) {
    console.error("[BspTest] Cannot render - BSP loading failed");
    return;
  }

  console.log("[BspTest] Building meshes...");
  const result = BspMeshBuilder.build(bsp, scene);

  console.log(
    `[BspTest] Created world mesh with ${result.stats.totalVertices} vertices, ${result.stats.totalTriangles} triangles`,
  );
  console.log(`[BspTest] Created ${result.lightmapTextures.length} lightmap textures`);

  // Position camera to view the map
  const world = bsp.models[0];
  if (world) {
    const centerX = (world.mins[0] + world.maxs[0]) / 2;
    const centerZ = (world.mins[1] + world.maxs[1]) / 2; // Y in Q3 is Z in Babylon
    const centerY = (world.mins[2] + world.maxs[2]) / 2; // Z in Q3 is Y in Babylon

    console.log(`[BspTest] World center: (${centerX}, ${centerY}, ${centerZ})`);
    console.log(`[BspTest] Recommended camera target: Vector3(${centerX}, ${centerY}, ${centerZ})`);
  }

  console.log("\n========================================\n");
}

/**
 * Quick test - just load and print stats without rendering
 */
export async function quickBspTest(): Promise<void> {
  await testBspLoading("wdm11");
}

// Export for console access
if (typeof window !== "undefined") {
  // biome-ignore lint/suspicious/noExplicitAny: BSP test data structures
  (window as any).testBspLoading = testBspLoading;
  // biome-ignore lint/suspicious/noExplicitAny: BSP test data structures
  (window as any).printBspStats = printBspStats;
  // biome-ignore lint/suspicious/noExplicitAny: BSP test data structures
  (window as any).testBspRendering = testBspRendering;
  // biome-ignore lint/suspicious/noExplicitAny: BSP test data structures
  (window as any).quickBspTest = quickBspTest;
}
