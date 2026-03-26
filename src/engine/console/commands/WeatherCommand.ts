/**
 * WeatherCommand - Weather control (uses game's weather system)
 */

import { Command, type CommandDef } from "../Command";

export default class WeatherCommand extends Command {
  readonly definition: CommandDef = {
    name: "weather",
    description: "Weather control",
    usage: "weather <rain|snow|clear|fog|thunder|status> [intensity]",
    subcommands: [
      { name: "rain", description: "Start rain", args: [{ name: "intensity", type: "number" }] },
      { name: "snow", description: "Start snow", args: [{ name: "intensity", type: "number" }] },
      { name: "clear", description: "Clear all weather" },
      { name: "fog", description: "Set fog", args: [{ name: "density", type: "number" }] },
      { name: "thunder", description: "Trigger thunder" },
      { name: "status", description: "Show weather status" },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    // Weather API is exposed on window.weather by GameScene
    const weather = (window as any).weather;

    if (!weather) {
      return "Weather system not available (game not started)";
    }

    const subcommand = args[0]?.toLowerCase();
    const intensity = parseFloat(args[1]) || 0.5;

    switch (subcommand) {
      case "rain":
        weather.rain(true);
        if (args[1]) weather.rainIntensity(intensity);
        return `Rain started (intensity: ${intensity})`;

      case "snow":
        weather.snow(true);
        if (args[1]) weather.snowIntensity(intensity);
        return `Snow started (intensity: ${intensity})`;

      case "clear":
        weather.rain(false);
        weather.snow(false);
        weather.fog(false);
        return "Weather cleared";

      case "fog": {
        const density = parseFloat(args[1]) || 0.02;
        weather.fog(true);
        weather.fogDensity(density);
        return `Fog set (density: ${density})`;
      }

      case "thunder":
        weather.thunder();
        return "Thunder triggered";

      case "status": {
        const raining = weather.isRaining?.();
        const snowing = weather.isSnowing?.();
        const foggy = weather.isFoggy?.();
        const windy = weather.isWindy?.();
        return `Weather: ${raining ? "raining" : snowing ? "snowing" : "clear"}${foggy ? ", foggy" : ""}${windy ? ", windy" : ""}`;
      }

      default:
        return "Subcommands: rain [intensity], snow [intensity], clear, fog [density], thunder, status";
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["rain", "snow", "clear", "fog", "thunder", "status"];
    }
    return [];
  }
}
