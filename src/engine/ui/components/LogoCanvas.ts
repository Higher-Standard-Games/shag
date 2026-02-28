/**
 * LogoCanvas — Reusable 3D logo renderer
 *
 * Renders a GLB model (washoi.glb) in its own Babylon.js engine/scene.
 * Features:
 *   - Slow pulsing "breathing" rotation on Y axis
 *   - CSS glow triangles behind the model (pink + teal)
 *   - Self-contained canvas — can be placed in any UI panel
 *   - Pauses rendering when not visible
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';

import { UIStyles } from '../UIStyles';
import logoCanvasCSSRaw from './styles/LogoCanvas.css?raw';

export interface LogoCanvasOptions {
    /** Width of the canvas in px (default: 340) */
    width?: number;
    /** Height of the canvas in px (default: 100) */
    height?: number;
    /** Path to the GLB model (default: /data/washoi.glb) */
    modelPath?: string;
    /** Show pulsing glow triangles behind the model (default: true) */
    showGlow?: boolean;
}

export class LogoCanvas {
    private container: HTMLElement;
    private canvas: HTMLCanvasElement;
    private engine: Engine | null = null;
    private scene: Scene | null = null;
    private running = false;
    private animFrame = 0;
    private disposed = false;

    constructor(private options: LogoCanvasOptions = {}) {
        UIStyles.injectCSS('logo-canvas', logoCanvasCSSRaw);

        const w = options.width ?? 340;
        const h = options.height ?? 100;

        // Container (holds glow effects + canvas)
        this.container = document.createElement('div');
        this.container.className = 'logo-canvas';
        this.container.style.width = `${w}px`;
        this.container.style.height = `${h}px`;

        // Glow triangles (CSS effects behind the model)
        if (options.showGlow !== false) {
            const glow = document.createElement('div');
            glow.className = 'logo-canvas__glow';

            // Teal triangle
            const tri1 = document.createElement('div');
            tri1.className = 'logo-canvas__tri logo-canvas__tri--teal';
            glow.appendChild(tri1);

            // Pink triangle
            const tri2 = document.createElement('div');
            tri2.className = 'logo-canvas__tri logo-canvas__tri--pink';
            glow.appendChild(tri2);

            // Secondary teal (smaller, offset)
            const tri3 = document.createElement('div');
            tri3.className = 'logo-canvas__tri logo-canvas__tri--teal2';
            glow.appendChild(tri3);

            // Secondary pink (smaller, offset)
            const tri4 = document.createElement('div');
            tri4.className = 'logo-canvas__tri logo-canvas__tri--pink2';
            glow.appendChild(tri4);

            this.container.appendChild(glow);
        }

        // Babylon.js canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'logo-canvas__canvas';
        this.canvas.width = w * 2;  // Retina
        this.canvas.height = h * 2;
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        this.container.appendChild(this.canvas);
    }

    /**
     * Get the container element for placement in DOM.
     */
    getElement(): HTMLElement {
        return this.container;
    }

    /**
     * Initialize the Babylon.js scene and load the model.
     * Call after the container has been added to the DOM.
     */
    async init(): Promise<void> {
        if (this.disposed) return;

        // Create a dedicated engine for this small canvas
        this.engine = new Engine(this.canvas, true, {
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: false,
            powerPreference: 'low-power',
        });

        this.scene = new Scene(this.engine);
        this.scene.clearColor = new Color4(0, 0, 0, 0); // transparent

        // Camera (fixed — no user interaction)
        const camera = new ArcRotateCamera(
            'logoCam',
            Math.PI / 2,    // alpha (horizontal)
            Math.PI / 2.3,  // beta (slightly above center)
            6,              // radius
            Vector3.Zero(),
            this.scene
        );
        camera.lowerRadiusLimit = 6;
        camera.upperRadiusLimit = 6;
        camera.attachControl(this.canvas, false);
        // Disable all user camera interaction
        camera.inputs.clear();

        // Lights
        const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
        hemi.intensity = 0.8;
        hemi.diffuse = new Color3(0.8, 0.9, 1.0);    // Cool white
        hemi.groundColor = new Color3(0.3, 0.1, 0.4); // Purple ground fill

        // Teal key light
        const lightTeal = new PointLight('lightTeal', new Vector3(-3, 2, 3), this.scene);
        lightTeal.diffuse = new Color3(0, 1, 0.85);   // Teal/cyan
        lightTeal.intensity = 1.2;

        // Pink fill light
        const lightPink = new PointLight('lightPink', new Vector3(3, 1, -2), this.scene);
        lightPink.diffuse = new Color3(1, 0.2, 0.6);  // Magenta/pink
        lightPink.intensity = 0.8;

        // Load the model
        const modelPath = this.options.modelPath ?? '/data/washoi.glb';
        try {
            const result = await SceneLoader.ImportMeshAsync(
                '',
                modelPath,
                '',
                this.scene
            );

            if (result.meshes.length > 0) {
                const root = result.meshes[0];
                // Center and scale the model
                root.position = Vector3.Zero();

                // Auto-fit: compute bounding info and scale
                this.scene.createDefaultCamera(false);
                let min = new Vector3(Infinity, Infinity, Infinity);
                let max = new Vector3(-Infinity, -Infinity, -Infinity);
                for (const mesh of result.meshes) {
                    if (!mesh.getBoundingInfo) continue;
                    const bi = mesh.getBoundingInfo();
                    min = Vector3.Minimize(min, bi.boundingBox.minimumWorld);
                    max = Vector3.Maximize(max, bi.boundingBox.maximumWorld);
                }
                const size = max.subtract(min);
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 4.0 / maxDim;
                root.scaling.setAll(scale);

                // Center
                const center = min.add(max).scale(0.5 * scale);
                root.position = center.negate();

                // Slow pulsing animation
                let t = 0;
                this.scene.onBeforeRenderObservable.add(() => {
                    t += 0.008; // Very slow
                    // Gentle Y-axis oscillation (±5 degrees)
                    root.rotation.y = Math.sin(t) * 0.09;
                    // Subtle breathing scale
                    const breathe = 1.0 + Math.sin(t * 0.7) * 0.01;
                    root.scaling.setAll(scale * breathe);
                });
            }
        } catch (e) {
            console.warn('[LogoCanvas] Failed to load model:', e);
        }

        // Start render
        this.start();
    }

    /**
     * Start (or resume) rendering.
     */
    start(): void {
        if (this.running || this.disposed || !this.engine || !this.scene) return;
        this.running = true;

        const loop = () => {
            if (!this.running || this.disposed) return;
            if (this.scene && this.engine) {
                this.scene.render();
            }
            this.animFrame = requestAnimationFrame(loop);
        };
        this.animFrame = requestAnimationFrame(loop);
    }

    /**
     * Pause rendering (saves resources when panel is hidden).
     */
    pause(): void {
        this.running = false;
        if (this.animFrame) {
            cancelAnimationFrame(this.animFrame);
            this.animFrame = 0;
        }
    }

    /**
     * Destroy everything.
     */
    dispose(): void {
        this.disposed = true;
        this.pause();
        this.scene?.dispose();
        this.engine?.dispose();
        this.container.remove();
    }
}
