/**
 * HitscanEffects — Generic visual effects for hitscan (instant-hit) weapons
 * 
 * Provides configurable tracer lines, beams, pellet spreads, and bolt trails.
 * Each effect raycasts against the scene to find the actual hit point,
 * then spawns a short-lived visual + optional impact flash.
 * 
 * Usage:
 *   HitscanEffects.getInstance().init(scene);
 *   HitscanEffects.getInstance().fireTracer({ origin, direction, ... });
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// ── Config types ─────────────────────────────────────────────────────

/** Shared config for all hitscan fire calls */
export interface HitscanFireConfig {
    /** World-space origin (camera/muzzle position) */
    origin: Vector3;
    /** Normalized forward direction */
    direction: Vector3;
    /** Maximum range (Quake units). Default 8192 */
    maxRange?: number;
    /** Color of the tracer/beam.  Default white */
    color?: Color3;
}

/** Bullet tracer (machinegun-style thin line that fades fast) */
export interface TracerConfig extends HitscanFireConfig {
    /** Line width factor (1 = thin tracer, 3 = thick).  Default 1 */
    width?: number;
    /** How long the tracer stays visible (seconds). Default 0.08 */
    duration?: number;
}

/** Continuous beam (lasergun-style held beam) */
export interface BeamConfig extends HitscanFireConfig {
    /** Width of the beam. Default 0.15 */
    width?: number;
    /** If supplied, this mesh is reused instead of creating a new one */
    existingBeam?: Mesh;
}

/** Pellet spread (riotgun-style multi-ray) */
export interface PelletConfig extends HitscanFireConfig {
    /** Number of pellets. Default 20 */
    pelletCount?: number;
    /** Spread angle in degrees. Default 9 */
    spreadAngle?: number;
    /** Per-pellet tracer duration. Default 0.06 */
    duration?: number;
}

/** Bolt / rail trail (electrobolt/instagun-style thick beam) */
export interface BoltConfig extends HitscanFireConfig {
    /** Width of the bolt beam. Default 0.35 */
    width?: number;
    /** Duration. Default 0.4 */
    duration?: number;
    /** If true, add spiral ring decoration. Default false */
    spiral?: boolean;
}

// ── Active effect tracking ───────────────────────────────────────────

interface ActiveEffect {
    id: string;
    meshes: Mesh[];
    materials: StandardMaterial[];
    light: PointLight | null;
    spawnTime: number;
    duration: number;
}

// ── Singleton ────────────────────────────────────────────────────────

export class HitscanEffects {
    private static instance: HitscanEffects;
    private scene: Scene | null = null;
    private effects: ActiveEffect[] = [];
    private nextId = 0;

    /** Reusable beam mesh for lasergun (updated every frame, not created/destroyed) */
    private activeBeam: Mesh | null = null;
    private activeBeamMat: StandardMaterial | null = null;
    private activeBeamLight: PointLight | null = null;

    /** Pooled wall marks (bullet holes / scorch marks) */
    private wallMarks: { mesh: Mesh; material: StandardMaterial; spawnTime: number }[] = [];
    private static readonly MAX_WALL_MARKS = 50;
    private static readonly WALL_MARK_DURATION = 3.0;  // seconds to full fade

    private constructor() { }
    static getInstance(): HitscanEffects {
        if (!HitscanEffects.instance) HitscanEffects.instance = new HitscanEffects();
        return HitscanEffects.instance;
    }

    init(scene: Scene): void {
        this.scene = scene;
        console.log('[HitscanEffects] Initialized');
    }

    // ── Public API ───────────────────────────────────────────────────

    /**
     * Instant bullet tracer  (machinegun, generic hitscan)
     * Thin line from origin → hit point, fades over `duration`.
     */
    fireTracer(cfg: TracerConfig): Vector3 | null {
        if (!this.scene) return null;
        const range = cfg.maxRange ?? 8192;
        const color = cfg.color ?? new Color3(1.0, 0.85, 0.3); // warm yellow
        const duration = cfg.duration ?? 0.08;
        const width = cfg.width ?? 1;

        const hit = this.traceRay(cfg.origin, cfg.direction, range);
        const endpoint = hit?.point ?? cfg.origin.add(cfg.direction.scale(range));

        // Create thin line mesh
        const id = `tracer_${this.nextId++}`;
        const line = MeshBuilder.CreateLines(id, {
            points: [cfg.origin.clone(), endpoint.clone()],
            colors: [
                new Color4(color.r, color.g, color.b, 1),
                new Color4(color.r, color.g, color.b, 0.3),
            ],
        }, this.scene);
        line.isPickable = false;
        if (width > 1) {
            line.enableEdgesRendering();
            line.edgesWidth = width;
            line.edgesColor = new Color4(color.r, color.g, color.b, 0.6);
        }

        // Small impact flash at endpoint
        const impactLight = this.spawnImpactFlash(endpoint, color, hit?.normal, duration * 2);

        this.effects.push({
            id,
            meshes: [line],
            materials: [],
            light: impactLight,
            spawnTime: performance.now() / 1000,
            duration,
        });

        // Leave a wall mark at hit point
        if (hit) {
            this.spawnWallMark(hit.point, hit.normal, color, 0.3);
        }

        return hit?.point ?? null;
    }

