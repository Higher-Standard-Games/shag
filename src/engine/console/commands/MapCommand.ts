/**
 * MapCommand - Map loading and management
 */

import { PLAYER_ORIGIN_HEIGHT } from "../../physics/PlayerPhysicsConstants";
import { Command, type CommandDef } from "../Command";
import { CommandRegistry } from "../CommandRegistry";

export default class MapCommand extends Command {
  readonly definition: CommandDef = {
    name: "map",
    description: "Map loading and management",
    usage: "map <name> or map <subcommand>",
    subcommands: [
      { name: "load", description: "Load a map", args: [{ name: "mapname", type: "string", required: true }] },
      { name: "reload", description: "Reload current map" },
      { name: "list", description: "List available maps" },
      { name: "current", description: "Show current map" },
      { name: "unload", description: "Unload current map" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    // Get camera system and scene
    let cameraSystem = undefined;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      cameraSystem = CameraSystem.getInstance();
    } catch {
      return "CameraSystem not available";
    }

    // Import MapLoader dynamically
    const { MapLoader } = await import("../../loader/map/MapLoader");
    const mapLoader = MapLoader.getInstance();
    const registry = CommandRegistry.getInstance();

    switch (subcommand) {
      case "load": {
        const mapName = args[1];
        if (!mapName) {
          return "Usage: map load <mapname>\nExample: map load wdm1";
        }
        return this.loadMap(mapName, cameraSystem, mapLoader, registry);
      }

      case "reload": {
        const currentMap = mapLoader.getCurrentMap();
        if (!currentMap) {
          return "No map currently loaded";
        }
        const activeScene = cameraSystem.getCamera()?.getScene();
        if (!activeScene) {
          return "No scene available";
        }
        const result = await mapLoader.loadMap(currentMap, activeScene);
        return result.success ? `Reloaded map: ${currentMap}` : `Failed to reload: ${result.error}`;
      }

      case "list": {
        const { PK3Index } = await import("../../loader/pk3/PK3Index");
        const pk3Index = PK3Index.getInstance();

        if (!pk3Index.hasIndex()) {
          return 'No PK3 index. Run "pk3 index" first to discover maps.';
        }

        const maps = mapLoader.getAvailableMaps();
        if (maps.length === 0) {
          return "No maps found in index.";
        }

        const lines = [`Available maps (${maps.length}):`];
        const displayMaps = maps.slice(0, 30);
        for (const map of displayMaps) {
          lines.push(`  ${map.name} (${map.pk3})`);
        }
        if (maps.length > 30) {
          lines.push(`  ... and ${maps.length - 30} more`);
        }
        return lines.join("\n");
      }

      case "current": {
        const current = mapLoader.getCurrentMap();
        return current ? `Current map: ${current}` : "No map loaded";
      }

      case "unload": {
        mapLoader.disposeCurrentMap();
        return "Map unloaded";
      }

      default: {
        // If no subcommand but has argument, treat as map name (shortcut: "map wdm1")
        if (subcommand && !["load", "reload", "list", "current", "unload"].includes(subcommand)) {
          return this.loadMap(subcommand, cameraSystem, mapLoader, registry);
        }

        return [
          "Map Commands:",
          "  map <name>      - Load a map (BSP from PK3)",
          "  map load <name> - Same as above",
          "  map list        - List available maps",
          "  map current     - Show current map",
          "  map reload      - Reload current map",
          "  map unload      - Unload current map",
        ].join("\n");
      }
    }
  }

  private async loadMap(
    mapName: string,
    cameraSystem: any,
    mapLoader: any,
    registry: CommandRegistry,
  ): Promise<string> {
    // Ensure RenderVars is instantiated (registers r_* cvars for BSP rendering)
    const { RenderVars } = await import("../../rendering/RenderVars");
    RenderVars.getInstance();

    let scene = cameraSystem.getCamera()?.getScene();

    if (!scene) {
      // Try to create empty scene first
      await registry.execute("scene empty");
      scene = cameraSystem.getCamera()?.getScene();
      if (!scene) {
        return 'No scene available. Run "scene empty" first.';
      }
    } else {
      // Clear existing scene before loading new map
      await registry.execute("scene clear");
      scene = cameraSystem.getCamera()?.getScene();
    }

    if (!scene) {
      return "No scene available";
    }

    // CRITICAL: Re-apply scene settings required for BSP rendering after clear
    // These may have been lost during scene clear or may not be set if using main.ts scene
    const { Color3 } = await import("@babylonjs/core/Maths/math.color");
    scene.ambientColor = new Color3(1, 1, 1); // Required for BSP lightmaps to render correctly
    scene.blockMaterialDirtyMechanism = false; // Allow material updates after texture assignment
    console.log("[MapCommand] Applied scene settings for BSP rendering");

    const result = await mapLoader.loadMap(mapName, scene, (progress: any) => {
      console.log(`[Map] ${progress.phase}${progress.detail ? `: ${progress.detail}` : ""}`);
    });

    if (result.success) {
      // Load day/night settings from worldspawn for BSP maps
      if (result.mapType === "bsp") {
        const { SkyLightSystem } = await import("../../lighting/SkyLightSystem");
        const sky = SkyLightSystem.getInstance();
        sky.resetWorldspawn(); // Reset for new map
        sky.loadFromWorldspawn(); // Load settings from worldspawn
      }

      // Force Spectator Mode removed to maintain FPS consistency
      // await registry.execute('spectator 1');

      // Spawn Logic using result.playerStartPosition
      let spawnStatus = "";
      if (result.playerStartPosition) {
        const spawnPos = result.playerStartPosition.clone();
        // Spawn position from BSP is at floor/feet level
        // Convert to ORIGIN level for Q3-style physics (origin is 24 above feet)
        spawnPos.y += PLAYER_ORIGIN_HEIGHT;

        // Calculate rotation from spawn entity if available
        let initialYaw = 0;
        if (result.bsp?.entities) {
          const spawnExp = result.bsp.entities.find(
            (e: any) => e.classname === "info_player_deathmatch" || e.classname === "info_player_start",
          );
          if (spawnExp?.properties?.angle) {
            // Convert Quake angle (0=East, 90=North) to Babylon (0=North)
            const angleDeg = parseFloat(spawnExp.properties.angle);
            initialYaw = -(angleDeg - 90) * (Math.PI / 180);
          }
        }

        const controller = cameraSystem.getActiveController();

        // 1. Set Position
        // biome-ignore lint/suspicious/noExplicitAny: BSP mesh metadata access
        if (controller && (controller as any).setPosition) {
          console.log(`[MapCommand] Teleporting ${controller.type} to ${spawnPos}`);
          // biome-ignore lint/suspicious/noExplicitAny: BSP mesh metadata access
          (controller as any).setPosition(spawnPos);

          // Delayed sync to ensure it sticks
          setTimeout(() => {
            if (cameraSystem.getActiveController() === controller) {
              // biome-ignore lint/suspicious/noExplicitAny: BSP mesh metadata access
              (controller as any).setPosition(spawnPos);
            }
          }, 100);
        } else {
          // Fallback
          const cam = cameraSystem.getCamera();
          if (cam) cam.position.copyFrom(spawnPos);
        }

        // 2. Set Rotation (Reset pitch, apply yaw)
        const cam = cameraSystem.getCamera();
        if (cam) {
          cam.rotation.x = 0; // Level view (reset pitch)
          cam.rotation.z = 0; // No roll
          cam.rotation.y = initialYaw;
          console.log(`[MapCommand] Set rotation: yaw=${initialYaw.toFixed(2)}`);
        }

        spawnStatus = `  Spawned at: ${spawnPos}`;
      }

      // Auto-enable PVS culling for BSP maps
      const pvsStatus = "";
      /* DISABLED: PVS culling causes invisible geometry on console load (camera cluster sync issue?)
      if (result.mapType === 'bsp' && result.meshResult?.clusterInfo?.hasPVS) {
        const pvsResult = await registry.execute('pvs on');
        pvsStatus = pvsResult ? `  PVS: enabled` : '';
      }
      */
      // Emit map:loaded event for UI systems
      const { EventBus } = await import("../../core/EventBus");
      EventBus.emit("map:loaded", { mapName });

      return [
        `Loaded map: ${mapName} (${result.mapType})`,
        result.meshResult ? `  Vertices: ${result.meshResult.stats.totalVertices}` : "",
        result.meshResult ? `  Triangles: ${result.meshResult.stats.totalTriangles}` : "",
        pvsStatus,
        spawnStatus,
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      return `Failed to load map: ${result.error}`;
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["load", "reload", "list", "current", "unload"];
    }
    return [];
  }
}
