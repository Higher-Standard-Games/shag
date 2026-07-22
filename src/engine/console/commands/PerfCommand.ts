/** Bounded renderer performance captures backed by Babylon instrumentation. */

import { Command, type CommandDef } from "../Command";

let captureInProgress = false;

export default class PerfCommand extends Command {
  readonly definition: CommandDef = {
    name: "perf",
    description: "Capture renderer performance over a bounded interval",
    usage: "perf capture [seconds]",
  };

  async execute(args: string[]): Promise<string> {
    if (args[0]?.toLowerCase() !== "capture") return `Usage: ${this.definition.usage}`;

    const requested = args[1] === undefined ? 10 : Number(args[1]);
    if (!Number.isFinite(requested) || requested < 1 || requested > 60) {
      return "Capture duration must be between 1 and 60 seconds";
    }
    if (captureInProgress) return "A renderer performance capture is already in progress";

    let scene: import("@babylonjs/core/scene").Scene | undefined;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      scene = CameraSystem.getInstance().getCamera()?.getScene();
    } catch {
      return "Scene not available";
    }
    if (!scene) return "No active scene";

    captureInProgress = true;
    try {
      const [{ captureRendererPerformance, formatRendererPerformanceReport }, { MapLoader }, { RenderVars }] =
        await Promise.all([
          import("../../rendering/RendererPerformanceCapture"),
          import("../../loader/map/MapLoader"),
          import("../../rendering/RenderVars"),
        ]);
      const report = await captureRendererPerformance(scene, requested, {
        map: MapLoader.getInstance().getCurrentMap(),
        ktx2: RenderVars.getInstance().get("r_ktx2") === 1,
      });
      return formatRendererPerformanceReport(report);
    } finally {
      captureInProgress = false;
    }
  }
}
