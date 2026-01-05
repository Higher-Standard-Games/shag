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

  const validCommands = ["info", "entities", "textures", "effects", "build", "test", "collision"];
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
      case "collision":
        await testCollision(bsp);
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

async function testCollision(bsp: BspFile): Promise<void> {
  console.log("\n=== BSP Collision Test ===");
  console.log(`Brushes: ${bsp.brushes.length}, Planes: ${bsp.planes.length}\n`);

  // Import BspCollision
  const { BspCollision } = await import("../engine/physics/BspCollision");
  const collision = new BspCollision(bsp);

  // Find spawn points for test positions
  const spawns = bsp.entities.filter(e => 
    e.classname === 'info_player_deathmatch' || 
    e.classname === 'info_player_start'
  );

  console.log(`Found ${spawns.length} spawn points\n`);

  // Analyze coordinate system by checking vertex bounds vs brush bounds
  console.log("=== Coordinate Analysis ===");
  
  // Get vertex bounds (Q3 coords as stored in BSP)
  let vMinX = Infinity, vMaxX = -Infinity;
  let vMinY = Infinity, vMaxY = -Infinity;
  let vMinZ = Infinity, vMaxZ = -Infinity;
  for (const v of bsp.vertices) {
    vMinX = Math.min(vMinX, v.position[0]);
    vMaxX = Math.max(vMaxX, v.position[0]);
    vMinY = Math.min(vMinY, v.position[1]);
    vMaxY = Math.max(vMaxY, v.position[1]);
    vMinZ = Math.min(vMinZ, v.position[2]);
    vMaxZ = Math.max(vMaxZ, v.position[2]);
  }
  console.log(`Vertex bounds (Q3 raw):`);
  console.log(`  X: ${vMinX.toFixed(0)} to ${vMaxX.toFixed(0)}`);
  console.log(`  Y: ${vMinY.toFixed(0)} to ${vMaxY.toFixed(0)}`);
  console.log(`  Z: ${vMinZ.toFixed(0)} to ${vMaxZ.toFixed(0)}`);
  console.log(`  (Q3: X=right, Y=forward, Z=up)\n`);

  // Sample some planes
  console.log("Sample brush planes (first 5 solid brushes):");
  let solidCount = 0;
  for (let bi = 0; bi < bsp.brushes.length && solidCount < 5; bi++) {
    const brush = bsp.brushes[bi];
    const texture = bsp.textures[brush.shaderIndex];
    const isSolid = texture && (texture.contentFlags & 0x1) !== 0;
    const isDetail = texture && (texture.contentFlags & 0x8000000) !== 0;
    if (!isSolid || isDetail) continue;
    solidCount++;
    
    console.log(`  Brush ${bi}: "${texture?.name}" (${brush.numSides} sides)`);
    for (let si = 0; si < Math.min(3, brush.numSides); si++) {
      const side = bsp.brushSides[brush.firstSide + si];
      const plane = bsp.planes[side.planeIndex];
      console.log(`    Plane: n=(${plane.normal[0].toFixed(2)}, ${plane.normal[1].toFixed(2)}, ${plane.normal[2].toFixed(2)}), d=${plane.dist.toFixed(1)}`);
    }
  }

  // Test traces at spawn points
  console.log("\n=== Spawn Point Collision Tests ===");
  for (let i = 0; i < Math.min(3, spawns.length); i++) {
    const spawn = spawns[i];
    const originStr = spawn.properties.origin || "0 0 0";
    const origin = originStr.split(' ').map(Number);
    // Entity origin is in Q3 coords: [x, y, z] where z=up
    
    console.log(`\nSpawn ${i+1}: Q3 origin = (${origin[0]}, ${origin[1]}, ${origin[2]})`);
    
    // Convert to Babylon coords for the trace API
    // Q3 (x, y, z) -> Babylon (x, z, y)
    const babylonPos = new Vector3(origin[0], origin[2], origin[1]);
    console.log(`  Babylon pos = (${babylonPos.x}, ${babylonPos.y}, ${babylonPos.z})`);
    
    // Trace DOWN in Babylon coords (negative Y)
    const downEnd = babylonPos.add(new Vector3(0, -500, 0));
    const downTrace = collision.traceBox(
      babylonPos,
      downEnd,
      new Vector3(-16, -24, -16),
      new Vector3(16, 32, 16),
      true // debug
    );
    console.log(`  Trace DOWN: frac=${downTrace.fraction.toFixed(3)}, startSolid=${downTrace.startSolid}`);
    if (downTrace.fraction < 1.0 && downTrace.plane) {
      console.log(`    Hit plane: n=(${downTrace.plane.normal[0].toFixed(2)}, ${downTrace.plane.normal[1].toFixed(2)}, ${downTrace.plane.normal[2].toFixed(2)}), d=${downTrace.plane.dist.toFixed(1)}`);
    }

    // Also test with point trace for comparison
    const pointTrace = collision.tracePoint(babylonPos, downEnd, true);
    console.log(`  Point trace DOWN: frac=${pointTrace.fraction.toFixed(3)}, startSolid=${pointTrace.startSolid}`);
  }

  console.log("\n=== Direct Q3 Coordinate Test ===");
  // Test tracing in raw Q3 coordinates (bypass the Babylon conversion)
  // Pick a point we know should be above ground
  if (spawns.length > 0) {
    const spawn = spawns[0];
    const originStr = spawn.properties.origin || "0 0 0";
    const q3Origin = originStr.split(' ').map(Number);
    
    // Trace directly in Q3 coords (z=up, so trace -z for down)
    // But the API expects Babylon coords, so we need to pass through conversion
    // Let's check what the internal trace sees
    console.log(`Testing raw Q3 origin: (${q3Origin[0]}, ${q3Origin[1]}, ${q3Origin[2]})`);
    
    // The issue might be: when we pass Babylon coords, it converts to Q3
    // But if spawn origins are already in Q3, we're double-converting!
    
    // Test 1: Pass Q3 coords directly as if they were Babylon (wrong, but let's see)
    const wrongPos = new Vector3(q3Origin[0], q3Origin[1], q3Origin[2]);
    const wrongEnd = wrongPos.add(new Vector3(0, -500, 0));
    const wrongTrace = collision.tracePoint(wrongPos, wrongEnd, false);
    console.log(`  If Q3 passed as Babylon: frac=${wrongTrace.fraction.toFixed(3)}, startSolid=${wrongTrace.startSolid}`);
    
    // Test 2: Pass correctly converted coords
    const rightPos = new Vector3(q3Origin[0], q3Origin[2], q3Origin[1]); // Babylon = (q3.x, q3.z, q3.y)
    const rightEnd = rightPos.add(new Vector3(0, -500, 0));
    const rightTrace = collision.tracePoint(rightPos, rightEnd, false);
    console.log(`  If Q3->Babylon converted: frac=${rightTrace.fraction.toFixed(3)}, startSolid=${rightTrace.startSolid}`);
  }

  console.log("\n[Collision] Test complete");
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
