/**
 * MapCommand - Map loading and management
 */

import { Command, type CommandDef } from "../Command";
import { getGameplayMapLauncher } from "../GameplayMapLauncher";

export default class MapCommand extends Command {
  private lastMapName: string | null = null;
  private lastGametype: string = "duel";

  readonly definition: CommandDef = {
    name: "map",
    description: "Developer server-backed map launch",
    usage: "map <name> [gametype] or map <subcommand>",
    developer: true,
    subcommands: [
      {
        name: "load",
        description: "Launch a server-backed map",
        args: [
          { name: "mapname", type: "string", required: true },
          { name: "gametype", type: "string", required: false },
        ],
      },
      { name: "reload", description: "Restart last server-backed map" },
      { name: "list", description: "List available maps" },
      { name: "current", description: "Show current map" },
      { name: "unload", description: "Disconnect and unload current map" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    // Import MapLoader dynamically
    const { MapLoader } = await import("../../loader/map/MapLoader");
    const mapLoader = MapLoader.getInstance();

    switch (subcommand) {
      case "load": {
        const mapName = args[1];
        if (!mapName) {
          return "Usage: map load <mapname> [gametype]\nExample: map load wdm2 duel";
        }
        return this.launchMap(mapName, args[2] || "duel");
      }

      case "reload": {
        if (!this.lastMapName) {
          return "No server-backed map launch to reload";
        }
        return this.launchMap(this.lastMapName, this.lastGametype);
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
        const rendered = mapLoader.getCurrentMap();
        if (!this.lastMapName && !rendered) return "No map loaded";
        return [
          this.lastMapName ? `Gameplay map: ${this.lastMapName} (${this.lastGametype})` : "",
          rendered ? `Rendered map: ${rendered}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }

      case "unload": {
        const launcher = getGameplayMapLauncher();
        if (launcher) {
          await launcher.unload();
        }
        const { unloadClientMap } = await import("../../loader/map/ClientMapLoader");
        await unloadClientMap();
        this.lastMapName = null;
        return "Map unloaded";
      }

      default: {
        // If no subcommand but has argument, treat as map name (shortcut: "map wdm1")
        if (subcommand && !["load", "reload", "list", "current", "unload"].includes(subcommand)) {
          return this.launchMap(subcommand, args[1] || "duel");
        }

        return [
          "Map Commands:",
          "  map <name> [gametype]      - Spawn a dedicated server via lobby and connect",
          "  map load <name> [gametype] - Same as above",
          "  map list        - List available maps",
          "  map current     - Show current map",
          "  map reload      - Restart last server-backed map",
          "  map unload      - Disconnect and unload current map",
          "",
          "Use bsp commands for inert BSP inspection/rendering.",
        ].join("\n");
      }
    }
  }

  private async launchMap(mapName: string, gametype: string): Promise<string> {
    const launcher = getGameplayMapLauncher();
    if (!launcher) {
      return "No gameplay map launcher registered. Use bsp commands for map inspection.";
    }

    if (typeof window !== "undefined") {
      const { preparePublishedMap } = await import("../../editor/PublishedMapClient");
      await preparePublishedMap(mapName.toLowerCase());
    }
    const result = await launcher.launch(mapName, gametype || "duel");
    this.lastMapName = result.map;
    this.lastGametype = result.gametype;

    return `Launched ${result.map} (${result.gametype}) on ${result.serverUrl}`;
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["load", "reload", "list", "current", "unload"];
    }
    return [];
  }
}
