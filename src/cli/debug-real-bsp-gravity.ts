/**
 * Comprehensive headless test for Pickup gravity using real BSP data
 * Tests the full collision chain: BSP -> CollisionManager -> findGround
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Logger } from "@babylonjs/core/Misc/logger";
import * as fs from "fs";
import * as path from "path";
import JSZip from "jszip";

// Suppress Babylon.js noise
Logger.LogLevels = 0;

async function runTest() {
    console.log("=== HEADLESS PICKUP GRAVITY TEST WITH REAL BSP ===\n");

    // Step 1: Load a real map PK3
    const pk3Path = path.join(process.cwd(), "public/games/default/map_wdm2.pk3");
    console.log(`[Test] Loading PK3: ${pk3Path}`);

    if (!fs.existsSync(pk3Path)) {
        console.error(`[Test] PK3 not found at ${pk3Path}`);
        console.log("[Test] Available maps:");
        const mapsDir = path.join(process.cwd(), "public/assets/maps");
        if (fs.existsSync(mapsDir)) {
            fs.readdirSync(mapsDir).forEach(f => console.log(`  - ${f}`));
        }
        return;
    }

    const pk3Buffer = fs.readFileSync(pk3Path);
    const zip = await JSZip.loadAsync(pk3Buffer);

    // Find BSP file
    let bspFile: JSZip.JSZipObject | null = null;
    let bspName = "";
    zip.forEach((relativePath, file) => {
        if (relativePath.endsWith(".bsp")) {
            bspFile = file;
            bspName = relativePath;
        }
    });

    if (!bspFile) {
        console.error("[Test] No BSP file found in PK3!");
        return;
    }

    console.log(`[Test] Found BSP: ${bspName}`);
    const bspData = await (bspFile as JSZip.JSZipObject).async("arraybuffer");
    console.log(`[Test] BSP size: ${bspData.byteLength} bytes`);

    // Step 2: Parse BSP
    console.log("\n[Test] Parsing BSP...");
    const { BspLoader } = await import("../engine/loader/bsp/BspLoader");
    const bsp = BspLoader.load(bspData);
    console.log(`[Test] BSP loaded: ${bsp.faces.length} faces, ${bsp.brushes.length} brushes`);

    // Step 3: Initialize Collision
    console.log("\n[Test] Initializing CollisionManager...");
    const engine = new NullEngine();
    const scene = new Scene(engine);

    const { CollisionManager } = await import("../engine/physics/CollisionManager");
    const cm = CollisionManager.getInstance();
    await cm.init(bsp, scene, 'q3'); // Using 'q3' (sweep collision) instead of 'brush'

    console.log(`[Test] CollisionManager initialized: ${cm.isInitialized()}`);
    console.log(`[Test] Active backend: ${cm.getBackendType()}`);
    console.log(`[Test] Stats:`, cm.getStats());

    // Step 4: Test findGround at various positions
    console.log("\n[Test] Testing findGround...");

    // Try to find a player spawn point from entities
    let testPos = new Vector3(0, 500, 0); // Default fallback
    for (const ent of bsp.entities) {
        if (ent.classname === "info_player_deathmatch" || ent.classname === "info_player_start") {
            const origin = (ent as any).origin || (ent as any).properties?.origin;
            if (origin) {
                const parts = origin.split(" ").map(parseFloat);
                // Q3 coords to Babylon: (x, y, z) -> (x, z, y)
                testPos = new Vector3(parts[0], parts[2] + 100, parts[1]); // +100 to be above floor
                console.log(`[Test] Found player spawn at Q3:(${origin}) -> Babylon:${testPos}`);
                break;
            }
        }
    }

    console.log(`\n[Test] Testing from position: ${testPos}`);

    // Test 1: findGround
    const ground = cm.findGround(testPos, 2000);
    if (ground) {
        console.log(`[Test] findGround SUCCESS!`);
        console.log(`  Ground Y: ${ground.position.y}`);
        console.log(`  Normal: ${ground.normal}`);
        console.log(`  Would drop from Y=${testPos.y} to Y=${ground.position.y + 8}`);
    } else {
        console.error(`[Test] findGround FAILED - returned NULL`);

        // Debug: Try a direct trace
        console.log("\n[Test] Debugging with direct trace (debug=true)...");
        const traceEnd = testPos.add(new Vector3(0, -2000, 0));
        const trace = cm.trace(testPos, traceEnd, { debug: true });
        console.log(`[Test] Direct trace result:`);
        console.log(`  fraction: ${trace.fraction}`);
        console.log(`  endPos: ${trace.endPos}`);
        console.log(`  startSolid: ${trace.startSolid}`);
        console.log(`  allSolid: ${trace.allSolid}`);
        console.log(`  contents: ${trace.contents}`);
        console.log(`  normal: ${trace.normal}`);
    }

    // Test 2: Try multiple positions
    console.log("\n[Test] Testing multiple positions...");
    const testPositions = [
        new Vector3(0, 300, 0),
        new Vector3(100, 300, 100),
        new Vector3(-100, 300, -100),
        new Vector3(500, 300, 500),
    ];

    for (const pos of testPositions) {
        const g = cm.findGround(pos, 2000);
        const result = g ? `Y=${g.position.y}` : "NULL";
        console.log(`  Pos ${pos} -> Ground: ${result}`);
    }

    engine.dispose();
    console.log("\n=== TEST COMPLETE ===");
}

runTest().catch(err => {
    console.error("Test failed with error:", err);
    process.exit(1);
});
