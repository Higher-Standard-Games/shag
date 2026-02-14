/**
 * Headless test to verify Pickup gravity works with CollisionManager
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Logger } from "@babylonjs/core/Misc/logger";
import { CollisionManager } from "../engine/physics/CollisionManager";

// Suppress Babylon.js noise
Logger.LogLevels = 0;

// Mock BspFile (minimal structure for testing)
const mockBsp: any = {
    faces: [],
    textures: [],
    vertices: [],
    models: [{ firstFace: 0, numFaces: 0, mins: [0, 0, 0], maxs: [100, 100, 100] }],
    brushes: [
        {
            firstSide: 0,
            numSides: 6,
            textureIndex: 0
        }
    ],
    brushSides: [
        { planeIndex: 0, textureIndex: 0 },
        { planeIndex: 1, textureIndex: 0 },
        { planeIndex: 2, textureIndex: 0 },
        { planeIndex: 3, textureIndex: 0 },
        { planeIndex: 4, textureIndex: 0 },
        { planeIndex: 5, textureIndex: 0 },
    ],
    planes: [
        { normal: [0, 0, 1], dist: 0 },    // Floor at Z=0 (becomes Y=0 in Babylon)
        { normal: [0, 0, -1], dist: -100 },
        { normal: [1, 0, 0], dist: 50 },
        { normal: [-1, 0, 0], dist: 50 },
        { normal: [0, 1, 0], dist: 50 },
        { normal: [0, -1, 0], dist: 50 },
    ],
    leafBrushes: [0],
    leaves: [{ cluster: 0, area: 0, firstLeafBrush: 0, numLeafBrushes: 1, firstLeafSurface: 0, numLeafSurfaces: 0, mins: [-100, -100, -100], maxs: [100, 100, 100] }],
    visData: null,
    effects: [],
    entities: [],
    format: "IBSP",
    version: 46
};

async function runTest() {
    console.log("=== TESTING COLLISION MANAGER findGround ===");

    const engine = new NullEngine();
    const scene = new Scene(engine);

    // Initialize collision manager with mock BSP
    const cm = CollisionManager.getInstance();
    console.log("[Test] Initializing CollisionManager...");
    await cm.init(mockBsp, scene, 'q3');

    console.log(`[Test] CollisionManager initialized: ${cm.isInitialized()}`);
    console.log(`[Test] Active backend: ${cm.getBackendType()}`);

    // Test findGround from high up
    const testPoints = [
        new Vector3(0, 100, 0),   // High above origin
        new Vector3(25, 50, 25),  // Somewhere in space
    ];

    for (const point of testPoints) {
        console.log(`\n[Test] Finding ground below ${point}...`);
        const ground = cm.findGround(point, 500);
        if (ground) {
            console.log(`  SUCCESS: Ground at Y=${ground.position.y}, Normal=${ground.normal}`);
        } else {
            console.log(`  FAILED: No ground found below ${point}`);
        }
    }

    // Also test trace directly
    console.log("\n[Test] Direct trace from (0, 100, 0) to (0, -100, 0)...");
    const trace = cm.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));
    console.log(`  Trace result: fraction=${trace.fraction}, endPos=${trace.endPos}, startSolid=${trace.startSolid}`);

    engine.dispose();
    console.log("\n=== TEST COMPLETE ===");
}

runTest().catch(console.error);
