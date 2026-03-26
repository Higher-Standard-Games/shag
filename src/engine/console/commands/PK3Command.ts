/**
 * PK3Command - PK3 archive management
 */

import { Command, type CommandDef } from "../Command";

export default class PK3Command extends Command {
  readonly definition: CommandDef = {
    name: "pk3",
    description: "PK3 archive management",
    usage: "pk3 <subcommand>",
    developer: true,
    subcommands: [
      { name: "list", description: "List indexed PK3 files" },
      { name: "index", description: "Rebuild PK3 index" },
      { name: "find", description: "Find a file in PK3s", args: [{ name: "pattern", type: "string", required: true }] },
      { name: "stats", description: "Show index statistics" },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    let pk3Index;
    try {
      const { PK3Index } = await import("../../loader/pk3/PK3Index");
      pk3Index = PK3Index.getInstance();
    } catch {
      return "PK3Index not available";
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "list": {
        const packages = pk3Index.getPackages();
        if (packages.length === 0) {
          return 'No PK3 files indexed. Run "pk3 index" first.';
        }
        const lines = [`${packages.length} PK3 files indexed:`];
        for (const pkg of packages) {
          lines.push(`  ${pkg.pk3} (${pkg.fileCount} files)`);
        }
        return lines.join("\n");
      }

      case "index": {
        const count = await pk3Index.buildIndex((msg) => console.log(`[PK3] ${msg}`));
        return `Index rebuilt: ${count} files indexed`;
      }

      case "find": {
        const pattern = args[1];
        if (!pattern) {
          return "Usage: pk3 find <pattern>";
        }
        // findFile returns the PK3 that contains a specific file
        const pk3 = pk3Index.findFile(pattern);
        if (!pk3) {
          return `File not found: "${pattern}"`;
        }
        return `Found "${pattern}" in ${pk3}`;
      }

      case "stats":
      default: {
        const stats = pk3Index.getStats();
        return (
          `PK3 Index Statistics:\n` +
          `  Packages: ${stats.packageCount}\n` +
          `  Files: ${stats.fileCount}\n` +
          `  Shaders: ${stats.shaderCount}\n` +
          `  Maps: ${stats.mapCount}`
        );
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["list", "index", "find", "stats"];
    }
    return [];
  }
}
