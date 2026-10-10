/**
 * TrainingDemoCommand - record a movement trick for the bots to learn.
 *
 * Launches a map like `map`, on a server that stays in warmup and records
 * every tick of your play to `public/data/demos/training/<map>_<name>.shagdemo`.
 * Do the trick (say, the wall jump to wdm2's Red Armor), then stop: leaving
 * the server saves the demo.
 */

import { Command, type CommandDef } from "../Command";
import { getGameplayMapLauncher } from "../GameplayMapLauncher";

const NAME = /^[a-z0-9_-]{1,40}$/i;

export default class TrainingDemoCommand extends Command {
  readonly definition: CommandDef = {
    name: "training_demo",
    description: "Record a movement trick on a map for bots to learn",
    usage: "training_demo <map> [name] [gametype] | training_demo stop",
    developer: true,
  };

  async execute(args: string[]): Promise<string | undefined> {
    const launcher = getGameplayMapLauncher();
    if (!launcher) return "No gameplay map launcher registered.";

    const first = args[0]?.toLowerCase();
    if (!first) {
      return [
        "Usage:",
        "  training_demo <map> [name] [gametype]  launch the map and record every tick",
        "  training_demo stop                     leave the server, which saves the demo",
        "Saved to public/data/demos/training/<map>_<name>.shagdemo",
      ].join("\n");
    }
    if (first === "stop") {
      await launcher.unload();
      return "Left the training server; it saves the demo as the last player leaves.";
    }

    const name = args[1] ?? "run";
    if (!NAME.test(name)) return `Invalid name "${name}": use letters, digits, _ and -`;

    if (typeof window !== "undefined") {
      const { preparePublishedMap } = await import("../../editor/PublishedMapClient");
      await preparePublishedMap(first);
    }
    const result = await launcher.launch(first, args[2] || "duel", { trainingDemo: name });
    return [
      `Recording training demo ${result.map}_${name} on ${result.serverUrl}.`,
      "The server stays in warmup. Do the trick, then: training_demo stop",
    ].join("\n");
  }
}
