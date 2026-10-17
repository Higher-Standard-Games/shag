/**
 * HeadlessBSPCollisionWorld - Server-side factory for SharedCollisionWorld
 *
 * Creates a SweepCollisionBackend from BSP data and wraps it in
 * SharedCollisionWorld — the same code used by the client.
 *
 * This guarantees physics parity between client and server.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { BspCollisionData } from "../engine/loader/bsp/BspLoader";
import { SweepBackendAdapter } from "../engine/physics/SweepBackendAdapter";
import { SweepCollisionBackend } from "../engine/physics/SweepCollisionBackend";
import type { CollisionWorld } from "../shared/collision/CollisionWorld";
import { SharedCollisionWorld } from "../shared/collision/SharedCollisionWorld";

/**
 * Create a server-side CollisionWorld from BSP data.
 *
 * Returns SharedCollisionWorld (same code as client) wrapping a fresh
 * SweepCollisionBackend initialized with the BSP.
 */
export async function createHeadlessCollisionWorld(bsp: BspCollisionData): Promise<CollisionWorld> {
  const backend = new SweepCollisionBackend();
  await backend.init(bsp);

  console.log("[HeadlessBSPCollisionWorld] Initialized with SweepCollisionBackend");

  // Debug: Test a trace to verify collision works
  const testStart = new Vector3(880, 200, 1508);
  const testEnd = new Vector3(880, 0, 1508);
  const testResult = backend.trace(testStart, testEnd, { radius: 16, height: 56 });
  console.log(
    `[HeadlessBSPCollisionWorld] Test trace: fraction=${testResult.fraction.toFixed(4)}, hit=${testResult.fraction < 1}`,
  );

  // Adapter converts structural Vec3 <-> Babylon at the engine boundary (QA-WO8)
  return new SharedCollisionWorld(new SweepBackendAdapter(backend));
}

// Re-export for backward compatibility
export { SharedCollisionWorld as HeadlessBSPCollisionWorld } from "../shared/collision/SharedCollisionWorld";