    /**
     * Continuous beam  (lasergun, held-down)
     * Update every frame while firing. Call `stopBeam()` when fire ends.
     */
    updateBeam(cfg: BeamConfig): Vector3 | null {
        if (!this.scene) return null;
        const range = cfg.maxRange ?? 850;
        const color = cfg.color ?? new Color3(1.0, 0.2, 0.2); // red
        const width = cfg.width ?? 0.15;

        const hit = this.traceRay(cfg.origin, cfg.direction, range);
        const endpoint = hit?.point ?? cfg.origin.add(cfg.direction.scale(range));

        // Create or update beam cylinder
        if (!this.activeBeam) {
            const id = `beam_${this.nextId++}`;
            this.activeBeam = MeshBuilder.CreateCylinder(id, {
                height: 1,
                diameterTop: width,
                diameterBottom: width,
                tessellation: 6,
            }, this.scene);
            this.activeBeam.isPickable = false;

            this.activeBeamMat = new StandardMaterial(`${id}_mat`, this.scene);
            this.activeBeamMat.emissiveColor = color;
            this.activeBeamMat.disableLighting = true;
            this.activeBeamMat.alpha = 0.8;
            this.activeBeamMat.backFaceCulling = false;
            this.activeBeam.material = this.activeBeamMat;
        } else {
            // Update color
            if (this.activeBeamMat) {
                this.activeBeamMat.emissiveColor = color;
            }
        }

        // Position and orient the cylinder between origin and endpoint
        this.orientCylinder(this.activeBeam, cfg.origin, endpoint);

        // Small endpoint glow light
        if (!this.activeBeamLight) {
            this.activeBeamLight = new PointLight('beam_end_light', endpoint, this.scene);
            this.activeBeamLight.diffuse = color;
            this.activeBeamLight.intensity = 3;
            this.activeBeamLight.range = 8;
        } else {
            this.activeBeamLight.position = endpoint;
            this.activeBeamLight.diffuse = color;
        }

        return hit?.point ?? null;
    }

    /** Stop the continuous beam effect */
    stopBeam(): void {
        this.activeBeam?.dispose();
        this.activeBeam = null;
        this.activeBeamMat?.dispose();
        this.activeBeamMat = null;
        this.activeBeamLight?.dispose();
        this.activeBeamLight = null;
    }

    /**
     * Pellet spread  (riotgun / shotgun)
     * Fires N rays in a cone and spawns a tracer for each hit.
     */
    firePellets(cfg: PelletConfig): Vector3[] {
        if (!this.scene) return [];
        const count = cfg.pelletCount ?? 20;
        const spreadDeg = cfg.spreadAngle ?? 9;
        const duration = cfg.duration ?? 0.06;
        const color = cfg.color ?? new Color3(1.0, 0.9, 0.4); // bright yellow
        const range = cfg.maxRange ?? 8192;

        const hitPoints: Vector3[] = [];
        const spreadRad = (spreadDeg * Math.PI) / 180;

        for (let i = 0; i < count; i++) {
            // Random direction within spread cone
            const dir = this.spreadDirection(cfg.direction, spreadRad);
            const hit = this.traceRay(cfg.origin, dir, range);
            const endpoint = hit?.point ?? cfg.origin.add(dir.scale(range));

            if (hit?.point) hitPoints.push(hit.point);

            // Short tracer per pellet (thinner, shorter-lived)
            const id = `pellet_${this.nextId++}`;
            const line = MeshBuilder.CreateLines(id, {
                points: [cfg.origin.clone(), endpoint.clone()],
                colors: [
                    new Color4(color.r, color.g, color.b, 0.6),
                    new Color4(color.r, color.g, color.b, 0.15),
                ],
            }, this.scene);
            line.isPickable = false;

            this.effects.push({
                id,
                meshes: [line],
                materials: [],
                light: null,
                spawnTime: performance.now() / 1000,
                duration,
            });

            // Small spark at each hit
            if (hit?.point) {
                this.spawnImpactFlash(hit.point, color, hit.normal, duration * 1.5);
                this.spawnWallMark(hit.point, hit.normal, color, 0.2);
            }
        }

        return hitPoints;
    }

