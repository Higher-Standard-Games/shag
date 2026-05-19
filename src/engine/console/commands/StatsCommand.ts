/**
 * StatsCommand - Performance statistics
 */

import type { Scene } from "@babylonjs/core/scene";
import { Command, type CommandDef } from "../Command";

export default class StatsCommand extends Command {
  readonly definition: CommandDef = {
    name: "stats",
    description: "Performance statistics",
    usage: "stats [detailed]",
  };

  async execute(args: string[]): Promise<string | undefined> {
    const detailed = args[0] === "detailed" || args[0] === "full";

    // Get scene
    let scene: Scene | null | undefined;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      scene = CameraSystem.getInstance().getCamera()?.getScene();
    } catch {
      return "Scene not available";
    }

    if (!scene) {
      return "No active scene";
    }

    const engine = scene.getEngine();
    const perf = performance as any;

    const lines = ["Performance Stats:"];
    lines.push(`  FPS: ${engine.getFps().toFixed(1)}`);
    lines.push(`  Frame time: ${engine.getDeltaTime().toFixed(1)}ms`);
    lines.push(`  Meshes: ${scene.meshes.length} (${scene.getActiveMeshes().length} active)`);
    lines.push(`  Materials: ${scene.materials.length}`);
    lines.push(`  Textures: ${scene.textures.length}`);
    lines.push(`  Lights: ${scene.lights.length}`);

    if (detailed) {
      lines.push("");
      lines.push("Detailed:");
      lines.push(`  Draw calls: ${engine._drawCalls?.current || "N/A"}`);
      lines.push(`  Triangles: ${(scene.getActiveIndices() / 3) | 0}`);

      if (perf.memory) {
        const used = perf.memory.usedJSHeapSize / 1024 / 1024;
        const total = perf.memory.totalJSHeapSize / 1024 / 1024;
        lines.push(`  JS Heap: ${used.toFixed(1)} / ${total.toFixed(1)} MB`);
      }
    }

    return lines.join("\n");
  }
}
