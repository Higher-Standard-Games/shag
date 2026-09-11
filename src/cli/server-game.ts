/**
 * Full Game Simulation Test
 *
 * Usage: npm run server:game
 *
 * Simulates a complete FPS match with:
 * - Multiple players
 * - Weapon firing
 * - Combat system
 * - Lag compensation
 */

import { Simulation } from "../engine/server/core/Simulation";
import { createPlayerEntity } from "../engine/server/ecs/Entity";
import { EntityType, entityId, playerId } from "../engine/server/ecs/types";
import { LAG_COMPENSATION } from "../engine/server/lagcomp/config";
import type { Ray } from "../engine/server/lagcomp/LagCompensation";
import { LagCompensation } from "../engine/server/lagcomp/LagCompensation";
import { CharacterPhysicsSystem } from "../games/fps/server/systems/CharacterPhysicsSystem";
import { CombatSystem } from "../games/fps/server/systems/CombatSystem";
import { ProjectileSystem } from "../games/fps/server/systems/ProjectileSystem";
import { WeaponSystem } from "../games/fps/server/systems/WeaponSystem";

console.log("═══════════════════════════════════════════════════════════════════");
console.log(" V2 Full Game Simulation");
console.log("═══════════════════════════════════════════════════════════════════");
console.log();

// ═══════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════

const NUM_PLAYERS = 4;
const MATCH_DURATION_TICKS = 1250; // 10 seconds at 125Hz
const TICK_MS = 8;

// Create simulation with all systems
const sim = new Simulation({ tickMs: TICK_MS });

const physicsSystem = new CharacterPhysicsSystem();
const combatSystem = new CombatSystem(); // Respawning now handled by GametypeController
const weaponSystem = new WeaponSystem();
const projectileSystem = new ProjectileSystem();

sim.addSubsystem(physicsSystem);
sim.addSubsystem(combatSystem);
sim.addSubsystem(weaponSystem);
sim.addSubsystem(projectileSystem);

sim.initialize();

// Create lag compensation
const lagComp = new LagCompensation(LAG_COMPENSATION);

// Add players
const state = sim.getStateMut();
for (let i = 0; i < NUM_PLAYERS; i++) {
  const angle = (i / NUM_PLAYERS) * Math.PI * 2;
  const radius = 200;

  const player = createPlayerEntity(entityId(i + 1), playerId(i + 1), {
    x: Math.cos(angle) * radius,
    y: 10,
    z: Math.sin(angle) * radius,
  });
  state.addEntity(player);
  weaponSystem.initializeWeapon(player.id);

  // Set simulated client latency
  lagComp.updateClientLatency(playerId(i + 1), 30 + i * 20); // 30-90ms
}

console.log(`[SETUP] Created ${NUM_PLAYERS} players`);
console.log(
  `[SETUP] Match duration: ${MATCH_DURATION_TICKS} ticks (${((MATCH_DURATION_TICKS * TICK_MS) / 1000).toFixed(1)}s)`,
);
console.log();

// ═══════════════════════════════════════════════════════════════════
// SIMULATION LOOP
// ═══════════════════════════════════════════════════════════════════

interface MatchStats {
  kills: number;
  deaths: number;
  damageDealt: number;
  shotsFired: number;
}

const stats: Map<number, MatchStats> = new Map();
for (let i = 1; i <= NUM_PLAYERS; i++) {
  stats.set(i, { kills: 0, deaths: 0, damageDealt: 0, shotsFired: 0 });
}

let totalLagCompTraces = 0;
let totalHits = 0;

console.log("[MATCH] Starting simulation...");
const startTime = performance.now();

