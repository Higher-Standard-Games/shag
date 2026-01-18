import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MapLoader } from "../engine/loader/map/MapLoader";
import { PK3Index } from "../engine/loader/pk3/PK3Index";
import { registerGameEntityHandlers } from "../games/default/EntityHandlers";
import { registerAllEntities } from "../games/default/EntityRegistration";
import { EntityHandlerRegistry } from "../engine/core/EntityHandlerRegistry";
import { GamePaths } from "../engine/core/GamePaths";

// Mock BspMeshBuilder logging to reduce noise?
// Actually BspMeshBuilder needs Scene.
// We might need to mock internal Babylon dependencies if valid meshes can't be created in NullEngine
// But BspMeshBuilder is robust enough usually.

async function main() {
    console.log("=== Testing MapLoader Integration ===");

    // 1. Setup Engine & Scene
    const engine = new NullEngine();
    const scene = new Scene(engine);
    console.log("Engine & Scene initialized.");

    // 2. Register Game Data
    console.log("Registering entities and handlers...");
    registerAllEntities();
    // registerGameEntityHandlers(); // OLD way
    // NEW way:
    const { EntityManager } = await import('../engine/entities/EntityManager');
    EntityManager.getInstance().registerHandlers();

    // 3. Setup PK3 Index
    const fs = await import('fs');
    const path = await import('path');

    // Path to the real pk3
    const pk3Path = path.resolve('public/games/default/basewsw/map_wdm2.pk3');
    if (!fs.existsSync(pk3Path)) {
        console.error("PK3 not found at:", pk3Path);
        process.exit(1);
    }

    console.log("Loading PK3 into memory for indexing:", pk3Path);
    const buffer = fs.readFileSync(pk3Path);

    // Index it
    const pk3Index = PK3Index.getInstance();
    // Simulate it being 'games/default/basewsw/data0_15pure.pk3' as filename/key
    // or just 'data0_15pure.pk3' if that's how it's usually referenced.
    // The GamePaths usually handles directories. MapLoader uses pk3Index.findMap("wdm2").
    // indexPK3ArrayBuffer needs a filename.
    await pk3Index.indexPK3ArrayBuffer('map_wdm2.pk3', buffer.buffer as ArrayBuffer, pk3Path);

    // DEBUG: Manually inspect zip contents to see why wdm2 was missed
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    console.log("DEBUG: Zip file examples:");
    const fileNames = Object.keys(zip.files);
    fileNames.slice(0, 5).forEach(f => console.log(` - ${f}`));
    const bspFiles = fileNames.filter(f => f.endsWith('.bsp'));
    console.log("DEBUG: BSP files found:", bspFiles);


    console.log("PK3 indexed. Index stats:", pk3Index.getStats());

    // Verify wdm2 is found
    const mapPk3 = pk3Index.findMap("wdm2");
    if (!mapPk3) {
        console.error("Map 'wdm2' not found in indexed PK3!");
        process.exit(1);
    }
    console.log(`Map 'wdm2' found in: ${mapPk3}`);

    // 4. Run MapLoader
    console.log("Running MapLoader.loadMap('wdm2')...");

    // Mock fetch for PK3Loader
    // MapLoader -> loadBspMap -> calls pk3Loader.loadPK3('data0_15pure.pk3')
    // PK3Loader usually fetches. Since we indexed it with arrayBuffer, PK3Loader.loadPK3 might try to fetch it if not already loaded?
    // PK3Index stores index, but PK3Loader stores loaded zip instances.
    // We should pre-load PK3Loader with this buffer to avoid fetch errors.

    const { PK3Loader } = await import('../engine/loader/pk3/PK3Loader');
    // We can't easily inject into PK3Loader.loadedPackages if it's private.
    // But PK3Loader has loadPK3FromUrl.
    const pk3Loader = PK3Loader.getInstance();

    // Access private method to inject buffer
    // @ts-ignore
    await pk3Loader.processPK3ArrayBuffer('map_wdm2.pk3', buffer.buffer as ArrayBuffer);
    console.log("Injected map_wdm2.pk3 into PK3Loader");

    // Mock ModelLoader to prevent GLB loading errors
    const { ModelLoader } = await import('../engine/loader/model/ModelLoader');
    ModelLoader.getInstance().loadModel = async () => {
        console.log("Mock ModelLoader: loadModel skipped");
        return null;
    };

    try {
        const result = await MapLoader.getInstance().loadMap("wdm2", scene, (p) => {
            console.log(`[Progress] ${p.phase} - ${p.detail || ''}`);
        });

        console.log("MapLoader result success:", result.success);
        console.log("Map type:", result.mapType);
        if (result.playerStartPosition) {
            console.log("Player Start: ", result.playerStartPosition.toString());
        } else {
            console.warn("Player Start MISSING in result");
        }

        // 5. Verify Entities
        const transformNodes = scene.transformNodes;
        console.log("DEBUG: All TransformNodes in scene:");
        transformNodes.forEach(n => console.log(` - ${n.name} (Class: ${n.getClassName()})`));

        const weaponNodes = transformNodes.filter(n => n.name.includes("weapon_plasmagun"));
        const ammoNodes = transformNodes.filter(n => n.name.includes("ammo_plasmagun"));

        console.log(`Found ${weaponNodes.length} 'weapon_plasmagun' nodes.`);
        console.log(`Found ${ammoNodes.length} 'ammo_plasmagun' nodes.`);

        if (weaponNodes.length > 0) {
            console.log("TEST SUCCESS: Plasmapgun spawned!");
        } else {
            console.error("TEST FAILURE: No plasmagun spawned.");
        }

    } catch (e) {
        console.error("MapLoader threw error:", e);
    }

}

main().catch(console.error);
