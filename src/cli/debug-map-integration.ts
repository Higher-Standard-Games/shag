import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AssetLoader } from "../engine/AssetLoader";
import { MapRenderer } from "../engine/MapRenderer";
import { registerGameEntityHandlers } from "../games/default/EntityHandlers";
import { EntityHandlerRegistry } from "../engine/core/EntityHandlerRegistry";
import { registerAllEntities } from "../games/default/EntityRegistration";
import { PK3Loader } from "../engine/loader/pk3/PK3Loader";
import { BspLoader } from "../engine/loader/bsp/BspLoader";
import { GamePaths } from "../engine/core/GamePaths";

async function main() {
    console.log("=== Debugging Map Integration ===");

    // 1. Setup Engine & Scene
    const engine = new NullEngine();
    const scene = new Scene(engine);
    console.log("Engine & Scene initialized.");

    // 2. Register Game Data (Handlers & Defs)
    console.log("Registering entities and handlers...");
    registerAllEntities();
    registerGameEntityHandlers();

    // Verify registration immediately
    const handler = EntityHandlerRegistry.getHandler("weapon_plasmagun");
    console.log("Handler for 'weapon_plasmagun':", handler ? "FOUND" : "MISSING");
    if (!handler) {
        console.error("CRITICAL: Handler not registered!");
        process.exit(1);
    }

    // 3. Mock Asset Loading (Load specific map)
    const mapName = "wdm2";
    console.log(`Loading map data for: ${mapName}...`);

    // We need to simulate how AssetLoader gets the entities.
    // In real app: AssetLoader.loadMapDynamic -> BspLoader.load -> returns { entities }
    // We'll use PK3Loader to get the BSP file content, then BspLoader to parse it.

    // Initialize GamePaths to point to local dir for CLI
    // Note: PK3Loader in CLI usually needs a file system path or URL
    // We'll mock PK3Loader to load from local FS if possible, or assume CLI environment has access
    // Assuming run_command runs from project root.

    // We can use BspLoader directly if we have the file buffer.
    // Let's rely on the existing CLI helpers or just read file node-style for this test.
    const fs = await import('fs');
    const path = await import('path');

    // Path to the pk3
    const pk3Path = path.resolve('public/games/default/basewsw/data0_15pure.pk3');
    console.log("Reading PK3 from:", pk3Path);

    // Use PK3Loader to open it
    const pk3Loader = PK3Loader.getInstance();
    // We need to load it. PK3Loader usually fetches via fetch/XHR.
    // In Node, we might need a polyfill or just use fs to read it and pass buffer if supported.
    // But PK3Loader.loadPK3FromUrl uses fetch. 
    // Let's implement a quick node-friendly way or use existing tools.
    // Actually, `src/cli/dump-map-entities.ts` used JSZip directly. Let's do that.

    const JSZip = (await import('jszip')).default;
    const fileData = fs.readFileSync(pk3Path);
    const zip = await JSZip.loadAsync(fileData);


    let bspFile = zip.file(`maps/${mapName}.bsp`);
    if (!bspFile) {
        // Fallback to root or other path
        bspFile = zip.file(`${mapName}.bsp`);
    }

    if (!bspFile) {
        console.error("BSP file not found in PK3. Available files:");
        const files = [];
        zip.forEach((path) => files.push(path));
        console.log(files.filter(f => f.endsWith('.bsp')).join('\n'));
        process.exit(1);
    }

    const bspBuffer = await bspFile.async('arraybuffer');
    console.log(`Loaded BSP buffer: ${bspBuffer.byteLength} bytes`);

    // 4. Parse BSP Entities
    console.log("Parsing BSP entities...");
    // BspLoader.load returns BspFile
    const bspData = BspLoader.load(bspBuffer);

    if (!bspData.entities || bspData.entities.length === 0) {
        console.error("No entities parsed from BSP!");
        process.exit(1);
    }
    console.log(`Parsed ${bspData.entities.length} entities.`);

    // 5. Filter for our target entities
    const weapons = bspData.entities.filter(e => e.classname === 'weapon_plasmagun');
    const ammo = bspData.entities.filter(e => e.classname === 'ammo_plasmagun');
    console.log(`Found ${weapons.length} weapon_plasmagun entities.`);
    console.log(`Found ${ammo.length} ammo_plasmagun entities.`);

    if (weapons.length === 0 && ammo.length === 0) {
        console.warn("Target entities not found in map data. Cannot test spawning.");
        process.exit(0);
    }

    // 6. Test MapRenderer.renderEntities
    console.log("Running MapRenderer.renderEntities...");

    // Mock ModelLoader to prevent it trying to load actual GLBs in NullEngine
    // We just want to see if it calls our handler.
    const { ModelLoader } = await import('../engine/loader/model/ModelLoader');
    ModelLoader.getInstance().loadModel = async () => { return null; }; // Mock

    // We can spy on console.log/error to verify execution
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args) => {
        logs.push(args.join(' '));
        origLog(...args);
    };

    const result = await MapRenderer.renderEntities(bspData.entities, scene, mapName);

    console.log("Render completed.");
    console.log("Checking logs for handler execution...");

    const pickupLogs = logs.filter(l => l.includes("Registering build_zone") || l.includes("Created NPC") || l.includes("weapon_plasmagun") || l.includes("ammo_plasmagun"));
    // Note: EntityHandlers.ts handlePickup doesn't log much by default. 
    // We should check the result.prefabInstances or similar?
    // MapRenderer: "Handle entities via EntityHandlerRegistry... if (result.handled && result.node) { prefabInstances.push(result.node); }"

    // Pickup objects are TransformNodes. Let's inspect the scene.
    const transformNodes = scene.transformNodes;
    console.log(`Scene has ${transformNodes.length} transform nodes.`);

    const weaponNodes = transformNodes.filter(n => n.name.includes("weapon_plasmagun"));
    const ammoNodes = transformNodes.filter(n => n.name.includes("ammo_plasmagun")); // Name set in Pickup constructor

    console.log(`Found ${weaponNodes.length} nodes matching 'weapon_plasmagun'`);
    console.log(`Found ${ammoNodes.length} nodes matching 'ammo_plasmagun'`);

    if (weaponNodes.length > 0) {
        console.log("SUCCESS: weapon_plasmagun nodes created in scene!");
        // Verify parent/position?
        console.log("Sample node pos:", weaponNodes[0].position.toString());
    } else {
        console.error("FAILURE: No weapon nodes created.");
    }

    if (ammoNodes.length > 0) {
        console.log("SUCCESS: ammo_plasmagun nodes created in scene!");
    } else {
        console.error("FAILURE: No ammo nodes created.");
    }

    console.log("=== Debug Complete ===");
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
