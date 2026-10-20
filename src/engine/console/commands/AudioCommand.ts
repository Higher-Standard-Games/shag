/**
 * AudioCommand - Control audio playback and settings
 */

import type { AudioManager } from "../../AudioManager";
import { Command, type CommandDef } from "../Command";

export default class AudioCommand extends Command {
  readonly definition: CommandDef = {
    name: "audio",
    description: "Control audio playback and settings",
    usage: "audio <subcommand> [args]",
    subcommands: [
      { name: "volume", description: "Set music volume", args: [{ name: "level", type: "number", required: true }] },
      { name: "mute", description: "Mute audio" },
      { name: "unmute", description: "Unmute audio" },
      { name: "play", description: "Play a music track", args: [{ name: "track", type: "string", required: true }] },
      { name: "stop", description: "Stop music" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    // Lazy import AudioManager to support headless mode
    let audio: AudioManager;
    try {
      const { AudioManager } = await import("../../AudioManager");
      audio = AudioManager.getInstance();
    } catch {
      return "Audio not available";
    }

    switch (subcommand) {
      case "volume": {
        const vol = parseFloat(args[1]);
        if (Number.isNaN(vol) || vol < 0 || vol > 1) {
          return "Usage: audio volume <0-1>";
        }
        audio.setMusicVolume(vol);
        return `Music volume set to ${vol}`;
      }

      case "mute":
        audio.setMusicEnabled(false);
        return "Audio muted";

      case "unmute":
        audio.setMusicEnabled(true);
        return "Audio unmuted";

      case "play": {
        const track = args[1];
        if (!track) {
          return "Usage: audio play <trackname>";
        }
        audio.playMusic(track);
        return `Playing: ${track}`;
      }

      case "stop":
        audio.stopMusic();
        return "Music stopped";

      default:
        return this.getHelp();
    }
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["volume", "mute", "unmute", "play", "stop"];
    }
    return [];
  }
}
