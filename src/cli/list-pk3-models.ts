
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

async function listModels() {
    const pk3Path = 'public/games/default/basewsw/data0_15pure.pk3';
    console.log(`=== Listing MD3s in ${pk3Path} ===`);

    if (!fs.existsSync(pk3Path)) {
        console.error(`PK3 not found: ${pk3Path}`);
        return;
    }

    const buffer = fs.readFileSync(pk3Path);
    const zip = await JSZip.loadAsync(buffer);

    const files = Object.keys(zip.files).filter(f => f.endsWith('.md3'));

    console.log(`Found ${files.length} MD3 files. Filtering for 'ammo' or 'plasma'...`);

    files.filter(f => f.includes('ammo') || f.includes('plasma')).sort().forEach(f => console.log(f));
}

listModels().catch(console.error);
