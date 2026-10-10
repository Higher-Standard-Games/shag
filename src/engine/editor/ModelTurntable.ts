/**
 * The model browser's preview: a small engine of its own on the drawer's
 * canvas, turning the shown model slowly. Dragging orbits, the wheel zooms;
 * the turn resumes once the pointer leaves. It renders only while started.
 */

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { loadEditorModel, type ModelBounds, measureModel } from "./EditorModelAsset";

export interface ModelPreview {
  /** Shows the model and resolves with its bounds; rejects when it cannot load. A newer show takes the stage. */
  show(path: string): Promise<ModelBounds | null>;
  clear(): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

export class ModelTurntable implements ModelPreview {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private root: TransformNode | null = null;
  private request = 0;
  private hovered = false;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.06, 0.09, 0.17, 1);
    this.camera = new ArcRotateCamera("model-preview", Math.PI / 4, 1.1, 96, Vector3.Zero(), this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.minZ = 0.5;
    const sky = new HemisphericLight("model-preview-sky", new Vector3(0.2, 1, 0.3), this.scene);
    sky.groundColor = new Color3(0.25, 0.27, 0.35);
    sky.intensity = 0.85;
    const key = new DirectionalLight("model-preview-key", new Vector3(-0.5, -1, -0.4), this.scene);
    key.intensity = 0.6;
    canvas.addEventListener("pointerenter", () => (this.hovered = true));
    canvas.addEventListener("pointerleave", () => (this.hovered = false));
    this.scene.onBeforeRenderObservable.add(() => {
      if (!this.hovered) this.camera.alpha += this.engine.getDeltaTime() * 0.0004;
    });
  }

  async show(path: string): Promise<ModelBounds | null> {
    const request = ++this.request;
    const root = await loadEditorModel(this.scene, path, `model-preview-${request}`);
    const bounds = measureModel(root);
    if (request !== this.request || this.scene.isDisposed) {
      // a newer model has the stage; this one was still measured for whoever picked it
      root.dispose(false, true);
      return bounds;
    }
    this.clear();
    this.request = request;
    this.root = root;
    if (bounds) {
      // Quake bounds back to Babylon's Y-up axes for the camera
      const center = new Vector3(
        (bounds.min.x + bounds.max.x) / 2,
        (bounds.min.z + bounds.max.z) / 2,
        (bounds.min.y + bounds.max.y) / 2,
      );
      const diagonal = Math.max(
        8,
        Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z),
      );
      this.camera.setTarget(center);
      // the bounding sphere's radius is half the diagonal; this distance fits it in the 0.8 rad field of view
      this.camera.radius = diagonal * 1.35;
      this.camera.lowerRadiusLimit = diagonal * 0.2;
      this.camera.upperRadiusLimit = diagonal * 6;
      this.camera.beta = 1.1;
    }
    return bounds;
  }

  clear(): void {
    this.request++;
    this.root?.dispose(false, true);
    this.root = null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.engine.resize();
    this.engine.runRenderLoop(() => this.scene.render());
  }

  stop(): void {
    this.running = false;
    this.engine.stopRenderLoop();
  }

  dispose(): void {
    this.stop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
