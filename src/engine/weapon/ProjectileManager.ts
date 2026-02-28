/**
 * ProjectileManager - Manages active projectiles in the scene
 * 
 * Handles spawning, updating, and despawning of client-side projectiles.
 * These are predicted/visual projectiles - server has authoritative versions.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { getEntityRegistry, ProjectileDef } from '../../shared/entities';
import { getMD3Loader, MD3LoadResult } from '../loader/model/MD3Loader';
import { PK3Loader } from '../loader/pk3/PK3Loader';
import { getExplosionEffect, ROCKET_EXPLOSION, GRENADE_EXPLOSION, PLASMA_EXPLOSION } from './ExplosionEffect';

interface ActiveProjectile {
    id: string;
    defId: string;
    node: TransformNode;
    light: PointLight | null;
    direction: Vector3;
    speed: number;
    velocity: Vector3;       // Full velocity vector (modified by gravity)
    gravity: number;         // 0 = none, 1 = full (800 u/s²)
    bouncesLeft: number;     // Remaining bounces before explode
    bounceFactor: number;    // Velocity retention on bounce (0.65)
    spawnTime: number;
    lifetime: number;
    materials: StandardMaterial[]; // For fade-in effect
    trailPoints: Vector3[];      // Position history for trail rendering
    trailMesh: LinesMesh | null;      // Current trail line mesh
    trailMaterial: StandardMaterial | null; // Trail material for disposal
    isLocalPrediction: boolean;  // If true, silently despawn on hit (no explosion)
    isServerDriven: boolean;     // If true, position comes from server snapshots (no client raycast)
    serverEntityId?: string;     // Server entity ID (e.g. 'proj_10001') for linking
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

    // Track predicted projectile impacts for deduplication with server events
    private recentPredictedImpacts: Array<{
        pos: Vector3;
        time: number;
        defId: string;
    }> = [];

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

    /**
     * Check if a predicted explosion was recently shown near the given position.
     * Used by FPSGameManager to deduplicate server-authoritative explosions
     * against client-predicted ones.
     */
    public hasRecentPrediction(pos: Vector3, defId: string, tolerance = 50, maxAgeMs = 500): boolean {
        const now = performance.now();
        for (let i = this.recentPredictedImpacts.length - 1; i >= 0; i--) {
            const p = this.recentPredictedImpacts[i];
            if (p.defId === defId &&
                now - p.time < maxAgeMs &&
                Vector3.Distance(p.pos, pos) < tolerance) {
                // Consume the prediction (one server event per prediction)
                this.recentPredictedImpacts.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    public init(scene: Scene): void {
        this.scene = scene;
        getExplosionEffect().init(scene);
        console.log('[ProjectileManager] Initialized');
    }

    // ═══════════════════════════════════════════════════════════════
    // SERVER-DRIVEN PROJECTILE API
    // ═══════════════════════════════════════════════════════════════

    /**
     * Spawn a server-driven projectile visual.
     * Position will be updated from server snapshots.
     */
    public spawnFromServer(
        serverEntityId: string,
        defId: string,
        position: Vector3,
        velocity: Vector3
    ): string | null {
        // Map weapon defId → projectile defId
        const projDefId = defId === 'glauncher' ? 'grenade'
            : defId === 'plasmagun' ? 'plasma_bolt'
                : defId === 'rlauncher' ? 'rocket'
                    : defId === 'gunblade' ? 'gunblade_blast'
                        : 'rocket';

        const direction = velocity.normalizeToNew();
        const id = this.spawn(projDefId, position, direction, {
            isLocalPrediction: false,
            isServerDriven: true,
            serverEntityId,
            velocityOverride: velocity,
        });
        return id;
    }

    /**
     * Update a server-driven projectile's position from interpolated snapshot data.
     * Called every frame by FPSGameManager.renderServerProjectiles() with
     * SnapshotBuffer-interpolated positions (Q3-style lerp between snapshots).
     */
    public updateServerPosition(
        serverEntityId: string,
        position: Vector3,
        velocity: Vector3
    ): void {
        const proj = this.projectiles.find(p => p.serverEntityId === serverEntityId);
        if (!proj) return;
        proj.node.position.copyFrom(position);
        proj.velocity.copyFrom(velocity);
        if (velocity.lengthSquared() > 0.01) {
            proj.direction = velocity.normalizeToNew();
        }
        proj.speed = velocity.length();
    }

    /**
     * Despawn a server-driven projectile by its server entity ID.
     */
    public despawnByEntityId(serverEntityId: string): void {
        const proj = this.projectiles.find(p => p.serverEntityId === serverEntityId);
        if (proj) {
            this.despawn(proj.id);
        }
    }

    /**
     * Check if a server-driven projectile exists.
     */
    public hasServerProjectile(serverEntityId: string): boolean {
        return this.projectiles.some(p => p.serverEntityId === serverEntityId);
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

                    // Try to load texture - first check explicit texturePaths from def
                    let textureUrl: string | null = null;

                    if (def.texturePaths && def.texturePaths.length > 0) {
                        // Use explicit texture path from definition
                        const explicitPath = def.texturePaths[0];
                        console.log(`[ProjectileManager] Using explicit texture: ${explicitPath}`);
                        if (pk3.hasFile(explicitPath)) {
                            textureUrl = await pk3.getFileAsURL(explicitPath, 'image/png');
                        } else {
                            console.warn(`[ProjectileManager] Explicit texture not found: ${explicitPath}`);
                        }
                    } else {
                        // Auto-detect: try same name with .tga extension
                        const autoTexturePath = path.replace('.md3', '.tga');
                        console.log(`[ProjectileManager] Auto-detecting texture: ${autoTexturePath}`);
                        if (pk3.hasFile(autoTexturePath)) {
                            textureUrl = await pk3.getFileAsURL(autoTexturePath, 'image/png');
                        }
                    }

                    if (textureUrl) {
                        this.modelTextureCache.set(defId, textureUrl);
                        console.log(`[ProjectileManager] Cached model texture: ${defId}`);
                    } else {
                        console.warn(`[ProjectileManager] No texture found for: ${defId}`);
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
    public spawn(defId: string, origin: Vector3, direction: Vector3, opts?: {
        isLocalPrediction?: boolean;
        isServerDriven?: boolean;
        serverEntityId?: string;
        velocityOverride?: Vector3;
    }): string | null {
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

                    // If the source mesh has a material, reuse it (it might be a complex shader material from MD3Loader)
                    if (mesh.material) {
                        clone.material = mesh.material;
                    } else {
                        // Only create fallback material if none exists
                        const mat = new StandardMaterial(`${id}_mat`, this.scene);
                        if (cachedTexture) {
                            mat.diffuseTexture = new Texture(cachedTexture, this.scene);
                            mat.diffuseTexture.hasAlpha = true;
                            mat.useAlphaFromDiffuseTexture = true;
                            // For additive/projectile usage, ensure it glows
                            mat.emissiveTexture = mat.diffuseTexture;
                        }
                        mat.emissiveColor = new Color3(color.r, color.g, color.b);
                        mat.disableLighting = true;
                        mat.backFaceCulling = false;
                        clone.material = mat;
                    }
                }
            }
            // Apply scale from def
            const scale = def.scale ?? 1.0;
            node.scaling.setAll(scale);
        } else {
            console.warn(`[ProjectileManager] Failed to spawn projectile ${defId}: No cached model or sprite`);
            // Fallback: simple glowing sphere - REMOVED per user request (was causing "blue dot" artifact)
            // const mesh = MeshBuilder.CreateSphere(`${id}_mesh`, { diameter: 0.5 }, this.scene);
            // mesh.parent = node;
            // mesh.isPickable = false;

            // const mat = new StandardMaterial(`${id}_mat`, this.scene);
            // mat.emissiveColor = new Color3(color.r, color.g, color.b);
            // mat.diffuseColor = new Color3(color.r * 0.5, color.g * 0.5, color.b * 0.5);
            // mat.disableLighting = true;
            // mesh.material = mat;
        }

        // Orient projectile to face direction of travel
        // MD3 models point along +Z in Babylon (after coord conversion)
        // We need to rotate to align the model's forward (+Z) with the direction vector
        const forward = direction.normalize();

        // Create a rotation that aligns +Z axis with forward direction
        // We need to compute a rotation from default forward (0,0,1) to our direction
        const defaultForward = new Vector3(0, 0, 1);

        // Use cross product to get axis, and dot product for angle
        const dot = Vector3.Dot(defaultForward, forward);

        if (dot > 0.9999) {
            // Nearly aligned, no rotation needed
            node.rotationQuaternion = Quaternion.Identity();
        } else if (dot < -0.9999) {
            // Opposite direction, rotate 180 around Y
            node.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
        } else {
            // General case: compute rotation axis and angle
            const axis = Vector3.Cross(defaultForward, forward).normalize();
            const angle = Math.acos(dot);
            node.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
        }

        // Apply additional -90° Y rotation for MD3 model alignment
        // MD3 projectile models typically face +Y in Quake coords
        const yRotation = Quaternion.RotationAxis(Vector3.Up(), -Math.PI / 2);
        if (node.rotationQuaternion) {
            node.rotationQuaternion = node.rotationQuaternion.multiply(yRotation);
        }

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

        // Collect all materials from child meshes for fade-in effect
        const materials: StandardMaterial[] = [];
        const meshes = node.getChildMeshes();
        for (const mesh of meshes) {
            if (mesh.material && mesh.material instanceof StandardMaterial) {
                materials.push(mesh.material);
                // Start fully transparent for fade-in
                mesh.material.alpha = 0;
            }
        }

        const normalDir = direction.normalize();
        const projectile: ActiveProjectile = {
            id,
            defId,
            node,
            light,
            direction: normalDir,
            speed: def.speed,
            velocity: opts?.velocityOverride ? opts.velocityOverride.clone() : normalDir.scale(def.speed),
            gravity: def.gravity ?? 0,
            bouncesLeft: def.bounces ?? 0,
            bounceFactor: 0.65,
            spawnTime: performance.now() / 1000,
            lifetime: def.lifetime,
            materials,
            trailPoints: [],
            trailMesh: null,
            trailMaterial: null,
            isLocalPrediction: opts?.isLocalPrediction ?? false,
            isServerDriven: opts?.isServerDriven ?? false,
            serverEntityId: opts?.serverEntityId,
        };

        this.projectiles.push(projectile);

        // Exclude projectile from cel outline depth pass (prevents black blob outlines)
        if (!node.metadata) node.metadata = {};
        node.metadata.celOutlineExclude = true;
        // Also tag all child meshes
        for (const child of node.getChildMeshes()) {
            if (!child.metadata) child.metadata = {};
            child.metadata.celOutlineExclude = true;
        }

        console.log(`[ProjectileManager] Spawned ${defId} (${id}) with ${materials.length} materials for fade-in`);

        return id;
    }

    // Gravity constant (Quake-style: ~800 units/s²)
    private static readonly GRAVITY = 800;

    /**
     * Update all projectiles
     */
    public update(deltaTime: number): void {
        if (!this.scene) return;

        // Cleanup stale predicted impacts (older than 1s)
        const cleanupTime = performance.now() - 1000;
        this.recentPredictedImpacts = this.recentPredictedImpacts.filter(p => p.time > cleanupTime);

        const now = performance.now() / 1000;
        const toRemove: string[] = [];

        for (const proj of this.projectiles) {
            // Check lifetime — but skip for server-driven projectiles, whose lifecycle
            // is controlled by snapshots (despawnByEntityId when entity disappears)
            const age = now - proj.spawnTime;
            if (age > proj.lifetime && !proj.isServerDriven) {
                // Grenades explode at end of lifetime — but only show client-predicted explosion
                // for non-server-driven projectiles. Server-driven ones get their explosion
                // from the authoritative projectile_impact event at the correct position.
                if (proj.gravity > 0 && !proj.isLocalPrediction) {
                    this.spawnImpact(proj.defId, proj.node.position.clone(), Vector3.Up());
                }
                toRemove.push(proj.id);
                continue;
            }

            // Fade-in effect: 0 -> 1 over 100ms
            const fadeInDuration = 0.1; // 100ms
            if (age < fadeInDuration && proj.materials.length > 0) {
                const alpha = Math.min(1.0, age / fadeInDuration);
                for (const mat of proj.materials) {
                    mat.alpha = alpha;
                }
            } else if (proj.materials.length > 0 && proj.materials[0].alpha < 1.0) {
                for (const mat of proj.materials) {
                    mat.alpha = 1.0;
                }
            }

            // Apply gravity to velocity
            if (proj.gravity > 0) {
                proj.velocity.y -= ProjectileManager.GRAVITY * proj.gravity * deltaTime;
            }

            // Calculate move amount from velocity
            const moveAmount = proj.velocity.scale(deltaTime);
            const moveDir = proj.velocity.normalizeToNew();
            const moveDist = moveAmount.length();

            // Server-driven projectiles: position is set externally by
            // FPSGameManager.renderServerProjectiles() using SnapshotBuffer interpolation.
            // No client-side movement or collision needed — but still update visual effects.
            if (proj.isServerDriven) {
                // Re-orient model to face direction of travel (gravity arcs)
                if (proj.gravity > 0 && proj.velocity.lengthSquared() > 0.01) {
                    const dir = proj.velocity.normalizeToNew();
                    proj.direction = dir;
                    const defaultFwd = new Vector3(0, 0, 1);
                    const dot = Vector3.Dot(defaultFwd, dir);
                    if (dot > 0.9999) {
                        proj.node.rotationQuaternion = Quaternion.Identity();
                    } else if (dot < -0.9999) {
                        proj.node.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
                    } else {
                        const axis = Vector3.Cross(defaultFwd, dir).normalize();
                        const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
                        proj.node.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
                    }
                    // MD3 alignment correction
                    const yRot = Quaternion.RotationAxis(Vector3.Up(), -Math.PI / 2);
                    if (proj.node.rotationQuaternion) {
                        proj.node.rotationQuaternion = proj.node.rotationQuaternion.multiply(yRot);
                    }
                }
                // Update trail effect (for projectiles with trailEffect defined)
                const trailDef = getEntityRegistry().get<ProjectileDef>(proj.defId);
                if (trailDef?.trailEffect) {
                    this.updateTrail(proj);
                }
                continue;
            }

            // Client-side collision check (only for local predictions / non-server projectiles)
            const ray = new Ray(proj.node.position, moveDir, moveDist + 1);
            const hit = this.scene.pickWithRay(ray, (mesh) => {
                if (!mesh.isPickable) return false;
                if (mesh.name.startsWith('proj_')) return false;
                if (mesh.name.startsWith('impact_')) return false;

                // Skip non-solid meshes (light halos, flares, billboards, effects)
                const name = mesh.name.toLowerCase();
                if (name.includes('flare') || name.includes('halo') || name.includes('glow') ||
                    name.includes('billboard') || name.includes('sprite') || name.includes('particle') ||
                    name.includes('effect') || name.includes('light_')) {
                    return false;
                }

                // Skip by texture name patterns
                const textureName = (mesh.metadata?.textureName || '').toLowerCase();
                if (textureName.includes('flare') || textureName.includes('halo') ||
                    textureName.includes('glow') || textureName.includes('flareshader') ||
                    textureName.includes('lights/') || textureName.includes('sfx/')) {
                    return false;
                }

                // Skip meshes with additive blending (light effects)
                const material = mesh.material;
                if (material) {
                    if ((material as any).alphaMode === 1 || (material as any).alphaMode === 2) return false;
                    if ((material as any).alpha !== undefined && (material as any).alpha < 0.5) return false;
                }

                // Skip billboard faces (faceType 4 in BSP)
                if (mesh.metadata?.faceType === 4) return false;

                return true;
            });

            if (hit && hit.hit && hit.pickedPoint) {
                const normal = hit.getNormal(true) ?? moveDir.scale(-1);

                if (proj.bouncesLeft > 0) {
                    // BOUNCE: reflect velocity off surface normal
                    proj.bouncesLeft--;
                    const velDotN = Vector3.Dot(proj.velocity, normal);
                    // Reflect: v' = v - 2(v·n)n, then scale by bounce factor
                    proj.velocity = proj.velocity.subtract(normal.scale(2 * velDotN)).scale(proj.bounceFactor);
                    proj.direction = proj.velocity.normalizeToNew();
                    proj.speed = proj.velocity.length();

                    // Move to hit point + small offset along normal
                    proj.node.position = hit.pickedPoint.add(normal.scale(1.0));

                    // Small bounce spark
                    this.spawnBounceEffect(hit.pickedPoint, normal);
                } else {
                    // No bounces left — full impact
                    if (!proj.isLocalPrediction) {
                        // Non-predicted projectile (remote player): show explosion
                        this.spawnImpact(proj.defId, hit.pickedPoint, normal);
                    }
                    // Local predictions silently despawn — server event handles explosion
                    toRemove.push(proj.id);
                }
                continue;
            }

            // No hit, move projectile
            proj.node.position.addInPlace(moveAmount);

            // Update direction for model orientation (gravity changes trajectory)
            if (proj.gravity > 0) {
                proj.direction = moveDir;
                // Re-orient model to face direction of travel
                const defaultFwd = new Vector3(0, 0, 1);
                const dot = Vector3.Dot(defaultFwd, moveDir);
                if (dot > 0.9999) {
                    proj.node.rotationQuaternion = Quaternion.Identity();
                } else if (dot < -0.9999) {
                    proj.node.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
                } else {
                    const axis = Vector3.Cross(defaultFwd, moveDir).normalize();
                    const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
                    proj.node.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
                }
                // MD3 alignment correction
                const yRot = Quaternion.RotationAxis(Vector3.Up(), -Math.PI / 2);
                if (proj.node.rotationQuaternion) {
                    proj.node.rotationQuaternion = proj.node.rotationQuaternion.multiply(yRot);
                }
            }

            // Update trail for projectiles with trailEffect defined
            const trailDef = getEntityRegistry().get<ProjectileDef>(proj.defId);
            if (trailDef?.trailEffect) {
                this.updateTrail(proj);
            }
        }

        // Remove projectiles that hit or expired
        for (const id of toRemove) {
            this.despawn(id);
        }

        // Update impacts (fade out)
        this.updateImpacts(deltaTime);

        // Update explosion effects
        getExplosionEffect().update(deltaTime);
    }

    /**
     * Spawn a small bounce spark at the bounce point
     */
    private spawnBounceEffect(position: Vector3, normal: Vector3): void {
        if (!this.scene) return;

        const id = `bounce_${this.nextId++}`;

        // Small sphere flash
        const mesh = MeshBuilder.CreateSphere(`${id}_mesh`, { diameter: 0.6 }, this.scene);
        mesh.position = position.add(normal.scale(0.1));
        mesh.isPickable = false;

        const mat = new StandardMaterial(`${id}_mat`, this.scene);
        mat.emissiveColor = new Color3(0.4, 0.6, 1.0);  // blue spark
        mat.diffuseColor = Color3.Black();
        mat.disableLighting = true;
        mesh.material = mat;

        // Small flash light
        const light = new PointLight(`${id}_light`, position, this.scene);
        light.diffuse = new Color3(0.4, 0.6, 1.0);
        light.intensity = 4;
        light.range = 15;

        this.impacts.push({
            id,
            mesh,
            material: mat,
            light,
            spawnTime: performance.now() / 1000,
            duration: 0.12,  // Very fast — just a spark
        });
    }

    /**
     * Spawn impact effect at hit point
     */
    private spawnImpact(projDefId: string, position: Vector3, normal: Vector3): void {
        if (!this.scene) return;

        // Client-side predicted explosions for rockets/grenades/plasma
        // These are shown immediately; server events are deduplicated against them
        if (projDefId === 'rocket' || projDefId === 'grenade' || projDefId === 'plasma_bolt') {
            // Record prediction for dedup and spawn the explosion locally
            this.recentPredictedImpacts.push({
                pos: position.clone(),
                time: performance.now(),
                defId: projDefId,
            });

            // Spawn the explosion locally using the config for this projectile type
            const config = projDefId === 'grenade' ? GRENADE_EXPLOSION
                : projDefId === 'plasma_bolt' ? PLASMA_EXPLOSION
                    : ROCKET_EXPLOSION;
            getExplosionEffect().spawn(position, config, normal);
            return;
        }

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
        proj.trailMesh?.dispose();
        proj.trailMaterial?.dispose();
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
            proj.trailMesh?.dispose();
            proj.trailMaterial?.dispose();
            proj.node.dispose();
        }
        this.projectiles = [];
    }

    /**
     * Update trail ribbon mesh for a projectile (grenades, rockets, etc.)
     */
    private updateTrail(proj: ActiveProjectile): void {
        if (!this.scene) return;

        const MAX_TRAIL_POINTS = 60;   // longer trail (was 20)
        const TRAIL_WIDTH = 6.0;        // ribbon half-width in world units

        // Record current position
        proj.trailPoints.push(proj.node.position.clone());

        // Trim old points
        while (proj.trailPoints.length > MAX_TRAIL_POINTS) {
            proj.trailPoints.shift();
        }

        // Need at least 2 points for a ribbon
        if (proj.trailPoints.length < 2) return;

        // Dispose old trail mesh & material
        proj.trailMesh?.dispose();
        proj.trailMaterial?.dispose();

        // Build ribbon path arrays — X-formation: two perpendicular planes for volume
        const pathA: Vector3[] = [];
        const pathB: Vector3[] = [];
        const pathC: Vector3[] = [];
        const pathD: Vector3[] = [];

        for (let i = 0; i < proj.trailPoints.length; i++) {
            const p = proj.trailPoints[i];

            // Compute a perpendicular offset direction
            let tangent: Vector3;
            if (i < proj.trailPoints.length - 1) {
                tangent = proj.trailPoints[i + 1].subtract(p).normalize();
            } else {
                tangent = p.subtract(proj.trailPoints[i - 1]).normalize();
            }

            // First perpendicular: cross tangent with world up (horizontal)
            let perp1 = Vector3.Cross(tangent, Vector3.Up());
            if (perp1.lengthSquared() < 0.001) {
                perp1 = Vector3.Cross(tangent, Vector3.Forward());
            }
            perp1.normalize();

            // Second perpendicular: cross tangent with first perp (vertical)
            const perp2 = Vector3.Cross(tangent, perp1).normalize();

            // Taper width: 0 at tail → full at head
            const t = i / (proj.trailPoints.length - 1);
            const width = TRAIL_WIDTH * t;

            // First ribbon plane (horizontal)
            pathA.push(p.add(perp1.scale(width)));
            pathB.push(p.subtract(perp1.scale(width)));
            // Second ribbon plane (vertical) — X formation
            pathC.push(p.add(perp2.scale(width)));
            pathD.push(p.subtract(perp2.scale(width)));
        }

        // Create single 4-path ribbon (two crossed planes)
        proj.trailMesh = MeshBuilder.CreateRibbon(`${proj.id}_trail`, {
            pathArray: [pathA, pathB, pathC, pathD],
            updatable: false,
            sideOrientation: Mesh.DOUBLESIDE,
        }, this.scene) as unknown as LinesMesh;
        proj.trailMesh.isPickable = false;

        // Per-projectile trail color from lightColor, fallback to blue
        const registry = getEntityRegistry();
        const def = registry.get<ProjectileDef>(proj.defId);
        const trailColor = def?.lightColor
            ? new Color3(def.lightColor.r, def.lightColor.g, def.lightColor.b)
            : new Color3(0.3, 0.5, 1.0); // fallback blue

        const mat = new StandardMaterial(`${proj.id}_trailMat`, this.scene);
        mat.emissiveColor = trailColor;
        mat.diffuseColor = Color3.Black();
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.alpha = 0.6;
        proj.trailMesh.material = mat;
        proj.trailMaterial = mat;
    }
}

// Convenience function
export function getProjectileManager(): ProjectileManager {
    return ProjectileManager.getInstance();
}
