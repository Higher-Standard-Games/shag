/**
 * DebugCommand - Debug overlays and visualization
 */

import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { Command, type CommandDef } from "../Command";

// Static storage for debug visualization
let playerDebugMesh: Mesh | null = null;
let eyeLevelMesh: Mesh | null = null;
let waistLevelMesh: Mesh | null = null;
let debugObserver: Observer<Scene> | null = null;

export default class DebugCommand extends Command {
  readonly definition: CommandDef = {
    name: "debug",
    description: "Debug overlays and visualization",
    usage: "debug <subcommand> [args]",
    developer: true,
    subcommands: [
      { name: "collision", description: "Toggle collision visualization" },
      { name: "wireframe", description: "Toggle wireframe rendering" },
      { name: "bounds", description: "Toggle bounding box display" },
      { name: "player", description: "Toggle player capsule visualization" },
      { name: "info", description: "Show debug info overlay" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    // Get scene from camera system
    let scene: Scene | undefined;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      scene = CameraSystem.getInstance().getCamera()?.getScene();
    } catch {
      return "Scene not available";
    }

    if (!scene) {
      return "No active scene";
    }

    switch (subcommand) {
      case "wireframe": {
        const enabled = args[1] === "1" || args[1] === "on";
        if (args[1] === undefined) {
          // Toggle
          scene.forceWireframe = !scene.forceWireframe;
        } else {
          scene.forceWireframe = enabled;
        }
        return `Wireframe: ${scene.forceWireframe ? "ON" : "OFF"}`;
      }

      case "bounds": {
        const enabled = args[1] === "1" || args[1] === "on";
        if (args[1] === undefined) {
          scene.forceShowBoundingBoxes = !scene.forceShowBoundingBoxes;
        } else {
          scene.forceShowBoundingBoxes = enabled;
        }
        return `Bounding boxes: ${scene.forceShowBoundingBoxes ? "ON" : "OFF"}`;
      }

      case "collision": {
        // This would toggle collision mesh visualization
        // Implementation depends on collision system
        return "Collision visualization not yet implemented";
      }

      case "player": {
        return await this.togglePlayerDebug(scene);
      }
      default: {
        const engine = scene.getEngine();
        return (
          `Debug Info:\n` +
          `  FPS: ${engine.getFps().toFixed(1)}\n` +
          `  Active meshes: ${scene.getActiveMeshes().length}\n` +
          `  Total meshes: ${scene.meshes.length}\n` +
          `  Wireframe: ${scene.forceWireframe ? "ON" : "OFF"}\n` +
          `  Bounding boxes: ${scene.forceShowBoundingBoxes ? "ON" : "OFF"}\n` +
          `  Player debug: ${playerDebugMesh ? "ON" : "OFF"}`
        );
      }
    }
  }

  private async togglePlayerDebug(scene: Scene): Promise<string> {
    // If already showing, hide it
    if (playerDebugMesh) {
      playerDebugMesh.dispose();
      playerDebugMesh = null;
      eyeLevelMesh?.dispose();
      eyeLevelMesh = null;
      waistLevelMesh?.dispose();
      waistLevelMesh = null;
      if (debugObserver) {
        scene.onBeforeRenderObservable.remove(debugObserver);
        debugObserver = null;
      }
      return "Player debug visualization: OFF";
    }

    // Get FPS controller from camera system
    let fpsController: any;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      const activeController = CameraSystem.getInstance().getActiveController();
      if (activeController?.type === "fps") {
        fpsController = activeController;
      }
    } catch {
      return "Camera system not available";
    }

    if (!fpsController || typeof fpsController.getPlayerPosition !== "function") {
      return "FPS controller not active or does not support position tracking";
    }

    // Create wireframe material (cyan for visibility)
    const capsuleMat = new StandardMaterial("debug_capsule_mat", scene);
    capsuleMat.wireframe = true;
    capsuleMat.emissiveColor = new Color3(0, 1, 1); // Cyan
    capsuleMat.disableLighting = true;

    // Create eye level indicator material (yellow)
    const eyeMat = new StandardMaterial("debug_eye_mat", scene);
    eyeMat.wireframe = true;
    eyeMat.emissiveColor = new Color3(1, 1, 0); // Yellow
    eyeMat.disableLighting = true;

    // Create waist level indicator material (orange)
    const waistMat = new StandardMaterial("debug_waist_mat", scene);
    waistMat.wireframe = true;
    waistMat.emissiveColor = new Color3(1, 0.5, 0); // Orange
    waistMat.disableLighting = true;

    // Player dimensions (from movement vars or defaults)
    // Standard Q3/Warsow player: 56 units tall, 32 diameter (16 radius)
    const playerHeight = 64;
    const playerRadius = 16;

    // Create capsule visualization using cylinder + two spheres
    // Main body cylinder
    const cylinder = MeshBuilder.CreateCylinder(
      "debug_player_body",
      {
        height: playerHeight - playerRadius * 2, // Cylinder height minus sphere caps
        diameter: playerRadius * 2,
        tessellation: 16,
      },
      scene,
    );
    cylinder.material = capsuleMat;

    // Top sphere cap
    const topSphere = MeshBuilder.CreateSphere(
      "debug_player_top",
      {
        diameter: playerRadius * 2,
        segments: 8,
      },
      scene,
    );
    topSphere.material = capsuleMat;
    topSphere.parent = cylinder;
    topSphere.position.y = (playerHeight - playerRadius * 2) / 2;

    // Bottom sphere cap
    const bottomSphere = MeshBuilder.CreateSphere(
      "debug_player_bottom",
      {
        diameter: playerRadius * 2,
        segments: 8,
      },
      scene,
    );
    bottomSphere.material = capsuleMat;
    bottomSphere.parent = cylinder;
    bottomSphere.position.y = -(playerHeight - playerRadius * 2) / 2;

    // Create eye level ring (at +24 from feet, which is origin in Quake coords)
    // Origin is at center of capsule, so eye level ring shows where "eyes" are
    const eyeRing = MeshBuilder.CreateTorus(
      "debug_eye_level",
      {
        diameter: playerRadius * 2,
        thickness: 1,
        tessellation: 16,
      },
      scene,
    );
    eyeRing.material = eyeMat;
    eyeRing.rotation.x = Math.PI / 2; // Lay flat

    // Create waist level ring (8 units below eye level)
    const waistRing = MeshBuilder.CreateTorus(
      "debug_waist_level",
      {
        diameter: playerRadius * 2,
        thickness: 1,
        tessellation: 16,
      },
      scene,
    );
    waistRing.material = waistMat;
    waistRing.rotation.x = Math.PI / 2;

    playerDebugMesh = cylinder;
    eyeLevelMesh = eyeRing;
    waistLevelMesh = waistRing;

    // Update position each frame
    debugObserver = scene.onBeforeRenderObservable.add(() => {
      if (!playerDebugMesh || !fpsController) return;

      const pos = fpsController.getPlayerPosition() as Vector3;

      // The capsule cylinder is centered, so position it at player origin
      // Player origin is at feet + 24 (Quake-style), capsule center is at feet + 28
      playerDebugMesh.position.x = pos.x;
      playerDebugMesh.position.y = pos.y + 4; // Offset to center capsule on player
      playerDebugMesh.position.z = pos.z;

      // Eye level is at origin (which is 24 above feet)
      if (eyeLevelMesh) {
        eyeLevelMesh.position.x = pos.x;
        eyeLevelMesh.position.y = pos.y + 24; // Eye level
        eyeLevelMesh.position.z = pos.z;
      }

      // Waist level is 16 below eye level (8 above feet)
      if (waistLevelMesh) {
        waistLevelMesh.position.x = pos.x;
        waistLevelMesh.position.y = pos.y + 8; // Waist level
        waistLevelMesh.position.z = pos.z;
      }
    });

    return `Player debug visualization: ON\n  Cyan = collision capsule (56h x 32w)\n  Yellow ring = eye level (+24)\n  Orange ring = waist level (+8)`;
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["collision", "wireframe", "bounds", "player", "info"];
    }
    if (args.length === 1) {
      return ["0", "1", "on", "off"];
    }
    return [];
  }
}
