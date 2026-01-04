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

// Polyfill fetch for Node.js (needed by PK3Loader)
import { fileURLToPath } from "url";

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

  const { ConsoleCommandRegistry } = await import("../engine/debug/ConsoleCommandRegistry");
  const registry = ConsoleCommandRegistry.getInstance();

  // Import headless-compatible modules only (no DOM dependencies)
  const { PK3Loader } = await import("../engine/loader/pk3/PK3Loader");
  const { BspLoader } = await import("../engine/loader/bsp/BspLoader");
  const { BspMeshBuilder } = await import("../engine/loader/bsp/BspMeshBuilder");
  const { Q3ShaderRegistry } = await import("../engine/loader/shader/Q3ShaderRegistry");

  // Store loaded BSP for commands
  let currentBsp: ReturnType<typeof BspLoader.load> | null = null;
  let currentBspName: string | null = null;

  // ============================================================================
  // PK3 Commands
  // ============================================================================

  registry.register("pk3", (args) => {
    const pk3Loader = PK3Loader.getInstance();
    const sub = args[0]?.toLowerCase();

    switch (sub) {
      case "list": {
        const packages = pk3Loader.getPackageInfo();
        if (packages.length === 0) return "No PK3 files loaded";
        return packages
          .map((p) => `  ${p.filename} (${p.fileCount} files, priority ${p.priority})`)
          .join("\n");
      }

      case "find": {
        const pattern = args[1];
        if (!pattern) return "Usage: pk3 find <pattern>";
        const files = pk3Loader.listFiles(pattern);
        if (files.length === 0) return `No files matching: ${pattern}`;
        return files.slice(0, 50).join("\n") + (files.length > 50 ? `\n... and ${files.length - 50} more` : "");
      }

      default:
        return "Subcommands: list, find <pattern>";
    }
  });

  // ============================================================================
  // Map Command
  // ============================================================================

  registry.register("map", async (args) => {
    const mapName = args[0];
    if (!mapName) return "Usage: map <mapname>";

    console.log(`[Map] Loading map: ${mapName}`);

    const pk3Loader = PK3Loader.getInstance();
    const bspPath = `maps/${mapName}.bsp`;

    // Try to find BSP in PK3 files
    const bspData = await pk3Loader.getFile(bspPath);
    if (!bspData) {
      // Try loading from local file
      const localPath = path.join(process.env.GAME_PATH || "./public/game", bspPath);
      if (fs.existsSync(localPath)) {
        const buffer = fs.readFileSync(localPath);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        currentBsp = BspLoader.load(arrayBuffer);
        currentBspName = mapName;
        return `[Map] Loaded from file: ${localPath}\n  ${currentBsp.faces.length} faces, ${currentBsp.vertices.length} vertices`;
      }
      return `[Map] BSP not found: ${bspPath}`;
    }

    currentBsp = BspLoader.load(bspData);
    currentBspName = mapName;
    return `[Map] Loaded: ${mapName}\n  ${currentBsp.faces.length} faces, ${currentBsp.vertices.length} vertices`;
  });

  // ============================================================================
  // BSP Commands
  // ============================================================================

  registry.register("bsp", (args) => {
    const sub = args[0]?.toLowerCase();

    if (!currentBsp) {
      return "No map loaded. Use: map <mapname>";
    }

    switch (sub) {
      case "info":
        return [
          `Map: ${currentBspName}`,
          `Format: ${currentBsp.header.isFBSP ? "FBSP (Warsow)" : "IBSP (Quake3)"}`,
          `Version: ${currentBsp.header.version}`,
          `Entities: ${currentBsp.entities.length}`,
          `Textures: ${currentBsp.textures.length}`,
          `Faces: ${currentBsp.faces.length}`,
          `Vertices: ${currentBsp.vertices.length}`,
          `Lightmaps: ${currentBsp.lightmaps.length}`,
          `Brushes: ${currentBsp.brushes.length}`,
        ].join("\n");

      case "entities": {
        const classCounts = new Map<string, number>();
        for (const ent of currentBsp.entities) {
          classCounts.set(ent.classname, (classCounts.get(ent.classname) || 0) + 1);
        }
        const sorted = [...classCounts.entries()].sort((a, b) => b[1] - a[1]);
        return sorted.map(([name, count]) => `  ${count.toString().padStart(4)} ${name}`).join("\n");
      }

      case "textures": {
        return currentBsp.textures.slice(0, 30).map((t, i) => `  [${i}] ${t.name}`).join("\n") +
          (currentBsp.textures.length > 30 ? `\n  ... and ${currentBsp.textures.length - 30} more` : "");
      }

      case "build": {
        console.log("[BSP] Building meshes...");
        const result = BspMeshBuilder.build(currentBsp, ctx.scene);
        return [
          `[BSP] Build complete:`,
          `  Vertices: ${result.stats.totalVertices}`,
          `  Triangles: ${result.stats.totalTriangles}`,
          `  Polygon faces: ${result.stats.polygonFaces}`,
          `  Patch faces: ${result.stats.patchFaces}`,
          `  Lightmaps: ${result.lightmapTextures.length}`,
        ].join("\n");
      }

      default:
        return "Subcommands: info, entities, textures, build";
    }
  });

  // ============================================================================
  // Shader Commands
  // ============================================================================

  registry.register("shader", (args) => {
    const shaderRegistry = Q3ShaderRegistry.getInstance();
    const sub = args[0]?.toLowerCase();

    switch (sub) {
      case "list": {
        const shaders = shaderRegistry.getAllShaderNames();
        return `${shaders.length} shaders loaded\n` +
          shaders.slice(0, 30).join("\n") +
          (shaders.length > 30 ? `\n... and ${shaders.length - 30} more` : "");
      }

      case "find": {
        const pattern = args[1];
        if (!pattern) return "Usage: shader find <pattern>";
        const shaders = shaderRegistry.getAllShaderNames().filter((s) => s.includes(pattern));
        return shaders.length > 0 ? shaders.join("\n") : `No shaders matching: ${pattern}`;
      }

      case "info": {
        const name = args[1];
        if (!name) return "Usage: shader info <name>";
        const shader = shaderRegistry.getShader(name);
        if (!shader) return `Shader not found: ${name}`;
        return JSON.stringify(shader, null, 2);
      }

      default:
        return "Subcommands: list, find <pattern>, info <name>";
    }
  });

  // ============================================================================
  // Headless-specific Commands
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

  registry.register("version", () => {
    return [
      "SHAG Engine - Headless Mode",
      "Babylon.js: " + context?.engine.description,
      "Node.js: " + process.version,
    ].join("\n");
  });

  registry.register("help", () => {
    const commands = registry.getCommandNames().sort();
    return [
      "=== Headless Game Commands ===",
      "",
      "PK3/Asset Commands:",
      "  pk3 list              List loaded PK3 files",
      "  pk3 find <pattern>    Find files in PK3 archives",
      "  shader list           List loaded shaders",
      "  shader find <pat>     Find shaders by name",
      "  shader info <name>    Show shader definition",
      "",
      "Map Commands:",
      "  map <name>            Load a map by name",
      "  bsp info              Show BSP information",
      "  bsp entities          List entities in map",
      "  bsp textures          List textures used",
      "  bsp build             Build meshes headlessly",
      "",
      "Headless Commands:",
      "  headless info         Show headless engine info",
      "  headless history [n]  Show last n console lines",
      "  writeconsole [file]   Write console to file",
      "  version               Show version info",
      "  quit                  Exit headless mode",
      "",
      `Available: ${commands.join(", ")}`,
    ].join("\n");
  });

  console.log("[Init] Commands registered: " + registry.getCommandNames().length);
}

// ============================================================================
// REPL (Read-Eval-Print Loop)
// ============================================================================

async function runREPL(): Promise<void> {
  const { ConsoleCommandRegistry } = await import("../engine/debug/ConsoleCommandRegistry");
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
  const { ConsoleCommandRegistry } = await import("../engine/debug/ConsoleCommandRegistry");
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
