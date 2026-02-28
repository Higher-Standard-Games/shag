/**
 * LogoCanvas — Reusable 3D logo renderer
 *
 * Renders a GLB model (washoi.glb) in its own Babylon.js engine/scene.
 * Features:
 *   - Slow pulsing "breathing" rotation on Y axis
 *   - Animated spotlights orbiting behind the model (pink + teal)
 *   - CSS glow triangles behind the model
 *   - Self-contained canvas — can be placed in any UI panel
 *   - Pauses rendering when not visible
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';

import { UIStyles } from '../UIStyles';
import logoCanvasCSSRaw from './styles/LogoCanvas.css?raw';

export interface LogoCanvasOptions {
    /** Width of the canvas in px (default: 600) */
    width?: number;
    /** Height of the canvas in px (default: 200) */
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

        const w = options.width ?? 600;
        const h = options.height ?? 200;

        // Container (holds glow effects + canvas)
        this.container = document.createElement('div');
        this.container.className = 'logo-canvas';
        this.container.style.width = `${w}px`;
        this.container.style.height = `${h}px`;

        // Glow triangles (CSS effects behind the model)
        if (options.showGlow !== false) {
            const glow = document.createElement('div');
            glow.className = 'logo-canvas__glow';

            // Teal triangles
            const tri1 = document.createElement('div');
            tri1.className = 'logo-canvas__tri logo-canvas__tri--teal';
            glow.appendChild(tri1);

            const tri3 = document.createElement('div');
            tri3.className = 'logo-canvas__tri logo-canvas__tri--teal2';
            glow.appendChild(tri3);

            // Pink triangles
            const tri2 = document.createElement('div');
            tri2.className = 'logo-canvas__tri logo-canvas__tri--pink';
            glow.appendChild(tri2);

            const tri4 = document.createElement('div');
            tri4.className = 'logo-canvas__tri logo-canvas__tri--pink2';
            glow.appendChild(tri4);

            // Extra radial glow burst
            const burst = document.createElement('div');
            burst.className = 'logo-canvas__burst';
            glow.appendChild(burst);

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
            Math.PI / 2.2,  // beta (slightly above center)
            5.5,            // radius — closer for bigger model
            Vector3.Zero(),
            this.scene
        );
        camera.lowerRadiusLimit = 5.5;
        camera.upperRadiusLimit = 5.5;
        camera.attachControl(this.canvas, false);
        camera.inputs.clear();

        // ── Base ambient light ──
        const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
        hemi.intensity = 0.6;
        hemi.diffuse = new Color3(0.7, 0.8, 1.0);
        hemi.groundColor = new Color3(0.2, 0.05, 0.3);

        // ── Static key lights ──
        const lightTeal = new PointLight('lightTeal', new Vector3(-3, 2, 3), this.scene);
        lightTeal.diffuse = new Color3(0, 1, 0.85);
        lightTeal.intensity = 1.4;

        const lightPink = new PointLight('lightPink', new Vector3(3, 1, -2), this.scene);
        lightPink.diffuse = new Color3(1, 0.2, 0.6);
        lightPink.intensity = 1.0;

        // ── Orbiting spotlights — dramatic animated lighting ──
        // Teal spotlight orbits from behind/left
        const spotTeal = new SpotLight(
            'spotTeal',
            new Vector3(-4, 3, -3),          // position
            new Vector3(1, -0.5, 1),         // direction (toward model)
            Math.PI / 3,                      // angle
            2,                                // exponent
            this.scene
        );
        spotTeal.diffuse = new Color3(0, 0.95, 0.9);   // Bright teal
        spotTeal.specular = new Color3(0, 1, 1);
        spotTeal.intensity = 2.5;

        // Pink spotlight orbits from behind/right
        const spotPink = new SpotLight(
            'spotPink',
            new Vector3(4, 2, -3),
            new Vector3(-1, -0.3, 1),
            Math.PI / 3,
            2,
            this.scene
        );
        spotPink.diffuse = new Color3(1, 0.1, 0.55);   // Hot pink
        spotPink.specular = new Color3(1, 0.3, 0.7);
        spotPink.intensity = 2.0;

        // Third accent spotlight — warm gold/yellow pulse
        const spotGold = new SpotLight(
            'spotGold',
            new Vector3(0, 4, -2),
            new Vector3(0, -1, 0.5),
            Math.PI / 4,
            3,
            this.scene
        );
        spotGold.diffuse = new Color3(1, 0.75, 0.2);
        spotGold.specular = new Color3(1, 0.9, 0.5);
        spotGold.intensity = 0.8;

        // ── Load the model ──
        const modelPath = this.options.modelPath ?? '/data/washoi_opt.glb';
        try {
            const result = await SceneLoader.ImportMeshAsync(
                '',
                modelPath,
                '',
                this.scene
            );

            if (result.meshes.length > 0) {
                const root = result.meshes[0];
                root.position = Vector3.Zero();

                // Auto-fit
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
                const scale = 4.5 / maxDim;  // Bigger fill
                root.scaling.setAll(scale);

                // Center
                const center = min.add(max).scale(0.5 * scale);
                root.position = center.negate();

                // ── Animation loop ──
                let t = 0;
                this.scene.onBeforeRenderObservable.add(() => {
                    t += 0.008;

                    // Gentle Y-axis pulse (±6 degrees)
                    root.rotation.y = Math.sin(t) * 0.1;

                    // Subtle breathing scale
                    const breathe = 1.0 + Math.sin(t * 0.7) * 0.012;
                    root.scaling.setAll(scale * breathe);

                    // ── Orbit the spotlights slowly ──
                    const orbitRadius = 5;

                    // Teal spotlight orbits counter-clockwise
                    spotTeal.position.x = Math.cos(t * 0.3) * orbitRadius;
                    spotTeal.position.z = Math.sin(t * 0.3) * -orbitRadius;
                    spotTeal.position.y = 2.5 + Math.sin(t * 0.5) * 1.0;
                    // Always point at model center
                    spotTeal.direction = Vector3.Zero().subtract(spotTeal.position).normalize();

                    // Pink spotlight orbits clockwise (offset phase)
                    spotPink.position.x = Math.cos(t * 0.25 + Math.PI) * orbitRadius;
                    spotPink.position.z = Math.sin(t * 0.25 + Math.PI) * -orbitRadius;
                    spotPink.position.y = 2.0 + Math.sin(t * 0.4 + 1) * 1.0;
                    spotPink.direction = Vector3.Zero().subtract(spotPink.position).normalize();

                    // Gold spotlight bobs up/down, slowly drifts
                    spotGold.position.x = Math.sin(t * 0.15) * 2;
                    spotGold.position.y = 3.5 + Math.sin(t * 0.6) * 1.5;
                    spotGold.direction = Vector3.Zero().subtract(spotGold.position).normalize();

                    // Pulse spotlight intensities for extra drama
                    spotTeal.intensity = 2.0 + Math.sin(t * 0.9) * 0.8;
                    spotPink.intensity = 1.6 + Math.sin(t * 0.7 + 2) * 0.6;
                    spotGold.intensity = 0.5 + Math.sin(t * 0.5 + 4) * 0.4;
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
