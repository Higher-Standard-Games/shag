/** Minimal engine example. Applications own their entry points. */
import "./style.css";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { registerEngineServices } from "./engine/core/EngineServices";
import { GamePaths } from "./engine/core/GamePaths";
import { ServiceLocator } from "./engine/core/ServiceLocator";
import { createBrowserRenderer, createBrowserScene, initializeBrowserScene } from "./engine/runtime/BrowserRuntime";

async function main() {
  GamePaths.getInstance().initFromConfig({ defaultGame: "default", engineAssetsPath: "/engine" });
  registerEngineServices();
  await ServiceLocator.getInstance().initCore();
  const renderer = await createBrowserRenderer(
    document.getElementById("renderCanvas") as HTMLCanvasElement,
    window.location.search,
  );
  const { engine, canvas } = renderer;
  const scene = createBrowserScene(engine);
  const camera = new FreeCamera("exampleCamera", new Vector3(0, 50, -100), scene);
  camera.setTarget(Vector3.Zero());
  camera.attachControl(canvas, true);
  await initializeBrowserScene(scene, () => {});
  new HemisphericLight("exampleLight", Vector3.Up(), scene);
  CreateBox("exampleBox", { size: 25 }, scene);
  const resize = () => engine.resize();
  window.addEventListener("resize", resize);
  scene.onDisposeObservable.addOnce(() => window.removeEventListener("resize", resize));
  engine.runRenderLoop(() => scene.render());
}

main().catch(console.error);
