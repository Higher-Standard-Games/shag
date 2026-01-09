/**
 * ConsoleDebugCommand - Toggle debug overlay
 */

import { Command, CommandDef } from '../Command';

export default class ConsoleDebugCommand extends Command {
  readonly definition: CommandDef = {
    name: 'console_debug',
    description: 'Toggle debug overlay at bottom-left',
    usage: 'console_debug [0|1]',
    developer: true,
  };

  async execute(args: string[]): Promise<string | void> {
    let overlay;
    try {
      const { getDebugOverlay } = await import('../../debug/DebugOverlay');
      overlay = getDebugOverlay();
    } catch {
      return 'DebugOverlay not available';
    }

    const value = args[0]?.toLowerCase();
    
    // No argument - show current state
    if (value === undefined) {
      return `console_debug = ${overlay.isEnabled() ? '1' : '0'}\nSmall debug overlay at bottom-left showing last 8 console lines`;
    }
    
    // Parse value
    const enabled = value === '1' || value === 'true' || value === 'on';
    overlay.setEnabled(enabled);
    
    return `Debug overlay: ${enabled ? 'ON' : 'OFF'}`;
  }
}
