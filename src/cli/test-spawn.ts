/**
 * Simple spawn test - check if player can spawn and stand on ground
 */
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { MovementProfile as FPSMovementProfile } from '../games/fps/simulation/MovementProfile';
import { createHeadlessCollisionWorld } from './HeadlessBSPCollisionWorld';
import { BspLoader } from '../engine/loader/bsp/BspLoader';
import type { Vec3 } from '../engine/network/components/TransformComponent';

async function loadBsp() {
    const bspPath = path.resolve('./public/games/default/map_wdm14.pk3');
    const pk3Buffer = fs.readFileSync(bspPath);
    const zip = await JSZip.loadAsync(new Uint8Array(pk3Buffer));
    for (const filename of Object.keys(zip.files)) {
        if (filename.endsWith('.bsp')) {
            const bspBuffer = await zip.files[filename].async('arraybuffer');
            return BspLoader.load(bspBuffer);
        }
    }
    throw new Error('No BSP found');
}

async function test() {
    console.log('=== Spawn Test ===\n');

    const bsp = await loadBsp();
    const collision = await createHeadlessCollisionWorld(bsp);
    const movement = new FPSMovementProfile();

    // Find spawn
    let spawnPos: Vec3 = { x: 0, y: 100, z: 0 };
    for (const entity of bsp.entities) {
        if (entity.classname === 'info_player_deathmatch') {
            const origin = entity.properties.origin;
            if (origin) {
                const [x, y, z] = origin.split(' ').map(Number);
                spawnPos = { x, y: z, z: y };
                break;
            }
        }
    }

    console.log(`Spawn at: (${spawnPos.x}, ${spawnPos.y}, ${spawnPos.z})`);

    // Simulate 1 second of standing still
    let pos = { ...spawnPos };
    let vel: Vec3 = { x: 0, y: 0, z: 0 };
    const deltaTime = 1 / 125; // 8ms

    console.log('\nTick | Y Position | Y Velocity | Grounded');
    console.log('-----|------------|------------|----------');

    for (let i = 0; i < 125; i++) {
        const result = movement.simulate(pos, vel, null, deltaTime, collision);
        pos = result.position;
        vel = result.velocity;

        if (i % 25 === 0 || i < 5) {
            console.log(`${i.toString().padStart(4)} | ${pos.y.toFixed(2).padStart(10)} | ${vel.y.toFixed(2).padStart(10)} | ${result.grounded ? 'YES' : 'NO '}`);
        }
    }

    console.log(`\nFinal: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
    console.log(`\nExpected: Player should fall slightly and settle on ground`);
    console.log(`Y should stabilize around ${(spawnPos.y - 8).toFixed(1)} (spawn - 8 units)`);
}

test().catch(console.error);
