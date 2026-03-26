/**
 * SpawnCommand - Spawn at map spawn points
 */

import { Command, type CommandDef } from "../Command";

export default class SpawnCommand extends Command {
  readonly definition: CommandDef = {
    name: "spawn",
    description: "Spawn at a map spawn point",
    usage: "spawn [index]",
    developer: true,
  };

  async execute(args: string[]): Promise<string | void> {
    // Get camera system and MapLoader
    let cameraSystem;
    let mapLoader;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      const { MapLoader } = await import("../../loader/map/MapLoader");
      cameraSystem = CameraSystem.getInstance();
      mapLoader = MapLoader.getInstance();
    } catch {
      return "Required systems not available";
    }

    const camera = cameraSystem.getCamera();
    if (!camera) {
      return "No active camera";
    }

    const bsp = mapLoader.getCurrentBsp();
    if (!bsp) {
      return "No BSP map loaded";
    }

    // Find spawn points
    const spawns = bsp.entities.filter(
      (e: { classname: string }) =>
        e.classname === "info_player_deathmatch" ||
        e.classname === "info_player_start" ||
        e.classname === "info_player_team1" ||
        e.classname === "info_player_team2",
    );

    if (spawns.length === 0) {
      return "No spawn points found in map";
    }

    // Select spawn point
    const index = parseInt(args[0] || "0", 10);
    const spawnIndex = Number.isNaN(index) ? 0 : Math.min(Math.max(0, index), spawns.length - 1);
    const spawn = spawns[spawnIndex];

    if (!spawn.properties?.origin) {
      return "Spawn point has no origin";
    }

    const parts = spawn.properties.origin.split(" ").map(Number);
    // Quake coords: origin is x, y, z but Y is up in Babylon
    camera.position.set(parts[0], parts[2] + 56, parts[1]);

    return `Spawned at ${spawn.classname} #${spawnIndex} (${parts[0]}, ${parts[2] + 56}, ${parts[1]})`;
  }
}
