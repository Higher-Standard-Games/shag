
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

/**
 * Dump entities from a BSP file inside a PK3 using JSZip
 */
async function runDump() {
    // Get map from args or default to wdm2
    const mapName = process.argv[2] || 'wdm2';
    const pk3Path = `public/games/default/basewsw/map_${mapName}.pk3`;

    console.log(`=== Dumping Entities from ${pk3Path} ===`);

    if (!fs.existsSync(pk3Path)) {
        console.error(`PK3 file not found: ${pk3Path}`);
        return;
    }

    const pk3Buffer = fs.readFileSync(pk3Path);

    try {
        const zip = await JSZip.loadAsync(pk3Buffer);

        // Find the BSP file
        const bspFiles = Object.keys(zip.files).filter(f => f.endsWith('.bsp'));
        if (bspFiles.length === 0) {
            console.error("No BSP files found in PK3");
            return;
        }

        console.log(`Found BSP files: ${bspFiles.join(', ')}`);
        const bspFile = zip.file(bspFiles[0]); // Use first one

        if (!bspFile) {
            console.error("Failed to access BSP file");
            return;
        }

        const bspBuffer = await bspFile.async('arraybuffer');
        const view = new DataView(bspBuffer);

        // Parse BSP Header to find Entities Lump
        // Header: 
        // 4 chars: IBSP or FBSP
        // 4 bytes: version
        // 17 lumps: each 8 bytes (offset, length)

        const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
        console.log(`BSP Magic: ${magic}`);

        // Entities lump is index 0
        const entitiesOffset = view.getInt32(8 + (0 * 8), true);
        const entitiesLength = view.getInt32(8 + (0 * 8) + 4, true);

        console.log(`Entities Lump: Offset ${entitiesOffset}, Length ${entitiesLength}`);

        // Read entities string
        const entitiesBytes = new Uint8Array(bspBuffer, entitiesOffset, entitiesLength);
        const entitiesStr = new TextDecoder('latin1').decode(entitiesBytes);

        // Parse entities
        const entityRegex = /\{([\s\S]*?)\}/g;
        let match;
        const weapons = new Set<string>();
        const ammo = new Set<string>();
        const pickups = new Set<string>();
        let count = 0;

        while ((match = entityRegex.exec(entitiesStr)) !== null) {
            const body = match[1];
            const props: Record<string, string> = {};
            const lines = body.split('\n');

            for (const line of lines) {
                const propMatch = line.match(/"([^"]+)"\s+"([^"]*)"/);
                if (propMatch) {
                    props[propMatch[1].toLowerCase()] = propMatch[2];
                }
            }

            if (props['classname']) {
                count++;
                const cls = props['classname'];
                const model = props['model'];

                if (cls.startsWith('weapon_')) {
                    weapons.add(`${cls} (Model: ${model || 'none'})`);
                } else if (cls.startsWith('ammo_') || cls.includes('ammo')) {
                    ammo.add(`${cls} (Model: ${model || 'none'})`);
                    // console.log(`[AMMO DETAILS] ${cls}`, props); 
                } else if (cls === 'item_armor_shard' || cls === 'item_health' || cls === 'item_quad') {
                    pickups.add(cls);
                }

                // Print plasma gun specific
                if (cls === 'weapon_plasmagun' || cls.includes('plasma')) {
                    console.log(`[PLASMA ENTITY] ${cls}`, props);
                }
            }
        }

        console.log(`Parsed ${count} entities.`);

        console.log("\n=== Weapons Found ===");
        Array.from(weapons).sort().forEach(w => console.log(w));

        console.log("\n=== Ammo Found ===");
        Array.from(ammo).sort().forEach(a => console.log(a));

        console.log("\n=== Other Pickups ===");
        Array.from(pickups).sort().forEach(p => console.log(p));

    } catch (e) {
        console.error("Error processing PK3:", e);
    }
}

runDump().catch(console.error);
