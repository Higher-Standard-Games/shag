/**
 * Headless Game Runner - Run the game engine in CLI mode
 *
 * Mirrors the real game startup sequence but in headless mode:
 * - Uses NullEngine (no WebGL)
 * - readline for console input
 * - All engine commands available
 * - writeconsole to dump output
 * - quit to exit
 *
 * Usage:
 *   npx vite-node src/cli/headless-game.ts
 *   npx vite-node src/cli/headless-game.ts --exec "map wdm11; bsp info"
 */

import { NullEngine, Scene, FreeCamera, Vector3 } from "babylonjs";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";

// Static imports for command system (avoids vite-node dynamic import issues)
import { ConsoleCommandRegistry } from "../engine/debug/ConsoleCommandRegistry";
import { registerEngineCommands } from "../engine/debug/EngineCommands";

// ============================================================================
// Console Output Capture
// ============================================================================

const consoleHistory: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

function captureConsole(): void {
  console.log = (...args: unknown[]) => {
    const line = args.map(a => String(a)).join(" ");
    consoleHistory.push(line);
    originalConsoleLog.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    const line = "[WARN] " + args.map(a => String(a)).join(" ");
    consoleHistory.push(line);
    originalConsoleWarn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    const line = "[ERROR] " + args.map(a => String(a)).join(" ");
    consoleHistory.push(line);
    originalConsoleError.apply(console, args);
  };
}

// ============================================================================
// Headless Game Context
// ============================================================================

interface HeadlessContext {
  engine: NullEngine;
  scene: Scene;
  camera: FreeCamera;
}

let context: HeadlessContext | null = null;

async function initializeEngine(): Promise<HeadlessContext> {
  console.log("\n=== Headless Game Engine ===\n");
  console.log("[Init] Creating NullEngine...");

  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new FreeCamera("camera", new Vector3(0, 100, -200), scene);

  console.log("[Init] Engine created: " + engine.description);

  return { engine, scene, camera };
}

async function initializeGameSystems(ctx: HeadlessContext): Promise<void> {
  console.log("[Init] Loading game systems...");

  // Initialize PK3 loader with game path
  const gamePath = process.env.GAME_PATH || "./public/game";
  console.log(`[Init] Game path: ${gamePath}`);

  // Check if game path exists
  if (!fs.existsSync(gamePath)) {
    console.warn(`[Init] Game path not found: ${gamePath}`);
    console.warn("[Init] Some commands may not work without PK3 files");
  }

  // Import and initialize systems
  try {
    // Initialize PK3 loader
    const { PK3Loader } = await import("../engine/loader/pk3/PK3Loader");
    const pk3Loader = PK3Loader.getInstance();

    // Scan for PK3 files
    if (fs.existsSync(gamePath)) {
      const pk3Files = fs.readdirSync(gamePath).filter(f => f.endsWith(".pk3"));
      console.log(`[Init] Found ${pk3Files.length} PK3 files`);

      // Load all PK3 files (takes a while but needed for full map support)
      let loadedCount = 0;
      for (const pk3File of pk3Files) {
        const pk3Path = path.join(gamePath, pk3File);
        try {
          const buffer = fs.readFileSync(pk3Path);
          const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
          // Use processPK3ArrayBuffer directly for Node.js (fetch doesn't work)
          await (pk3Loader as unknown as { processPK3ArrayBuffer: (f: string, a: ArrayBuffer) => Promise<void> })
            .processPK3ArrayBuffer(pk3File, arrayBuffer);
          loadedCount++;
        } catch (e) {
          console.warn(`[Init] Failed to load ${pk3File}:`, e instanceof Error ? e.message : e);
        }
      }
      console.log(`[Init] Indexed ${loadedCount}/${pk3Files.length} PK3 files`);
    }

    // Load shaders
    const { Q3ShaderRegistry } = await import("../engine/loader/shader/Q3ShaderRegistry");
    const shaderRegistry = Q3ShaderRegistry.getInstance();
    const shaderCount = await shaderRegistry.loadShaders();
    console.log(`[Init] Loaded ${shaderCount} shaders`);

  } catch (error) {
    console.warn("[Init] Some systems failed to initialize:", error);
  }
}

