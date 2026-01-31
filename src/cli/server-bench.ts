/**
 * Server Benchmark CLI
 * 
 * Usage: npm run server:bench
 * 
 * Stress tests the simulation with many entities and measures performance.
 */

import { Simulation } from '../engine/server/core/Simulation';
import { createPlayerEntity, createProjectileEntity } from '../engine/server/ecs/Entity';
import { entityId, playerId } from '../engine/server/ecs/types';
import { FPSPhysicsSystem } from '../games/fps/server/systems/FPSPhysicsSystem';
import { SnapshotEncoder } from '../engine/server/network/protocol/SnapshotProtocol';

console.log('═══════════════════════════════════════════════════════════════════');
console.log(' V2 Server Benchmark');
console.log('═══════════════════════════════════════════════════════════════════');
console.log();

// ═══════════════════════════════════════════════════════════════════
// BENCHMARK PARAMETERS
// ═══════════════════════════════════════════════════════════════════

const PLAYER_COUNTS = [1, 16, 32, 64];
const PROJECTILES_PER_PLAYER = 5;
const TICKS_PER_TEST = 1000;
const WARMUP_TICKS = 100;

interface BenchmarkResult {
    players: number;
    entities: number;
    totalTimeMs: number;
    tickTimeMs: number;
    ticksPerSec: number;
    bytesPerSnapshot: number;
    bytesPerEntity: number;
}

const results: BenchmarkResult[] = [];

// ═══════════════════════════════════════════════════════════════════
// RUN BENCHMARKS
// ═══════════════════════════════════════════════════════════════════

for (const playerCount of PLAYER_COUNTS) {
    console.log(`[BENCH] Testing with ${playerCount} players...`);

    // Create simulation
    const sim = new Simulation({ tickMs: 8 });
    sim.addSubsystem(new FPSPhysicsSystem());
    sim.initialize();

    const state = sim.getStateMut();

    // Add players
    let entityIndex = 1;
    for (let i = 0; i < playerCount; i++) {
        const player = createPlayerEntity(
            entityId(entityIndex++),
            playerId(i),
            {
                x: (Math.random() - 0.5) * 1000,
                y: 100 + Math.random() * 100,
                z: (Math.random() - 0.5) * 1000
            }
        );
        state.addEntity(player);

        // Set random input
        const p = state.getEntityMut(player.id);
        if (p?.input) {
            p.input.forward = Math.random() > 0.5 ? 1 : 0;
            p.input.right = Math.random() - 0.5;
            p.input.yaw = Math.random() * 360;
            p.input.jump = Math.random() > 0.8;
        }

        // Add projectiles
        for (let j = 0; j < PROJECTILES_PER_PLAYER; j++) {
            const proj = createProjectileEntity(
                entityId(entityIndex++),
                playerId(i),
                { x: Math.random() * 100, y: 50, z: Math.random() * 100 },
                { x: Math.random() * 100, y: 0, z: Math.random() * 100 }
            );
            state.addEntity(proj);
        }
    }

    const totalEntities = state.entityCount;
    console.log(`  Entities: ${totalEntities}`);

    // Warmup
    for (let i = 0; i < WARMUP_TICKS; i++) {
        sim.tick();
    }

    // Benchmark ticks
    const startTime = performance.now();
    for (let i = 0; i < TICKS_PER_TEST; i++) {
        sim.tick();
    }
    const totalTimeMs = performance.now() - startTime;

    // Benchmark snapshot encoding
    const snapshotEncoder = new SnapshotEncoder();
    const snapshotBytes = snapshotEncoder.encodeFullSnapshot(sim.getState());

    // Record results
    results.push({
        players: playerCount,
        entities: totalEntities,
        totalTimeMs,
        tickTimeMs: totalTimeMs / TICKS_PER_TEST,
        ticksPerSec: (TICKS_PER_TEST / totalTimeMs) * 1000,
        bytesPerSnapshot: snapshotBytes.length,
        bytesPerEntity: snapshotBytes.length / totalEntities,
    });
}

// ═══════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════

console.log();
console.log('═══════════════════════════════════════════════════════════════════');
console.log(' Results');
console.log('═══════════════════════════════════════════════════════════════════');
console.log();

// Table header
console.log('┌──────────┬──────────┬────────────┬────────────┬────────────┬────────────┐');
console.log('│ Players  │ Entities │ Tick Time  │ Ticks/sec  │ Snapshot   │ Per Entity │');
console.log('├──────────┼──────────┼────────────┼────────────┼────────────┼────────────┤');

for (const r of results) {
    console.log(
        `│ ${r.players.toString().padStart(8)} │ ` +
        `${r.entities.toString().padStart(8)} │ ` +
        `${r.tickTimeMs.toFixed(4).padStart(8)}ms │ ` +
        `${r.ticksPerSec.toFixed(0).padStart(10)} │ ` +
        `${(r.bytesPerSnapshot / 1024).toFixed(1).padStart(7)}KB │ ` +
        `${r.bytesPerEntity.toFixed(1).padStart(8)}B │`
    );
}

console.log('└──────────┴──────────┴────────────┴────────────┴────────────┴────────────┘');

// Performance summary
console.log();
const worst = results[results.length - 1];
const targetTickMs = 8; // 125 Hz

if (worst.tickTimeMs < targetTickMs) {
    const headroom = ((targetTickMs - worst.tickTimeMs) / targetTickMs) * 100;
    console.log(`✅ ${worst.players} players at ${worst.ticksPerSec.toFixed(0)} ticks/sec`);
    console.log(`   ${headroom.toFixed(1)}% headroom for 125Hz target`);
} else {
    console.log(`⚠️  ${worst.players} players at ${worst.tickTimeMs.toFixed(2)}ms/tick exceeds 8ms target`);
}

// Network estimate
console.log();
console.log('Network Estimates (at 30 snapshots/sec):');
for (const r of results) {
    const kbps = (r.bytesPerSnapshot * 30 * 8) / 1000;
    console.log(`  ${r.players} players: ${kbps.toFixed(1)} Kbps per client`);
}

console.log();
console.log('═══════════════════════════════════════════════════════════════════');
