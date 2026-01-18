
import { BspLoader, LumpIndex } from "../engine/loader/bsp/BspLoader";
import { PK3Loader } from "../engine/loader/pk3/PK3Loader";
import fs from 'fs';
import path from 'path';

async function runDump() {
    console.log("=== Dumping Plasma Entities ===");

    // Need to load the PK3 first to get the map
    const pk3Path = 'public/games/default/basewsw/data0_15pure.pk3';
    // Actually we need to read it using Node fs because we are in CLI
    // PK3Loader uses fetch by default? Let's check or just read file buffer manually if needed.
    // The PK3Loader in this project likely supports environments if we use it right.
    // But honestly, the BspLoader takes an ArrayBuffer.

    // Let's try to find where the BspLoader gets its data usually.
    // It seems BspLoader is just a parser.

    // We need to unzip the PK3 or read the BSP directly if it exists.
    // Let's assume we can read the PK3 file.

    const pk3 = PK3Loader.getInstance();
    // PK3Loader usually fetches from URL in browser. In Node, we might need a polyfill or different method.
    // But since we are in `vite-node`, we might have issues with `fetch` if pointing to local files without a server.

    // HOWEVER, previous commands used `games/default/basewsw/data0_15pure.pk3` path.
    // Let's try to read the file buffer directly using fs and pass to a ZIP reader if we can,
    // OR just rely on the fact that we might have the extracted BSP?
    // Wait, the user has `public/games/default/maps/wsw_dm5.bsp`? 
    // Let's check file existence first.

    // Using `ls` via `list_dir` might be better, but let's assume we want to read `maps/wsw_dm5.bsp` from within the PK3.

    // SIMPLER APPROACH:
    // Just grep the text content of the PK3 file buffer for "plasma" directly? 
    // Entities store text in the BSP entities lump.
    // AND the BSP is inside the PK3.
    // So "plasma" string should persist.

    const pk3Buffer = fs.readFileSync(pk3Path);
    const content = pk3Buffer.toString('latin1'); // Use latin1 to preserve bytes as chars

    // Regex for entity definition blocks
    // Entities look like { ... "classname" "weapon_plasmagun" ... }

    console.log(`Searching ${pk3Path} (${pk3Buffer.length} bytes)...`);

    // We are looking for "classname" "weapon_..." or similar
    // Let's find all occurrences of "plasma" and print surrounding context

    const regex = /\{[^}]*plasma[^}]*\}/gi;
    const matches = content.match(regex);

    if (matches) {
        console.log(`Found ${matches.length} entities matching 'plasma':`);
        matches.forEach(m => console.log(m));
    } else {
        console.log("No matches found via regex");

        // Fallback: just index
        let idx = content.indexOf("plasma");
        while (idx !== -1) {
            const start = content.lastIndexOf("{", idx);
            const end = content.indexOf("}", idx);
            console.log("Context:\n" + content.substring(start, end + 1));
            idx = content.indexOf("plasma", idx + 1);
        }
    }
}

runDump().catch(console.error);
