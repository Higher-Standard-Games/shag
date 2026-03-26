/**
 * VersionCommand - Display engine version
 */

import { EngineVersion } from "../../core/EngineVersion";
import { Command, type CommandDef } from "../Command";

export default class VersionCommand extends Command {
  readonly definition: CommandDef = {
    name: "version",
    aliases: ["ver"],
    description: "Display engine version",
  };

  async execute(): Promise<string | undefined> {
    const version = EngineVersion.getInstance();
    return `${version.getEngineName()} v${version.getVersion()}`;
  }
}
