import { parseBsp } from './src/engine/loader/bsp/BspLoader';
import AdmZip from 'adm-zip';

const pk3Path = './public/games/default/map_wdm2.pk3';
const zip = new AdmZip(pk3Path);
const bspEntry = zip.getEntries().find(e => e.entryName.endsWith('.bsp'));
const bspData = bspEntry?.getData();
if (!bspData) throw new Error('No BSP');

const bsp = parseBsp(bspData.buffer);
const spawns = bsp.entities.filter(e => e.classname === 'info_player_deathmatch');

console.log('\n=== WDM2 Spawn Points ===');
spawns.slice(0, 6).forEach((s, i) => {
    const origin = s.properties.origin?.split(' ').map(Number);
    if (origin) {
        const [x, y, z] = origin;  // Quake: x, y, z (z up)
        console.log(`\nSpawn ${i}:`);
        console.log(`  Quake origin (x, y, z-up) = (${x}, ${y}, ${z})`);
        console.log(`  Babylon Y (from Q3 Z) = ${z}`);
        console.log(`  Server adds +24 offset → Y = ${z + 24}`);
    }
});

// The floor at spawn point should be at Z = origin.z (in Q3 coords)
// The player origin should be Z + 24 (origin is 24 above feet)
// So if BSP spawn Z = 168, then:
// - Floor is at Y = 168 (in Babylon)
// - Player origin should be at Y = 168 + 24 = 192
// - But server shows Y = 167.9 after settling
// 
// This means the spawn point in BSP is ALREADY at origin level (168 = floor + 24)?
// Or the spawn point is at feet level and server should add 24 but collision is wrong?

console.log('\n=== Analysis ===');
console.log('If server shows Y=167.9 for player standing on floor,');
console.log('and spawn has Q3 Z=144 (feet level), then:');
console.log('  Server spawn Y = 144 + 24 = 168 (origin level)');
console.log('  After physics settles = 167.9 (correct)');
console.log('\nBut if client expects Y=191.9, then client is calculating:');
console.log('  Client ground Y = 167.9 + 24 = 191.9?');
console.log('  This suggests client thinks origin is 24 units higher than server');
