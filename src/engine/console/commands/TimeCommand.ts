/**
 * TimeCommand - Control game time
 */

import { Command, type CommandDef } from "../Command";

export default class TimeCommand extends Command {
  readonly definition: CommandDef = {
    name: "time",
    description: "Control game time",
    usage: "time [subcommand] [args]",
    subcommands: [
      { name: "set", description: "Set time of day", args: [{ name: "hour", type: "number", required: true }] },
      { name: "pause", description: "Pause time" },
      { name: "resume", description: "Resume time" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    // Lazy import GameClock
    let clock;
    try {
      const { GameClock } = await import("../../core/GameClock");
      clock = GameClock.getInstance();
    } catch {
      return "GameClock not available";
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "set": {
        const hour = parseFloat(args[1]);
        if (Number.isNaN(hour) || hour < 0 || hour > 24) {
          return "Usage: time set <0-24>";
        }
        clock.setTime(hour);
        return `Time set to ${hour}:00`;
      }

      case "pause":
        clock.pause();
        return "Time paused";

      case "resume":
        clock.resume();
        return "Time resumed";

      default:
        return `Current time: ${clock.formatTime()}, Day ${clock.getCurrentDay()}`;
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["set", "pause", "resume"];
    }
    return [];
  }
}
