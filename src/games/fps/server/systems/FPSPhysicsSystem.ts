/**
 * FPS Physics System
 * Q3/Warsow style movement
 */

import { Subsystem, type SubsystemConfig } from '@engine/server/core/Subsystem';
import type { WorldState } from '@engine/server/core/WorldState';
import type { TickNumber } from '@engine/server/ecs/types';
import { EntityType } from '@engine/server/ecs/types';
import {
    moveGround,
    moveAir,
    applyGravity,
    applyJump,
    calculateWishDir,
} from '@shared/server/simulation/physics/movement';
import { MAX_GROUND_SPEED } from '@shared/server/simulation/physics/constants';

const CONFIG: SubsystemConfig = {
    name: 'FPSPhysics',
    priority: 10,
    tickRate: 125,
};

export class FPSPhysicsSystem extends Subsystem {
    constructor() {
        super(CONFIG);
    }

    update(state: WorldState, dt: number, _tick: TickNumber): void {
        // Process all player entities
        for (const entity of state.entitiesByType(EntityType.Player)) {
            if (!entity.transform || !entity.physics || !entity.input) continue;
            if (entity.health?.dead) continue;

            // Get mutable entity (COW)
            const mutable = state.getEntityMut(entity.id);
            if (!mutable || !mutable.transform || !mutable.physics || !mutable.input) continue;

            const input = mutable.input;
            const physics = mutable.physics;
            const transform = mutable.transform;

            // Calculate wish direction from input
            const wishDir = calculateWishDir(input.forward, input.right, input.yaw);
            const wishSpeed = MAX_GROUND_SPEED;

            // Apply movement based on ground state
            if (physics.grounded) {
                // Jump check
                if (input.jump && !physics.jumping) {
                    physics.velocity = applyJump(physics.velocity);
                    physics.grounded = false;
                    physics.jumping = true;
                } else {
                    physics.velocity = moveGround(physics.velocity, wishDir, wishSpeed, dt);
                }
            } else {
                // Air movement
                physics.velocity = moveAir(physics.velocity, wishDir, wishSpeed, dt);
                physics.velocity = applyGravity(physics.velocity, dt);
            }

            // Reset jumping flag when jump released
            if (!input.jump) {
                physics.jumping = false;
            }

            // Apply velocity to position
            // TODO: Use collision system for actual movement
            transform.position = {
                x: transform.position.x + physics.velocity.x * dt,
                y: transform.position.y + physics.velocity.y * dt,
                z: transform.position.z + physics.velocity.z * dt,
            };
        }
    }
}
