/**
 * DayNightCommand - Day/night cycle control for BSP maps
 */

import { Command, CommandDef } from '../Command';
import { Cvar } from '../../core/Cvar';

export default class DayNightCommand extends Command {
  readonly definition: CommandDef = {
    name: 'daynight',
    description: 'Day/night cycle control for BSP maps',
    usage: 'daynight <on|off|time|start|stop|info> [args]',
    developer: true,
    subcommands: [
      { name: 'on', description: 'Enable day/night cycle' },
      { name: 'off', description: 'Disable day/night cycle' },
      { name: 'time', description: 'Set time (0-1, 0=midnight, 0.5=noon)', args: [{ name: 'value', type: 'number' }] },
      { name: 'start', description: 'Start time animation' },
      { name: 'stop', description: 'Stop time animation' },
      { name: 'speed', description: 'Set animation speed multiplier', args: [{ name: 'value', type: 'number' }] },
      { name: 'info', description: 'Show current day/night state' },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'on':
        Cvar.set('r_daynight', 1);
        return 'Day/night cycle enabled. Use "daynight time 0.5" to set noon, "daynight start" to animate.';

      case 'off':
        Cvar.set('r_daynight', 0);
        return 'Day/night cycle disabled';

      case 'time': {
        const value = parseFloat(args[1]);
        if (isNaN(value)) {
          const current = Number(Cvar.get('r_daynight_time') ?? 0.5);
          const hour = Math.floor(current * 24);
          const minute = Math.floor((current * 24 - hour) * 60);
          return `Current time: ${current.toFixed(3)} (${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')})`;
        }
        const clamped = Math.max(0, Math.min(1, value));
        Cvar.set('r_daynight_time', clamped);
        const hour = Math.floor(clamped * 24);
        const minute = Math.floor((clamped * 24 - hour) * 60);
        return `Time set to ${clamped.toFixed(3)} (${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')})`;
      }

      case 'start':
        Cvar.set('r_daynight', 1);
        Cvar.set('r_daynight_animate', 1);
        return 'Day/night animation started';

      case 'stop':
        Cvar.set('r_daynight_animate', 0);
        return 'Day/night animation stopped';

      case 'speed': {
        const value = parseFloat(args[1]);
        if (isNaN(value)) {
          return `Current speed: ${Cvar.get('r_daynight_speed')}x`;
        }
        Cvar.set('r_daynight_speed', Math.max(0.1, Math.min(10, value)));
        return `Animation speed set to ${value}x`;
      }

      case 'noon':
        Cvar.set('r_daynight', 1);
        Cvar.set('r_daynight_time', 0.5);
        return 'Time set to noon (0.5)';

      case 'midnight':
        Cvar.set('r_daynight', 1);
        Cvar.set('r_daynight_time', 0);
        return 'Time set to midnight (0.0)';

      case 'sunrise':
        Cvar.set('r_daynight', 1);
        Cvar.set('r_daynight_time', 0.25);
        return 'Time set to sunrise (0.25)';

      case 'sunset':
        Cvar.set('r_daynight', 1);
        Cvar.set('r_daynight_time', 0.75);
        return 'Time set to sunset (0.75)';

      case 'info':
      default: {
        const enabled = Number(Cvar.get('r_daynight') ?? 0) >= 0.5;
        const animate = Number(Cvar.get('r_daynight_animate') ?? 0) >= 0.5;
        const time = Number(Cvar.get('r_daynight_time') ?? 0.5);
        const speed = Number(Cvar.get('r_daynight_speed') ?? 1);
        const length = Number(Cvar.get('r_daynight_length') ?? 1440);
        const lmMin = Number(Cvar.get('r_daynight_lm_min') ?? 0.05);
        const lmMax = Number(Cvar.get('r_daynight_lm_max') ?? 1.0);
        const sunInt = Number(Cvar.get('r_daynight_sun_intensity') ?? 0.3);
        const moonInt = Number(Cvar.get('r_daynight_moon_intensity') ?? 0.15);
        const skyTint = Number(Cvar.get('r_daynight_sky_tint') ?? 1) >= 0.5;

        const hour = Math.floor(time * 24);
        const minute = Math.floor((time * 24 - hour) * 60);
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

        // Calculate current lightmap intensity
        const sunFactor = Math.max(0, Math.sin(time * Math.PI));
        const currentLm = lmMin + (lmMax - lmMin) * sunFactor;

        return `Day/Night Cycle Info:
  Enabled: ${enabled ? 'yes' : 'no'}
  Animating: ${animate ? 'yes' : 'no'}
  Time: ${time.toFixed(3)} (${timeStr})
  Speed: ${speed}x
  Cycle length: ${length}s (${(length / 60).toFixed(1)} min)
  
Lightmap:
  Min intensity: ${lmMin}
  Max intensity: ${lmMax}
  Current: ${currentLm.toFixed(3)}
  
Lights:
  Sun intensity: ${sunInt}
  Moon intensity: ${moonInt}
  Skybox tinting: ${skyTint ? 'yes' : 'no'}

Quick commands:
  daynight noon     - Set to noon
  daynight midnight - Set to midnight
  daynight sunrise  - Set to sunrise
  daynight sunset   - Set to sunset
  daynight start    - Start animation
  daynight stop     - Stop animation`;
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ['on', 'off', 'time', 'start', 'stop', 'speed', 'info', 'noon', 'midnight', 'sunrise', 'sunset'];
    }
    return [];
  }
}
