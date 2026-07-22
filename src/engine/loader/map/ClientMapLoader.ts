import { CommandRegistry } from "../../console/CommandRegistry";
import { PLAYER_ORIGIN_HEIGHT } from "../../physics/PlayerPhysicsConstants";

/**
 * Render/load a BSP map for a client that is already connected to an
 * authoritative server. This is intentionally not a gameplay starter.
 */
export async function loadClientMap(mapName: string): Promise<string> {
  let cameraSystem: any;
  try {
    const { CameraSystem } = await import("../../camera/CameraSystem");
    cameraSystem = CameraSystem.getInstance();
  } catch {
    return "CameraSystem not available";
  }

  const { MapLoader } = await import("./MapLoader");
  const mapLoader = MapLoader.getInstance();
  const registry = CommandRegistry.getInstance();

  return loadClientMapWithSystems(mapName, cameraSystem, mapLoader, registry);
}

export async function unloadClientMap(): Promise<void> {
  const { MapLoader } = await import("./MapLoader");
  MapLoader.getInstance().disposeCurrentMap();
}

async function loadClientMapWithSystems(
  mapName: string,
  cameraSystem: any,
  mapLoader: any,
  registry: CommandRegistry,
): Promise<string> {
  const { RenderVars } = await import("../../rendering/RenderVars");
  RenderVars.getInstance();

  let scene = cameraSystem.getCamera()?.getScene();

  if (!scene) {
    await registry.execute("scene empty");
    scene = cameraSystem.getCamera()?.getScene();
    if (!scene) {
      return 'No scene available. Run "scene empty" first.';
    }
  } else {
    await registry.execute("scene clear");
    scene = cameraSystem.getCamera()?.getScene();
  }

  if (!scene) {
    return "No scene available";
  }

  const { Color3 } = await import("@babylonjs/core/Maths/math.color");
  scene.ambientColor = new Color3(1, 1, 1);
  scene.blockMaterialDirtyMechanism = false;
  console.log("[ClientMapLoader] Applied scene settings for BSP rendering");

  const result = await mapLoader.loadMap(mapName, scene, (progress: any) => {
    console.log(`[Map] ${progress.phase}${progress.detail ? `: ${progress.detail}` : ""}`);
  });

  if (!result.success) {
    return `Failed to load map: ${result.error}`;
  }

  if (result.mapType === "bsp") {
    const { SkyLightSystem } = await import("../../lighting/SkyLightSystem");
    const sky = SkyLightSystem.getInstance();
    sky.resetWorldspawn();
    sky.loadFromWorldspawn();

    // Opt-in volumetric sun shafts via worldspawn `godrays "1"` (+ tuning keys).
    const { GodRaysController } = await import("../../lighting/GodRaysController");
    const godRayCamera = cameraSystem.getCamera();
    if (godRayCamera) {
      GodRaysController.getInstance().loadFromWorldspawn(scene, godRayCamera);
    } else {
      GodRaysController.getInstance().disable();
    }
  }

  let spawnStatus = "";
  if (result.playerStartPosition) {
    const spawnPos = result.playerStartPosition.clone();
    spawnPos.y += PLAYER_ORIGIN_HEIGHT;

    let initialYaw = 0;
    if (result.bsp?.entities) {
      const spawnExp = result.bsp.entities.find(
        (e: any) => e.classname === "info_player_deathmatch" || e.classname === "info_player_start",
      );
      if (spawnExp?.properties?.angle) {
        const angleDeg = parseFloat(spawnExp.properties.angle);
        initialYaw = -(angleDeg - 90) * (Math.PI / 180);
      }
    }

    const controller = cameraSystem.getActiveController();
    if (controller && (controller as any).setPosition) {
      console.log(`[ClientMapLoader] Teleporting ${controller.type} to ${spawnPos}`);
      (controller as any).setPosition(spawnPos);

      setTimeout(() => {
        if (cameraSystem.getActiveController() === controller) {
          (controller as any).setPosition(spawnPos);
        }
      }, 100);
    } else {
      const cam = cameraSystem.getCamera();
      if (cam) cam.position.copyFrom(spawnPos);
    }

    const cam = cameraSystem.getCamera();
    if (cam) {
      cam.rotation.x = 0;
      cam.rotation.z = 0;
      cam.rotation.y = initialYaw;
      console.log(`[ClientMapLoader] Set rotation: yaw=${initialYaw.toFixed(2)}`);
    }

    spawnStatus = `  Spawned at: ${spawnPos}`;
  }

  const { EventBus } = await import("../../core/EventBus");
  EventBus.emit("map:loaded", { mapName });

  return [
    `Loaded map: ${mapName} (${result.mapType})`,
    result.meshResult ? `  Vertices: ${result.meshResult.stats.totalVertices}` : "",
    result.meshResult ? `  Triangles: ${result.meshResult.stats.totalTriangles}` : "",
    spawnStatus,
  ]
    .filter(Boolean)
    .join("\n");
}
