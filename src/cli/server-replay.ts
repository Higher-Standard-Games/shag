/**
 * Replay Test CLI
 * 
 * Usage: npm run server:replay
 * 
 * Records a simulation, saves it, plays it back, and verifies determinism.
 */

import { Simulation } from '../engine/server/core/Simulation';
import { createPlayerEntity } from '../engine/server/ecs/Entity';
import { entityId, playerId, tickNumber, type TickNumber } from '../engine/server/ecs/types';
import { CharacterPhysicsSystem } from '../games/fps/server/systems/CharacterPhysicsSystem';
import { ReplayRecorder, ReplayPlayer } from '../engine/server/replay/Replay';
import type { InputCommand } from '../engine/server/network/protocol/InputProtocol';

console.log('═══════════════════════════════════════════════════════════════════');
console.log(' V2 Replay System Test');
console.log('═══════════════════════════════════════════════════════════════════');
console.log();

// ═══════════════════════════════════════════════════════════════════
// PHASE 1: Record a simulation
// ═══════════════════════════════════════════════════════════════════

console.log('[RECORD] Starting simulation recording...');

const sim1 = new Simulation({ tickMs: 8 });
sim1.addSubsystem(new CharacterPhysicsSystem());
sim1.initialize();

const state1 = sim1.getStateMut();
const player1 = createPlayerEntity(entityId(1), playerId(100), { x: 0, y: 100, z: 0 });
state1.addEntity(player1);

// Create recorder
const recorder = new ReplayRecorder('test_map', 125);
recorder.start();

// Simulate 500 ticks (4 seconds) with varying input
const inputHistory: { tick: TickNumber; input: InputCommand }[] = [];

for (let i = 0; i < 500; i++) {
    const tick = tickNumber(i);
    recorder.beginTick(tick);

    // Create input that varies over time
    const input: InputCommand = {
        sequence: i,
        clientTime: i * 8,
        forward: Math.sin(i * 0.05) > 0 ? 1 : 0,  // Alternate forward
        right: Math.sin(i * 0.03) > 0.5 ? 0.5 : (Math.sin(i * 0.03) < -0.5 ? -0.5 : 0),
        pitch: 0,
        yaw: (i * 2) % 360,  // Slowly turn
        jump: i % 50 === 0,  // Jump every 50 ticks
        crouch: false,
        attack: false,
        altAttack: false,
        use: false,
        weaponSlot: 1,
    };

    // Apply input to entity
    const entity = sim1.getStateMut().getEntityMut(entityId(1));
    if (entity?.input) {
        entity.input.forward = input.forward;
        entity.input.right = input.right;
        entity.input.yaw = input.yaw;
        entity.input.jump = input.jump;
    }

    // Record input
    recorder.recordInput(playerId(100), input);
    inputHistory.push({ tick, input });

    // Run tick
    sim1.tick();
}

const finalChecksum1 = sim1.checksum();
const replayJSON = recorder.toJSON(finalChecksum1);

console.log(`[RECORD] Recorded ${recorder.frameCount} frames`);
console.log(`[RECORD] Replay size: ${(replayJSON.length / 1024).toFixed(1)} KB`);
console.log(`[RECORD] Final checksum: ${finalChecksum1}`);

const finalState1 = sim1.getState();
const finalPlayer1 = finalState1.getEntity(entityId(1));
if (finalPlayer1?.transform) {
    console.log(`[RECORD] Final position: (${finalPlayer1.transform.position.x.toFixed(2)}, ${finalPlayer1.transform.position.y.toFixed(2)}, ${finalPlayer1.transform.position.z.toFixed(2)})`);
}
console.log();

// ═══════════════════════════════════════════════════════════════════
// PHASE 2: Load and playback
// ═══════════════════════════════════════════════════════════════════

console.log('[PLAYBACK] Loading replay...');

const replayPlayer = ReplayPlayer.fromJSON(replayJSON);

