/**
 * MemCommand - Memory and performance info
 */

import { Command, type CommandDef } from "../Command";

export default class MemCommand extends Command {
  readonly definition: CommandDef = {
    name: "mem",
    description: "Memory and performance info",
    usage: "mem [subcommand]",
    developer: true,
    subcommands: [
      { name: "info", description: "Show memory usage" },
      { name: "gc", description: "Request garbage collection (if available)" },
      { name: "textures", description: "Show texture memory usage" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "gc":
        if (window.gc) {
          window.gc();
          return "Garbage collection requested";
        }
        return 'GC not available (run Chrome with --js-flags="--expose-gc")';

      case "textures": {
        try {
          const { TextureMemoryManager } = await import("../../loader/texture/TextureMemoryManager");
          const tmm = TextureMemoryManager.getInstance();
          const stats = tmm.getStats();
          return (
            `Texture Memory:\n` +
            `  Loaded: ${stats.textureCount} textures\n` +
            `  Memory: ${stats.currentMB.toFixed(1)} MB\n` +
            `  Budget: ${stats.budgetMB.toFixed(0)} MB (${stats.usagePercent.toFixed(0)}% used)`
          );
        } catch {
          return "TextureMemoryManager not available";
        }
      }
      default: {
        const perf = performance as any;
        if (perf.memory) {
          const used = perf.memory.usedJSHeapSize / 1024 / 1024;
          const total = perf.memory.totalJSHeapSize / 1024 / 1024;
          const limit = perf.memory.jsHeapSizeLimit / 1024 / 1024;
          return `JS Heap: ${used.toFixed(1)} MB / ${total.toFixed(1)} MB (limit: ${limit.toFixed(0)} MB)`;
        }
        return "Memory info not available (Chrome only)";
      }
    }
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["info", "gc", "textures"];
    }
    return [];
  }
}
