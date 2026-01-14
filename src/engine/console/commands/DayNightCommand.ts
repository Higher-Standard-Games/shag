/**
 * DayNightCommand - Day/night cycle control for BSP maps
 * Uses direct SkyLightSystem API (bypasses cvars for empty scene compatibility)
 */

import { Command, CommandDef } from '../Command';
import { SkyLightSystem } from '../../lighting/SkyLightSystem';

export default class DayNightCommand extends Command {
  readonly definition: CommandDef = {
    name: 'daynight',
    description: 'Day/night cycle control for BSP maps',
    usage: 'daynight <on|off|noon|midnight|start|stop|info>',
    developer: true,
    subcommands: [
      { name: 'on', description: 'Enable day/night cycle' },
      { name: 'off', description: 'Disable day/night cycle' },
      { name: 'noon', description: 'Set to noon (brightest)' },
      { name: 'midnight', description: 'Set to midnight (darkest)' },
      { name: 'sunrise', description: 'Set to sunrise' },
      { name: 'sunset', description: 'Set to sunset' },
      { name: 'start', description: 'Start time animation' },
      { name: 'stop', description: 'Stop time animation' },
      { name: 'time', description: 'Set time (0-1)', args: [{ name: 'value', type: 'number' }] },
      { name: 'info', description: 'Show current state' },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();
    const sky = SkyLightSystem.getInstance();

    switch (subcommand) {
      case 'on':
        sky.setBspDayNightEnabled(true);
        return 'Day/night cycle enabled. Try: daynight noon, daynight midnight, daynight start';

      case 'off':
        sky.setBspDayNightEnabled(false);
        return 'Day/night cycle disabled';

      case 'noon':
        sky.setBspDayNightEnabled(true);
        sky.setBspTimeOfDay(0.5);
        return 'Time set to noon (brightest)';

      case 'midnight':
        sky.setBspDayNightEnabled(true);
        sky.setBspTimeOfDay(0);
        return 'Time set to midnight (darkest)';

      case 'sunrise':
        sky.setBspDayNightEnabled(true);
        sky.setBspTimeOfDay(0.25);
        return 'Time set to sunrise';

      case 'sunset':
        sky.setBspDayNightEnabled(true);
        sky.setBspTimeOfDay(0.75);
        return 'Time set to sunset';

      case 'start':
        sky.setBspDayNightEnabled(true);
        sky.setBspAnimating(true);
        return 'Day/night animation started (60s cycle)';

      case 'stop':
        sky.setBspAnimating(false);
        return 'Day/night animation stopped';

      case 'time': {
        const value = parseFloat(args[1]);
        if (isNaN(value)) {
          const time = sky.getBspTimeOfDay();
          return `Current time: ${time.toFixed(2)} (0=midnight, 0.5=noon)`;
        }
        sky.setBspDayNightEnabled(true);
        sky.setBspTimeOfDay(value);
        return `Time set to ${value.toFixed(2)}`;
      }

      case 'info':
      default: {
        const time = sky.getBspTimeOfDay();
        const sunFactor = Math.max(0, Math.sin(time * Math.PI));
        const intensity = 0.1 + 1.4 * sunFactor;

        return `BSP Day/Night:
  Time: ${time.toFixed(2)} (0=midnight, 0.5=noon)
  Lightmap intensity: ${intensity.toFixed(2)}

Commands:
  daynight on/off   - Enable/disable
  daynight noon     - Set to noon (bright)
  daynight midnight - Set to midnight (dark)  
  daynight start    - Animate (60s cycle)
  daynight stop     - Stop animation`;
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ['on', 'off', 'noon', 'midnight', 'sunrise', 'sunset', 'start', 'stop', 'time', 'info'];
    }
    return [];
  }
}
