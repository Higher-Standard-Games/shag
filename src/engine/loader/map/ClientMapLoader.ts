import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import type { CameraSystem } from "../../camera/CameraSystem";
import { CommandRegistry } from "../../console/CommandRegistry";
import { devLog } from "../../core/DevLog";
import { createLoadingOperationId } from "../../core/LoadingEvents";
import { PLAYER_ORIGIN_HEIGHT } from "../../physics/PlayerPhysicsConstants";
import type { MapLoader, MapLoadOptions, MapLoadProgress } from "./MapLoader";

/**
 * Render/load a BSP map for a client that is already connected to an
 * authoritative server. This is intentionally not a gameplay starter.
 */
let clientLoadTail: Promise<void> = Promise.resolve();
let currentLoad: { id: string; controller: AbortController } | null = null;

export function loadClientMap(mapName: string, options: MapLoadOptions = {}): Promise<string> {
  currentLoad?.controller.abort(new Error("Client map superseded"));
  const owner = { id: options.operationId ?? createLoadingOperationId(), controller: new AbortController() };
  currentLoad = owner;
  const aborted = () => owner.controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", aborted, { once: true });
  if (options.signal?.aborted) aborted();
  const operation = clientLoadTail.then(async () => {
    try {
      owner.controller.signal.throwIfAborted();
      return await performClientMap(mapName, { ...options, operationId: owner.id, signal: owner.controller.signal });
    } finally {
      options.signal?.removeEventListener("abort", aborted);
    }
  });
  clientLoadTail = operation.then(
    () => {},
    () => {},
  );
  return operation;
}

async function performClientMap(mapName: string, options: MapLoadOptions): Promise<string> {
  let cameraSystem: CameraSystem;
  try {
    const { CameraSystem } = await import("../../camera/CameraSystem");
    options.signal?.throwIfAborted();
    cameraSystem = CameraSystem.getInstance();
  } catch {
    options.signal?.throwIfAborted();
    return "CameraSystem not available";
  }

  const { MapLoader } = await import("./MapLoader");
  options.signal?.throwIfAborted();
  const mapLoader = MapLoader.getInstance();
  const registry = CommandRegistry.getInstance();

  return loadClientMapWithSystems(mapName, cameraSystem, mapLoader, registry, options);
}

export async function unloadClientMap(operationId?: string): Promise<void> {
  const owner = currentLoad;
  if (operationId && owner?.id !== operationId) return;
  owner?.controller.abort(new Error("Client map unloaded"));
  const disposal = clientLoadTail.then(async () => {
    if (owner !== currentLoad) return;
    const { MapLoader } = await import("./MapLoader");
    if (owner !== currentLoad) return;
    await MapLoader.getInstance().disposeCurrentMap();
  });
  clientLoadTail = disposal.catch(() => {});
  await disposal;
}

async function loadClientMapWithSystems(
  mapName: string,
  cameraSystem: CameraSystem,
  mapLoader: MapLoader,
  registry: CommandRegistry,
  options: MapLoadOptions,
): Promise<string> {
  const { RenderVars } = await import("../../rendering/RenderVars");
  options.signal?.throwIfAborted();
  RenderVars.getInstance();

  let scene = cameraSystem.getCamera()?.getScene();

  if (!scene) {
    await registry.execute("scene empty");
    options.signal?.throwIfAborted();
    scene = cameraSystem.getCamera()?.getScene();
    if (!scene) {
      return 'No scene available. Run "scene empty" first.';
    }
  } else {
    await registry.execute("scene clear");
    options.signal?.throwIfAborted();
    scene = cameraSystem.getCamera()?.getScene();
  }

  if (!scene) {
    return "No scene available";
  }

  const { Color3 } = await import("@babylonjs/core/Maths/math.color");
  options.signal?.throwIfAborted();
  scene.ambientColor = new Color3(1, 1, 1);
  scene.blockMaterialDirtyMechanism = false;
  devLog("[ClientMapLoader] Applied scene settings for BSP rendering");

  const result = await mapLoader.loadMap(
    mapName,
    scene,
    (progress: MapLoadProgress) => {
      devLog(`[Map] ${progress.phase}${progress.detail ? `: ${progress.detail}` : ""}`);
    },
    {
      ...options,
      finalizeScene: async (result) => {
        if (result.mapType === "bsp") {
          const { SkyLightSystem } = await import("../../lighting/SkyLightSystem");
          options.signal?.throwIfAborted();
          const sky = SkyLightSystem.getInstance();
          sky.resetWorldspawn();
          sky.loadFromWorldspawn();

          // Opt-in volumetric sun shafts via worldspawn `godrays "1"` (+ tuning keys).
          const { GodRaysController } = await import("../../lighting/GodRaysController");
          options.signal?.throwIfAborted();
          const godRayCamera = cameraSystem.getCamera();
          if (godRayCamera) {
            GodRaysController.getInstance().loadFromWorldspawn(scene, godRayCamera);
          } else {
            GodRaysController.getInstance().disable();
          }

          // Textured area lights from map `light_area` entities (r_arealights, capped).
          const { AreaLightManager } = await import("../../lighting/AreaLightManager");
          options.signal?.throwIfAborted();
          AreaLightManager.getInstance().loadFromMap(scene);
        }

        await options.finalizeScene?.(result);
      },
    },
  );
  options.signal?.throwIfAborted();

  if (!result.success) {
    return `Failed to load map: ${result.error}`;
  }

  let spawnStatus = "";
  if (result.playerStartPosition) {
    const spawnPos = result.playerStartPosition.clone();
    spawnPos.y += PLAYER_ORIGIN_HEIGHT;

    let initialYaw = 0;
    if (result.bsp?.entities) {
      const spawnExp = result.bsp.entities.find(
        (e) => e.classname === "info_player_deathmatch" || e.classname === "info_player_start",
      );
      if (spawnExp?.properties?.angle) {
        const angleDeg = parseFloat(spawnExp.properties.angle);
        initialYaw = -(angleDeg - 90) * (Math.PI / 180);
      }
    }

    const controller = cameraSystem.getActiveController();
    if (controller?.setPosition) {
      devLog(`[ClientMapLoader] Teleporting ${controller.type} to ${spawnPos}`);
      controller.setPosition(spawnPos);

      setTimeout(() => {
        if (!options.signal?.aborted && cameraSystem.getActiveController() === controller) {
          controller.setPosition?.(spawnPos);
        }
      }, 100);
    } else {
      const cam = cameraSystem.getCamera();
      if (cam) cam.position.copyFrom(spawnPos);
    }

    const cam = cameraSystem.getCamera();
    if (cam instanceof TargetCamera) {
      cam.rotation.x = 0;
      cam.rotation.z = 0;
      cam.rotation.y = initialYaw;
      devLog(`[ClientMapLoader] Set rotation: yaw=${initialYaw.toFixed(2)}`);
    }

    spawnStatus = `  Spawned at: ${spawnPos}`;
  }

  const { EventBus } = await import("../../core/EventBus");
  options.signal?.throwIfAborted();
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
