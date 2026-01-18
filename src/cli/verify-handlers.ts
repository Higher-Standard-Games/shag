
import { registerGameEntityHandlers } from '../games/default/EntityHandlers';
import { EntityHandlerRegistry } from '../engine/core/EntityHandlerRegistry';

async function runVerification() {
    console.log("=== Verifying Entity Handler Registration ===");

    // Simulate game startup
    registerGameEntityHandlers();

    // Check if handlers exist
    const plasmaHandler = EntityHandlerRegistry.getHandler('weapon_plasmagun');
    const ammoHandler = EntityHandlerRegistry.getHandler('ammo_plasmagun');

    console.log(`Handler for 'weapon_plasmagun': ${plasmaHandler ? 'FOUND' : 'MISSING'}`);
    console.log(`Handler for 'ammo_plasmagun': ${ammoHandler ? 'FOUND' : 'MISSING'}`);

    if (plasmaHandler && ammoHandler) {
        console.log("SUCCESS: Entities are registered and ready to spawn.");
    } else {
        console.error("FAILURE: Handlers not registered.");
        process.exit(1);
    }
}

runVerification().catch(console.error);
