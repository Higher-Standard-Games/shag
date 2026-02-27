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

import { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3 } from "@babylonjs/core/Maths/math.color";

// Import depth renderer side-effects so scene.enableDepthRenderer() exists
import "@babylonjs/core/Rendering/depthRendererSceneComponent";

// Fragment shader: depth-only edge detection with reconstructed normals
const CEL_OUTLINE_FRAGMENT = `
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;  // Scene color
uniform sampler2D depthSampler;    // Depth buffer

// Configuration
uniform vec2 texelSize;
uniform float thickness;
uniform float depthThreshold;
uniform float normalThreshold;
uniform float opacity;
uniform vec3 outlineColor;
uniform float cameraNear;
uniform float cameraFar;

// Get linear depth (0=near, 1=far)
float getDepth(vec2 uv) {
    return texture2D(depthSampler, uv).r;
}

// Reconstruct view-space normal from depth buffer using cross-product
// of neighboring depth samples (standard technique)
vec3 reconstructNormal(vec2 uv) {
    float d  = getDepth(uv);
    float dR = getDepth(uv + vec2(texelSize.x, 0.0));
    float dL = getDepth(uv - vec2(texelSize.x, 0.0));
    float dU = getDepth(uv + vec2(0.0, texelSize.y));
    float dD = getDepth(uv - vec2(0.0, texelSize.y));
    
    // Use the neighbor pair with smallest depth difference (handles edges better)
    float dx = abs(dR - d) < abs(d - dL) ? (dR - d) : (d - dL);
    float dy = abs(dU - d) < abs(d - dD) ? (dU - d) : (d - dD);
    
    return normalize(vec3(dx, dy, texelSize.x * 2.0));
}

// Sobel edge detection on depth
float sobelDepth(vec2 uv, vec2 offset) {
    float d00 = getDepth(uv + vec2(-offset.x, -offset.y));
    float d10 = getDepth(uv + vec2( 0.0,      -offset.y));
    float d20 = getDepth(uv + vec2( offset.x,  -offset.y));
    float d01 = getDepth(uv + vec2(-offset.x,   0.0));
    float d21 = getDepth(uv + vec2( offset.x,   0.0));
    float d02 = getDepth(uv + vec2(-offset.x,   offset.y));
    float d12 = getDepth(uv + vec2( 0.0,        offset.y));
    float d22 = getDepth(uv + vec2( offset.x,   offset.y));
    
    float gx = -d00 - 2.0*d01 - d02 + d20 + 2.0*d21 + d22;
    float gy = -d00 - 2.0*d10 - d20 + d02 + 2.0*d12 + d22;
    
    return sqrt(gx*gx + gy*gy);
}

// Roberts cross on reconstructed normals
float robertsNormal(vec2 uv, vec2 offset) {
    vec3 n00 = reconstructNormal(uv);
    vec3 n11 = reconstructNormal(uv + offset);
    vec3 n10 = reconstructNormal(uv + vec2(offset.x, 0.0));
    vec3 n01 = reconstructNormal(uv + vec2(0.0, offset.y));
    
    float cross1 = length(n00 - n11);
    float cross2 = length(n10 - n01);
    
    return sqrt(cross1*cross1 + cross2*cross2);
}

void main(void) {
    vec4 sceneColor = texture2D(textureSampler, vUV);
    
    vec2 offset = texelSize * thickness;
    
    // Depth edge detection (silhouettes, large depth discontinuities)
    float dEdge = sobelDepth(vUV, offset);
    
    // Normal edge detection (surface creases, face angle changes)
    float nEdge = robertsNormal(vUV, offset);
    
    // Crisp threshold with slight smoothstep for anti-aliasing
    float depthLine = smoothstep(depthThreshold * 0.5, depthThreshold, dEdge);
    float normalLine = smoothstep(normalThreshold * 0.5, normalThreshold, nEdge);
    
    // Combine
    float edge = max(depthLine, normalLine);
    edge = clamp(edge * opacity, 0.0, 1.0);
    
    // Skip skybox (depth ~1.0)
    float centerDepth = getDepth(vUV);
    if (centerDepth > 0.999) {
        edge = 0.0;
    }
    
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
    private _thickness = 1.0;
    private _depthThreshold = 0.002;
    private _normalThreshold = 0.5;
    private _opacity = 0.8;
    private _color = new Color3(0, 0, 0);

    private constructor() { }

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
        Effect.ShadersStore['celOutlineFragmentShader'] = CEL_OUTLINE_FRAGMENT;

        if (this._enabled) {
            this.createPostProcess();
        }

        console.log('[CelOutline] Initialized');
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
            console.warn('[CelOutline] Failed to enable depth renderer');
            return;
        }

        const depthTex = depthRenderer.getDepthMap();
        console.log(`[CelOutline] Depth texture ready: ${depthTex.getSize().width}x${depthTex.getSize().height}`);

        // Create the post-process
        this.postProcess = new PostProcess(
            'celOutline',
            'celOutline',                // Shader name → looks up 'celOutlineFragmentShader' in store
            ['texelSize', 'thickness', 'depthThreshold', 'normalThreshold', 'opacity', 'outlineColor', 'cameraNear', 'cameraFar'],
            ['depthSampler'],            // Only need depth — normals are reconstructed in shader
            1.0,                         // Full resolution
            this.camera,
            Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            engine,
            false,
        );

        this.postProcess.onApply = (effect: Effect) => {
            const width = engine.getRenderWidth();
            const height = engine.getRenderHeight();

            effect.setFloat2('texelSize', 1.0 / width, 1.0 / height);
            effect.setFloat('thickness', this._thickness);
            effect.setFloat('depthThreshold', this._depthThreshold);
            effect.setFloat('normalThreshold', this._normalThreshold);
            effect.setFloat('opacity', this._opacity);
            effect.setColor3('outlineColor', this._color);
            effect.setFloat('cameraNear', this.camera!.minZ);
            effect.setFloat('cameraFar', this.camera!.maxZ);

            effect.setTexture('depthSampler', depthTex);
        };

        console.log('[CelOutline] Post-process created and attached to camera');
    }

    private destroyPostProcess(): void {
        if (this.postProcess) {
            this.postProcess.dispose();
            this.postProcess = null;
            console.log('[CelOutline] Post-process destroyed');
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

        console.log(`[CelOutline] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    public isEnabled(): boolean {
        return this._enabled;
    }

    public setThickness(px: number): void {
        this._thickness = Math.max(0.1, Math.min(8.0, px));
    }

    public setDepthThreshold(t: number): void {
        this._depthThreshold = Math.max(0.0001, Math.min(0.1, t));
    }

    public setNormalThreshold(t: number): void {
        this._normalThreshold = Math.max(0.01, Math.min(2.0, t));
    }

    public setOpacity(opacity: number): void {
        this._opacity = Math.max(0, Math.min(1, opacity));
    }

    public setColor(r: number, g: number, b: number): void {
        this._color = new Color3(
            Math.max(0, Math.min(1, r)),
            Math.max(0, Math.min(1, g)),
            Math.max(0, Math.min(1, b))
        );
    }

    /**
     * Parse color from string format "r g b" (0-1 range)
     */
    public setColorFromString(colorStr: string): void {
        const parts = colorStr.trim().split(/\s+/).map(Number);
        if (parts.length >= 3 && parts.every(n => !isNaN(n))) {
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
        console.log('[CelOutline] Disposed');
    }
}
