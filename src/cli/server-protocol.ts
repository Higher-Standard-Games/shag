/**
 * Network Protocol Test CLI
 * 
 * Usage: npm run server:protocol
 * 
 * Tests binary encoding, snapshot serialization, and delta compression.
 */

import { BinaryEncoder, BinaryDecoder } from '../engine/server/network/protocol/BinaryEncoder';
import { SnapshotEncoder, SnapshotDecoder } from '../engine/server/network/protocol/SnapshotProtocol';
import { InputEncoder, InputDecoder, type InputCommand } from '../engine/server/network/protocol/InputProtocol';
import { WorldState } from '../engine/server/core/WorldState';
import { createPlayerEntity } from '../engine/server/ecs/Entity';
import { entityId, playerId, tickNumber } from '../engine/server/ecs/types';

console.log('═══════════════════════════════════════════════════════════════════');
console.log(' V2 Network Protocol Test');
console.log('═══════════════════════════════════════════════════════════════════');
console.log();

// ═══════════════════════════════════════════════════════════════════
// TEST 1: Binary Encoder
// ═══════════════════════════════════════════════════════════════════

console.log('[TEST 1] Binary Encoder/Decoder');

const encoder = new BinaryEncoder();
encoder.writeUint8(42);
encoder.writeUint16(1234);
encoder.writeUint32(0xDEADBEEF);
encoder.writeFloat32(3.14159);
encoder.writeVarUint(300);  // Will use 2 bytes
encoder.writeVarInt(-150);  // ZigZag encoded
encoder.writeString('Hello, Quake!');
encoder.writeQuantizedPos(1234.5, -567.25, 890.75);

const bytes = encoder.toBytes();
console.log(`  Encoded ${bytes.length} bytes`);

const decoder = new BinaryDecoder(bytes);
const u8 = decoder.readUint8();
const u16 = decoder.readUint16();
const u32 = decoder.readUint32();
const f32 = decoder.readFloat32();
const varU = decoder.readVarUint();
const varI = decoder.readVarInt();
const str = decoder.readString();
const pos = decoder.readQuantizedPos();

console.log(`  uint8: ${u8} (expected 42)`);
console.log(`  uint16: ${u16} (expected 1234)`);
console.log(`  uint32: 0x${u32.toString(16).toUpperCase()} (expected 0xDEADBEEF)`);
console.log(`  float32: ${f32.toFixed(5)} (expected 3.14159)`);
console.log(`  varUint: ${varU} (expected 300)`);
console.log(`  varInt: ${varI} (expected -150)`);
console.log(`  string: "${str}" (expected "Hello, Quake!")`);
console.log(`  quantized pos: (${pos.x}, ${pos.y}, ${pos.z}) (expected ~1234.5, -567.25, 890.75)`);

const binaryPassed =
    u8 === 42 &&
    u16 === 1234 &&
    u32 === 0xDEADBEEF &&
    Math.abs(f32 - 3.14159) < 0.0001 &&
    varU === 300 &&
    varI === -150 &&
    str === 'Hello, Quake!' &&
    Math.abs(pos.x - 1234.5) < 0.5 &&
    Math.abs(pos.y - (-567)) < 0.5 &&
    Math.abs(pos.z - 891) < 0.5;

console.log(`  Result: ${binaryPassed ? '✅ PASSED' : '❌ FAILED'}`);
console.log();

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Full Snapshot
// ═══════════════════════════════════════════════════════════════════

console.log('[TEST 2] Full Snapshot Encoding');

const state = new WorldState(tickNumber(100));

// Add some players
const player1 = createPlayerEntity(entityId(1), playerId(100), { x: 100, y: 200, z: 300 });
const player2 = createPlayerEntity(entityId(2), playerId(101), { x: -50, y: 100, z: 50 });
state.addEntity(player1);
state.addEntity(player2);

// Set some velocities
const p1 = state.getEntityMut(entityId(1));
if (p1?.physics) {
    p1.physics.velocity = { x: 100, y: -50, z: 200 };
    p1.physics.grounded = true;
}

const snapshotEncoder = new SnapshotEncoder();
const snapshotBytes = snapshotEncoder.encodeFullSnapshot(state);

console.log(`  Entities: ${state.entityCount}`);
console.log(`  Snapshot size: ${snapshotBytes.length} bytes`);
console.log(`  Per entity: ${(snapshotBytes.length / state.entityCount).toFixed(1)} bytes`);

