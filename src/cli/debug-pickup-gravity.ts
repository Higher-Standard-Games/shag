import { runCli } from "./_runCli";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Logger } from "@babylonjs/core/Misc/logger";
import { Scene } from "@babylonjs/core/scene";
import { FPSPickup } from "../games/fps/world/FPSPickup";

// Mute babylon noise
Logger.LogLevels = 0;

async function runTest() {
  console.log("=== STARTING PICKUP GRAVITY DEBUG ===");

  const engine = new NullEngine();
  const scene = new Scene(engine);

  // 1. Create a "Map" ground
  console.log("[Test] Creating Ground at Y=0");
  const ground = MeshBuilder.CreateBox("map_ground", { size: 100, height: 1 }, scene);
  ground.position.y = -0.5; // Top surface at Y=0
  ground.isPickable = true; // CRITICAL: This must be true for pickWithRay
  ground.checkCollisions = true;

  // 2. Create a "Pickup" high above
  const startPos = new Vector3(0, 50, 0);
  console.log(`[Test] Spawning Pickup at ${startPos}`);

  // We mock the options to strip visual stuff that might crash NullEngine if not careful,
  // though Pickup is fairly robust now.
  const pickup = new FPSPickup("test_pickup", scene, startPos, {
    id: "test_item",
    type: "weapon",
    value: "weapon_test",
    modelPath: "models/test.md3", // Won't load, will trigger fallback
    gravity: true,
  });

  // Wait a bit for async stuff (even though null engine is fast)
  // Pickup calls loadModel -> which is async
  console.log("[Test] Waiting for Pickup init...");
  await new Promise((r) => setTimeout(r, 100));

  // Check position
  console.log(`[Test] Pickup Y Position: ${pickup.position.y}`);

  if (pickup.position.y < 40) {
    console.log("SUCCESS: Pickup dropped to ground!");
  } else {
    console.error("FAILURE: Pickup is still floating high up!");

    // Debug: Try manual cast
    console.log("[Test] Retrying manual dropToGround call...");
    pickup.dropToGround();
    console.log(`[Test] Post-Manual Drop Y: ${pickup.position.y}`);
  }

  // Test with NON-PICKABLE ground
  console.log("\n[Test] Testing with NON-PICKABLE ground...");
  ground.isPickable = false;
  pickup.position.copyFrom(startPos);
  pickup.dropToGround();
  console.log(`[Test] Non-Pickable Ground Result Y: ${pickup.position.y} (Expected ~50)`);

  engine.dispose();
  console.log("=== TEST COMPLETE ===");
}

runCli(runTest);
