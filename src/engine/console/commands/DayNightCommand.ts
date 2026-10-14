/**
 * DayNightCommand - Day/night cycle control for BSP maps
 * Uses direct SkyLightSystem API (bypasses cvars for empty scene compatibility)
 */

import { SkyLightSystem } from "../../lighting/SkyLightSystem";
import { Command, type CommandDef } from "../Command";

export default class DayNightCommand extends Command {
  readonly definition: CommandDef = {
    name: "daynight",
    description: "Day/night cycle control for BSP maps",
    usage: "daynight <on|off|noon|midnight|sunrise|sunset|time <0-1>|cycle <minutes>|start|stop|info>",
    developer: true,
    subcommands: [
      { name: "on", description: "Enable day/night cycle" },
      { name: "off", description: "Disable day/night cycle" },
      { name: "noon", description: "Set to noon (brightest)" },
      { name: "midnight", description: "Set to midnight (darkest)" },
      { name: "sunrise", description: "Set to sunrise" },
      { name: "sunset", description: "Set to sunset" },
      { name: "start", description: "Start time animation" },
      { name: "stop", description: "Stop time animation" },
      { name: "time", description: "Set time (0-1)", args: [{ name: "value", type: "number" }] },
      { name: "info", description: "Show current state" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();
    const sky = SkyLightSystem.getInstance();

    switch (subcommand) {
      case "on":
        sky.setBspDayNightEnabled(true);
        return "Day/night cycle enabled. Try: daynight noon, daynight midnight, daynight start";

      case "off":
        sky.setBspDayNightEnabled(false);
        return "Day/night cycle disabled";

      case "noon":
        sky.setBspDayNightEnabled(true);
        sky.setBspTimeOfDay(0.5);
        return "Time set to noon (brightest)";

      case "midnight":
        sky.setBspDayNightEnabled(true);
        sky.setBspTimeOfDay(0);
        return "Time set to midnight (darkest)";

      case "sunrise":
        sky.setBspDayNightEnabled(true);
        sky.setBspTimeOfDay(0.25);
        return "Time set to sunrise";

      case "sunset":
        sky.setBspDayNightEnabled(true);
        sky.setBspTimeOfDay(0.75);
        return "Time set to sunset";

      case "start":
        sky.setBspDayNightEnabled(true);
        sky.setBspAnimating(true);
        return `Day/night animation started (${sky.getBspCycleLength()} min cycle)`;

      case "stop":
        sky.setBspAnimating(false);
        return "Day/night animation stopped";

      case "cycle": {
        const minutes = parseFloat(args[1]);
        if (Number.isNaN(minutes)) {
          return `Current cycle length: ${sky.getBspCycleLength()} minutes`;
        }
        sky.setBspCycleLength(minutes);
        return `Cycle length set to ${minutes} minutes`;
      }

      case "time": {
        const value = parseFloat(args[1]);
        if (Number.isNaN(value)) {
          const time = sky.getBspTimeOfDay();
          return `Current time: ${time.toFixed(2)} (0=midnight, 0.5=noon)`;
        }
        sky.setBspDayNightEnabled(true);
        sky.setBspTimeOfDay(value);
        return `Time set to ${value.toFixed(2)}`;
      }
      default: {
        const time = sky.getBspTimeOfDay();
        const sunFactor = Math.max(0, Math.sin(time * Math.PI));
        const intensity = 0.1 + 1.4 * sunFactor;
        const isNight = time < 0.2 || time > 0.8;

        return `BSP Day/Night:
  Time: ${time.toFixed(2)} (0=midnight, 0.5=noon)
  Intensity: ${intensity.toFixed(2)}
  Cycle: ${sky.getBspCycleLength()} min
  Period: ${isNight ? "NIGHT (lamps on)" : "DAY"}

Commands:
  daynight on/off       - Enable/disable
  daynight noon         - Set to noon
  daynight midnight     - Set to midnight
  daynight sunrise      - Set to sunrise
  daynight sunset       - Set to sunset
  daynight time <0-1>   - Set time of day
  daynight start/stop   - Animate cycle
  daynight cycle <min>  - Set cycle length`;
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["on", "off", "noon", "midnight", "sunrise", "sunset", "start", "stop", "cycle", "time", "info"];
    }
    return [];
  }
}