for (let tick = 0; tick < MATCH_DURATION_TICKS; tick++) {
  // Apply AI-like inputs to all players
  for (let i = 1; i <= NUM_PLAYERS; i++) {
    const entity = sim.getStateMut().getEntityMut(entityId(i));
    if (!entity?.input || entity.health?.dead) continue;

    // Random movement
    entity.input.forward = Math.random() > 0.3 ? 1 : 0;
    entity.input.right = (Math.random() - 0.5) * 2;
    entity.input.yaw = (tick * 3 + i * 90) % 360;
    entity.input.jump = Math.random() > 0.95;

    // Fire weapons periodically
    if (tick % (20 + i * 5) === 0) {
      entity.input.attack = true;
      stats.get(i)!.shotsFired++;

      // Perform lag-compensated trace
      const clientPing = lagComp.getClientLatency(playerId(i));
      const ray: Ray = {
        origin: entity.transform!.position,
        direction: {
          x: Math.sin((entity.input.yaw * Math.PI) / 180),
          y: 0,
          z: Math.cos((entity.input.yaw * Math.PI) / 180),
        },
        maxDistance: 5000,
      };

      const hitResult = lagComp.traceHitscan(ray, entity.id, clientPing, sim.getState());
      totalLagCompTraces++;

      if (hitResult.hit) {
        totalHits++;
        // Queue damage through combat system
        combatSystem.queueDamage({
          victimId: hitResult.entityId!,
          attackerId: entity.id,
          damage: 15,
          armorPiercing: 0,
          damageType: "bullet" as any,
          hitLocation: hitResult.hitPart === "head" ? ("head" as any) : ("body" as any),
        });

        stats.get(i)!.damageDealt += 15;
      }
    } else {
      entity.input.attack = false;
    }

    // Occasionally switch weapons
    if (tick % 100 === i * 25) {
      entity.input.weaponSlot = ((tick / 100) % 4) + 1;
    }
  }

  // Run simulation tick
  sim.tick();

  // Record state for lag compensation
  lagComp.recordSnapshot(sim.getState());

  // Process kills from combat system
  for (const kill of combatSystem.getRecentKills()) {
    const killerId = kill.killerId as number;
    const victimId = kill.victimId as number;

    if (killerId && stats.has(killerId)) {
      stats.get(killerId)!.kills++;
    }
    if (stats.has(victimId)) {
      stats.get(victimId)!.deaths++;
    }
  }
  combatSystem.clearKills();

  // Collect projectiles for stats
  for (const _proj of sim.getState().entitiesByType(EntityType.Projectile)) {
    // Count once when created
  }

  // Progress indicator every second
  if (tick > 0 && tick % 125 === 0) {
    const elapsed = (tick / MATCH_DURATION_TICKS) * 100;
    process.stdout.write(`\r[MATCH] Progress: ${elapsed.toFixed(0)}%`);
  }
}

const elapsed = performance.now() - startTime;
console.log("\r[MATCH] Completed!                    ");
console.log();

// ═══════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════

console.log("═══════════════════════════════════════════════════════════════════");
console.log(" Match Results");
console.log("═══════════════════════════════════════════════════════════════════");
console.log();

// Performance
console.log("[PERFORMANCE]");
console.log(`  Duration: ${elapsed.toFixed(2)}ms (${((MATCH_DURATION_TICKS / elapsed) * 1000).toFixed(0)} ticks/sec)`);
console.log(`  Per tick: ${(elapsed / MATCH_DURATION_TICKS).toFixed(4)}ms`);
console.log();

// Lag compensation stats
const lagStats = lagComp.getStats();
console.log("[LAG COMPENSATION]");
console.log(`  History buffer: ${lagStats.bufferSize}/${lagStats.bufferCapacity} snapshots`);
console.log(`  Total traces: ${totalLagCompTraces}`);
console.log(`  Hits: ${totalHits} (${((totalHits / totalLagCompTraces) * 100).toFixed(1)}% accuracy)`);
console.log();

// Player scoreboard
console.log("[SCOREBOARD]");
console.log("┌──────────┬────────┬────────┬────────┬────────┬────────┐");
console.log("│ Player   │  K/D   │ Kills  │ Deaths │ Damage │ Shots  │");
console.log("├──────────┼────────┼────────┼────────┼────────┼────────┤");

for (let i = 1; i <= NUM_PLAYERS; i++) {
  const s = stats.get(i)!;
  const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
  console.log(
    `│ Player ${i.toString().padEnd(2)}│ ${kd.padStart(6)} │ ${s.kills.toString().padStart(6)} │ ` +
      `${s.deaths.toString().padStart(6)} │ ${s.damageDealt.toString().padStart(6)} │ ${s.shotsFired.toString().padStart(6)} │`,
  );
}

console.log("└──────────┴────────┴────────┴────────┴────────┴────────┘");
console.log();

// Final state
const finalState = sim.getState();
console.log("[FINAL STATE]");
console.log(`  Tick: ${finalState.tick}`);
console.log(`  Entities: ${finalState.entityCount}`);
console.log(`  Checksum: ${finalState.checksum()}`);
console.log();

console.log("═══════════════════════════════════════════════════════════════════");
console.log(" ✅ Full Game Simulation Complete");
console.log("═══════════════════════════════════════════════════════════════════");
