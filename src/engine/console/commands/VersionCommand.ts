/**
 * VersionCommand - Display engine version
 */

import { Command, CommandDef } from '../Command';
import { EngineVersion } from '../../core/EngineVersion';

export default class VersionCommand extends Command {
  readonly definition: CommandDef = {
    name: 'version',
    aliases: ['ver'],
    description: 'Display engine version',
  };

  async execute(): Promise<string | void> {
    const version = EngineVersion.getInstance();
    return `${version.getEngineName()} v${version.getVersion()}`;
  }
}
