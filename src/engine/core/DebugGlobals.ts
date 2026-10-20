/**
 * DebugGlobals — the functions and objects the engine puts on `window` for the
 * browser's developer console, typed so engine code reads them without casts.
 */

import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import type { CameraMode, EngineScene } from "../EngineScene";
import type { BspFile } from "../loader/bsp/BspLoader";

declare global {
  interface Window {
    loadMap?: (mapName: string) => unknown;
    setZoom?: (size: number) => void;
    setCameraMode?: (mode: CameraMode) => void;
    getCameraMode?: () => CameraMode;
    setCameraHeight?: (height: number) => void;
    getCameraHeight?: () => number;
    camera?: ReturnType<EngineScene["cameraDebug"]>;
    fx?: ReturnType<EngineScene["fxDebug"]>;
    weather?: ReturnType<EngineScene["weatherDebug"]>;
    /** The engine `scene` commands reuse across empty scenes. */
    babylonEngine?: Engine;
    /** Chrome's collector, with `--js-flags="--expose-gc"`. */
    gc?: () => void;
    testBspLoading?: (mapName?: string) => Promise<BspFile | null>;
    printBspStats?: (bsp: BspFile) => void;
    testBspRendering?: (scene: Scene, mapName?: string) => Promise<void>;
    quickBspTest?: () => Promise<void>;
  }
}
