/** FPS visibility is a saved preference; the game owns the display. */
import { Cvar } from "../../core/Cvar";
import { registerFpsDisplayCvar } from "../../core/FpsDisplaySettings";
import { Command, type CommandDef } from "../Command";

export default class ShowFpsCommand extends Command {
  readonly definition: CommandDef = {
    name: "show_fps",
    aliases: ["fps"],
    description: "Toggle FPS display",
    usage: "show_fps [0|1|on|off]",
  };

  constructor() {
    super();
    registerFpsDisplayCvar();
  }

  async execute(args: string[]): Promise<string | undefined> {
    const value = args[0];
    if (value === undefined) {
      return `show_fps is ${Cvar.getBool("show_fps") ? "1 (on)" : "0 (off)"}`;
    }
    const enable = value === "1" || value === "on" || value === "true";
    const disable = value === "0" || value === "off" || value === "false";
    if (!enable && !disable) return "Usage: show_fps [0|1|on|off]";

    Cvar.set("show_fps", enable ? 1 : 0);
    return `FPS display ${enable ? "enabled" : "disabled"}`;
  }
}