const snapshotDecoder = new SnapshotDecoder();
const decoded = snapshotDecoder.decode(snapshotBytes);

console.log(`  Decoded tick: ${decoded.tick} (expected 100)`);
console.log(`  Decoded entities: ${decoded.entities.length}`);

const snapshotPassed =
    decoded.tick === 100 &&
    decoded.entities.length === 2 &&
    decoded.entities[0].id === 1 &&
    decoded.entities[1].id === 2;

console.log(`  Result: ${snapshotPassed ? '✅ PASSED' : '❌ FAILED'}`);
console.log();

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Delta Snapshot
// ═══════════════════════════════════════════════════════════════════

console.log('[TEST 3] Delta Snapshot Encoding');

// Create baseline state (copy of current)
const baseline = state.clone();

// Create next tick state with changes
const nextState = state.nextTick();
const p1Next = nextState.getEntityMut(entityId(1));
if (p1Next?.transform) {
    p1Next.transform.position = { x: 150, y: 180, z: 350 }; // Moved
}

// Add a new player
const player3 = createPlayerEntity(entityId(3), playerId(102), { x: 0, y: 0, z: 0 });
nextState.addEntity(player3);

const deltaBytes = snapshotEncoder.encodeDeltaSnapshot(nextState, baseline);

console.log(`  Full snapshot: ${snapshotBytes.length} bytes`);
console.log(`  Delta snapshot: ${deltaBytes.length} bytes`);
console.log(`  Compression: ${((1 - deltaBytes.length / snapshotBytes.length) * 100).toFixed(1)}% smaller`);

const decodedDelta = snapshotDecoder.decode(deltaBytes);
console.log(`  Delta entities: ${decodedDelta.entities.length} (1 changed + 1 added)`);
console.log(`  Removed: ${decodedDelta.removedIds.length}`);

const deltaPassed =
    decodedDelta.entities.length === 2 &&
    decodedDelta.removedIds.length === 0;

console.log(`  Result: ${deltaPassed ? '✅ PASSED' : '❌ FAILED'}`);
console.log();

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Input Protocol
// ═══════════════════════════════════════════════════════════════════

console.log('[TEST 4] Input Protocol');

const inputEncoder = new InputEncoder();
const commands: InputCommand[] = [
    {
        sequence: 1,
        clientTime: 16.5,
        forward: 1.0,
        right: -0.5,
        pitch: 15.0,
        yaw: 90.0,
        jump: true,
        crouch: false,
        attack: true,
        altAttack: false,
        use: false,
        weaponSlot: 2,
    },
    {
        sequence: 2,
        clientTime: 24.5,
        forward: 1.0,
        right: 0,
        pitch: 15.0,
        yaw: 92.0,
        jump: false,
        crouch: false,
        attack: false,
        altAttack: false,
        use: false,
        weaponSlot: 2,
    },
];

const inputBytes = inputEncoder.encodeInputBatch(playerId(100), tickNumber(50), commands);
console.log(`  Commands: ${commands.length}`);
console.log(`  Input batch size: ${inputBytes.length} bytes`);
console.log(`  Per command: ${(inputBytes.length / commands.length).toFixed(1)} bytes`);

const inputDecoder = new InputDecoder();
const decodedInput = inputDecoder.decode(inputBytes);

console.log(`  Decoded player: ${decodedInput.playerId}`);
console.log(`  Decoded commands: ${decodedInput.commands.length}`);
console.log(`  First command: seq=${decodedInput.commands[0].sequence}, fwd=${decodedInput.commands[0].forward.toFixed(2)}, jump=${decodedInput.commands[0].jump}`);

const inputPassed =
    decodedInput.playerId === 100 &&
    decodedInput.commands.length === 2 &&
    decodedInput.commands[0].sequence === 1 &&
    Math.abs(decodedInput.commands[0].forward - 1.0) < 0.01 &&
    decodedInput.commands[0].jump === true;

console.log(`  Result: ${inputPassed ? '✅ PASSED' : '❌ FAILED'}`);
console.log();

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════

const allPassed = binaryPassed && snapshotPassed && deltaPassed && inputPassed;

console.log('═══════════════════════════════════════════════════════════════════');
console.log(` Overall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
console.log('═══════════════════════════════════════════════════════════════════');
