/**
 * SceneCommand - Scene creation, management and debugging
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { devLog } from "../../core/DevLog";
import { Command, type CommandDef } from "../Command";

// Module-level state for empty scene management
let emptyScene: Scene | null = null;
let emptySceneCamera: FreeCamera | null = null;
let emptySceneEscHandler: ((e: KeyboardEvent) => void) | null = null;

export default class SceneCommand extends Command {
  readonly definition: CommandDef = {
    name: "scene",
    description: "Scene creation, management and debugging",
    usage: "scene [subcommand]",
    subcommands: [
      { name: "empty", description: "Create empty scene for BSP testing" },
      { name: "clear", description: "Clear all scene objects" },
      { name: "dispose", description: "Dispose empty scene" },
      { name: "info", description: "Show scene statistics" },
      { name: "meshes", description: "List all meshes" },
      { name: "materials", description: "List all materials" },
      { name: "lights", description: "List all lights" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    // Handle empty/clear/dispose first (don't require existing scene)
    if (subcommand === "empty") {
      return this.createEmptyScene();
    }
    if (subcommand === "dispose") {
      return this.disposeEmptyScene();
    }
    if (subcommand === "clear") {
      return this.clearScene();
    }

    // Get scene from camera system for other commands
    let scene: Scene | null | undefined;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      scene = CameraSystem.getInstance().getCamera()?.getScene();
    } catch {
      return "Scene not available";
    }

    if (!scene) {
      return 'No active scene. Run "scene empty" first.';
    }

    switch (subcommand) {
      case "meshes": {
        const meshes = scene.meshes;
        const lines = [`${meshes.length} meshes:`];
        const sorted = [...meshes].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        for (const mesh of sorted.slice(0, 50)) {
          const tris = mesh.getTotalVertices ? Math.floor(mesh.getTotalVertices() / 3) : 0;
          lines.push(`  ${mesh.name || "(unnamed)"} - ${tris} tris`);
        }
        if (meshes.length > 50) {
          lines.push(`  ... and ${meshes.length - 50} more`);
        }
        return lines.join("\n");
      }

      case "materials": {
        const materials = scene.materials;
        const lines = [`${materials.length} materials:`];
        for (const mat of materials.slice(0, 30)) {
          lines.push(`  ${mat.name || "(unnamed)"} - ${mat.getClassName()}`);
        }
        if (materials.length > 30) {
          lines.push(`  ... and ${materials.length - 30} more`);
        }
        return lines.join("\n");
      }

      case "lights": {
        const lights = scene.lights;
        const lines = [`${lights.length} lights:`];
        for (const light of lights) {
          lines.push(`  ${light.name || "(unnamed)"} - ${light.getClassName()}`);
        }
        return lines.join("\n");
      }
      default: {
        const meshCount = scene.meshes.length;
        const matCount = scene.materials.length;
        const texCount = scene.textures.length;
        const lightCount = scene.lights.length;
        const activeMeshes = scene.getActiveMeshes().length;

        return (
          `Scene Statistics:\n` +
          `  Meshes: ${meshCount} (${activeMeshes} active)\n` +
          `  Materials: ${matCount}\n` +
          `  Textures: ${texCount}\n` +
          `  Lights: ${lightCount}\n` +
          `  FPS: ${scene.getEngine().getFps().toFixed(1)}`
        );
      }
    }
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["empty", "clear", "dispose", "info", "meshes", "materials", "lights"];
    }
    return [];
  }

  private async createEmptyScene(): Promise<string> {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    if (!canvas) {
      return "No canvas found";
    }

    // Get or create engine
    const existingEngine = window.babylonEngine;
    const engine = existingEngine || new Engine(canvas, true);

    if (!existingEngine) {
      window.babylonEngine = engine;
    }

    // Dispose previous empty scene if exists
    if (emptyScene) {
      emptyScene.dispose();
    }

    // Create new empty scene
    emptyScene = new Scene(engine);
    emptyScene.clearColor = new Color4(0.1, 0.1, 0.15, 1);
    emptyScene.collisionsEnabled = true;
    emptyScene.ambientColor = new Color3(1, 1, 1); // Required for BSP lightmaps to render

    // Initialize Physics (Havok)
    try {
      const { PhysicsSystem } = await import("../../physics/PhysicsSystem");
      console.warn("[SceneCommand] initializing PhysicsSystem for empty scene...");
      await PhysicsSystem.getInstance().enablePhysics(emptyScene);
    } catch (e) {
      console.error("[SceneCommand] Failed to init physics:", e);
    }

    // Create camera at origin
    emptySceneCamera = new FreeCamera("emptySceneCamera", new Vector3(0, 100, -500), emptyScene);
    emptySceneCamera.setTarget(Vector3.Zero());
    emptySceneCamera.fov = 1.0;
    emptySceneCamera.minZ = 1;
    emptySceneCamera.maxZ = 50000;
    emptySceneCamera.inputs.clear();

    // Initialize scene services (TextureManager, SkyLightSystem, etc.)
    const { ServiceLocator } = await import("../../core/ServiceLocator");
    await ServiceLocator.getInstance().initScene(emptyScene);

    // Add basic lighting (unless already created by SkyLightSystem)
    if (emptyScene.lights.length === 0) {
      const light = new HemisphericLight("light", new Vector3(0, 1, 0), emptyScene);
      light.intensity = 1.0;
    }

    // Set as active scene with SkyLightSystem update for day/night cycle
    const { SkyLightSystem } = await import("../../lighting/SkyLightSystem");
    engine.stopRenderLoop();
    engine.runRenderLoop(() => {
      if (emptyScene) {
        const deltaTime = engine.getDeltaTime();
        SkyLightSystem.getInstance().update(deltaTime);
        emptyScene.render();
      }
    });

    // Initialize camera system with this scene
    const { CameraSystem } = await import("../../camera/CameraSystem");
    const cameraSystem = CameraSystem.getInstance();
    cameraSystem.init(emptyScene, canvas);
    cameraSystem.setCamera(emptySceneCamera);

    // Create fresh freefly controller (unless we're in network mode)
    const { Game } = await import("../../../games/fps/Game");
    const isNetworkMode = Game.getInstance().isConnectedToServer();

    if (!isNetworkMode) {
      const { FreeflyController } = await import("../../camera/controllers/FreeflyController");
      const existingFreefly = cameraSystem.getController("freefly");
      if (existingFreefly) {
        existingFreefly.dispose();
      }
      const freeflyController = new FreeflyController();
      cameraSystem.registerController("freefly", freeflyController);
      cameraSystem.setController("freefly");
    } else {
      devLog("[SceneCommand] Skipping freefly controller - network mode active");
    }

    // Enter "in_game" state
    const { MenuSystem } = await import("../../MenuSystem");
    MenuSystem.getInstance().enterGame();

    // Hide main menu
    const mainMenuEl = document.getElementById("main-menu");
    if (mainMenuEl) {
      mainMenuEl.style.display = "none";
    }

    // Add ESC key handler
    if (emptySceneEscHandler) {
      window.removeEventListener("keydown", emptySceneEscHandler);
    }
    emptySceneEscHandler = async (e: KeyboardEvent) => {
      const { DebugConsole } = await import("../../debug/DebugConsole");
      if (DebugConsole.getInstance().getIsOpen()) {
        return;
      }
      if (e.key === "Escape" && emptyScene) {
        e.preventDefault();
        e.stopPropagation();
        this.disposeEmptyScene();
      }
    };
    window.addEventListener("keydown", emptySceneEscHandler, { capture: true });

    return [
      "Created empty scene for BSP testing",
      "Camera: freefly mode (LMB forward, RMB backward, freelook)",
      "Press ESC to exit empty scene",
      "Now run: map <mapname>",
    ].join("\n");
  }

  private async disposeEmptyScene(): Promise<string> {
    if (!emptyScene) {
      return "No empty scene to dispose";
    }

    // Remove ESC handler
    if (emptySceneEscHandler) {
      window.removeEventListener("keydown", emptySceneEscHandler);
      emptySceneEscHandler = null;
    }

    // Stop render loop
    const engine = emptyScene.getEngine();
    engine.stopRenderLoop();

    // Dispose scene
    emptyScene.dispose();
    emptyScene = null;
    emptySceneCamera = null;

    // Return to main menu
    const { MenuSystem } = await import("../../MenuSystem");
    MenuSystem.getInstance().returnToMainMenu();

    return "Empty scene disposed - returned to main menu";
  }

  private async clearScene(): Promise<string> {
    const { CameraSystem } = await import("../../camera/CameraSystem");
    const scene = CameraSystem.getInstance().getCamera()?.getScene();

    if (!scene) {
      return "No active scene to clear";
    }

    const stats = { meshes: 0, materials: 0, textures: 0 };

    // Dispose all meshes except camera
    const meshesToDispose = [...scene.meshes];
    for (const mesh of meshesToDispose) {
      if (mesh.name !== "emptySceneCamera") {
        mesh.dispose(false, true); // Dispose mesh + children
        stats.meshes++;
      }
    }

    // Rely on MapLoader to dispose map-specific materials and textures
    // Manual disposal of scene.materials/textures can cause race conditions
    // with TextureLoader caches or double-disposal issues.
    // Unused materials/textures will be GC'd or handled by the loader's cleanup.

    // Clear shader animation system
    try {
      const { ShaderAnimationSystem } = await import("../../loader/shader/ShaderAnimationSystem");
      ShaderAnimationSystem.getInstance().clear();
    } catch {
      /* ignore */
    }

    // Clear MapLoader state (this clears texture caches and lightmaps)
    try {
      const { MapLoader } = await import("../../loader/map/MapLoader");
      await MapLoader.getInstance().disposeCurrentMap();
    } catch {
      /* ignore */
    }

    // Reinitialize SkyLightSystem lights
    try {
      const { SkyLightSystem } = await import("../../lighting/SkyLightSystem");
      SkyLightSystem.getInstance().reinitLights();
    } catch {
      /* ignore */
    }

    return ["Scene cleared:", `  Meshes disposed: ${stats.meshes}`, "  Materials/Textures: delegated to loaders"].join(
      "\n",
    );
  }
}