async function registerCommands(ctx: HeadlessContext): Promise<void> {
  console.log("[Init] Registering commands...");

  const registry = ConsoleCommandRegistry.getInstance();

  // Register all engine commands (uses lazy imports internally for DOM modules)
  registerEngineCommands();
  console.log("[Init] Engine commands registered");

  // ============================================================================
  // Headless-specific Commands (override/extend engine commands)
  // ============================================================================

  registry.register("writeconsole", (args) => {
    const outputPath = args[0] || "console.log";
    fs.writeFileSync(outputPath, consoleHistory.join("\n"));
    return `Console output written to ${outputPath} (${consoleHistory.length} lines)`;
  });

  registry.register("quit", () => {
    console.log("\n[Headless] Shutting down...");
    if (context) {
      context.scene.dispose();
      context.engine.dispose();
    }
    process.exit(0);
  });

  registry.register("headless", (args) => {
    const sub = args[0]?.toLowerCase();
    switch (sub) {
      case "info":
        return [
          "Headless Game Engine",
          `  Engine: ${context?.engine.description || "N/A"}`,
          `  Scene: ${context?.scene.uid || "N/A"}`,
          `  Console history: ${consoleHistory.length} lines`,
        ].join("\n");
      case "history": {
        const count = parseInt(args[1]) || 20;
        return consoleHistory.slice(-count).join("\n");
      }
      default:
        return "Subcommands: info, history [count]";
    }
  });

  // Override version for headless mode
  registry.register("version", () => {
    return [
      "SHAG Engine - Headless Mode",
      "Babylon.js: " + context?.engine.description,
      "Node.js: " + process.version,
    ].join("\n");
  });

  // Help command for headless mode
  registry.register("help", (args) => {
    const cmdName = args[0]?.toLowerCase();

    if (cmdName) {
      // Show help for specific command
      const def = registry.getDefinition(cmdName);
      if (!def) {
        return `Unknown command: ${cmdName}`;
      }

      let result = `${def.name}: ${def.description}`;
      if (def.usage) {
        result += `\nUsage: ${def.usage}`;
      }
      if (def.subcommands && def.subcommands.length > 0) {
        result += "\n\nSubcommands:";
        for (const sub of def.subcommands) {
          result += `\n  ${sub.name} - ${sub.description}`;
        }
      }
      return result;
    }

    // Show all commands
    const defs = registry.getAllDefinitions();
    const lines = ["Available commands:", ""];

    for (const def of defs.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  ${def.name.padEnd(15)} ${def.description}`);
    }

    lines.push("");
    lines.push("Type 'help <command>' for detailed help");

    return lines.join("\n");
  });

  console.log("[Init] Commands registered: " + registry.getCommandNames().length);
}

// ============================================================================
// REPL (Read-Eval-Print Loop)
// ============================================================================

async function runREPL(): Promise<void> {
  const registry = ConsoleCommandRegistry.getInstance();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  console.log("\n[Ready] Type commands, 'help' for list, 'quit' to exit\n");
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (input) {
      try {
        const result = await registry.execute(input);
        if (result) {
          console.log(result);
        }
      } catch (error) {
        console.error("Error:", error);
      }
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\n[Headless] Goodbye!");
    process.exit(0);
  });
}

async function runBatch(commands: string): Promise<void> {
  const registry = ConsoleCommandRegistry.getInstance();

  console.log(`\n[Batch] Executing: ${commands}\n`);

  const result = await registry.execute(commands);
  if (result) {
    console.log(result);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  // Start capturing console output
  captureConsole();

  // Parse arguments
  const args = process.argv.slice(2);
  let execCommands: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--exec" && args[i + 1]) {
      execCommands = args[i + 1];
      i++;
    }
  }

  try {
    // Initialize engine
    context = await initializeEngine();

    // Initialize game systems (PK3, shaders, etc.)
    await initializeGameSystems(context);

    // Register commands
    await registerCommands(context);

    console.log("\n[Init] Startup complete!\n");

    if (execCommands) {
      // Batch mode - execute commands and exit
      await runBatch(execCommands);
    } else {
      // Interactive mode - REPL
      await runREPL();
    }

  } catch (error) {
    console.error("[Fatal] Initialization failed:", error);
    process.exit(1);
  }
}

// Run
main().catch(console.error);
