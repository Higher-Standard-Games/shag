
import { Command, CommandDef } from "../Command";
import { GameState } from "../../../games/default/GameState";
import { GameScene } from "../../../games/default/GameScene";

export default class DebugPlantsCommand extends Command {
    definition: CommandDef = {
        name: "debug_plants",
        description: "Manage plant state for debugging (list, clear)",
        usage: "debug_plants <action> [args]",
        developer: true
    };

    async execute(args: string[]): Promise<string> {
        const action = args[0] ? args[0].toLowerCase() : "help";
        const gameState = GameState.getInstance();

        switch (action) {
            case "list":
                const plants = gameState.getPlants();
                if (plants.length === 0) {
                    return "No plants found in GameState.";
                }

                let output = `Found ${plants.length} plants:\n`;
                plants.forEach(p => {
                    output += `- ID: ${p.id}, Map: ${p.mapId}, Strain: ${p.strain}, Pos: (${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)}, ${p.position.z.toFixed(1)})\n`;
                });
                return output;

            case "clear":
                const allPlants = [...gameState.getPlants()];
                let removed = 0;
                allPlants.forEach(p => {
                    if (gameState.removePlant(p.id)) {
                        removed++;
                    }
                });

                return `Cleared ${removed} plants from GameState.`;

            case "clear_map":
                const currentMap = GameScene.getInstance()?.getCurrentMap();
                if (!currentMap) return "No active map.";

                const mapPlants = gameState.getPlantsInMap(currentMap);
                let mapRemoved = 0;
                mapPlants.forEach(p => {
                    if (gameState.removePlant(p.id)) {
                        mapRemoved++;
                    }
                });

                return `Cleared ${mapRemoved} plants from map '${currentMap}'.`;

            case "refresh_visuals":
                return "Visual verification: If rings persist with no plants, restart map.";

            default:
                return `Unknown action: ${action}. Usage: debug_plants <list|clear|clear_map>`;
        }
    }
}
