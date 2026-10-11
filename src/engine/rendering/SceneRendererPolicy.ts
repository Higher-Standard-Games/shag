import type { Scene } from "@babylonjs/core/scene";
import { registerGLTFExtension } from "@babylonjs/loaders/glTF/2.0/glTFLoaderExtensionRegistry";
import {
  applySafeMaxSimultaneousLights,
  applySafeSceneLightCaps,
  clampSceneLightCaps,
} from "../lighting/DynamicLightSafety";

const installed = new WeakSet<Scene>();

/** Whether a synchronous fresh clone should receive this scene's existing policy. */
export function isSceneRendererPolicyApplied(scene: Scene): boolean {
  return installed.has(scene);
}

// Babylon 9.17 raises EVERY scene material's light cap to scene.lights.length
// at the end of each glTF import, including existing BSP materials. Guarded
// materials ignore that raise (see DynamicLightSafety); this hook runs right
// after it, before another render or compilation, and lowers any material that
// was not yet guarded.
const GLTF_POLICY_EXTENSION = "SHAG_renderer_light_policy";
registerGLTFExtension(GLTF_POLICY_EXTENSION, false, (loader) => {
  let scene: Scene | undefined = loader.babylonScene;
  return {
    name: GLTF_POLICY_EXTENSION,
    enabled: installed.has(scene) && scene.getEngine().isWebGPU === true,
    onReady() {
      if (scene && !scene.isDisposed && installed.has(scene)) clampSceneLightCaps(scene);
    },
    dispose() {
      scene = undefined;
    },
  };
});

/** Shared by both application bootstraps and isolated renderer diagnostics. */
export function applySceneRendererPolicy(scene: Scene): void {
  if (!installed.has(scene)) {
    installed.add(scene);
    scene.onNewMaterialAddedObservable.add((material) => {
      if (!scene.isDisposed) applySafeMaxSimultaneousLights(material);
    });
    // Babylon clears the material observer with the scene. Do not retain scenes.
    scene.onDisposeObservable.addOnce(() => installed.delete(scene));
  }
  // Also usable immediately before explicit shader compilation, before deferred
  // material-added notifications have run.
  applySafeSceneLightCaps(scene);
}
