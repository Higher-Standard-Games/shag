/**
 * SSREffect — dynamic screen-space reflections on glossy surfaces (metal floors/
 * walls) via Babylon 9's `SSRRenderingPipeline`.
 *
 * Design + rationale: docs/research/BABYLON9_SSR.md
 *
 * SSR is **material-driven**: it only reflects pixels whose reflectivity is above
 * `reflectivityThreshold`, which the engine already writes via gloss maps /
 * PBR metallic — so the glossy metal reflects the live scene automatically, no
 * per-surface tagging. Rays that leave the screen fall back to the map's skybox
 * cubemap (`environmentTexture`). GPU-expensive, so this is **off by default**
 * (`r_ssr`, opt-in) and GPU-tier-tuned; it fails gracefully if unsupported.
 */

import { devLog } from "../core/DevLog";
import "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { SSRRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline";
import type { Scene } from "@babylonjs/core/scene";
import { EventBus } from "../core/EventBus";
import { QualityDetector } from "../core/QualityDetector";
import { fixGeometryShaderWGSL } from "../rendering/BabylonShaderFixes";
import RenderVars from "../rendering/RenderVars";

const DEFAULT_STRENGTH = 0.4;

export class SSREffect {
  private static instance: SSREffect;

  /** Clear the cached singleton so a fresh scene re-inits cleanly (QA-WO13 pattern). */
  static resetInstance(): void {
    SSREffect.instance?.dispose();
    SSREffect.instance = null as unknown as SSREffect;
  }

  static getInstance(): SSREffect {
    if (!SSREffect.instance) {
      SSREffect.instance = new SSREffect();
    }
    return SSREffect.instance;
  }

  private scene: Scene | null = null;
  private pipeline: SSRRenderingPipeline | null = null;
  private unsubs: (() => void)[] = [];
  private releaseEnvironment: () => void = () => {};
  private disposedEnvironments = new WeakSet<BaseTexture>();

  /** Bind to the scene; build the pipeline now only if `r_ssr` is on. */
  init(scene: Scene): void {
    this.dispose();
    this.scene = scene;
    if (this.requested()) this.createPipeline();

    const rv = RenderVars.getInstance();
    this.unsubs.push(rv.onChange("r_ssr", () => this.refresh()));
    this.unsubs.push(rv.onChange("r_ssr_strength", () => this.applyStrength()));
    this.unsubs.push(
      EventBus.on("map:loaded", () => {
        this.refresh();
        this.refreshEnvironment();
      }),
    );
    const environmentObserver = scene.onEnvironmentTextureChangedObservable.add(() => this.refreshEnvironment());
    const disposeObserver = scene.onDisposeObservable.addOnce(() => this.dispose());
    this.unsubs.push(
      () => scene.onEnvironmentTextureChangedObservable.remove(environmentObserver),
      () => scene.onDisposeObservable.remove(disposeObserver),
    );
    // Rebind to the new active camera on controller swaps (BSP/freefly).
    this.unsubs.push(
      EventBus.on("camera:controller_changed", () => {
        if (this.requested()) this.rebuild();
      }),
    );
  }

  isEnabled(): boolean {
    return this.pipeline !== null;
  }

  private requested(): boolean {
    return (RenderVars.getInstance().get("r_ssr") ?? 0) >= 0.5;
  }

  private refresh(): void {
    if (this.requested() && !this.pipeline) this.createPipeline();
    else if (!this.requested() && this.pipeline) this.destroyPipeline();
  }

  private rebuild(): void {
    this.destroyPipeline();
    this.createPipeline();
  }

  private createPipeline(): void {
    if (!this.scene || this.pipeline) return;
    const camera = this.scene.activeCamera;
    if (!camera) return;

    try {
      // forceGeometryBuffer=true: use the GeometryBufferRenderer (its own geometry
      // shader) for the reflectivity/normal/depth buffers, NOT the PrePassRenderer.
      // The prepass path compiles reflectivity into each material's own shader, and
      // StandardMaterial's prepass output references an undeclared `specularMapColor`
      // (Babylon bug) — breaking our specular-textured BSP surfaces. The geometry
      // buffer path avoids that entirely.
      fixGeometryShaderWGSL();
      const pipeline = new SSRRenderingPipeline("ssr", this.scene, [camera], true);
      if (!pipeline.isSupported) {
        console.warn("[SSREffect] SSR not supported on this device");
        pipeline.dispose();
        return;
      }
      // Own the pipeline before configuration so a later failure cannot leak it.
      this.pipeline = pipeline;

      // Subtle "wet sheen", not a mirror: faint, smooth, roughness-blurred.
      pipeline.reflectionSpecularFalloffExponent = 3;
      pipeline.reflectivityThreshold = 0.04; // only genuinely glossy surfaces pay
      pipeline.enableSmoothReflections = true;
      pipeline.enableAutomaticThicknessComputation = true;
      pipeline.blurDispersionStrength = 0.03;
      pipeline.samples = 1;

      // GPU-tier budget: fewer/coarser ray-march steps on weaker GPUs.
      const tier = QualityDetector.getInstance().getDeviceInfo().gpuTier;
      pipeline.step = tier >= 3 ? 1 : tier >= 2 ? 2 : 4;
      pipeline.maxSteps = tier >= 3 ? 1000 : 500;
      pipeline.maxDistance = 1000;
      pipeline.thickness = tier >= 2 ? 0.5 : 1;

      this.refreshEnvironment();
      this.applyStrength();
      devLog(`[SSREffect] SSR enabled (gpuTier ${tier})`);
    } catch (e) {
      this.destroyPipeline();
      console.warn("[SSREffect] SSR init failed:", e);
    }
  }

  private applyStrength(): void {
    if (this.pipeline) {
      this.pipeline.strength = RenderVars.getInstance().get("r_ssr_strength") ?? DEFAULT_STRENGTH;
    }
  }

  /** Prefer an explicit scene environment; otherwise use the current map sky. */
  private findEnvironmentCubemap(): CubeTexture | null {
    const mat = this.scene?.getMeshByName("skybox")?.material as unknown as {
      reflectionTexture?: CubeTexture | null;
    } | null;
    for (const texture of [this.scene?.environmentTexture, mat?.reflectionTexture]) {
      if (texture?.isCube && !this.disposedEnvironments.has(texture)) return texture as CubeTexture;
    }
    return null;
  }

  private refreshEnvironment(): void {
    if (!this.pipeline) return;
    const texture = this.findEnvironmentCubemap();
    if (this.pipeline.environmentTexture === texture) return;
    this.releaseEnvironment();
    this.releaseEnvironment = () => {};
    this.pipeline.environmentTexture = texture;
    if (texture) {
      const observer = texture.onDisposeObservable.addOnce(() => {
        this.disposedEnvironments.add(texture);
        this.refreshEnvironment();
      });
      this.releaseEnvironment = () => texture.onDisposeObservable.remove(observer);
    }
  }

  private destroyPipeline(): void {
    this.releaseEnvironment();
    this.releaseEnvironment = () => {};
    this.pipeline?.dispose();
    this.pipeline = null;
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.destroyPipeline();
    this.scene = null;
  }
}
