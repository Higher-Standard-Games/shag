#!/usr/bin/env node

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { MapLoader } from "../engine/loader/map/MapLoader";

async function testCollisionAtSpawn(): Promise<void> {
  console.log("[Test] Starting collision mesh test at spawn point...\n");

  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mapLoader = MapLoader.getInstance();

  try {
    await mapLoader.loadMap("wdm2", scene, () => {});

    // Spawn position from previous logs.
    const spawnPos = new Vector3(-184, 224, 288);
    console.log(`[Test] Spawn position: (${spawnPos.x}, ${spawnPos.y}, ${spawnPos.z})\n`);

    const collisionMeshes = scene.meshes.filter((m) => m.checkCollisions);
    console.log(`[Test] Total collision meshes: ${collisionMeshes.length}\n`);

    const clipBrushMeshes = collisionMeshes.filter((m) => m.name.startsWith("clip_brush_"));
    console.log(`[Test] Clip brush collision meshes: ${clipBrushMeshes.length}\n`);

    const nearSpawn = collisionMeshes.filter((m) => Vector3.Distance(m.position, spawnPos) < 50);

    console.log(`[Test] Collision meshes within 50 units of spawn: ${nearSpawn.length}`);
    if (nearSpawn.length > 0) {
      console.log("[Test] WARNING: Collision meshes near spawn point!\n");
      nearSpawn.forEach((m) => {
        const dist = Vector3.Distance(m.position, spawnPos);
        const bounds = m.getBoundingInfo();
        const size = bounds.boundingBox.extendSize.scale(2);
        console.log(`  - "${m.name}"`);
        console.log(
          `    Position: (${m.position.x.toFixed(1)}, ${m.position.y.toFixed(1)}, ${m.position.z.toFixed(1)})`,
        );
        console.log(`    Distance from spawn: ${dist.toFixed(1)} units`);
        console.log(`    Size: (${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)})`);
        console.log(`    Metadata: ${JSON.stringify(m.metadata)}`);
        console.log("");
      });
    }

    console.log("[Test] Checking if spawn is inside any collision mesh...\n");
    let insideCount = 0;
    collisionMeshes.forEach((m) => {
      const bounds = m.getBoundingInfo();
      if (bounds.boundingBox.intersectsPoint(spawnPos)) {
        insideCount++;
        const size = bounds.boundingBox.extendSize.scale(2);
        console.log(`  - INSIDE "${m.name}"`);
        console.log(
          `    Position: (${m.position.x.toFixed(1)}, ${m.position.y.toFixed(1)}, ${m.position.z.toFixed(1)})`,
        );
        console.log(`    Size: (${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)})`);
        console.log(`    Metadata: ${JSON.stringify(m.metadata)}`);
        console.log("");
      }
    });

    if (insideCount > 0) {
      console.log(`[Test] ERROR: Spawn is inside ${insideCount} collision mesh(es)!`);
      console.log("[Test] This can explain spawn/camera getting stuck in collision geometry.\n");
    } else {
      console.log("[Test] Spawn is not inside any collision mesh (good)\n");
    }

    console.log("[Test] Sample clip brush mesh positions:");
    clipBrushMeshes.slice(0, 5).forEach((m) => {
      const bounds = m.getBoundingInfo();
      const size = bounds.boundingBox.extendSize.scale(2);
      console.log(`  - "${m.name}"`);
      console.log(`    Position: (${m.position.x.toFixed(1)}, ${m.position.y.toFixed(1)}, ${m.position.z.toFixed(1)})`);
      console.log(`    Size: (${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)})`);
      console.log(`    Metadata: ${JSON.stringify(m.metadata)}`);
    });
  } catch (error) {
    console.error("[Test] Error:", error);
    process.exitCode = 1;
  } finally {
    scene.dispose();
    engine.dispose();
  }

  console.log("\n[Test] Test complete");
}

void testCollisionAtSpawn();
