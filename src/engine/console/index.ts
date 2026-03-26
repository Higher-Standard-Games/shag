/**
 * Console System - Public exports
 *
 * The console provides a Quake-style dropdown command interface.
 * Commands are auto-discovered from commands/ directory.
 */

export { type ArgumentDef, Command, type CommandDef, type SubcommandDef } from "./Command";
export { CommandRegistry } from "./CommandRegistry";

// Console UI will be exported after migration from DebugConsole
// export { Console } from './Console';
