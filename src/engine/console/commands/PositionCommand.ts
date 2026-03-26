/**
 * PositionCommand - Show/set camera position
 */

import { Command, type CommandDef } from "../Command";

export default class PositionCommand extends Command {
  readonly definition: CommandDef = {
    name: "pos",
    aliases: ["position", "getpos"],
    description: "Show or copy camera position",
    usage: "pos [copy]",
  };

  async execute(args: string[]): Promise<string | void> {
    // Get camera
    let camera;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      camera = CameraSystem.getInstance().getCamera();
    } catch {
      return "CameraSystem not available";
    }

    if (!camera) {
      return "No active camera";
    }

    const pos = camera.position;
    const posStr = `${pos.x.toFixed(2)} ${pos.y.toFixed(2)} ${pos.z.toFixed(2)}`;

    // Copy option
    if (args[0] === "copy") {
      try {
        await navigator.clipboard.writeText(posStr);
        return `Position copied: ${posStr}`;
      } catch {
        return `Position: ${posStr} (copy failed)`;
      }
    }

    return `Position: ${posStr}`;
  }
}
