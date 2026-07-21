/**
 * DynamicLightCluster — one scene-scoped ClusteredLightContainer for GAMEPLAY
 * dynamic world lights (pooled effect lights, charge glows, projectile glows).
 *
 * Why (WS1, docs/research/BabylonJS-9-upgrade.md): forward-lit materials derive
 * shader defines from the enabled-light set and pay per-light uniforms, which is
 * why dynamic lights were historically rationed (a 4-light pool, 2-light
 * material clamps, permutation prewarms). A ClusteredLightContainer presents
 * ALL its lights to materials as ONE stable light — per-light data lives in a
 * texture updated per frame, not in shader defines — so light count stops
 * being a scarcity or a recompile trigger.
 *
 * Scope: WORLD-lighting dynamics only. The muzzle-flash light stays outside —
 * it is deliberately `includedOnlyMeshes`-scoped to the weapon viewmodel, and
 * per-light mesh scoping does not survive inside a container. Static map
 * lights and street lamps keep their own existing containers.
 *
 * Lifecycle rules:
 *  - The container is created LAZILY on the first `addToDynamicLightCluster`
 *    call (an empty container can upset Babylon material-ready checks — see
 *    StreetLampSystem's identical note).
 *  - `container.dispose()` DISPOSES its lights, and a light disposed directly
 *    is NOT auto-removed from its container — always call
 *    `removeFromDynamicLightCluster(light)` before disposing a clustered
 *    light. The scene-dispose hook tears the container down with the scene.
 */

import { ClusteredLightContainer } from "@babylonjs/core/Lights/Clustered/clusteredLightContainer";
import "@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent";
import type { Light } from "@babylonjs/core/Lights/light";
import type { Scene } from "@babylonjs/core/scene";

const containers = new WeakMap<Scene, ClusteredLightContainer>();

/**
 * Add a dynamic world light to the scene's gameplay cluster (lazily creating
 * the container on first use). Safe to call repeatedly with the same light.
 */
export function addToDynamicLightCluster(scene: Scene, light: Light): void {
  let container = containers.get(scene);
  if (!container) {
    // Create empty + addLight (rather than passing lights to the constructor):
    // the constructor's initial-lights loop is gated on a non-zero engine batch
    // size, which is 0 on backends without float-blend caps (e.g. NullEngine) —
    // addLight() itself is not gated, so this path works everywhere and is
    // functionally identical on WebGL2. The light is added synchronously, so the
    // container is never observably empty.
    container = new ClusteredLightContainer("dynamicLightsCluster", [], scene);
    containers.set(scene, container);
    scene.onDisposeObservable.addOnce(() => {
      disposeDynamicLightCluster(scene);
    });
  }
  if (!container.lights.includes(light)) {
    container.addLight(light);
  }
}

/**
 * Remove a light from the scene's gameplay cluster. MUST be called before
 * disposing a clustered light (the container does not observe light disposal).
 * No-op if the light was never clustered.
 */
export function removeFromDynamicLightCluster(scene: Scene, light: Light): void {
  const container = containers.get(scene);
  if (!container) return;
  if (container.lights.includes(light)) {
    container.removeLight(light);
  }
}

/**
 * Remove `light` from its scene's cluster (if present) and dispose it. Derives
 * the scene from the light, so callers with only the light can use it directly.
 */
export function disposeClusteredLight(light: Light): void {
  const scene = light.getScene();
  if (scene) removeFromDynamicLightCluster(scene, light);
  light.dispose();
}

/** The scene's gameplay cluster, if it exists (diagnostics/tests). */
export function getDynamicLightCluster(scene: Scene): ClusteredLightContainer | null {
  return containers.get(scene) ?? null;
}

/**
 * Tear down the scene's gameplay cluster WITHOUT disposing the member lights
 * (their owners — pool, glow maps — manage their own disposal). Called
 * automatically on scene dispose; callable explicitly on map teardown.
 */
export function disposeDynamicLightCluster(scene: Scene): void {
  const container = containers.get(scene);
  if (!container) return;
  containers.delete(scene);
  // Detach members first: ClusteredLightContainer.dispose() disposes the
  // lights it still contains, which would destroy pool-owned lights.
  for (const light of [...container.lights]) {
    container.removeLight(light);
  }
  container.dispose();
}
