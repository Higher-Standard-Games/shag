/**
 * Headless BSP Inspector - CLI tool for BSP analysis without rendering
 *
 * Uses Babylon.js NullEngine to load and inspect BSP files without WebGL.
 *
 * Usage:
 *   npx vite-node src/cli/headless-bsp.ts <bspfile>
 *   npx vite-node src/cli/headless-bsp.ts info <bspfile>
 *   npx vite-node src/cli/headless-bsp.ts entities <bspfile>
 *   npx vite-node src/cli/headless-bsp.ts textures <bspfile>
 *   npx vite-node src/cli/headless-bsp.ts effects <bspfile>
 *   npx vite-node src/cli/headless-bsp.ts build <bspfile>
 */

import { NullEngine, Scene, FreeCamera, Vector3, MeshBuilder, Mesh } from "babylonjs";
import * as fs from "fs";

// Import BSP loader
import { BspLoader, type BspFile } from "../engine/loader/bsp/BspLoader";

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    printUsage();
    process.exit(1);
  }

  // Parse command
  let command = "info";
  let bspFile: string;

  const validCommands = ["info", "entities", "textures", "effects", "build", "test"];
  if (validCommands.includes(args[0])) {
    command = args[0];
    bspFile = args[1];
  } else {
    bspFile = args[0];
  }

  // Special test command
  if (command === "test") {
    await runTest();
    return;
  }

  if (!bspFile) {
    printUsage();
    process.exit(1);
  }

  console.log(`\n[HeadlessBSP] Command: ${command}`);
  console.log(`[HeadlessBSP] File: ${bspFile}\n`);

  try {
    // Read BSP file
    if (!fs.existsSync(bspFile)) {
      console.error(`[HeadlessBSP] File not found: ${bspFile}`);
      process.exit(1);
    }

    const buffer = fs.readFileSync(bspFile);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    console.log(`[HeadlessBSP] Loaded ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Parse BSP
    const bsp = BspLoader.load(arrayBuffer);
    console.log(`[HeadlessBSP] BSP parsed: ${bsp.header.isFBSP ? "FBSP" : "IBSP"} v${bsp.header.version}\n`);

    // Execute command
    switch (command) {
      case "info":
        printInfo(bsp);
        break;
      case "entities":
        printEntities(bsp);
        break;
      case "textures":
        printTextures(bsp);
        break;
      case "effects":
        printEffects(bsp);
        break;
      case "build":
        await buildMeshes(bsp);
        break;
      default:
        printInfo(bsp);
    }

  } catch (error) {
    console.error("[HeadlessBSP] Error:", error);
    process.exit(1);
  }
}

// ============================================================================
// Commands
// ============================================================================

function printInfo(bsp: BspFile): void {
  console.log("=== BSP Info ===\n");
  console.log(`Format: ${bsp.header.isFBSP ? "FBSP (Warsow)" : "IBSP (Quake3)"}`);
  console.log(`Version: ${bsp.header.version}`);
  console.log(`Lightmap size: ${bsp.lightmapSize}x${bsp.lightmapSize}`);
  console.log("");
  console.log("Lumps:");
  console.log(`  Entities: ${bsp.entities.length}`);
  console.log(`  Textures: ${bsp.textures.length}`);
  console.log(`  Planes: ${bsp.planes.length}`);
  console.log(`  Nodes: ${bsp.nodes.length}`);
  console.log(`  Leafs: ${bsp.leafs.length}`);
  console.log(`  Faces: ${bsp.faces.length}`);
  console.log(`  Vertices: ${bsp.vertices.length}`);
  console.log(`  MeshVerts: ${bsp.meshVerts.length}`);
  console.log(`  Lightmaps: ${bsp.lightmaps.length}`);
  console.log(`  Effects: ${bsp.effects.length}`);
  console.log(`  Brushes: ${bsp.brushes.length}`);
  console.log(`  BrushSides: ${bsp.brushSides.length}`);
  console.log(`  Models: ${bsp.models.length}`);

  if (bsp.visData) {
    console.log(`  PVS: ${bsp.visData.numClusters} clusters`);
  } else {
    console.log(`  PVS: none`);
  }

  // Face type breakdown
  const faceTypes = { polygon: 0, patch: 0, mesh: 0, billboard: 0 };
  for (const face of bsp.faces) {
    switch (face.faceType) {
      case 1: faceTypes.polygon++; break;
      case 2: faceTypes.patch++; break;
      case 3: faceTypes.mesh++; break;
      case 4: faceTypes.billboard++; break;
    }
  }
  console.log("");
  console.log("Face types:");
  console.log(`  Polygons: ${faceTypes.polygon}`);
  console.log(`  Patches: ${faceTypes.patch}`);
  console.log(`  Meshes: ${faceTypes.mesh}`);
  console.log(`  Billboards: ${faceTypes.billboard}`);
}

function printEntities(bsp: BspFile): void {
  console.log("=== Entities ===\n");

  // Count by classname
  const classCounts = new Map<string, number>();
  for (const ent of bsp.entities) {
    const count = classCounts.get(ent.classname) || 0;
    classCounts.set(ent.classname, count + 1);
  }

  // Sort by count
  const sorted = [...classCounts.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`Total: ${bsp.entities.length} entities\n`);
  for (const [name, count] of sorted) {
    console.log(`  ${count.toString().padStart(4)} ${name}`);
  }
}

function printTextures(bsp: BspFile): void {
  console.log("=== Textures ===\n");
  console.log(`Total: ${bsp.textures.length}\n`);

  for (let i = 0; i < bsp.textures.length; i++) {
    const tex = bsp.textures[i];
    const flags = [];
    if (tex.surfaceFlags & 0x4) flags.push("sky");
    if (tex.surfaceFlags & 0x40) flags.push("nodraw");
    if (tex.contentFlags & 0x1) flags.push("solid");
    if (tex.contentFlags & 0x10) flags.push("fog");

    const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
    console.log(`  [${i.toString().padStart(3)}] ${tex.name}${flagStr}`);
  }
}

function printEffects(bsp: BspFile): void {
  console.log("=== Effects (Fog) ===\n");

  if (bsp.effects.length === 0) {
    console.log("No effects found.");
    return;
  }

  console.log(`Total: ${bsp.effects.length}\n`);

  for (let i = 0; i < bsp.effects.length; i++) {
    const effect = bsp.effects[i];
    console.log(`  [${i}] "${effect.name}"`);
    console.log(`      Brush: ${effect.brushIndex}`);

    // Show brush info if valid
    if (effect.brushIndex >= 0 && effect.brushIndex < bsp.brushes.length) {
      const brush = bsp.brushes[effect.brushIndex];
      console.log(`      Brush sides: ${brush.numSides} (first: ${brush.firstSide})`);
    }
    console.log("");
  }
}

async function buildMeshes(bsp: BspFile): Promise<void> {
  console.log("=== Build Meshes (Headless) ===\n");

  // Create headless engine
  const engine = new NullEngine();
  const scene = new Scene(engine);

  // Need a camera for scene.render()
  new FreeCamera("camera", new Vector3(0, 0, 0), scene);

  console.log("[Build] NullEngine created");
  console.log("[Build] Building world geometry...\n");

  // Import mesh builder
  const { BspMeshBuilder } = await import("../engine/loader/bsp/BspMeshBuilder");

  // Build meshes
  const result = BspMeshBuilder.build(bsp, scene);

  console.log("Build Result:");
  console.log(`  World mesh: ${result.worldMesh.name}`);
  console.log(`  Total vertices: ${result.stats.totalVertices}`);
  console.log(`  Total triangles: ${result.stats.totalTriangles}`);
  console.log(`  Polygon faces: ${result.stats.polygonFaces}`);
  console.log(`  Patch faces: ${result.stats.patchFaces}`);
  console.log(`  Mesh faces: ${result.stats.meshFaces}`);
  console.log(`  Billboard faces: ${result.stats.billboardFaces}`);
  console.log(`  Skipped sky faces: ${result.stats.skippedSkyFaces}`);
  console.log(`  Lightmaps: ${result.lightmapTextures.length}`);
  console.log(`  Sky shaders: ${result.skyShaders.length}`);

  if (result.clusterInfo) {
    console.log(`  PVS clusters: ${result.clusterInfo.numClusters}`);
    console.log(`  Has PVS: ${result.clusterInfo.hasPVS}`);
  }

  // Run one render to process
  scene.render();

  // Get child mesh count
  const childMeshes = result.worldMesh.getChildMeshes();
  console.log(`\n  Child meshes (texture groups): ${childMeshes.length}`);

  // Sample some mesh stats
  if (childMeshes.length > 0) {
    console.log("\n  Sample meshes:");
    for (let i = 0; i < Math.min(5, childMeshes.length); i++) {
      const mesh = childMeshes[i] as Mesh;
      const meta = mesh.metadata as { textureName?: string } | null;
      console.log(`    ${mesh.name}: ${mesh.getTotalVertices()} verts, tex="${meta?.textureName || "?"}"`);
    }
    if (childMeshes.length > 5) {
      console.log(`    ... and ${childMeshes.length - 5} more`);
    }
  }

  // Cleanup
  scene.dispose();
  engine.dispose();

  console.log("\n[Build] Done");
}

async function runTest(): Promise<void> {
  console.log("\n=== NullEngine Test ===\n");

  const engine = new NullEngine();
  const scene = new Scene(engine);
  new FreeCamera("camera", new Vector3(0, 5, -10), scene);

  console.log("NullEngine created:", engine.description);
  console.log("Scene UID:", scene.uid);
  console.log("Engine caps:", {
    maxTextureSize: engine.getCaps().maxTextureSize,
    maxVertexAttribs: engine.getCaps().maxVertexAttribs,
  });

  // Create test meshes
  const box = MeshBuilder.CreateBox("box", { size: 2 }, scene);
  const sphere = MeshBuilder.CreateSphere("sphere", { diameter: 1 }, scene);
  sphere.position = new Vector3(3, 0, 0);

  console.log("\nTest meshes created:");
  console.log(`  Box: ${box.getTotalVertices()} vertices`);
  console.log(`  Sphere: ${sphere.getTotalVertices()} vertices`);

  // Render frame
  scene.render();
  console.log("\nScene rendered (no visual output - headless)");

  // Cleanup
  scene.dispose();
  engine.dispose();

  console.log("\n[Test] NullEngine works correctly!\n");
}

function printUsage(): void {
  console.log(`
Headless BSP Inspector - CLI tool for BSP analysis

Usage:
  npx ts-node src/cli/headless-bsp.ts <pk3path> <mapname>
  npx ts-node src/cli/headless-bsp.ts info <pk3path> <mapname>
  npx ts-node src/cli/headless-bsp.ts entities <pk3path> <mapname>
  npx ts-node src/cli/headless-bsp.ts textures <pk3path> <mapname>
  npx ts-node src/cli/headless-bsp.ts stats <pk3path> <mapname>

Commands:
  info       Show BSP header and lump info
  entities   List all entities in BSP
  textures   List all textures used
  stats      Show detailed statistics

Example:
  npx ts-node src/cli/headless-bsp.ts info ./game/map_wdm11.pk3 wdm11
`);
}

// Run
main().catch(console.error);
