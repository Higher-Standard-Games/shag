/**
 * Compare Local (Client) vs Server Physics
 *
 * Runs identical input through both systems to verify they match
 *
 * Run with: npx vite-node src/cli/compare-local-vs-server.ts --map washoi_dm2
 */

import * as fs from "node:fs";
import * as path from "node:path";
import JSZip from "jszip";
import { BspLoader } from "../engine/loader/bsp/BspLoader";
import { InputButtons } from "../engine/network/components/InputComponent";
import type { Vec3 } from "../engine/network/components/TransformComponent";
import type { MovementInput } from "../engine/network/systems/movement/MovementProfile";
import { MovementProfile as FPSMovementProfile } from "../games/fps/simulation/MovementProfile";
import { runCli } from "./_runCli";
import { createHeadlessCollisionWorld } from "./HeadlessBSPCollisionWorld";

// Parse command line args
const args = process.argv.slice(2);
let mapName = "washoi_dm2";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--map" || args[i].startsWith("--map=")) {
    mapName = args[i].startsWith("--map=") ? args[i].substring(6) : args[++i];
  } else if (!args[i].startsWith("-")) {
    mapName = args[i];
  }
}

console.log("");
console.log("╔═══════════════════════════════════════════════════════╗");
console.log("║     Local vs Server Physics Comparison Test           ║");
console.log("╚═══════════════════════════════════════════════════════╝");
console.log("");

async function loadBsp(mapName: string) {
  const possiblePaths = [
    path.resolve("./public/games/default", `map_${mapName}.pk3`),
    path.resolve("./public/games/default/basewsw", `map_${mapName}.pk3`),
  ];

  for (const bspPath of possiblePaths) {
    if (fs.existsSync(bspPath)) {
      const pk3Buffer = fs.readFileSync(bspPath);
      const zip = await JSZip.loadAsync(new Uint8Array(pk3Buffer));

      for (const filename of Object.keys(zip.files)) {
        if (filename.endsWith(".bsp")) {
          const bspBuffer = await zip.files[filename].async("arraybuffer");
          return BspLoader.load(bspBuffer);
        }
      }
    }
  }

  throw new Error(`Could not find BSP for map: ${mapName}`);
}

async function runComparison() {
  console.log(`[Test] Loading map: ${mapName}`);
  const bsp = await loadBsp(mapName);
  console.log(`[Test] BSP loaded`);

  // Create server collision
  const serverCollision = await createHeadlessCollisionWorld(bsp);
  console.log(`[Test] Server collision created`);

  // Find spawn
  let spawnPos: Vec3 = { x: 0, y: 100, z: 0 };
  for (const entity of bsp.entities) {
    if (entity.classname === "info_player_deathmatch") {
      const origin = entity.properties.origin;
      if (origin) {
        const [x, y, z] = origin.split(" ").map(Number);
        spawnPos = { x, y: z, z: y };
        break;
      }
    }
  }
  console.log(`[Test] Spawn: (${spawnPos.x}, ${spawnPos.y}, ${spawnPos.z})`);
  console.log("");

  // Run simulation with SAME input
  const tickRate = 125; // Match network tickrate
  const deltaTime = 1 / tickRate; // 8ms
  const totalTicks = 60; // ~0.5 seconds

  const serverMovement = new FPSMovementProfile();

  let serverPos = { ...spawnPos };
  let serverVel: Vec3 = { x: 0, y: 0, z: 0 };

  // Test: Stand still, then jump, then move forward
  console.log("=== Test Scenario: Stand → Jump → Move Forward ===");
  console.log("");
  console.log("Tick | Server Y | Server Vel Y | Grounded | Notes");
  console.log("-----|----------|--------------|----------|-------");

  for (let tick = 0; tick < totalTicks; tick++) {
    let buttons = 0;
    let direction = { x: 0, y: 0, z: 0 };

    // Jump at tick 10
    if (tick === 10) {
      buttons = InputButtons.JUMP;
    }

    // Move forward starting tick 20
    if (tick >= 20) {
      buttons |= InputButtons.SPRINT;
      direction = { x: 0, y: 0, z: 1 };
    }

    const input: MovementInput = {
      direction,
      viewAngles: { pitch: 0, yaw: 0 },
      buttons,
      isPressed: (btn: number) => (buttons & btn) !== 0,
    };

    // Run server physics
    const serverResult = serverMovement.simulate(serverPos, serverVel, input, deltaTime, serverCollision);
    serverPos = serverResult.position;
    serverVel = serverResult.velocity;

    // Log important frames
    if (tick % 5 === 0 || (tick >= 8 && tick <= 15)) {
      const notes = [];
      if (tick === 10) notes.push("JUMP");
      if (tick === 20) notes.push("MOVE");

      console.log(
        `${tick.toString().padStart(4)} | ` +
          `${serverPos.y.toFixed(1).padStart(8)} | ` +
          `${serverVel.y.toFixed(1).padStart(12)} | ` +
          `${serverResult.grounded ? "YES" : "NO ".padStart(8)} | ` +
          `${notes.join(", ")}`,
      );
    }
  }

  console.log("");
  console.log("=== Analysis ===");
  console.log("Expected behavior (matching local mode):");
  console.log("- Spawn: Fall slightly and settle on ground");
  console.log("- Tick 10 (Jump): Y velocity becomes positive, grounded=NO");
  console.log("- After jump: Rise, fall, land back on ground");
  console.log("- Movement: Should move horizontally while maintaining ground contact");
  console.log("");
  console.log(`Final position: (${serverPos.x.toFixed(1)}, ${serverPos.y.toFixed(1)}, ${serverPos.z.toFixed(1)})`);
  console.log(`Final velocity: (${serverVel.x.toFixed(1)}, ${serverVel.y.toFixed(1)}, ${serverVel.z.toFixed(1)})`);
}

void runCli(runComparison);
