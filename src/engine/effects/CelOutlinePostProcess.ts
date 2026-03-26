/**
 * CelOutlinePostProcess - Warsow-style cel-shading outlines
 *
 * Uses post-process edge detection on depth buffer to draw toon-style
 * black outlines on geometry edges and surface creases.
 *
 * Normals are reconstructed from the depth buffer via cross-product,
 * eliminating the need for a separate geometry/normal buffer.
 *
 * Configurable via cvars:
 * - r_cel_outlines (bool)         - Enable/disable
 * - r_cel_thickness (float)       - Outline width in pixels
 * - r_cel_depth_threshold (float) - Depth edge sensitivity
 * - r_cel_normal_threshold (float)- Normal edge sensitivity
 * - r_cel_opacity (float)         - Outline opacity
 * - r_cel_color (string)          - Outline RGB color "r g b"
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import type { Scene } from "@babylonjs/core/scene";

// Import depth renderer side-effects so scene.enableDepthRenderer() exists
import "@babylonjs/core/Rendering/depthRendererSceneComponent";

// Fragment shader: depth-only edge detection with reconstructed normals
const CEL_OUTLINE_FRAGMENT = `
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;

uniform vec2 texelSize;
uniform float thickness;
uniform float depthThreshold;
uniform float normalThreshold;
uniform float opacity;
uniform vec3 outlineColor;
uniform float cameraNear;
uniform float cameraFar;

float getDepth(vec2 uv) {
    return texture2D(depthSampler, uv).r;
}

// Simple 4-tap depth edge detection with depth-relative comparison
// Divides depth differences by center depth to normalize across distances
float depthEdge(vec2 uv, vec2 offset) {
    float center = getDepth(uv);
    
    // Skip sky
    if (center > 0.999) return 0.0;
    
    // Sample 4 neighbors
    float left  = getDepth(uv - vec2(offset.x, 0.0));
    float right = getDepth(uv + vec2(offset.x, 0.0));
    float up    = getDepth(uv + vec2(0.0, offset.y));
    float down  = getDepth(uv - vec2(0.0, offset.y));
    
    // Depth-relative differences (normalize by center depth)
    // This prevents close surfaces from overwhelming the detector
    float invDepth = 1.0 / max(center, 0.001);
    float dx = abs(right - left) * invDepth;
    float dy = abs(up - down) * invDepth;
    
    return max(dx, dy);
}

// Normal edge via depth-reconstructed normals (4-tap)
float normalEdge(vec2 uv, vec2 offset) {
    // Reconstruct normals from depth at 4 positions
    float c  = getDepth(uv);
    float cR = getDepth(uv + vec2(offset.x, 0.0));
    float cL = getDepth(uv - vec2(offset.x, 0.0));
    float cU = getDepth(uv + vec2(0.0, offset.y));
    float cD = getDepth(uv - vec2(0.0, offset.y));
    
    // Skip sky
    if (c > 0.999) return 0.0;
    
    // Central normal
    vec3 n0 = normalize(vec3(cL - cR, cD - cU, 2.0 * length(offset)));
    
    // Offset normals (shift one texel in each direction)
    float rR = getDepth(uv + vec2(offset.x * 2.0, 0.0));
    float rU = getDepth(uv + vec2(offset.x, offset.y));
    float rD = getDepth(uv + vec2(offset.x, -offset.y));
    vec3 n1 = normalize(vec3(cR - rR, rD - rU, 2.0 * length(offset)));
    
    float uU = getDepth(uv + vec2(0.0, offset.y * 2.0));
    float uR = getDepth(uv + vec2(offset.x, offset.y));
    float uL = getDepth(uv + vec2(-offset.x, offset.y));
    vec3 n2 = normalize(vec3(uL - uR, cU - uU, 2.0 * length(offset)));
    
    // Compare normals via dot product (1 = same, 0 = perpendicular)
    float d1 = 1.0 - abs(dot(n0, n1));
    float d2 = 1.0 - abs(dot(n0, n2));
    
    return max(d1, d2);
}

void main(void) {
    vec4 sceneColor = texture2D(textureSampler, vUV);
    
    vec2 offset = texelSize * thickness;
    
    float dEdge = depthEdge(vUV, offset);
    float nEdge = normalEdge(vUV, offset);
    
    // Threshold with slight anti-aliasing
    float depthLine = smoothstep(depthThreshold * 0.7, depthThreshold, dEdge);
    float normalLine = smoothstep(normalThreshold * 0.7, normalThreshold, nEdge);
    
    float edge = max(depthLine, normalLine);
    edge = clamp(edge * opacity, 0.0, 1.0);
    
    // Fade outlines on bright pixels (explosions, particles use additive blending).
    // These effects don't write to depth, so the shader detects geometry edges
    // behind them. By fading on bright pixels, outlines disappear under effects.
    float brightness = max(sceneColor.r, max(sceneColor.g, sceneColor.b));
    float brightFade = 1.0 - smoothstep(0.7, 1.5, brightness);
    edge *= brightFade;
    
    vec3 finalColor = mix(sceneColor.rgb, outlineColor, edge);
    gl_FragColor = vec4(finalColor, sceneColor.a);
}
`;

export class CelOutlinePostProcess {
  private static _instance: CelOutlinePostProcess;

  private scene: Scene | null = null;
  private camera: Camera | null = null;
  private postProcess: PostProcess | null = null;

  // Settings
  private _enabled = true;
  private _thickness = 1.5;
  private _depthThreshold = 0.1; // Depth-relative: 10% depth difference = edge
  private _normalThreshold = 0.3; // Normal dot product difference threshold
  private _opacity = 1.0;
  private _color = new Color3(0, 0, 0);

  private constructor() {}

  public static getInstance(): CelOutlinePostProcess {
    if (!CelOutlinePostProcess._instance) {
      CelOutlinePostProcess._instance = new CelOutlinePostProcess();
    }
    return CelOutlinePostProcess._instance;
  }

  /**
   * Initialize the cel outline post-process
   */
  public init(scene: Scene, camera: Camera): void {
    this.scene = scene;
    this.camera = camera;

    // Register the custom shader in Babylon's shader store
    Effect.ShadersStore["celOutlineFragmentShader"] = CEL_OUTLINE_FRAGMENT;

    if (this._enabled) {
      this.createPostProcess();
    }

    console.log("[CelOutline] Initialized");
  }

  /**
   * Rebind to a new camera (called when camera changes)
   */
  public setCamera(camera: Camera): void {
    if (!this.scene) return;
    if (this.camera === camera) return;

    this.camera = camera;

    // Always recreate on new camera (initial create may have failed on old camera)
    this.destroyPostProcess();
    if (this._enabled) {
      this.createPostProcess();
    }
  }

  private createPostProcess(): void {
    if (!this.scene || !this.camera) return;
    if (this.postProcess) return;

    const engine = this.scene.getEngine();

    // Enable depth renderer — this is the ONLY dependency
    const depthRenderer = this.scene.enableDepthRenderer(this.camera, false);
    if (!depthRenderer) {
      console.warn("[CelOutline] Failed to enable depth renderer");
      return;
    }

    const depthTex = depthRenderer.getDepthMap();
    console.log(`[CelOutline] Depth texture ready: ${depthTex.getSize().width}x${depthTex.getSize().height}`);

    // Filter what writes to the depth buffer for outline detection.
    // Exclude: alpha-blended meshes (particles, explosions), tagged meshes (projectiles).
    depthTex.renderListPredicate = (mesh) => {
      // Skip invisible or non-rendered meshes
      if (!mesh.isVisible || !mesh.isEnabled()) return false;
      // Skip meshes explicitly excluded from cel outlines
      if (mesh.metadata?.celOutlineExclude) return false;
      // Skip alpha-blended materials (particles, explosions, sprites)
      const mat = mesh.material;
      if (mat && mat.needAlphaBlendingForMesh(mesh)) return false;
      // Skip meshes with very low visibility (fading effects)
      if (mesh.visibility < 0.5) return false;
      return true;
    };

    // Create the post-process with HALF_FLOAT to preserve HDR pipeline quality.
    // Without this, PostProcess defaults to UNSIGNED_BYTE (8-bit) which quantizes
    // the HDR float16 output from DefaultRenderingPipeline, causing visible
    // color banding and texture detail loss ("8-bit graphics" look).
    this.postProcess = new PostProcess(
      "celOutline",
      "celOutline",
      [
        "texelSize",
        "thickness",
        "depthThreshold",
        "normalThreshold",
        "opacity",
        "outlineColor",
        "cameraNear",
        "cameraFar",
      ],
      ["depthSampler"],
      1.0,
      this.camera,
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      engine,
      false, // reusable
      undefined, // defines
      Constants.TEXTURETYPE_HALF_FLOAT, // preserve HDR precision
    );

    this.postProcess.onApply = (effect: Effect) => {
      const width = engine.getRenderWidth();
      const height = engine.getRenderHeight();

      effect.setFloat2("texelSize", 1.0 / width, 1.0 / height);
      effect.setFloat("thickness", this._thickness);
      effect.setFloat("depthThreshold", this._depthThreshold);
      effect.setFloat("normalThreshold", this._normalThreshold);
      effect.setFloat("opacity", this._opacity);
      effect.setColor3("outlineColor", this._color);
      effect.setFloat("cameraNear", this.camera!.minZ);
      effect.setFloat("cameraFar", this.camera!.maxZ);

      effect.setTexture("depthSampler", depthTex);
    };

    console.log("[CelOutline] Post-process created and attached to camera");
  }

  private destroyPostProcess(): void {
    if (this.postProcess) {
      this.postProcess.dispose();
      this.postProcess = null;
      console.log("[CelOutline] Post-process destroyed");
    }
  }

  // ==================== Public API ====================

  public setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) return;
    this._enabled = enabled;

    if (enabled) {
      this.createPostProcess();
    } else {
      this.destroyPostProcess();
    }

    console.log(`[CelOutline] ${enabled ? "Enabled" : "Disabled"}`);
  }

  public isEnabled(): boolean {
    return this._enabled;
  }

  public setThickness(px: number): void {
    this._thickness = Math.max(0.1, Math.min(8.0, px));
  }

  public setDepthThreshold(t: number): void {
    this._depthThreshold = Math.max(0.001, Math.min(1.0, t));
  }

  public setNormalThreshold(t: number): void {
    this._normalThreshold = Math.max(0.01, Math.min(2.0, t));
  }

  public setOpacity(opacity: number): void {
    this._opacity = Math.max(0, Math.min(1, opacity));
  }

  public setColor(r: number, g: number, b: number): void {
    this._color = new Color3(Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b)));
  }

  /**
   * Parse color from string format "r g b" (0-1 range)
   */
  public setColorFromString(colorStr: string): void {
    const parts = colorStr.trim().split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every((n) => !isNaN(n))) {
      this.setColor(parts[0], parts[1], parts[2]);
    }
  }

  public getColor(): Color3 {
    return this._color.clone();
  }

  public dispose(): void {
    this.destroyPostProcess();
    this.scene = null;
    this.camera = null;
    console.log("[CelOutline] Disposed");
  }

  // ==================== Static Helpers ====================

  /**
   * Exclude a mesh (and its children) from cel outline depth pass.
   * Use for projectiles, particles, UI elements, etc.
   */
  public static excludeMesh(mesh: { metadata: any; getChildMeshes?: () => any[] }): void {
    if (!mesh.metadata) mesh.metadata = {};
    mesh.metadata.celOutlineExclude = true;
    // Also tag children
    if (mesh.getChildMeshes) {
      for (const child of mesh.getChildMeshes()) {
        if (!child.metadata) child.metadata = {};
        child.metadata.celOutlineExclude = true;
      }
    }
  }

  /**
   * Re-include a mesh in cel outline depth pass.
   */
  public static includeMesh(mesh: { metadata: any; getChildMeshes?: () => any[] }): void {
    if (mesh.metadata) {
      mesh.metadata.celOutlineExclude = false;
    }
    if (mesh.getChildMeshes) {
      for (const child of mesh.getChildMeshes()) {
        if (child.metadata) {
          child.metadata.celOutlineExclude = false;
        }
      }
    }
  }
}
