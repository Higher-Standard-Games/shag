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

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import * as fs from "fs";

// Import BSP loader
import { type BspFile, BspLoader } from "../engine/loader/bsp/BspLoader";

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

  const validCommands = ["info", "entities", "textures", "effects", "build", "test", "collision", "clipbrushes"];
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
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

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
      case "clipbrushes":
        analyzeClipBrushes(bsp);
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

function analyzeClipBrushes(bsp: BspFile): void {
  console.log("=== Clip Brush Analysis ===\n");

  const PLAYERCLIP = 0x10000;
  const SOLID = 0x1;
  const DETAIL = 0x8000000;

  let totalBrushes = 0;
  let clipByFlag = 0;
  let clipByName = 0;
  let solidClip = 0;
  let nonSolidClip = 0;

  const clipTextures: Map<string, { count: number; flags: number; solid: boolean }> = new Map();

  for (let bi = 0; bi < bsp.brushes.length; bi++) {
    const brush = bsp.brushes[bi];
    const texture = bsp.textures[brush.shaderIndex];
    if (!texture) continue;

    const contentFlags = texture.contentFlags;
    const texName = texture.name?.toLowerCase() || "";

    // Skip detail
    if (contentFlags & DETAIL) continue;

    const isPlayerClipByFlag = (contentFlags & PLAYERCLIP) !== 0;
    const isSolid = (contentFlags & SOLID) !== 0;
    const isClipByName =
      texName.includes("clip") ||
      texName.includes("fullclip") ||
      texName.includes("playerclip") ||
      texName.includes("common/clip") ||
      texName.includes("system/clip") ||
      texName === "nodraw";

    if (isPlayerClipByFlag || isClipByName) {
      totalBrushes++;
      if (isPlayerClipByFlag) clipByFlag++;
      if (isClipByName) clipByName++;
      if (isSolid) solidClip++;
      else nonSolidClip++;

      // Track by texture name
      const existing = clipTextures.get(texName);
      if (existing) {
        existing.count++;
      } else {
        clipTextures.set(texName, { count: 1, flags: contentFlags, solid: isSolid });
      }
    }
  }

  console.log(`Total clip brushes found: ${totalBrushes}`);
  console.log(`  By PLAYERCLIP flag: ${clipByFlag}`);
  console.log(`  By texture name: ${clipByName}`);
  console.log(`  With SOLID flag: ${solidClip}`);
  console.log(`  Without SOLID flag: ${nonSolidClip}`);
  console.log("");
  console.log("Clip textures breakdown:");

  for (const [name, info] of clipTextures) {
    console.log(`  "${name}": ${info.count} brushes, flags=0x${info.flags.toString(16)}, solid=${info.solid}`);
  }

  console.log("");
  console.log(`With fix: Should generate ${totalBrushes} collision meshes (was only ${nonSolidClip} before)`);

  // Test bounds computation
  console.log("\nTesting bounds computation...");
  let boundsSuccess = 0;
  let boundsFail = 0;

  for (let bi = 0; bi < bsp.brushes.length; bi++) {
    const brush = bsp.brushes[bi];
    const texture = bsp.textures[brush.shaderIndex];
    if (!texture) continue;

    const texName = texture.name?.toLowerCase() || "";
    const isClip = texName.includes("clip");
    if (!isClip) continue;

    // Test bounds computation using plane intersection
    const planes: { nx: number; ny: number; nz: number; d: number }[] = [];
    for (let i = 0; i < brush.numSides; i++) {
      const side = bsp.brushSides[brush.firstSide + i];
      if (!side) continue;
      const plane = bsp.planes[side.planeIndex];
      if (!plane) continue;
      planes.push({ nx: plane.normal[0], ny: plane.normal[1], nz: plane.normal[2], d: plane.dist });
    }

    // Find vertices
    const vertices: [number, number, number][] = [];
    for (let i = 0; i < planes.length - 2; i++) {
      for (let j = i + 1; j < planes.length - 1; j++) {
        for (let k = j + 1; k < planes.length; k++) {
          const v = intersect3Planes(planes[i], planes[j], planes[k]);
          if (v && isInsidePlanes(v, planes)) {
            vertices.push(v);
          }
        }
      }
    }

    if (vertices.length >= 4) boundsSuccess++;
    else boundsFail++;
  }

  console.log(`  Bounds computed successfully: ${boundsSuccess}`);
  console.log(`  Bounds computation failed: ${boundsFail}`);
}