    /**
     * Bolt / rail trail  (electrobolt, instagun)
     * Thick persistent beam with optional spiral decoration.
     */
    fireBolt(cfg: BoltConfig): Vector3 | null {
        if (!this.scene) return null;
        const range = cfg.maxRange ?? 8192;
        const color = cfg.color ?? new Color3(0.3, 0.6, 1.0); // electric blue
        const duration = cfg.duration ?? 0.4;
        const width = cfg.width ?? 0.35;

        const hit = this.traceRay(cfg.origin, cfg.direction, range);
        const endpoint = hit?.point ?? cfg.origin.add(cfg.direction.scale(range));

        const id = `bolt_${this.nextId++}`;
        const meshes: Mesh[] = [];

        // Core beam (thick cylinder)
        const core = MeshBuilder.CreateCylinder(`${id}_core`, {
            height: 1,
            diameterTop: width,
            diameterBottom: width,
            tessellation: 8,
        }, this.scene);
        core.isPickable = false;
        const coreMat = new StandardMaterial(`${id}_core_mat`, this.scene);
        coreMat.emissiveColor = color;
        coreMat.disableLighting = true;
        coreMat.alpha = 0.9;
        coreMat.backFaceCulling = false;
        core.material = coreMat;
        this.orientCylinder(core, cfg.origin, endpoint);
        meshes.push(core);

        // Outer glow (wider, more transparent)
        const glow = MeshBuilder.CreateCylinder(`${id}_glow`, {
            height: 1,
            diameterTop: width * 3,
            diameterBottom: width * 3,
            tessellation: 8,
        }, this.scene);
        glow.isPickable = false;
        const glowMat = new StandardMaterial(`${id}_glow_mat`, this.scene);
        glowMat.emissiveColor = color;
        glowMat.disableLighting = true;
        glowMat.alpha = 0.25;
        glowMat.backFaceCulling = false;
        glow.material = glowMat;
        this.orientCylinder(glow, cfg.origin, endpoint);
        meshes.push(glow);

        // Bright impact flash
        const impactLight = this.spawnImpactFlash(endpoint, color, hit?.normal, duration);

        this.effects.push({
            id,
            meshes,
            materials: [coreMat, glowMat],
            light: impactLight,
            spawnTime: performance.now() / 1000,
            duration,
        });

        // Leave a scorch mark at impact
        if (hit) {
            this.spawnWallMark(hit.point, hit.normal, color, 1.0);
        }

        return hit?.point ?? null;
    }

    // ── Update (call every frame) ────────────────────────────────────

    update(_deltaTime: number): void {
        const now = performance.now() / 1000;
        const toRemove: string[] = [];

        for (const fx of this.effects) {
            const age = now - fx.spawnTime;
            const t = Math.min(1, age / fx.duration);

            if (t >= 1) {
                toRemove.push(fx.id);
                continue;
            }

            // Fade out
            const fade = 1 - t;
            for (const mat of fx.materials) {
                mat.alpha = fade * 0.9;
            }
            // Lines can't have their alpha changed easily — just remove at expiry
            if (fx.light) {
                fx.light.intensity *= 0.85; // exponential decay
            }
        }

        // Fade wall marks
        for (let i = this.wallMarks.length - 1; i >= 0; i--) {
            const wm = this.wallMarks[i];
            const age = now - wm.spawnTime;
            if (age >= HitscanEffects.WALL_MARK_DURATION) {
                wm.mesh.dispose();
                wm.material.dispose();
                this.wallMarks.splice(i, 1);
            } else {
                wm.material.alpha = 1 - (age / HitscanEffects.WALL_MARK_DURATION);
            }
        }

        for (const id of toRemove) {
            const idx = this.effects.findIndex(e => e.id === id);
            if (idx !== -1) {
                const fx = this.effects[idx];
                for (const m of fx.meshes) m.dispose();
                for (const mat of fx.materials) mat.dispose();
                fx.light?.dispose();
                this.effects.splice(idx, 1);
            }
        }
    }

    /** Cleanup everything */
    clear(): void {
        for (const fx of this.effects) {
            for (const m of fx.meshes) m.dispose();
            for (const mat of fx.materials) mat.dispose();
            fx.light?.dispose();
        }
        this.effects = [];
        this.stopBeam();
    }

    // ── Private helpers ──────────────────────────────────────────────