console.log(`[PLAYBACK] Map: ${replayPlayer.header.mapName}`);
console.log(`[PLAYBACK] Tick rate: ${replayPlayer.header.tickRate} Hz`);
console.log(`[PLAYBACK] Total frames: ${replayPlayer.totalFrames}`);
console.log(`[PLAYBACK] Expected checksum: ${replayPlayer.expectedChecksum}`);
console.log();

// Create fresh simulation
const sim2 = new Simulation({ tickMs: 8 });
sim2.addSubsystem(new CharacterPhysicsSystem());
sim2.initialize();

const state2 = sim2.getStateMut();
const player2 = createPlayerEntity(entityId(1), playerId(100), { x: 0, y: 100, z: 0 });
state2.addEntity(player2);

console.log('[PLAYBACK] Running replay...');
const startTime = performance.now();

let framesPlayed = 0;
while (replayPlayer.hasNextFrame()) {
    const frame = replayPlayer.nextFrame();
    if (!frame) break;

    // Apply inputs from replay
    for (const [_pid, input] of frame.inputs) {
        const entity = sim2.getStateMut().getEntityMut(entityId(1)); // Assuming player 1
        if (entity?.input) {
            entity.input.forward = input.forward;
            entity.input.right = input.right;
            entity.input.yaw = input.yaw;
            entity.input.jump = input.jump;
        }
    }

    // Run tick
    sim2.tick();
    framesPlayed++;
}

const elapsed = performance.now() - startTime;
const finalChecksum2 = sim2.checksum();

console.log(`[PLAYBACK] Completed ${framesPlayed} frames in ${elapsed.toFixed(2)}ms`);
console.log(`[PLAYBACK] Speed: ${(framesPlayed / elapsed * 1000).toFixed(0)} ticks/sec`);
console.log(`[PLAYBACK] Final checksum: ${finalChecksum2}`);

const finalState2 = sim2.getState();
const finalPlayer2 = finalState2.getEntity(entityId(1));
if (finalPlayer2?.transform) {
    console.log(`[PLAYBACK] Final position: (${finalPlayer2.transform.position.x.toFixed(2)}, ${finalPlayer2.transform.position.y.toFixed(2)}, ${finalPlayer2.transform.position.z.toFixed(2)})`);
}
console.log();

// ═══════════════════════════════════════════════════════════════════
// PHASE 3: Verify determinism
// ═══════════════════════════════════════════════════════════════════

console.log('[VERIFY] Checking determinism...');

const checksumMatch = finalChecksum1 === finalChecksum2;
const expectedMatch = finalChecksum2 === replayPlayer.expectedChecksum;

let positionMatch = false;
if (finalPlayer1?.transform && finalPlayer2?.transform) {
    const dx = Math.abs(finalPlayer1.transform.position.x - finalPlayer2.transform.position.x);
    const dy = Math.abs(finalPlayer1.transform.position.y - finalPlayer2.transform.position.y);
    const dz = Math.abs(finalPlayer1.transform.position.z - finalPlayer2.transform.position.z);
    positionMatch = dx < 0.001 && dy < 0.001 && dz < 0.001;
    console.log(`[VERIFY] Position diff: (${dx.toFixed(6)}, ${dy.toFixed(6)}, ${dz.toFixed(6)})`);
}

console.log(`[VERIFY] Checksum match (record vs playback): ${checksumMatch ? '✅' : '❌'}`);
console.log(`[VERIFY] Checksum match (expected): ${expectedMatch ? '✅' : '❌'}`);
console.log(`[VERIFY] Position match: ${positionMatch ? '✅' : '❌'}`);
console.log();

const allPassed = checksumMatch && expectedMatch && positionMatch;

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════════════');
if (allPassed) {
    console.log(' ✅ DETERMINISM VERIFIED - Replay matches original!');
} else {
    console.log(' ❌ DETERMINISM FAILED - Replay does not match!');
}
console.log('═══════════════════════════════════════════════════════════════════');
