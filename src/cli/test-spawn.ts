
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { EntityHandlerRegistry } from "../engine/core/EntityHandlerRegistry";
import { registerGameEntityHandlers } from "../games/default/EntityHandlers";
import { registerAllEntities } from "../games/default/EntityRegistration";
import { EntityRegistry } from "../shared/entities/EntityRegistry";
import { CameraSystem } from "../engine/camera/CameraSystem";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";

async function testSpawn() {
    console.log("=== Testing Entity Spawn ===");

    // Setup environment
    const engine = new NullEngine();
    const scene = new Scene(engine);

    // Mock CameraSystem
    const camera = new ArcRotateCamera("cam", 0, 0, 10, Vector3.Zero(), scene);
    CameraSystem.getInstance().init(scene, null as any);
    CameraSystem.getInstance().setCamera(camera);

    // Register things
    registerAllEntities();
    registerGameEntityHandlers();

    const registry = EntityRegistry.getInstance();
    console.log(`Registered Entities: ${registry.getAllIds().join(', ')}`);

    if (!registry.has('plasmagun')) {
        console.error("FAILED: plasmagun not registered");
        return;
    }

    // Test Weapon Spawn
    const weaponHandler = EntityHandlerRegistry.getHandler('weapon_plasmagun');
    if (!weaponHandler) {
        console.error("FAILED: No handler for weapon_plasmagun");
        return;
    }

    console.log("Spawning weapon_plasmagun...");
    const weaponResult = await weaponHandler({
        classname: 'weapon_plasmagun',
        properties: { origin: '100 0 -100', targetname: 'my_plasma' }
    }, scene);

    if (weaponResult.handled && weaponResult.node) {
        console.log("SUCCESS: Weapon spawned!", weaponResult.node.name);
        console.log("Position:", weaponResult.node.position.toString());
    } else {
        console.error("FAILED: Weapon spawn result invalid", weaponResult);
    }

    // Test Ammo Spawn
    const ammoHandler = EntityHandlerRegistry.getHandler('ammo_plasmagun');
    if (!ammoHandler) {
        console.error("FAILED: No handler for ammo_plasmagun");
        return;
    }

    console.log("Spawning ammo_plasmagun...");
    const ammoResult = await ammoHandler({
        classname: 'ammo_plasmagun',
        properties: { origin: '50 0 50' }
    }, scene);

    if (ammoResult.handled && ammoResult.node) {
        console.log("SUCCESS: Ammo spawned!", ammoResult.node.name);
        console.log("Position:", ammoResult.node.position.toString());
        // Check amount logic? We can't easily inspect private options of Pickup.
        // But if it created a Pickup node, it's good.
    } else {
        console.error("FAILED: Ammo spawn result invalid", ammoResult);
    }

    engine.dispose();
}

testSpawn().catch(console.error);
