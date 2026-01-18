/**
 * Test script to verify asset preloading works correctly
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { PK3Index } from "../engine/loader/pk3/PK3Index";
import { PK3Loader } from "../engine/loader/pk3/PK3Loader";
import { registerGameEntityHandlers } from "../games/default/EntityHandlers";
import { registerAllEntities } from "../games/default/EntityRegistration";
import { AssetPreloader } from "../engine/loader/AssetPreloader";
import { BspLoader } from "../engine/loader/bsp/BspLoader";

async function main() {
    console.log("=== Testing Asset Preloading ===\n");

    // 1. Setup Engine & Scene
    const engine = new NullEngine();
    const scene = new Scene(engine);

    // 2. Register Game Data
    registerAllEntities();
    registerGameEntityHandlers();
    console.log("✓ Entity definitions registered\n");

    // 3. Setup PK3
    const fs = await import('fs');
    const path = await import('path');
    const pk3Path = path.resolve('public/games/default/basewsw/map_wdm2.pk3');

    if (!fs.existsSync(pk3Path)) {
        console.error("PK3 not found at:", pk3Path);
        process.exit(1);
    }
    const buffer = fs.readFileSync(pk3Path);

    // 4. Index and load PK3 
    const pk3Index = PK3Index.getInstance();
    await pk3Index.indexPK3ArrayBuffer('map_wdm2.pk3', buffer.buffer as ArrayBuffer, pk3Path);
    console.log("✓ PK3 indexed\n");

    const pk3Loader = PK3Loader.getInstance();
    // @ts-ignore
    await pk3Loader.processPK3ArrayBuffer('map_wdm2.pk3', buffer.buffer as ArrayBuffer);
    console.log("✓ PK3 processed\n");

    // 5. Load BSP data
    const bspPath = 'maps/wdm2.bsp';
    const bspBuffer = await pk3Loader.getFile(bspPath);

    if (!bspBuffer) {
        console.error("BSP not found in PK3:", bspPath);
        process.exit(1);
    }

    const bsp = BspLoader.load(bspBuffer);
    console.log(`✓ BSP parsed: ${bsp.entities.length} entities\n`);

    // 6. Test AssetPreloader
    console.log("Testing AssetPreloader...\n");
    const preloader = AssetPreloader.getInstance();

    const preloadCount = await preloader.preloadFromBsp(bsp, scene, (progress) => {
        console.log(`  [${progress.current + 1}/${progress.total}] ${progress.modelPath}`);
    });

    console.log(`\n✓ Preloaded ${preloadCount} models\n`);

    // 7. Verify cache
    console.log("Cache status:");
    if (preloader.hasModel('models/weapons/plasmagun/plasmagun.md3')) {
        console.log("  ✓ plasmagun.md3 is cached");
    } else {
        console.log("  ✗ plasmagun.md3 NOT cached");
    }

    console.log("\n=== Test Complete ===");
    process.exit(0);
}

main().catch(e => {
    console.error("Test failed:", e);
    process.exit(1);
});
