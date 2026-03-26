/**
 * NameCommand — Set or display player name
 *
 * Usage:
 *   name              → Show current name
 *   name <newname>    → Set new name (persists to profile)
 */

import { PlayerProfile } from "../../player/PlayerProfile";
import { Command, type CommandDef } from "../Command";

export default class NameCommand extends Command {
  readonly definition: CommandDef = {
    name: "name",
    description: "Set or display player name",
    usage: "name [newname]",
  };

  async execute(args: string[]): Promise<string | void> {
    const profile = PlayerProfile.load();

    if (args.length === 0) {
      return `Player name: ${profile.name}  (id: ${profile.id.substring(0, 8)}...)`;
    }

    const newName = args.join(" ").trim();
    if (newName.length === 0) {
      return "Name cannot be empty.";
    }
    if (newName.length > 32) {
      return "Name too long (max 32 characters).";
    }

    const oldName = profile.name;
    profile.name = newName;
    profile.save();

    return `Name changed: ${oldName} → ${newName}`;
  }
}
