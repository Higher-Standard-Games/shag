/**
 * Engine Commands - Auto-discovery loader
 *
 * Uses Vite's glob import to automatically discover and register
 * all command files matching *Command.ts pattern.
 *
 * To add a new command:
 * 1. Create FooCommand.ts in this directory
 * 2. Export default class extending Command
 * 3. It will be auto-registered on startup
 */

import { DebugConsole } from "../../debug/DebugConsole";
import { CommandBindings } from "../../input/CommandBindings";
import type { Command } from "../Command";
import { CommandRegistry } from "../CommandRegistry";

/**
 * Register all engine commands using Vite glob import
 */
export async function registerEngineCommands(): Promise<void> {
  const registry = CommandRegistry.getInstance();

  // Vite glob import - discovers all *Command.ts files in this directory
  const modules = import.meta.glob<{ default: new () => Command }>("./*Command.ts", { eager: true });

  let count = 0;
  for (const [path, module] of Object.entries(modules)) {
    if (module.default) {
      try {
        const command = new module.default();
        registry.register(command);
        count++;
      } catch (error) {
        console.error(`[Console] Failed to register command from ${path}:`, error);
      }
    }
  }

  console.log(`[Console] Registered ${count} engine commands`);

  // Bound keys run through the same registry. Attached here so every
  // composition that has commands also has its bindings, without a separate
  // wiring step to forget.
  CommandBindings.attach({
    run: (command) => {
      void registry.execute(command);
    },
    isBlocked: () => DebugConsole.getInstance().getIsOpen(),
  });
}
