/**
 * Test script for FPSSimulation initialization
 * Run with: npx vite-node src/cli/test-fps-simulation.ts
 */

import { FPSSimulation } from '../games/fps/simulation/FPSSimulation';
import { BSPCollisionWorld } from '../games/fps/simulation/collision/BSPCollisionWorld';

console.log('\n=== FPSSimulation Initialization Test ===\n');

// Create simulation
console.log('[TEST] Creating FPSSimulation...');
const sim = new FPSSimulation({ tickRate: 60 });

console.log('[TEST] Simulation created');

// Check if we can set collision world
console.log('[TEST] Testing setCollisionWorld...');

try {
    // BSPCollisionWorld constructor takes no args - uses CollisionManager singleton
    const collisionWorld = new BSPCollisionWorld();
    console.log('[TEST] BSPCollisionWorld created:', !!collisionWorld);

    sim.setCollisionWorld(collisionWorld);
    console.log('[TEST] setCollisionWorld called successfully');
} catch (err) {
    console.error('[TEST] Error setting collision world:', err);
}

// Test spawning a player
console.log('\n[TEST] Testing player spawn...');
try {
    const player = sim.spawnPlayer('test-player');
    console.log('[TEST] Player spawned:', !!player);
    console.log('[TEST] Player entity ID:', player.id);

    const transform = player.getComponent('transform');
    const velocity = player.getComponent('velocity');
    console.log('[TEST] Player has transform:', !!transform);
    console.log('[TEST] Player has velocity:', !!velocity);
    if (transform) {
        console.log('[TEST] Player position:', transform.position);
    }
    if (velocity) {
        console.log('[TEST] Player velocity:', velocity.linear);
        console.log('[TEST] Player grounded:', velocity.grounded);
    }
} catch (err) {
    console.error('[TEST] Error spawning player:', err);
}

// Test simulation tick
console.log('\n[TEST] Testing simulation ticks with gravity...');
try {
    // Run 10 simulation ticks
    for (let i = 0; i < 10; i++) {
        sim.tick(16); // 16ms deltaTime
    }
    console.log('[TEST] 10 simulation ticks completed');

    // Check state after ticks
    const movementSystem = sim.getMovementSystem();
    console.log('[TEST] Movement system exists:', !!movementSystem);
    console.log('[TEST] Movement profile name:', movementSystem?.getProfileName?.());
} catch (err) {
    console.error('[TEST] Error during tick:', err);
}

console.log('\n=== Test Complete ===\n');
