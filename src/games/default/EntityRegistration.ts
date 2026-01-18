
import { EntityRegistry } from "../../shared/entities/EntityRegistry";
import * as Definitions from "../../shared/entities/definitions";

/**
 * Register all static entity definitions
 */
export function registerAllEntities(): void {
    const registry = EntityRegistry.getInstance();

    console.log("[EntityRegistration] Registering entities...");

    // Iterate over all exports in definitions
    for (const key in Definitions) {
        const value = (Definitions as any)[key];

        // Check if it matches EntityDef shape (has id and type)
        if (value && typeof value === 'object' && 'id' in value && 'type' in value) {
            registry.register(value);
        }
    }

    console.log(`[EntityRegistration] Total entities registered: ${registry.getCount()}`);
}
