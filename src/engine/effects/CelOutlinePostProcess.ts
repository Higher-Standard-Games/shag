/**
 * CelOutlinePostProcess - Warsow-style cel-shading outlines
 * 
 * Uses post-process edge detection on depth + normal buffers to
 * draw toon-style black outlines on geometry edges and surface creases.
 * 
 * Much better than Warsow's old approach of rendering black rectangles
 * over surfaces — this is a single full-screen shader pass.
 * 
 * Configurable via cvars:
 * - r_cel_outlines (bool)       - Enable/disable
 * - r_cel_thickness (float)     - Outline width in pixels
 * - r_cel_depth_threshold (float) - Depth edge sensitivity
 * - r_cel_normal_threshold (float) - Normal edge sensitivity
 * - r_cel_opacity (float)       - Outline opacity
 * - r_cel_color (string)        - Outline RGB color "r g b"
 */

import { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { Effect } from "@babylonjs/core/Materials/effect";
import { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3 } from "@babylonjs/core/Maths/math.color";

// Fragment shader for edge detection on depth + normals
const CEL_OUTLINE_FRAGMENT = `
precision highp float;

// Scene color from previous pass
varying vec2 vUV;
uniform sampler2D textureSampler;

// Engine-provided buffers
uniform sampler2D depthSampler;
uniform sampler2D normalSampler;

// Configuration uniforms
uniform vec2 texelSize;       // 1.0 / screenResolution
uniform float thickness;      // Outline thickness in pixels
uniform float depthThreshold; // Sensitivity to depth edges
uniform float normalThreshold;// Sensitivity to normal edges
uniform float opacity;        // Outline opacity
uniform vec3 outlineColor;    // Outline color (default black)
uniform float nearPlane;
uniform float farPlane;

// Linearize depth from depth buffer
float linearizeDepth(float rawDepth) {
    // Babylon.js depth buffer stores: (viewZ - near) / (far - near)
    return rawDepth;
}

// Sample depth at offset (in pixel units)
float sampleDepth(vec2 uv) {
    return linearizeDepth(texture2D(depthSampler, uv).r);
}

// Sample normal at offset
vec3 sampleNormal(vec2 uv) {
    return texture2D(normalSampler, uv).rgb * 2.0 - 1.0;
}

// Sobel edge detection on depth
float depthEdge(vec2 uv, vec2 offset) {
    // 3x3 Sobel kernel
    float d00 = sampleDepth(uv + vec2(-offset.x, -offset.y));
    float d10 = sampleDepth(uv + vec2( 0.0,      -offset.y));
    float d20 = sampleDepth(uv + vec2( offset.x,  -offset.y));
    float d01 = sampleDepth(uv + vec2(-offset.x,   0.0));
    float d21 = sampleDepth(uv + vec2( offset.x,   0.0));
    float d02 = sampleDepth(uv + vec2(-offset.x,   offset.y));
    float d12 = sampleDepth(uv + vec2( 0.0,        offset.y));
    float d22 = sampleDepth(uv + vec2( offset.x,   offset.y));
    
    // Sobel X: horizontal gradient
    float gx = -d00 - 2.0*d01 - d02 + d20 + 2.0*d21 + d22;
    // Sobel Y: vertical gradient
    float gy = -d00 - 2.0*d10 - d20 + d02 + 2.0*d12 + d22;
    
    return sqrt(gx*gx + gy*gy);
}

// Roberts cross edge detection on normals (faster, good enough)
float normalEdge(vec2 uv, vec2 offset) {
    vec3 n00 = sampleNormal(uv);
    vec3 n11 = sampleNormal(uv + offset);
    vec3 n10 = sampleNormal(uv + vec2(offset.x, 0.0));
    vec3 n01 = sampleNormal(uv + vec2(0.0, offset.y));
    
    // Roberts cross: diagonal differences
    float cross1 = length(n00 - n11);
    float cross2 = length(n10 - n01);
    
    return sqrt(cross1*cross1 + cross2*cross2);
}

void main(void) {
    vec4 sceneColor = texture2D(textureSampler, vUV);
    
    // Scale offset by thickness
    vec2 offset = texelSize * thickness;
    
    // Detect edges
    float dEdge = depthEdge(vUV, offset);
    float nEdge = normalEdge(vUV, offset);
    
    // Apply thresholds — step function for crisp toon outlines
    float depthLine = smoothstep(depthThreshold * 0.5, depthThreshold, dEdge);
    float normalLine = smoothstep(normalThreshold * 0.5, normalThreshold, nEdge);
    
    // Combine: take the strongest edge
    float edge = max(depthLine, normalLine);
    
    // Clamp and apply opacity
    edge = clamp(edge * opacity, 0.0, 1.0);
    
    // Mix outline color into scene
    vec3 finalColor = mix(sceneColor.rgb, outlineColor, edge);
    
    gl_FragColor = vec4(finalColor, sceneColor.a);
}
`;

export class CelOutlinePostProcess {
    private static _instance: CelOutlinePostProcess;

    private scene: Scene | null = null;
    private camera: Camera | null = null;
    private postProcess: PostProcess | null = null;
    private depthRenderer: DepthRenderer | null = null;

    // Settings
    private _enabled = true;
    private _thickness = 1.0;
    private _depthThreshold = 0.002;
    private _normalThreshold = 0.5;
    private _opacity = 0.8;
    private _color = new Color3(0, 0, 0); // Black

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

        // Register the custom shader
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

        // Recreate the post-process on the new camera
        if (this.postProcess) {
            this.destroyPostProcess();
            if (this._enabled) {
                this.createPostProcess();
            }
        }
    }

    private createPostProcess(): void {
        if (!this.scene || !this.camera) return;
        if (this.postProcess) return; // Already created

        const engine = this.scene.getEngine();

        // Enable depth renderer if not already active
        if (!this.scene.enableDepthRenderer) {
            console.warn('[CelOutline] Depth renderer not available');
            return;
        }
        this.depthRenderer = this.scene.enableDepthRenderer(this.camera, false);

        // Enable geometry buffer renderer for normals
        let geometryBufferRenderer = this.scene.geometryBufferRenderer;
        if (!geometryBufferRenderer) {
            this.scene.enableGeometryBufferRenderer();
            geometryBufferRenderer = this.scene.geometryBufferRenderer;
        }

        if (!geometryBufferRenderer) {
            console.warn('[CelOutline] Geometry buffer renderer not available');
            return;
        }

        // Create the post-process
        this.postProcess = new PostProcess(
            'celOutline',
            'celOutline',
            // Uniforms
            ['texelSize', 'thickness', 'depthThreshold', 'normalThreshold', 'opacity', 'outlineColor', 'nearPlane', 'farPlane'],
            // Samplers
            ['depthSampler', 'normalSampler'],
            1.0, // Full resolution
            this.camera,
            Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            engine,
            false, // reusable
        );

        const depthTex = this.depthRenderer.getDepthMap();
        const normalTex = geometryBufferRenderer.getGBuffer().textures[1]; // Normal texture

        this.postProcess.onApply = (effect: Effect) => {
            const width = engine.getRenderWidth();
            const height = engine.getRenderHeight();

            effect.setFloat2('texelSize', 1.0 / width, 1.0 / height);
            effect.setFloat('thickness', this._thickness);
            effect.setFloat('depthThreshold', this._depthThreshold);
            effect.setFloat('normalThreshold', this._normalThreshold);
            effect.setFloat('opacity', this._opacity);
            effect.setColor3('outlineColor', this._color);
            effect.setFloat('nearPlane', this.camera!.minZ);
            effect.setFloat('farPlane', this.camera!.maxZ);

            effect.setTexture('depthSampler', depthTex);
            effect.setTexture('normalSampler', normalTex);
        };

        console.log('[CelOutline] Post-process created');
    }

    private destroyPostProcess(): void {
        if (this.postProcess) {
            this.postProcess.dispose();
            this.postProcess = null;
        }
        // Note: don't dispose depthRenderer/geometryBuffer — other systems may use them
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
