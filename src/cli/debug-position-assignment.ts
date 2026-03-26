/**
 * Headless test to verify TransformNode position assignment behavior
 * Tests whether full Vector3 assignment properly updates position
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Logger } from "@babylonjs/core/Misc/logger";
import { Scene } from "@babylonjs/core/scene";

// Suppress Babylon.js noise
Logger.LogLevels = 0;

async function runTest() {
  console.log("=== HEADLESS TRANSFORMNODE POSITION TEST ===\n");

  const engine = new NullEngine();
  const scene = new Scene(engine);

  // Test 1: Basic TransformNode position assignment
  console.log("[Test 1] Basic TransformNode position assignment");
  const node = new TransformNode("test_node", scene);

  // Set initial position
  node.position = new Vector3(100, 500, 100);
  console.log(`  Initial position: ${node.position}`);
  console.log(`  Initial Y: ${node.position.y}`);

  // Test direct Y modification
  node.position.y = 50;
  console.log(`  After .y = 50: ${node.position.y}`);

  // Test full Vector3 assignment
  const newY = 25;
  node.position = new Vector3(node.position.x, newY, node.position.z);
  console.log(`  After full Vector3 assignment (newY=${newY}): ${node.position.y}`);
  console.log(`  Full position: ${node.position}`);

  // Test 2: TransformNode with child mesh (like Pickup)
  console.log("\n[Test 2] TransformNode with child mesh");
  const parent = new TransformNode("parent", scene);
  parent.position = new Vector3(0, 400, 0);
  console.log(`  Parent initial: ${parent.position}`);

  const childBox = MeshBuilder.CreateBox("child", { size: 32 }, scene);
  childBox.parent = parent;
  childBox.position.y = 16; // Local offset

  console.log(`  Child local position: ${childBox.position}`);
  console.log(`  Child world position before drop: ${childBox.getAbsolutePosition()}`);

  // Now "drop" the parent
  const groundY = 100;
  const offset = 16;
  const targetY = groundY + offset;
  console.log(`  Target Y: ${targetY} (ground=${groundY}, offset=${offset})`);

  // Method A: Full Vector3 assignment
  parent.position = new Vector3(parent.position.x, targetY, parent.position.z);
  console.log(`  After drop - parent.position.y: ${parent.position.y}`);
  console.log(`  After drop - child world Y: ${childBox.getAbsolutePosition().y}`);

  // Test 3: Verify Pickup-like class
  console.log("\n[Test 3] Pickup-like class extending TransformNode");

  class TestPickup extends TransformNode {
    constructor(name: string, scene: Scene, position: Vector3) {
      super(name, scene);
      console.log(`  Constructor: setting position to ${position}`);
      this.position = position;
      console.log(`  After constructor assignment: ${this.position}`);
    }

    dropTo(newY: number) {
      console.log(`  dropTo(${newY}): current position = ${this.position}`);
      console.log(`  dropTo: current Y = ${this.position.y}`);

      // Method A: Full assignment
      this.position = new Vector3(this.position.x, newY, this.position.z);

      console.log(`  dropTo: after assignment, Y = ${this.position.y}`);
    }
  }

  const spawnPos = new Vector3(100, 600, 100);
  const pickup = new TestPickup("test_pickup", scene, spawnPos);
  console.log(`  Created pickup at Y=${pickup.position.y}`);

  // Add child
  const debugBox = MeshBuilder.CreateBox("debug", { size: 32 }, scene);
  debugBox.parent = pickup;
  debugBox.position.y = 16;

  console.log(`  Debug box world Y before drop: ${debugBox.getAbsolutePosition().y}`);

  // Drop it
  pickup.dropTo(116);

  console.log(`  After drop:`);
  console.log(`    pickup.position.y = ${pickup.position.y}`);
  console.log(`    debug box world Y = ${debugBox.getAbsolutePosition().y}`);

  // Test 4: Check if external reference matters
  console.log("\n[Test 4] External Vector3 reference");
  const externalPos = new Vector3(0, 500, 0);
  const node2 = new TransformNode("node2", scene);
  node2.position = externalPos;
  console.log(`  After assigning external ref: node2.position.y = ${node2.position.y}`);
  console.log(`  Are they same object? ${node2.position === externalPos}`);

  // Modify via node
  node2.position = new Vector3(0, 100, 0);
  console.log(`  After new assignment:`);
  console.log(`    node2.position.y = ${node2.position.y}`);
  console.log(`    externalPos.y = ${externalPos.y}`);
  console.log(`    Are they same object? ${node2.position === externalPos}`);

  engine.dispose();
  console.log("\n=== TEST COMPLETE ===");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
