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
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
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
    // Cache projectile model textures
    private modelTextureCache: Map<string, string> = new Map();  // defId -> url
    // Cache sprite textures
    private spriteCache: Map<string, string> = new Map();  // defId -> url
    // Cache impact models
    private impactModelCache: Map<string, MD3LoadResult> = new Map();
    private impactTextureCache: Map<string, string> = new Map();

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
        if (!def?.modelPath) {
            console.warn(`[ProjectileManager] No modelPath for: ${defId}`);
            return false;
        }

        const pk3 = PK3Loader.getInstance();
        const path = def.modelPath;
        console.log(`[ProjectileManager] Preloading ${defId} - path: ${path}`);

        // Check if sprite texture (.tga/.jpg/.png) or model (.md3)
        const isSprite = path.endsWith('.tga') || path.endsWith('.jpg') || path.endsWith('.png');
        console.log(`[ProjectileManager] isSprite: ${isSprite}`);

        if (isSprite) {
            // Check if already cached
            if (this.spriteCache.has(defId)) return true;

            try {
                console.log(`[ProjectileManager] Loading sprite from: ${path}`);
                const textureUrl = await pk3.getFileAsURL(path, 'image/png');
                console.log(`[ProjectileManager] Got URL: ${textureUrl ? 'yes' : 'no'}`);
                if (textureUrl) {
                    this.spriteCache.set(defId, textureUrl);
                    console.log(`[ProjectileManager] Cached sprite: ${defId}`);
                    return true;
                } else {
                    console.warn(`[ProjectileManager] No texture URL returned for: ${path}`);
                }
            } catch (e) {
                console.warn(`[ProjectileManager] Failed to load sprite: ${path}`, e);
            }
        } else {
            // MD3 model
            if (this.modelCache.has(defId)) return true;

            const md3Loader = getMD3Loader();
            try {
                const modelData = await pk3.getFile(path);
                if (!modelData) {
                    console.warn(`[ProjectileManager] Model not found: ${path}`);
                    return false;
                }

                const parsed = md3Loader.parseMD3(modelData);
                const model = md3Loader.createMeshes(parsed, def.id);
                if (model) {
                    model.root.setEnabled(false);
                    this.modelCache.set(defId, model);
                    console.log(`[ProjectileManager] Cached model: ${defId}`);

                    // Try to load texture from same folder as model
                    const texturePath = path.replace('.md3', '.tga');
                    if (pk3.hasFile(texturePath)) {
                        const textureUrl = await pk3.getFileAsURL(texturePath, 'image/png');
                        if (textureUrl) {
                            this.modelTextureCache.set(defId, textureUrl);
                            console.log(`[ProjectileManager] Cached model texture: ${defId}`);
                        }
                    }
                }
            } catch (e) {
                console.error(`[ProjectileManager] Failed to load model: ${path}`, e);
            }
        }

        // Also load impact model if defined
        if (def.impactModelPath) {
            if (!this.impactModelCache.has(defId)) {
                try {
                    const md3Loader = getMD3Loader();
                    const impactData = await pk3.getFile(def.impactModelPath);
                    if (impactData) {
                        const parsed = md3Loader.parseMD3(impactData);
                        const model = md3Loader.createMeshes(parsed, `${def.id}_impact`);
                        if (model) {
                            model.root.setEnabled(false);
                            this.impactModelCache.set(defId, model);
                            console.log(`[ProjectileManager] Cached impact model: ${defId}`);
                        }
                    }
                } catch (e) {
                    console.warn(`[ProjectileManager] Failed to load impact model: ${def.impactModelPath}`, e);
                }
            }
        }

        // Load impact texture
        if (def.impactTexturePath && !this.impactTextureCache.has(defId)) {
            try {
                const textureUrl = await pk3.getFileAsURL(def.impactTexturePath, 'image/png');
                if (textureUrl) {
                    this.impactTextureCache.set(defId, textureUrl);
                    console.log(`[ProjectileManager] Cached impact texture: ${defId}`);
                }
            } catch (e) {
                console.warn(`[ProjectileManager] Failed to load impact texture: ${def.impactTexturePath}`, e);
            }
        }

        return true;
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

        // Try cached sprite, then cached model, then fallback to sphere
        const cachedSprite = this.spriteCache.get(defId);
        const cachedModel = this.modelCache.get(defId);

        if (cachedSprite) {
            // Create billboard plane with sprite texture
            const size = def.scale ?? 1.5;
            const mesh = MeshBuilder.CreatePlane(`${id}_mesh`, { size }, this.scene);
            mesh.parent = node;
            mesh.isPickable = false;
            mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;  // Always face camera

            const mat = new StandardMaterial(`${id}_mat`, this.scene);
            mat.diffuseTexture = new Texture(cachedSprite, this.scene);
            mat.diffuseTexture.hasAlpha = true;
            mat.useAlphaFromDiffuseTexture = true;
            mat.emissiveColor = new Color3(color.r, color.g, color.b);
            mat.disableLighting = true;
            mat.backFaceCulling = false;
            mesh.material = mat;
        } else if (cachedModel) {
            // Clone the cached model meshes
            const cachedTexture = this.modelTextureCache.get(defId);
            for (const mesh of cachedModel.meshes) {
                const clone = mesh.clone(`${id}_${mesh.name}`, node);
                if (clone) {
                    clone.isPickable = false;
                    // Apply textured material if we have a texture, fallback to emissive
                    const mat = new StandardMaterial(`${id}_mat`, this.scene);
                    if (cachedTexture) {
                        mat.diffuseTexture = new Texture(cachedTexture, this.scene);
                        mat.diffuseTexture.hasAlpha = true;
                        mat.useAlphaFromDiffuseTexture = true;
                    }
                    mat.emissiveColor = new Color3(color.r, color.g, color.b);
                    mat.disableLighting = true;
                    mat.backFaceCulling = false;
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
        const duration = def?.impactDuration ?? 0.2;
        const scale = def?.impactScale ?? 1.5;

        const id = `impact_${this.nextId++}`;
        let mesh: Mesh;
        let mat: StandardMaterial;

        // Try to use cached impact model
        const cachedModel = this.impactModelCache.get(projDefId);
        const cachedTexture = this.impactTextureCache.get(projDefId);

        if (cachedModel && cachedModel.meshes.length > 0) {
            // Clone the impact model
            const sourceMesh = cachedModel.meshes[0];
            const clone = sourceMesh.clone(`${id}_mesh`, null);
            if (clone) {
                mesh = clone;
                mesh.position = position.add(normal.scale(0.1));
                mesh.isPickable = false;

                // Apply texture if available, with emissive glow
                mat = new StandardMaterial(`${id}_mat`, this.scene);
                if (cachedTexture) {
                    mat.diffuseTexture = new Texture(cachedTexture, this.scene);
                    mat.diffuseTexture.hasAlpha = true;
                    mat.useAlphaFromDiffuseTexture = true;
                }
                mat.emissiveColor = new Color3(color.r, color.g, color.b);
                mat.disableLighting = true;
                mat.backFaceCulling = false;
                mesh.material = mat;

                // Scale
                mesh.scaling.setAll(scale);

                // Orient to face away from wall (along normal)
                const up = Vector3.Up();
                if (Math.abs(Vector3.Dot(normal, up)) > 0.9) {
                    mesh.lookAt(position.add(normal), 0, 0, Math.PI);
                } else {
                    mesh.lookAt(position.add(normal));
                }
            } else {
                // Fallback
                mesh = MeshBuilder.CreateSphere(`${id}_mesh`, { diameter: 1.5 }, this.scene);
                mesh.position = position.add(normal.scale(0.1));
                mat = new StandardMaterial(`${id}_mat`, this.scene);
                mat.emissiveColor = new Color3(color.r, color.g, color.b);
                mat.disableLighting = true;
                mesh.material = mat;
            }
        } else {
            // Fallback: simple glowing sphere
            mesh = MeshBuilder.CreateSphere(`${id}_mesh`, { diameter: 1.5 }, this.scene);
            mesh.position = position.add(normal.scale(0.1));

            mat = new StandardMaterial(`${id}_mat`, this.scene);
            mat.emissiveColor = new Color3(color.r, color.g, color.b);
            mat.diffuseColor = Color3.Black();
            mat.alpha = 1.0;
            mat.disableLighting = true;
            mesh.material = mat;
        }

        // Create bright flash light
        const light = new PointLight(`${id}_light`, position, this.scene);
        light.diffuse = new Color3(color.r, color.g, color.b);
        light.intensity = 10;
        light.range = 30;

        // Store for fade out
        this.impacts.push({
            id,
            mesh,
            material: mat!,
            light,
            spawnTime: performance.now() / 1000,
            duration,
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
