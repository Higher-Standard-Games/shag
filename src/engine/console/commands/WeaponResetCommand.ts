/**
 * WeaponResetCommand - Reset all cl_wep_* cvars to 0
 *
 * Quick way to clear all weapon position debug overrides
 * so each weapon uses its own definition values.
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";

const WEP_CVARS = [
  "cl_wep_hip_x",
  "cl_wep_hip_y",
  "cl_wep_hip_z",
  "cl_wep_ads_x",
  "cl_wep_ads_y",
  "cl_wep_ads_z",
  "cl_wep_scale",
];

export default class WeaponResetCommand extends Command {
  readonly definition: CommandDef = {
    name: "cl_wep_reset",
    description: "Reset all cl_wep_* overrides to 0 (use weapon defs)",
    usage: "cl_wep_reset",
  };

  async execute(_args: string[]): Promise<string | undefined> {
    const reset: string[] = [];
    for (const name of WEP_CVARS) {
      if (Cvar.exists(name)) {
        Cvar.set(name, 0);
        reset.push(name);
      }
    }
    return `Reset ${reset.length} weapon cvars to 0: ${reset.join(", ")}`;
  }
}
