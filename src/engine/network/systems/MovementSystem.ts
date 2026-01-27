import { GameSystem } from '../core/Simulation';
import type { GameState } from '../core/GameState';
import { TransformComponent } from '../components/TransformComponent';
import { VelocityComponent } from '../components/VelocityComponent';
import { InputComponent } from '../components/InputComponent';
import { MovementStateComponent } from '../components/MovementStateComponent';
import type { MovementProfile, MovementInput } from './movement/MovementProfile';
import type { CollisionWorld } from './collision/CollisionWorld';

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
    for (const [_entityId, entity] of state.entities) {
      // Get required components
      const transform = entity.getComponent<TransformComponent>('transform');
      const velocity = entity.getComponent<VelocityComponent>('velocity');

      // Skip entities without transform and velocity
      if (!transform || !velocity) continue;

      // Get optional input component (for player-controlled entities)
      const input = entity.getComponent<InputComponent>('input');

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
        this.collision
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
      const movementState = entity.getComponent<MovementStateComponent>('movementState');
      if (movementState) {
        const advancedResult = result as {
          isSliding?: boolean;
          isCrouching?: boolean;
          crouchViewOffset?: number;
          wallJumpState?: 'none' | 'available' | 'charging';
          ledgeGrabState?: 'none' | 'grabbing' | 'pulling';
          actualHorizSpeed?: number;
        };
        movementState.updateFrom(advancedResult);
      }
    }
  }
}
