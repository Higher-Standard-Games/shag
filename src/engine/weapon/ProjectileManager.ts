/**
 * ProjectileManager - Manages active projectiles in the scene
 * 
 * Handles spawning, updating, and despawning of client-side projectiles.
 * These are predicted/visual projectiles - server has authoritative versions.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { getEntityRegistry, ProjectileDef } from '../../shared/entities';
import { getMD3Loader, MD3LoadResult } from '../loader/model/MD3Loader';
import { PK3Loader } from '../loader/pk3/PK3Loader';

interface ActiveProjectile {
    id: string;
    defId: string;
    node: TransformNode;
    light: PointLight | null;
    direction: Vector3;
    speed: number;
    spawnTime: number;
    lifetime: number;
}

interface ActiveImpact {
    id: string;
    mesh: Mesh;
    material: StandardMaterial;
    light: PointLight;
    spawnTime: number;
    duration: number;
}

export class ProjectileManager {
    private static instance: ProjectileManager;
    private scene: Scene | null = null;
    private projectiles: ActiveProjectile[] = [];
    private impacts: ActiveImpact[] = [];
    private nextId: number = 0;

    // Cache loaded projectile models for cloning
    private modelCache: Map<string, MD3LoadResult> = new Map();

    private constructor() { }

    public static getInstance(): ProjectileManager {
        if (!ProjectileManager.instance) {
            ProjectileManager.instance = new ProjectileManager();
        }
        return ProjectileManager.instance;
    }

    public init(scene: Scene): void {
        this.scene = scene;
        console.log('[ProjectileManager] Initialized');
    }

    /**
     * Preload a projectile model (call during init for instant spawning)
     */
    public async preloadModel(defId: string): Promise<boolean> {
        if (!this.scene) return false;

        const registry = getEntityRegistry();
        const def = registry.get<ProjectileDef>(defId);
        if (!def?.modelPath) return false;

        // Check if already cached
        if (this.modelCache.has(defId)) return true;

        const pk3 = PK3Loader.getInstance();
        const md3Loader = getMD3Loader();

        try {
            const modelData = await pk3.getFile(def.modelPath);
            if (!modelData) {
                console.warn(`[ProjectileManager] Model not found: ${def.modelPath}`);
                return false;
            }

            // Parse then create meshes
            const parsed = md3Loader.parseMD3(modelData);
            const model = md3Loader.createMeshes(parsed, def.id);
            if (model) {
                // Hide the template
                model.root.setEnabled(false);
                this.modelCache.set(defId, model);
                console.log(`[ProjectileManager] Cached model: ${defId}`);
                return true;
            }
        } catch (e) {
            console.error(`[ProjectileManager] Failed to load model: ${def.modelPath}`, e);
        }

        return false;
    }

    /**
     * Spawn a projectile
     * @param defId - Projectile definition ID (e.g., "plasma_bolt")
     * @param origin - Starting position
     * @param direction - Direction (normalized)
     */
    public spawn(defId: string, origin: Vector3, direction: Vector3): string | null {
        if (!this.scene) {
            console.error('[ProjectileManager] Not initialized');
            return null;
        }

        const registry = getEntityRegistry();
        const def = registry.get<ProjectileDef>(defId);
        if (!def) {
            console.warn(`[ProjectileManager] Unknown projectile: ${defId}`);
            return null;
        }

        const id = `proj_${this.nextId++}`;
        const color = def.lightColor ?? { r: 1, g: 1, b: 1 };

        // Create projectile node
        const node = new TransformNode(id, this.scene);
        node.position = origin.clone();

        // Try to use cached model, fallback to sphere
        const cachedModel = this.modelCache.get(defId);
        if (cachedModel) {
            // Clone the cached model meshes
            for (const mesh of cachedModel.meshes) {
                const clone = mesh.clone(`${id}_${mesh.name}`, node);
                if (clone) {
                    clone.isPickable = false;
                    // Apply glowing material
                    const mat = new StandardMaterial(`${id}_mat`, this.scene);
                    mat.emissiveColor = new Color3(color.r, color.g, color.b);
                    mat.diffuseColor = new Color3(color.r * 0.3, color.g * 0.3, color.b * 0.3);
                    mat.disableLighting = true;
                    clone.material = mat;
                }
            }
            // Apply scale from def
            const scale = def.scale ?? 1.0;
            node.scaling.setAll(scale);
        } else {
            // Fallback: simple glowing sphere
            const mesh = MeshBuilder.CreateSphere(`${id}_mesh`, { diameter: 0.5 }, this.scene);
            mesh.parent = node;
            mesh.isPickable = false;

            const mat = new StandardMaterial(`${id}_mat`, this.scene);
            mat.emissiveColor = new Color3(color.r, color.g, color.b);
            mat.diffuseColor = new Color3(color.r * 0.5, color.g * 0.5, color.b * 0.5);
            mat.disableLighting = true;
            mesh.material = mat;
        }

        // Make projectile face direction of travel
        // Calculate rotation to face direction
        const forward = direction.normalize();
        node.lookAt(node.position.add(forward));

        // Create dynamic light
        let light: PointLight | null = null;
        if (def.lightIntensity && def.lightIntensity > 0) {
            light = new PointLight(`${id}_light`, origin.clone(), this.scene);
            light.diffuse = new Color3(color.r, color.g, color.b);
            light.specular = new Color3(color.r * 0.3, color.g * 0.3, color.b * 0.3);
            light.intensity = def.lightIntensity;
            light.range = def.lightRange ?? 20;
            light.parent = node;
        }

        const projectile: ActiveProjectile = {
            id,
            defId,
            node,
            light,
            direction: direction.normalize(),
            speed: def.speed,
            spawnTime: performance.now() / 1000,
            lifetime: def.lifetime,
        };

        this.projectiles.push(projectile);
        console.log(`[ProjectileManager] Spawned ${defId} (${id})`);

        return id;
    }

    /**
     * Update all projectiles
     */
    public update(deltaTime: number): void {
        if (!this.scene) return;

        const now = performance.now() / 1000;
        const toRemove: string[] = [];

        for (const proj of this.projectiles) {
            // Check lifetime
            const age = now - proj.spawnTime;
            if (age > proj.lifetime) {
                toRemove.push(proj.id);
                continue;
            }

            // Calculate move amount
            const moveAmount = proj.direction.scale(proj.speed * deltaTime);
            const nextPos = proj.node.position.add(moveAmount);

            // Raycast to check for collision
            const ray = new Ray(proj.node.position, proj.direction, moveAmount.length() + 1);
            const hit = this.scene.pickWithRay(ray, (mesh) => {
                // Ignore projectile meshes and non-pickable
                if (!mesh.isPickable) return false;
                if (mesh.name.startsWith('proj_')) return false;
                return true;
            });

            if (hit && hit.hit && hit.pickedPoint) {
                // HIT! Spawn impact effect
                this.spawnImpact(proj.defId, hit.pickedPoint, hit.getNormal(true) ?? proj.direction.scale(-1));
                toRemove.push(proj.id);
                continue;
            }

            // No hit, move projectile
            proj.node.position = nextPos;
        }

        // Remove projectiles that hit or expired
        for (const id of toRemove) {
            this.despawn(id);
        }

        // Update impacts (fade out)
        this.updateImpacts(deltaTime);
    }

    /**
     * Spawn impact effect at hit point
     */
    private spawnImpact(projDefId: string, position: Vector3, normal: Vector3): void {
        if (!this.scene) return;

        const registry = getEntityRegistry();
        const def = registry.get<ProjectileDef>(projDefId);
        const color = def?.lightColor ?? { r: 1, g: 0.8, b: 0.3 };

        const id = `impact_${this.nextId++}`;

        // Create impact flash (sphere that fades)
        const mesh = MeshBuilder.CreateSphere(`${id}_mesh`, { diameter: 1.5 }, this.scene);
        mesh.position = position.add(normal.scale(0.1));  // Slightly off wall

        const mat = new StandardMaterial(`${id}_mat`, this.scene);
        mat.emissiveColor = new Color3(color.r, color.g, color.b);
        mat.diffuseColor = Color3.Black();
        mat.alpha = 1.0;
        mat.disableLighting = true;
        mesh.material = mat;

        // Create bright flash light
        const light = new PointLight(`${id}_light`, position, this.scene);
        light.diffuse = new Color3(color.r, color.g, color.b);
        light.intensity = 10;
        light.range = 30;

        // Store for fade out
        this.impacts.push({
            id,
            mesh,
            material: mat,
            light,
            spawnTime: performance.now() / 1000,
            duration: 0.15,  // 150ms flash
        });
    }

    /**
     * Update impact effects (fade out and despawn)
     */
    private updateImpacts(_deltaTime: number): void {
        const now = performance.now() / 1000;
        const toRemove: string[] = [];

        for (const impact of this.impacts) {
            const age = now - impact.spawnTime;
            const progress = Math.min(1, age / impact.duration);

            if (progress >= 1) {
                toRemove.push(impact.id);
                continue;
            }

            // Fade out
            const fade = 1 - progress;
            impact.material.alpha = fade;
            impact.light.intensity = 10 * fade;

            // Scale up slightly for explosion feel
            const scale = 1 + progress * 0.5;
            impact.mesh.scaling.setAll(scale);
        }

        // Remove finished impacts
        for (const id of toRemove) {
            const index = this.impacts.findIndex(i => i.id === id);
            if (index !== -1) {
                const impact = this.impacts[index];
                impact.mesh.dispose();
                impact.material.dispose();
                impact.light.dispose();
                this.impacts.splice(index, 1);
            }
        }
    }

    /**
     * Despawn a projectile
     */
    public despawn(id: string): void {
        const index = this.projectiles.findIndex(p => p.id === id);
        if (index === -1) return;

        const proj = this.projectiles[index];

        // Cleanup
        proj.light?.dispose();
        proj.node.dispose();

        this.projectiles.splice(index, 1);
        // console.log(`[ProjectileManager] Despawned ${id}`);
    }

    /**
     * Get active projectile count
     */
    public getCount(): number {
        return this.projectiles.length;
    }

    /**
     * Clear all projectiles
     */
    public clear(): void {
        for (const proj of this.projectiles) {
            proj.light?.dispose();
            proj.node.dispose();
        }
        this.projectiles = [];
    }
}

// Convenience function
export function getProjectileManager(): ProjectileManager {
    return ProjectileManager.getInstance();
}
