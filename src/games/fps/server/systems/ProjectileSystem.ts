/**
 * Projectile System
 * 
 * Handles projectile movement and collision.
 * Works for any projectile-based combat system.
 */

import { Subsystem, type SubsystemConfig } from '@engine/server/core/Subsystem';
import type { WorldState } from '@engine/server/core/WorldState';
import type { TickNumber, EntityId } from '@engine/server/ecs/types';
import { EntityType } from '@engine/server/ecs/types';
import { DamageType, type DamageEvent, HitLocation } from './CombatSystem';
import { WEAPONS } from '../weapons/WeaponDef';

const CONFIG: SubsystemConfig = {
    name: 'Projectile',
    priority: 20, // Early, so explosions happen before combat
    tickRate: 125,
};

// ═══════════════════════════════════════════════════════════════════
// PROJECTILE SYSTEM
// ═══════════════════════════════════════════════════════════════════

export class ProjectileSystem extends Subsystem {
    private pendingDamage: DamageEvent[] = [];
    private projectilesToRemove: EntityId[] = [];
    private maxLifetimeTicks: number = 500; // 4 seconds at 125Hz
    private projectileAges: Map<EntityId, number> = new Map();

    constructor() {
        super(CONFIG);
    }

    /**
     * Get pending damage events
     */
    getPendingDamage(): DamageEvent[] {
        const events = this.pendingDamage;
        this.pendingDamage = [];
        return events;
    }

    update(state: WorldState, dt: number, _tick: TickNumber): void {
        this.projectilesToRemove = [];

        // Process all projectiles
        for (const projectile of state.entitiesByType(EntityType.Projectile)) {
            if (!projectile.transform || !projectile.physics) continue;

            const mutable = state.getEntityMut(projectile.id);
            if (!mutable?.transform || !mutable?.physics) continue;

            // Track age
            const age = (this.projectileAges.get(projectile.id) || 0) + 1;
            this.projectileAges.set(projectile.id, age);

            // Remove if too old
            if (age > this.maxLifetimeTicks) {
                this.projectilesToRemove.push(projectile.id);
                continue;
            }

            // Move projectile
            const oldPos = { ...mutable.transform.position };
            mutable.transform.position = {
                x: oldPos.x + mutable.physics.velocity.x * dt,
                y: oldPos.y + mutable.physics.velocity.y * dt,
                z: oldPos.z + mutable.physics.velocity.z * dt,
            };
            const newPos = mutable.transform.position;

            // Apply gravity to rockets (slight drop)
            mutable.physics.velocity.y -= 50 * dt; // Much less than player gravity

            // Check collisions with players
            for (const target of state.entitiesByType(EntityType.Player)) {
                if (target.ownerId === projectile.ownerId) continue; // No self-damage
                if (!target.transform || !target.health || target.health.dead) continue;

                // Simple sphere collision
                const distSq =
                    (newPos.x - target.transform.position.x) ** 2 +
                    (newPos.y - target.transform.position.y) ** 2 +
                    (newPos.z - target.transform.position.z) ** 2;

                const hitRadius = 50; // Projectile + player radius
                if (distSq < hitRadius ** 2) {
                    // Direct hit!
                    this.pendingDamage.push({
                        victimId: target.id,
                        attackerId: projectile.ownerId ? state.getEntityByOwner(projectile.ownerId)?.id : undefined,
                        damage: WEAPONS.rocketLauncher.damage,
                        armorPiercing: 0,
                        damageType: DamageType.Explosion,
                        hitLocation: HitLocation.Body,
                    });

                    // Apply splash damage to nearby players
                    this.applySplashDamage(state, newPos, projectile.ownerId, 120);

                    this.projectilesToRemove.push(projectile.id);
                    break;
                }
            }

            // Check world collision (simplified - just check Y)
            if (newPos.y < 0) {
                // Hit ground - explode
                this.applySplashDamage(state, newPos, projectile.ownerId, 120);
                this.projectilesToRemove.push(projectile.id);
            }
        }

        // Remove expired/exploded projectiles
        for (const id of this.projectilesToRemove) {
            state.removeEntity(id);
            this.projectileAges.delete(id);
        }
    }

    private applySplashDamage(
        state: WorldState,
        center: { x: number; y: number; z: number },
        attackerOwnerId: number | undefined,
        radius: number
    ): void {
        for (const target of state.entitiesByType(EntityType.Player)) {
            if (!target.transform || !target.health || target.health.dead) continue;

            const dist = Math.sqrt(
                (center.x - target.transform.position.x) ** 2 +
                (center.y - target.transform.position.y) ** 2 +
                (center.z - target.transform.position.z) ** 2
            );

            if (dist < radius) {
                // Damage falls off with distance
                const falloff = 1 - (dist / radius);
                const damage = Math.round(WEAPONS.rocketLauncher.damage * 0.5 * falloff);

                if (damage > 0) {
                    // Allow self-damage but reduced
                    const isSelf = target.ownerId === attackerOwnerId;
                    const finalDamage = isSelf ? Math.round(damage * 0.5) : damage;

                    this.pendingDamage.push({
                        victimId: target.id,
                        attackerId: attackerOwnerId ? state.getEntityByOwner(attackerOwnerId)?.id : undefined,
                        damage: finalDamage,
                        armorPiercing: 0,
                        damageType: DamageType.Explosion,
                        hitLocation: HitLocation.Body,
                    });
                }
            }
        }
    }
}
