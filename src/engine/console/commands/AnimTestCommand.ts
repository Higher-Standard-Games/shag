import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  CARTEL_MODEL_ROOT,
  FEMALE_MODEL_ROOT,
  PLAYER_ANIMATION_ROOT,
  RIOTKITTY_MODEL_ROOT,
  ROBOT_MODEL_ROOT,
} from "../../animation/PlayerModelAssets";
import "@babylonjs/loaders/glTF";
import { type PlayerModelInstance, PlayerModelManager } from "../../animation/PlayerModelManager";
import { Command, type CommandDef } from "../Command";

/** Inspect the same model, retargeting and playback used by player rendering. */
export default class AnimTestCommand extends Command {
  readonly definition: CommandDef = {
    name: "animtest",
    aliases: ["at"],
    description: "Test animation system with player model",
    usage: "animtest <load|play|once|list|stop|dispose> [animation]",
    developer: true,
  };
  private manager: PlayerModelManager | null = null;
  private model: PlayerModelInstance | null = null;

  async execute(args: string[]): Promise<string | undefined> {
    switch (args[0]?.toLowerCase()) {
      case "load": {
        const { CameraSystem } = await import("../../camera/CameraSystem");
        const camera = CameraSystem.getInstance().getCamera();
        if (!camera) return "No active camera";
        this.disposeModel();
        const manager = new PlayerModelManager(camera.getScene());
        this.manager = manager;
        if (
          args[1] &&
          args[1] !== "police" &&
          args[1] !== "female" &&
          args[1] !== "robot" &&
          args[1] !== "cartel" &&
          args[1] !== "riotkitty"
        ) {
          this.disposeModel();
          return "Choose police, female, cartel, riotkitty or robot";
        }
        if (args[1] === "female")
          await manager.loadModel(FEMALE_MODEL_ROOT, "female.glb", undefined, PLAYER_ANIMATION_ROOT);
        else if (args[1] === "robot")
          await manager.loadModel(ROBOT_MODEL_ROOT, "robot.glb", undefined, PLAYER_ANIMATION_ROOT);
        else if (args[1] === "cartel")
          await manager.loadModel(CARTEL_MODEL_ROOT, "cartel.glb", undefined, PLAYER_ANIMATION_ROOT);
        else if (args[1] === "riotkitty")
          await manager.loadModel(RIOTKITTY_MODEL_ROOT, "riotkitty.glb", undefined, PLAYER_ANIMATION_ROOT);
        else await manager.loadModel();
        // Another load/dispose may have superseded this request while importing.
        if (this.manager !== manager) return "Load cancelled";
        this.model = manager.createInstance("animtest");
        if (!this.model) {
          this.disposeModel();
          return "Player model failed to load";
        }
        this.model.anchor.position.copyFrom(camera.position.add(camera.getDirection(Vector3.Forward()).scale(150)));
        this.model.anchor.position.y -= 32;
        manager.playAnimation(this.model, "idle");
        return `Model loaded: ${this.model.skeleton?.bones.length} bones, ${this.model.anims.length} animations.\nanimtest list | animtest play <name>`;
      }
      case "play":
      case "once": {
        if (!this.model || !this.manager) return "No model";
        const value = args[1];
        if (!value) return "Specify animation";
        const index = Number(value);
        const clip = Number.isInteger(index)
          ? this.model.anims[index]
          : (this.model.anims.find((a) => a.name === value) ?? this.model.anims.find((a) => a.name.includes(value)));
        if (!clip) return `Not found: ${value}`;
        if (args[0].toLowerCase() === "play") {
          this.manager.playAnimation(this.model, clip.name);
          return `Playing: ${clip.name}`;
        }
        // Taunts and the blade swing play over the upper body; other clips take the whole body
        if (!this.manager.playOnce(this.model, clip.name)) return `Could not play: ${clip.name}`;
        return `Once: ${clip.name} over ${this.model.currentAnim}`;
      }
      case "list":
        return this.model?.anims.map((a, i) => `[${i}] ${a.name}`).join("\n") ?? "No model";
      case "stop":
        this.model?.masterGroup?.pause();
        return "Stopped";
      case "dispose":
        this.disposeModel();
        return "Disposed";
      default:
        return "animtest load [police|female|cartel|riotkitty|robot] | play <name> | once <name> | list | stop | dispose";
    }
  }
  private disposeModel(): void {
    if (this.model) this.manager?.disposeInstance(this.model);
    this.manager?.dispose();
    this.manager = null;
    this.model = null;
  }
  override getCompletions(_input: string, args: string[]): string[] {
    if (args[0] === "load") return ["police", "female", "cartel", "riotkitty", "robot"];
    return args.length === 0
      ? ["load", "play", "once", "list", "stop", "dispose"]
      : args[0] === "play" || args[0] === "once"
        ? (this.model?.anims.map((a) => a.name) ?? [])
        : [];
  }
}
