/**
 * PickupVisual — the visual half of an in-world collectible, decoupled from the
 * generic `Pickup` lifecycle (see docs/research/PROCEDURAL_ITEMS.md).
 *
 * `Pickup` owns the authoritative concerns (position, ground placement,
 * proximity, server-driven active state, respawn timing, disposal). A
 * `PickupVisual` owns ONLY the rendered representation: geometry, materials,
 * cosmetic animation, and active/collect/respawn transitions. It must never
 * write back into the authoritative pickup position or collection range.
 *
 * The default (model-backed) visual is the existing MD3/GLB leader-mesh path
 * baked into `Pickup.loadModel()`. When `PickupOptions.visualFactory` is
 * supplied, `Pickup` builds a `PickupVisual` instead and routes update / active
 * / dispose through it. This is the seam FPS health and armor use to inject
 * their procedural sculptures without a new map entity or network identity.
 */

import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { PickupOptions } from "./Pickup";

export interface PickupVisual {
  /**
   * Fixed world anchor for the visual. Non-bobbing — only its children animate.
   * Kept enabled for the visual's whole life so detached collection transients
   * (parented here) survive the persistent geometry being hidden on collection.
   */
  readonly root: TransformNode;

  /**
   * Advance cosmetic animation. `dt` is seconds since the previous frame;
   * `elapsed` is a monotonically increasing seconds clock (seeded per pickup so
   * items don't animate in lockstep). Purely cosmetic — never authoritative.
   */
  update(dt: number, elapsed: number): void;

  /**
   * Reconcile to the server's authoritative active state. The FIRST call after
   * construction applies visibility silently (fail-closed: no collection or
   * respawn burst at map start / late join). Subsequent real transitions play
   * the collection (active→inactive) or respawn-assembly (inactive→active)
   * effect. Idempotent for unchanged state.
   */
  setActive(active: boolean): void;

  /** Dispose all owned meshes, private materials, and in-flight transients. */
  dispose(): void;
}

/** Context handed to a factory when `Pickup` builds a procedural visual. */
export interface PickupVisualFactoryContext {
  scene: Scene;
  /** Final server-aligned world position (the cosmetic hover center). */
  position: Vector3;
  /** The full pickup options (registry id, pickupId seed, serverManagedRespawn). */
  options: PickupOptions;
}

/**
 * Builds a `PickupVisual` for a pickup. Returns `null` to decline (e.g. no
 * recipe for this id), in which case `Pickup` falls back to the model path.
 */
export type PickupVisualFactory = (ctx: PickupVisualFactoryContext) => PickupVisual | null;
