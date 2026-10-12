/**
 * FogCommand - what world fog is drawing, and why
 *
 * World fog comes from the map's worldspawn and the r_fog cvars; this command
 * reads it out. Change it with r_fog (on/off) and, in developer mode, the
 * r_fog_* overrides.
 */

import { Cvar } from "../../core/Cvar";
import { WorldFogController } from "../../rendering/WorldFogController";
import type { CommandDef } from "../Command";
import { Command } from "../Command";

export default class FogCommand extends Command {
  readonly definition: CommandDef = {
    name: "fog",
    description: "Show the world fog: the map's, the cvars' and what is drawn",
    usage: "fog",
    developer: true,
  };

  async execute(): Promise<string | undefined> {
    const controller = WorldFogController.getInstance();
    const fog = controller.getActive();
    const lines = ["World fog:"];
    if (!Cvar.getBool("r_fog")) lines.push("  off (r_fog 0)");
    else if (!fog) lines.push('  none: the map sets no fog (worldspawn "fog")');
    else {
      const source = Cvar.getBool("developer") && Cvar.getNumber("r_fog_distance") > 0 ? "r_fog_* cvars" : "map";
      lines.push(`  source: ${source}${controller.isDrawing() ? "" : " (lent to a fog volume, water or weather)"}`);
      lines.push(
        `  ~95% opaque at ${fog.density > 0 ? (3 / fog.density).toFixed(0) : "never"}, starting at ${fog.minDist}`,
      );
      lines.push(`  colour ${fog.color.map((c) => c.toFixed(3)).join(" ")}`);
      if (fog.height) lines.push(`  height band: clear at ${fog.height.clear}, full at ${fog.height.full}`);
      if (fog.sun) lines.push(`  sun: intensity ${fog.sun.intensity}, exponent ${fog.sun.exponent}`);
      if (fog.sky)
        lines.push(`  sky horizon tint: ${fog.sky.horizonBias} ${fog.sky.horizonScale} ${fog.sky.zenithFalloff}`);
    }
    lines.push(`  sky height: ${controller.getSkyHeight()}`);
    lines.push(
      "Change: r_fog 0/1; developer 1 and r_fog_distance, r_fog_color, r_fog_mindist, r_fog_height_*, r_fog_sun_*, r_fog_sky_blend",
    );
    return lines.join("\n");
  }
}