function intersect3Planes(
  p1: { nx: number; ny: number; nz: number; d: number },
  p2: { nx: number; ny: number; nz: number; d: number },
  p3: { nx: number; ny: number; nz: number; d: number },
): [number, number, number] | null {
  const n2xn3_x = p2.ny * p3.nz - p2.nz * p3.ny;
  const n2xn3_y = p2.nz * p3.nx - p2.nx * p3.nz;
  const n2xn3_z = p2.nx * p3.ny - p2.ny * p3.nx;
  const denom = p1.nx * n2xn3_x + p1.ny * n2xn3_y + p1.nz * n2xn3_z;
  if (Math.abs(denom) < 0.0001) return null;
  const n3xn1_x = p3.ny * p1.nz - p3.nz * p1.ny;
  const n3xn1_y = p3.nz * p1.nx - p3.nx * p1.nz;
  const n3xn1_z = p3.nx * p1.ny - p3.ny * p1.nx;
  const n1xn2_x = p1.ny * p2.nz - p1.nz * p2.ny;
  const n1xn2_y = p1.nz * p2.nx - p1.nx * p2.nz;
  const n1xn2_z = p1.nx * p2.ny - p1.ny * p2.nx;
  const invD = 1.0 / denom;
  return [
    (p1.d * n2xn3_x + p2.d * n3xn1_x + p3.d * n1xn2_x) * invD,
    (p1.d * n2xn3_y + p2.d * n3xn1_y + p3.d * n1xn2_y) * invD,
    (p1.d * n2xn3_z + p2.d * n3xn1_z + p3.d * n1xn2_z) * invD,
  ];
}

function isInsidePlanes(
  pt: [number, number, number],
  planes: { nx: number; ny: number; nz: number; d: number }[],
): boolean {
  for (const p of planes) {
    const dist = pt[0] * p.nx + pt[1] * p.ny + pt[2] * p.nz - p.d;
    if (Math.abs(dist) > 10000) return false; // Reject obviously invalid points
  }
  return true;
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
  console.log("\n=== BSP Collision Test (SweepCollisionBackend) ===");
  console.log(`Brushes: ${bsp.brushes.length}, Planes: ${bsp.planes.length}\n`);

  // Use the same collision backend as the actual game
  const { SweepCollisionBackend } = await import("../engine/physics/SweepCollisionBackend");
  const backend = new SweepCollisionBackend();
  await backend.init(bsp);

  // Find spawn points for test positions
  const spawns = bsp.entities.filter(
    (e) => e.classname === "info_player_deathmatch" || e.classname === "info_player_start",
  );

  console.log(`Found ${spawns.length} spawn points\n`);

  // Analyze coordinate system by checking vertex bounds vs brush bounds
  console.log("=== Coordinate Analysis ===");

  // Get vertex bounds (Q3 coords as stored in BSP)
  let vMinX = Infinity,
    vMaxX = -Infinity;
  let vMinY = Infinity,
    vMaxY = -Infinity;
  let vMinZ = Infinity,
    vMaxZ = -Infinity;
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
      console.log(
        `    Plane: n=(${plane.normal[0].toFixed(2)}, ${plane.normal[1].toFixed(2)}, ${plane.normal[2].toFixed(2)}), d=${plane.dist.toFixed(1)}`,
      );
    }
  }

  // Test traces at spawn points using SweepCollisionBackend
  console.log("\n=== Spawn Point Collision Tests ===");
  for (let i = 0; i < Math.min(3, spawns.length); i++) {
    const spawn = spawns[i];
    const originStr = spawn.properties.origin || "0 0 0";
    const origin = originStr.split(" ").map(Number);

    console.log(`\nSpawn ${i + 1}: Q3 origin = (${origin[0]}, ${origin[1]}, ${origin[2]})`);

    // Convert to Babylon coords: Q3 (x, y, z) -> Babylon (x, z, y)
    const babylonPos = new Vector3(origin[0], origin[2], origin[1]);
    console.log(`  Babylon pos = (${babylonPos.x}, ${babylonPos.y}, ${babylonPos.z})`);

    // Trace DOWN in Babylon coords (negative Y)
    const downEnd = babylonPos.add(new Vector3(0, -500, 0));
    const downTrace = backend.trace(babylonPos, downEnd, { radius: 16, height: 56 });
    console.log(`  Trace DOWN: frac=${downTrace.fraction.toFixed(3)}, startSolid=${downTrace.startSolid}`);
    if (downTrace.fraction < 1.0 && downTrace.normal) {
      console.log(
        `    Hit normal: (${downTrace.normal.x.toFixed(2)}, ${downTrace.normal.y.toFixed(2)}, ${downTrace.normal.z.toFixed(2)})`,
      );
    }

    // Point trace for comparison
    const pointTrace = backend.trace(babylonPos, downEnd);
    console.log(`  Point trace DOWN: frac=${pointTrace.fraction.toFixed(3)}, startSolid=${pointTrace.startSolid}`);
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
