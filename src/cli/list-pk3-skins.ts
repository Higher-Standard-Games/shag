
import fs from 'fs';
import JSZip from 'jszip';

async function listSkins() {
    const pk3Path = 'public/games/default/basewsw/data0_15pure.pk3';

    if (!fs.existsSync(pk3Path)) return;

    const buffer = fs.readFileSync(pk3Path);
    const zip = await JSZip.loadAsync(buffer);

    const files = Object.keys(zip.files).filter(f => f.endsWith('.skin'));

    console.log(`Found ${files.length} SKIN files. Filtering for 'ammo'...`);
    files.filter(f => f.includes('ammo')).sort().forEach(f => console.log(f));
}

listSkins().catch(console.error);
