/**
 * Comprehensive headless test to verify computeWorldMatrix fixes child positions
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Logger } from "@babylonjs/core/Misc/logger";
import { Scene } from "@babylonjs/core/scene";
import { runCli } from "./_runCli";

Logger.LogLevels = 0;

async function runTest() {
  console.log("=== COMPREHENSIVE PICKUP POSITION TEST ===\n");

  const engine = new NullEngine();
  const scene = new Scene(engine);

  // Simulate exact Pickup behavior
  console.log("[Test] Simulating Pickup flow...");

  // Step 1: Create parent (Pickup) at high Y position
  const pickup = new TransformNode("pickup", scene);
  const spawnY = 600;
  pickup.position = new Vector3(100, spawnY, 100);
  console.log(`  [1] Created pickup at Y=${pickup.position.y}`);

  // Step 2: Create debug box as child with local offset
  const debugBox = MeshBuilder.CreateBox("debug", { size: 32 }, scene);
  debugBox.parent = pickup;
  debugBox.position.y = 16; // Local offset
  console.log(`  [2] Created debug box with local Y=${debugBox.position.y}`);
  console.log(`      Debug box world Y (before any change): ${debugBox.getAbsolutePosition().y}`);

  // Step 3: Simulate dropToGround
  const groundY = 100;
  const offset = 16;
  const newY = groundY + offset;
  console.log(`  [3] Ground at Y=${groundY}, offset=${offset}, newY=${newY}`);

  // Method: Full Vector3 assignment + computeWorldMatrix
  console.log(`\n[Test] Applying position change...`);
  console.log(`  Before: pickup.position.y = ${pickup.position.y}`);
  console.log(`  Before: debugBox world Y = ${debugBox.getAbsolutePosition().y}`);

  pickup.position = new Vector3(pickup.position.x, newY, pickup.position.z);
  console.log(`  After assignment: pickup.position.y = ${pickup.position.y}`);
  console.log(`  After assignment (no compute): debugBox world Y = ${debugBox.getAbsolutePosition().y}`);

  // Force compute on parent
  pickup.computeWorldMatrix(true);
  console.log(`  After parent.computeWorldMatrix: debugBox world Y = ${debugBox.getAbsolutePosition().y}`);

  // Force compute on child
  debugBox.computeWorldMatrix(true);
  console.log(`  After debugBox.computeWorldMatrix: debugBox world Y = ${debugBox.getAbsolutePosition().y}`);

  // Try getChildMeshes approach
  pickup.getChildMeshes().forEach((m) => {
    m.computeWorldMatrix(true);
  });
  console.log(`  After getChildMeshes().computeWorldMatrix: debugBox world Y = ${debugBox.getAbsolutePosition().y}`);

  // Step 4: Check what getAbsolutePosition actually returns
  console.log(`\n[Test] Investigating getAbsolutePosition...`);
  const absPos = debugBox.getAbsolutePosition();
  console.log(`  getAbsolutePosition() returns: ${absPos}`);
  console.log(`  Expected: (100, ${newY + 16}, 100) = (100, ${newY + 16}, 100)`);

  // Check world matrix directly
  const worldMatrix = debugBox.getWorldMatrix();
  console.log(
    `  World matrix translation: [${worldMatrix.m[12]?.toFixed(1)}, ${worldMatrix.m[13]?.toFixed(1)}, ${worldMatrix.m[14]?.toFixed(1)}]`,
  );

  // Step 5: Alternative approach - set absolute position
  console.log(`\n[Test] Trying setAbsolutePosition...`);
  const targetAbsPos = new Vector3(100, newY, 100);
  pickup.setAbsolutePosition(targetAbsPos);
  pickup.computeWorldMatrix(true);
  debugBox.computeWorldMatrix(true);
  console.log(`  After setAbsolutePosition: pickup.position.y = ${pickup.position.y}`);
  console.log(`  After setAbsolutePosition: debugBox world Y = ${debugBox.getAbsolutePosition().y}`);

  // Step 6: Try with forceUpdate on scene
  console.log(`\n[Test] Trying scene render...`);
  scene.render(); // This should update all matrices
  console.log(`  After scene.render(): debugBox world Y = ${debugBox.getAbsolutePosition().y}`);

  // Step 7: Ultimate test - create child AFTER parent is at correct position
  console.log(`\n[Test] Creating child AFTER position change...`);
  const pickup2 = new TransformNode("pickup2", scene);
  pickup2.position = new Vector3(200, 600, 200);
  console.log(`  pickup2 initial Y: ${pickup2.position.y}`);

  // Change position first
  pickup2.position = new Vector3(200, 116, 200);
  pickup2.computeWorldMatrix(true);
  console.log(`  pickup2 after drop Y: ${pickup2.position.y}`);

  // THEN create child
  const debugBox2 = MeshBuilder.CreateBox("debug2", { size: 32 }, scene);
  debugBox2.parent = pickup2;
  debugBox2.position.y = 16;
  debugBox2.computeWorldMatrix(true);
  console.log(`  debugBox2 world Y: ${debugBox2.getAbsolutePosition().y}`);
  console.log(`  Expected: ${116 + 16} = 132`);

  engine.dispose();
  console.log("\n=== TEST COMPLETE ===");
}

runCli(runTest);
