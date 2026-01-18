import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MapLoader } from "../engine/loader/map/MapLoader";
import { PK3Index } from "../engine/loader/pk3/PK3Index";
import { registerGameEntityHandlers } from "../games/default/EntityHandlers";
import { registerAllEntities } from "../games/default/EntityRegistration";

async function main() {
    console.log("=== Testing Item Rendering (ModelLoader) ===");

    // 1. Setup Engine & Scene
    const engine = new NullEngine();
    const scene = new Scene(engine);

    // 2. Register Game Data
    registerAllEntities();
    registerGameEntityHandlers();

    // 3. Setup PK3
    const fs = await import('fs');
    const path = await import('path');
    const pk3Path = path.resolve('public/games/default/basewsw/map_wdm2.pk3');

    // Check if file exists
    if (!fs.existsSync(pk3Path)) {
        console.error("PK3 not found at:", pk3Path);
        process.exit(1);
    }
    const buffer = fs.readFileSync(pk3Path);

    // 4. Index PK3 
    const pk3Index = PK3Index.getInstance();
    await pk3Index.indexPK3ArrayBuffer('map_wdm2.pk3', buffer.buffer as ArrayBuffer, pk3Path);
    console.log("Indexed PK3.");

    // 5. Inject into PK3Loader
    const { PK3Loader } = await import('../engine/loader/pk3/PK3Loader');
    const pk3Loader = PK3Loader.getInstance();
    // @ts-ignore
    await pk3Loader.processPK3ArrayBuffer('map_wdm2.pk3', buffer.buffer as ArrayBuffer);
    console.log("Injected into PK3Loader");

    // 6. Test ModelLoader with a known item model (from entity definition)
    // We want to test if ModelLoader can load "models/items/ammo/ammobox/ammobox.md3"
    // Or whatever path the entity uses.

    const { ModelLoader } = await import('../engine/loader/model/ModelLoader');
    const { MD3Loader } = await import('../engine/loader/model/MD3Loader');

    // Mock texture loading in MD3Loader because NullEngine fails on real textures
    // We need to spy on MD3Loader.loadTexture or similar?
    // MD3Loader likely uses standard Materials or Textures.

    // Let's rely on ModelLoader parsing logic.
    const loader = ModelLoader.getInstance();
    loader.init(scene);

    // MOCK MD3Loader texture loading to avoid "Texture is not defined" in NullEngine
    const md3Loader = MD3Loader.getInstance();
    // @ts-ignore
    md3Loader.loadTexture = async (path) => {
        console.log(`[MockMD3] Skipping texture load: ${path}`);
        return null;
    };

    // Also mock global Texture class if needed by MD3Loader internals
    (global as any).Texture = class FakeTexture {
        constructor(url: string, scene: any) { }
    };

    const testPath = 'models/items/ammo/ammobox/ammobox.md3';
    console.log(`Attempting to load model: ${testPath}`);

    try {
        const result = await loader.loadModel(testPath, { scale: 1.0 });
        if (result && result.root) {
            console.log("SUCCESS: Model loaded!");
            console.log(` - Root name: ${result.root.name}`);
            console.log(` - Child meshes: ${result.root.getChildMeshes().length}`);
            result.root.getChildMeshes().forEach(m => {
                console.log(`   - Mesh: ${m.name}, Verts: ${m.getTotalVertices()}`);
            });
        } else {
            console.error("FAILURE: Model loaded but returned null root.");
        }
    } catch (e) {
        console.error("FAILURE: ModelLoader threw error:", e);
    }

    // 7. Test Spawning to check TransformNode creation
    console.log("\nTesting Map Spawn...");
    // Mock global fetch
    (global as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = input.toString();
        if (urlStr.endsWith('map_wdm2.pk3')) {
            return new Response(buffer);
        }
        return new Response(null, { status: 404 });
    };

    try {
        // We need to prevent MapLoader from crashing on Textures/Skybox
        // But we removed mocks for ModelLoader.
        // We might need to mock image loading if MD3 tries to load texture files.

        await MapLoader.getInstance().loadMap("wdm2", scene, (p) => { });

        const nodes = scene.transformNodes;
        const pickups = nodes.filter(n => n.getClassName() === "Pickup" || n.name.includes("weapon") || n.name.includes("ammo"));
        console.log(`Found ${pickups.length} pickup nodes.`);
        pickups.forEach(n => {
            console.log(` - ${n.name} (Class: ${n.getClassName()})`);
            const children = n.getChildMeshes();
            console.log(`   Children: ${children.length}`);
            // If debug box is there, we should see it
            const debugBox = children.find(c => c.name === "debug_pickup");
            if (debugBox) console.log("   -> Has DEBUG BOX");
        });

    } catch (e) {
        console.error("MapLoader error:", e);
    }
}

main().catch(console.error);
