import type { LiftActor } from "../../../shared/bsp/LiftSystem";
import type { InputComponent } from "../components/InputComponent";
import type { MovementStateComponent } from "../components/MovementStateComponent";
import type { TransformComponent } from "../components/TransformComponent";
import type { VelocityComponent } from "../components/VelocityComponent";
import type { GameState } from "../core/GameState";
import { GameSystem } from "../core/Simulation";
import type { CollisionWorld } from "./collision/CollisionWorld";
import type { MovementInput, MovementProfile } from "./movement/MovementProfile";

/**
 * MovementSystem - Generic movement processing
 *
 * Processes all entities that have:
 * - TransformComponent (position)
 * - VelocityComponent (velocity)
 * - Optionally InputComponent (player-controlled)
 *
 * Uses a pluggable MovementProfile for game-specific physics:
 * - Q3Movement for FPS
 * - TopDownMovement for hack'n'slash
 * - VehicleMovement for racing
 *
 * This system is completely game-agnostic.
 */
export class MovementSystem extends GameSystem {
  private profile: MovementProfile;
  private collision: CollisionWorld | null;

  constructor(profile: MovementProfile, collision: CollisionWorld | null = null) {
    super();
    this.profile = profile;
    this.collision = collision;
  }

  /**
   * Set the collision world (can be changed at runtime)
   */
  setCollisionWorld(collision: CollisionWorld | null): void {
    this.collision = collision;
    console.log(`[MovementSystem] setCollisionWorld: ${collision ? collision.constructor.name : "null"}`);
  }

  /**
   * Set the movement profile (can be changed at runtime)
   */
  setMovementProfile(profile: MovementProfile): void {
    this.profile = profile;
  }

  /**
   * Get current profile name for debugging
   */
  getProfileName(): string {
    return this.profile.getName();
  }

  update(state: GameState, deltaTime: number): void {
    if (this.collision?.lifts?.definitions.length) {
      const actors: LiftActor[] = [];
      // Everything with a body rides; only an input-driven body calls a lift.
      for (const entity of state.entities.values()) {
        const transform = entity.getComponent<TransformComponent>("transform");
        const velocity = entity.getComponent<VelocityComponent>("velocity");
        if (transform && velocity)
          actors.push({
            position: transform.position,
            velocity: velocity.linear,
            passive: !entity.getComponent("input"),
          });
      }
      this.collision.lifts.step(deltaTime, actors);
    }
    for (const [_entityId, entity] of state.entities) {
      // Get required components
      const transform = entity.getComponent<TransformComponent>("transform");
      const velocity = entity.getComponent<VelocityComponent>("velocity");

      // Skip entities without transform and velocity
      if (!transform || !velocity) continue;

      // Get optional input component (for player-controlled entities)
      const input = entity.getComponent<InputComponent>("input");

      // Create movement input from InputComponent
      let movementInput: MovementInput | null = null;

      if (input) {
        movementInput = {
          direction: input.moveDirection,
          viewAngles: input.viewAngles,
          buttons: input.buttons,
          isPressed: (button: number) => input.isPressed(button),
        };
      }

      // Run movement simulation
      const result = this.profile.simulate(
        transform.position,
        velocity.linear,
        movementInput,
        deltaTime,
        this.collision,
      );

      // Apply results
      transform.position = result.position;
      velocity.linear = result.velocity;
      velocity.grounded = result.grounded;

      // Apply rotation if provided
      if (result.rotation) {
        transform.rotation = result.rotation;
      }

      // Update advanced movement state if component exists
      // The result may be an extended type (like AdvancedMovementResult) with additional fields
      const movementState = entity.getComponent<MovementStateComponent>("movementState");
      if (movementState) {
        const advancedResult = result as {
          isSliding?: boolean;
          isCrouching?: boolean;
          crouchViewOffset?: number;
          wallJumpState?: "none" | "available" | "charging";
          ledgeGrabState?: "none" | "grabbing" | "pulling";
          actualHorizSpeed?: number;
          waterLevel?: 0 | 1 | 2 | 3;
        };
        movementState.updateFrom(advancedResult);
      }
    }

    // After all movement: push overlapping players apart (Q3-style)
    this.separatePlayers(state);
  }

  // ────────────────────────────────────────────────────────────────
  // Player-vs-player collision (post-movement separation)
  // ────────────────────────────────────────────────────────────────

  /** Player cylinder radius for entity-entity blocking */
  private static readonly PLAYER_RADIUS = 16;
  /** Combined radius: two players touching */
  private static readonly SEPARATION_DIST = MovementSystem.PLAYER_RADIUS * 2; // 32
  /** Player bounds Y: origin at waist, -24 feet to +32 head */
  private static readonly PLAYER_MIN_Y = -24;
  private static readonly PLAYER_MAX_Y = 32;

  /**
   * Block overlapping players without pushing — Q3-style entity blocking.
   * Each entity is independently pushed back from all others it overlaps.
   * Uses immutable position snapshots so iteration order doesn't matter.
   */
  private separatePlayers(state: GameState): void {
    // Snapshot positions (immutable during resolution)
    const entities: { id: string; x: number; y: number; z: number; transform: TransformComponent }[] = [];
    for (const [id, entity] of state.entities) {
      const t = entity.getComponent<TransformComponent>("transform");
      if (t) entities.push({ id, x: t.position.x, y: t.position.y, z: t.position.z, transform: t });
    }

    const sepDist = MovementSystem.SEPARATION_DIST;
    const sepDistSq = sepDist * sepDist;

    // For each entity, resolve against all others independently
    for (let i = 0; i < entities.length; i++) {
      const me = entities[i];
      let pushX = 0;
      let pushZ = 0;

      for (let j = 0; j < entities.length; j++) {
        if (i === j) continue;
        const other = entities[j];

        // Y overlap check (cylinder)
        const meBottom = me.y + MovementSystem.PLAYER_MIN_Y;
        const meTop = me.y + MovementSystem.PLAYER_MAX_Y;
        const otherBottom = other.y + MovementSystem.PLAYER_MIN_Y;
        const otherTop = other.y + MovementSystem.PLAYER_MAX_Y;
        if (meTop <= otherBottom || otherTop <= meBottom) continue;

        // XZ distance (from snapshot)
        const dx = me.x - other.x;
        const dz = me.z - other.z;
        const distSq = dx * dx + dz * dz;
        if (distSq >= sepDistSq) continue;

        const dist = Math.sqrt(distSq);
        const overlap = sepDist - dist;

        if (dist > 0.001) {
          const nx = dx / dist;
          const nz = dz / dist;
          pushX += nx * overlap;
          pushZ += nz * overlap;
        } else {
          // Exactly overlapping — push in arbitrary direction
          pushX += overlap;
        }
      }

      // Apply accumulated push to this entity only
      if (pushX !== 0 || pushZ !== 0) {
        me.transform.position.x += pushX;
        me.transform.position.z += pushZ;
      }
    }
  }
}