    /** Raycast and return hit info (point + normal), or null */
    private traceRay(origin: Vector3, dir: Vector3, maxDist: number): { point: Vector3; normal: Vector3 } | null {
        if (!this.scene) return null;

        const ray = new Ray(origin, dir, maxDist);
        const hit = this.scene.pickWithRay(ray, (mesh) => {
            if (!mesh.isPickable) return false;
            if (mesh.name.startsWith('tracer_')) return false;
            if (mesh.name.startsWith('pellet_')) return false;
            if (mesh.name.startsWith('bolt_')) return false;
            if (mesh.name.startsWith('beam_')) return false;
            if (mesh.name.startsWith('proj_')) return false;
            if (mesh.name.startsWith('impact_')) return false;
            if (mesh.name.startsWith('wallmark_')) return false;
            return true;
        });

        if (hit?.hit && hit.pickedPoint) {
            const normal = hit.getNormal(true) ?? dir.scale(-1);
            return { point: hit.pickedPoint, normal };
        }
        return null;
    }

    /** Orient a unit-height cylinder between two points */
    private orientCylinder(cyl: Mesh, start: Vector3, end: Vector3): void {
        const diff = end.subtract(start);
        const dist = diff.length();
        const mid = start.add(diff.scale(0.5));

        cyl.position = mid;
        cyl.scaling.y = dist;

        // BJS cylinder extends along local Y — rotate so Y aligns with diff
        const dir = diff.normalize();
        const up = Vector3.Up();
        const dot = Vector3.Dot(up, dir);

        if (dot > 0.9999) {
            // Already aligned with Y-up
            cyl.rotationQuaternion = Quaternion.Identity();
        } else if (dot < -0.9999) {
            // Opposite to Y-up — rotate 180° around Z
            cyl.rotationQuaternion = Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.PI);
        } else {
            const cross = Vector3.Cross(up, dir).normalize();
            const angle = Math.acos(dot);
            cyl.rotationQuaternion = Quaternion.RotationAxis(cross, angle);
        }
    }

    /** Create a random direction within a cone (spread in radians) */
    private spreadDirection(dir: Vector3, spreadRad: number): Vector3 {
        // Random point in unit disk
        const r = Math.sqrt(Math.random()) * Math.tan(spreadRad);
        const theta = Math.random() * Math.PI * 2;
        const offsetX = r * Math.cos(theta);
        const offsetY = r * Math.sin(theta);

        // Build a coordinate frame around dir
        const forward = dir.normalize();
        let right: Vector3;
        if (Math.abs(forward.y) < 0.999) {
            right = Vector3.Cross(Vector3.Up(), forward).normalize();
        } else {
            right = Vector3.Cross(new Vector3(1, 0, 0), forward).normalize();
        }
        const up = Vector3.Cross(forward, right).normalize();

        return forward.add(right.scale(offsetX)).add(up.scale(offsetY)).normalize();
    }

    /** Spawn a small impact flash light + point, auto-cleaned up */
    private spawnImpactFlash(pos: Vector3, color: Color3, normal: Vector3 | undefined, _duration: number): PointLight | null {
        if (!this.scene) return null;

        // Offset slightly along normal to prevent Z-fighting
        const offset = normal ? normal.scale(0.05) : Vector3.Zero();

        const light = new PointLight(`impact_flash_${this.nextId++}`, pos.add(offset), this.scene);
        light.diffuse = color;
        light.intensity = 5;
        light.range = 12;

        // Impact light is cleaned up by the effect that owns it
        return light;
    }

    /**
     * Spawn a persistent wall mark (bullet hole / scorch) at a hit point.
     * Flat plane oriented to the wall normal, fades out over WALL_MARK_DURATION.
     */
    private spawnWallMark(position: Vector3, normal: Vector3, color: Color3, size: number): void {
        if (!this.scene) return;

        // Enforce pool limit — remove oldest
        while (this.wallMarks.length >= HitscanEffects.MAX_WALL_MARKS) {
            const oldest = this.wallMarks.shift()!;
            oldest.mesh.dispose();
            oldest.material.dispose();
        }

        const id = `wallmark_${this.nextId++}`;
        const mesh = MeshBuilder.CreatePlane(id, { size }, this.scene);
        mesh.isPickable = false;

        // Position slightly off the wall to avoid z-fighting
        mesh.position = position.add(normal.scale(0.05));

        // Orient plane to face along the wall normal
        const target = position.add(normal);
        mesh.lookAt(target);

        // Dark scorch material
        const mat = new StandardMaterial(`${id}_mat`, this.scene);
        mat.emissiveColor = new Color3(color.r * 0.3, color.g * 0.3, color.b * 0.3);
        mat.diffuseColor = Color3.Black();
        mat.alpha = 0.7;
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mesh.material = mat;

        this.wallMarks.push({
            mesh,
            material: mat,
            spawnTime: performance.now() / 1000,
        });
    }
}

// Convenience export
export function getHitscanEffects(): HitscanEffects {
    return HitscanEffects.getInstance();
}
