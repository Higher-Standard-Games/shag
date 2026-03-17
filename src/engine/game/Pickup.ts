import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ModelLoader } from "../loader/model/ModelLoader";
import { InventoryManager } from "./InventoryManager";
import { CameraSystem } from "../camera/CameraSystem";
import { getCollisionManager } from "../physics";
import { PhysicsSystem } from "../physics/PhysicsSystem";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { showPickupPrompt, hidePickupPrompt } from "./PickupPrompt";

import { AudioManager } from "../AudioManager";

// ... (interface) ...

// Inside loadModel method around line 107 in original file (now around 110-120)
// The tool works by replacing blocks, but I need to handle the import separately from the usage change if they are far apart.
// Let's do imports first.

export interface PickupOptions {
    id: string;
    modelPath: string; // e.g. models/items/ammo/ammobox/ammobox.md3
    type: 'weapon' | 'ammo' | 'health' | 'armor';
    value: string | number; // weaponId (string) or amount (number)
    respawnTime?: number; // seconds, default 30. Use 0 for no respawn (dropped items).
    scale?: number;
    amount?: number; // For ammo
    gravity?: boolean; // Attempt to drop to floor
    bobbing?: boolean; // Enable/disable bobbing/rotation (default true)
    glowColor?: { r: number; g: number; b: number }; // Optional glow light color (RGB 0-1)
    /** Initial velocity for toss arc. If set, item is thrown (weapon drop). If not set, item drops in place (map spawn). */
    velocity?: Vector3;
    /** Network entity ID (e.g. 'item_50001') for server sync. */
    entityId?: string;
    /** Ammo count for dropped weapons. If set, pickup gives this amount instead of default. */
    ammoCount?: number;
    /** Server-assigned sequential pickup ID for deterministic deactivation. */
    pickupId?: number;
}

export class Pickup extends TransformNode {
    private options: PickupOptions;
    private mesh: Mesh | null = null;
    private isActive: boolean = true;
    private respawnTimer: number | null = null;
    private glowLight: PointLight | null = null;
    private glowPulseTime: number = 0;

    /** Whether physics has settled (velocity near zero). Used for server position sync. */
    public settled: boolean = false;

    /** Whether this pickup has a physics body attached */
    public hasPhysics: boolean = false;


    // ═══════════════════════════════════════════════════════════════════
    // STATIC: Server-driven pickup registry
    // ═══════════════════════════════════════════════════════════════════
    /** Registry of all Pickup instances for server-driven deactivation */
    private static allPickups: Pickup[] = [];

    /** ID-based lookup map for deterministic deactivation (server pickupId → Pickup) */
    private static pickupById: Map<number, Pickup> = new Map();

    constructor(name: string, scene: Scene, position: Vector3, options: PickupOptions) {
        super(name, scene);

        this.options = options;
        this.position = position;

        // Only register map-spawn pickups (no entityId) for server-driven deactivation.
        // Dropped weapons (with entityId) are managed by DroppedWeaponRenderer.
        if (!options.entityId) {
            Pickup.allPickups.push(this);
            // Register by server pickup ID for O(1) deactivation
            if (options.pickupId !== undefined) {
                Pickup.pickupById.set(options.pickupId, this);
            }
            // Check deferred deactivation queue — if server already picked this up before we existed
            Pickup.checkDeferredDeactivation(this);
        }

        this.loadModel();
    }

    private async loadModel() {
        try {


            // Check AssetPreloader cache first for instant spawn
            let result = null;
            try {
                const { AssetPreloader } = await import('../loader/AssetPreloader');
                const preloader = AssetPreloader.getInstance();
                if (preloader.hasModel(this.options.modelPath)) {

                    result = preloader.cloneCachedModel(this.options.modelPath, this.getScene());
                }
            } catch {
                // Preloader not available, continue with fresh load
            }

            // Fall back to fresh loading if not cached
            if (!result) {
                const loader = ModelLoader.getInstance();
                if (!loader.isInitialized()) loader.init(this.getScene());

                result = await loader.loadModel(this.options.modelPath, {
                    position: Vector3.Zero(), // Relative to this node
                    scale: this.options.scale || 1.0,
                    hasCollision: false,
                    applyLighting: false, // Pickups don't need per-model lights (prevents shader overflow)
                });
            }

            if (result && result.root) {
                const pickupScale = this.options.scale || 1.5;

                // Find the leader mesh (first renderable) and parent ALL other
                // meshes under it. Havok CONVEX_HULL is applied directly to the
                // leader — child meshes follow via parenting. This is identical
                // to how MD3 (single mesh) always worked.
                let leaderMesh: Mesh | null = null;
                const otherMeshes: Mesh[] = [];

                for (const m of result.meshes) {
                    if (m instanceof Mesh) {
                        // Cap lights to prevent shader uniform block overflow
                        if (m.material && 'maxSimultaneousLights' in m.material) {
                            (m.material as any).maxSimultaneousLights = 4;
                        }
                        // Skip empty meshes (__root__, armature nodes) — must have geometry
                        if (m.getTotalVertices() === 0) continue;
                        if (!leaderMesh) {
                            leaderMesh = m;
                        } else {
                            otherMeshes.push(m);
                        }
                    }
                }

                if (leaderMesh) {
                    // CRITICAL: Do NOT parent leader mesh to this Pickup node.
                    // Havok physics bodies require root-level meshes (no parent).
                    // Parenting causes world/local transform desync on respawn.
                    leaderMesh.parent = null;
                    // Place at Pickup's world position directly
                    leaderMesh.position.copyFrom(this.getAbsolutePosition());
                    leaderMesh.rotationQuaternion = null;
                    leaderMesh.rotation.setAll(0);
                    leaderMesh.isVisible = true;
                    leaderMesh.scaling.setAll(pickupScale);

                    // Parent all other meshes under the LEADER (not `this`)
                    // so they follow when Havok moves the leader
                    for (const m of otherMeshes) {
                        m.parent = leaderMesh;
                        m.position.setAll(0);
                        m.rotationQuaternion = null;
                        m.rotation.setAll(0);
                        m.isVisible = true;
                        // Don't scale again — they inherit leader's scale
                    }

                    this.mesh = leaderMesh;
                }

                // Detach loader root from scene hierarchy without disposing children.
                // GLB __root__ may contain intermediate TransformNodes (armatures, bones)
                // that still parent our re-parented meshes. dispose() would cascade-kill them.
                if (result.root) {
                    result.root.parent = null;
                    result.root.setEnabled(false);
                }

                // Create glow light if glowColor is defined
                if (this.options.glowColor) {
                    // this.createGlowLight(); // Disabled for testing
                }

                // PHYSICS: Only apply Havok for dropped weapons (toss arc).
                // Map-spawn pickups sit at their BSP entity position — no physics needed.
                // Havok CONVEX_HULL was unreliable with BSP MESH static bodies,
                // causing weapons to float/spin until settle timer froze them mid-air.
                if (this.options.velocity && leaderMesh) {
                    const physics = PhysicsSystem.getInstance();
                    if (physics.isInitialized()) {
                        physics.createDynamicBody(leaderMesh, PhysicsShapeType.CONVEX_HULL, 10, 0.3);
                        this.hasPhysics = true;

                        if (leaderMesh.physicsBody) {
                            leaderMesh.physicsBody.setLinearVelocity(this.options.velocity);
                            const randomRot = new Vector3(
                                (Math.random() - 0.5) * 12,
                                (Math.random() - 0.5) * 12,
                                (Math.random() - 0.5) * 12,
                            );
                            leaderMesh.physicsBody.setAngularVelocity(randomRot);
                            this._scheduleSettleCheck(leaderMesh);
                        }
                    }
                } else {
                    // Map spawn: raycast down to BSP floor, then place mesh there
                    this.dropToGround();
                    this.settled = true;
                    // Sync detached mesh position (parent=null for Havok compat)
                    if (leaderMesh) {
                        leaderMesh.position.copyFrom(this.getAbsolutePosition());
                    }
                }

                // Setup collision check and glow light pulse
                this.getScene().onBeforeRenderObservable.add(() => {
                    this.checkPickup();
                    this.updateGlowLight();
                });
            } else {
                if (this.options.gravity) {
                    this.dropToGround();
                }
            }
        } catch (e) {
            console.error(`[Pickup] CRITICAL ERROR in loadModel for ${this.name}:`, e);
            if (this.options.gravity) {
                this.dropToGround();
            }
        }
    }



    /**
     * Update the glow light pulse effect
     */
    private updateGlowLight(): void {
        if (!this.glowLight || !this.isActive) return;

        // Increment pulse time
        const dt = this.getScene().getEngine().getDeltaTime() / 1000;
        this.glowPulseTime += dt * 3.0; // Pulse speed (3 = ~3 Hz)

        // Sinusoidal intensity pulse between 0.4 and 1.2
        const pulseValue = Math.sin(this.glowPulseTime) * 0.4 + 0.8;
        this.glowLight.intensity = pulseValue;
    }



    private checkPickup() {
        if (!this.isActive) return;

        const camera = CameraSystem.getInstance().getCamera();
        if (!camera) return;

        // Suppress pickup prompts in spectator (freefly) mode or when paused (no pointer lock)
        const activeController = CameraSystem.getInstance().getActiveController();
        if (activeController?.type === 'freefly' || !document.pointerLockElement) {
            if (Pickup.nearbyWeaponPickup === this) {
                Pickup.clearNearbyWeapon();
            }
            return;
        }

        // Try to get player's feet position from FPSController
        let playerPos = camera.position;
        const controller = CameraSystem.getInstance().getActiveController();

        if (controller && 'getPlayerPosition' in controller && typeof (controller as any).getPlayerPosition === 'function') {
            playerPos = (controller as any).getPlayerPosition();
        }

        // Target position (pickup logic uses mesh position if physics is active)
        const targetPos = this.mesh ? this.mesh.getAbsolutePosition() : this.position;

        // Use Cylindrical Check (Vertical + Horizontal separate)
        const dx = playerPos.x - targetPos.x;
        const dz = playerPos.z - targetPos.z;
        const dy = playerPos.y - targetPos.y;

        const horizDistSquared = dx * dx + dz * dz;
        const pickupRadius = 96;
        const pickupRadiusSq = pickupRadius * pickupRadius;

        const verticalRangeMin = -24;
        const verticalRangeMax = 88;

        const inRange = horizDistSquared < pickupRadiusSq && dy > verticalRangeMin && dy < verticalRangeMax;

        if (inRange) {
            // Client-side Pickup is DISPLAY-ONLY.
            // All actual pickup logic is server-authoritative (PickupSystem.ts).
            // We only show/hide the SWAP prompt here for the HUD.
            if (this.options.type === 'weapon') {
                const controller = CameraSystem.getInstance().getActiveController();
                const inventory = controller && (controller as any).inventory as InventoryManager | null;
                const alreadyHas = inventory ? inventory.hasWeapon(this.options.value as string) : false;
                const hasRoom = inventory ? inventory.getSlotCount() < InventoryManager.MAX_WEAPONS : false;

                if (alreadyHas || hasRoom) {
                    // Player already owns weapon (server gives ammo auto) or has room
                    // → server handles auto-pickup, no prompt needed
                    if (Pickup.nearbyWeaponPickup === this) {
                        Pickup.clearNearbyWeapon();
                    }
                } else {
                    // At capacity + new weapon → check if holding gunblade
                    // Gunblade is always swappable (server auto-swaps), no prompt needed
                    const currentWeapon = inventory ? inventory.getCurrentWeaponId() : null;
                    if (currentWeapon === 'gunblade') {
                        // Holding gunblade at capacity — no swap prompt, server handles it
                        if (Pickup.nearbyWeaponPickup === this) {
                            Pickup.clearNearbyWeapon();
                        }
                    } else {
                        // At capacity with non-gunblade — show SWAP prompt (server waits for USE key)
                        Pickup.setNearbyWeapon(this);
                    }
                }
            }
            // Ammo/health/armor: server handles auto-pickup, no client action needed
        } else {
            // Out of range — clear if we were the nearby weapon
            if (Pickup.nearbyWeaponPickup === this) {
                Pickup.clearNearbyWeapon();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STATIC: Nearby weapon tracking + HUD prompt
    // ═══════════════════════════════════════════════════════════════════

    private static nearbyWeaponPickup: Pickup | null = null;

    /** Deferred deactivation queue — for item_pickup events that arrive before client Pickup is created */
    private static pendingDeactivations: { weaponId: string; x: number; y: number; z: number; pickupId?: number; timestamp: number }[] = [];

    /** Called by FPSController.onUse (F key) — now only clears prompt.
     *  The USE key is sent to server as a button flag; server handles the swap. */
    public static triggerUseAction(): void {
        // Don't execute pickup client-side — server handles it via PickupSystem.
        // Just clear the prompt (server will sync the weapon state).
        if (Pickup.nearbyWeaponPickup) {
            Pickup.clearNearbyWeapon();
        }
    }

    private static setNearbyWeapon(pickup: Pickup): void {
        if (Pickup.nearbyWeaponPickup === pickup) return; // Already set

        Pickup.nearbyWeaponPickup = pickup;

        // Determine prompt text
        const controller = CameraSystem.getInstance().getActiveController();
        const inventory = controller && (controller as any).inventory as InventoryManager | null;
        const weaponName = pickup.options.id.replace(/_/g, ' ').toUpperCase();

        let promptText: string;
        if (inventory && inventory.getSlotCount() >= InventoryManager.MAX_WEAPONS) {
            promptText = `PRESS [F] TO SWAP TO ${weaponName}`;
        } else {
            promptText = `PRESS [F] TO PICKUP ${weaponName}`;
        }

        showPickupPrompt('pickup', promptText);
    }

    private static clearNearbyWeapon(): void {
        Pickup.nearbyWeaponPickup = null;
        hidePickupPrompt('pickup');
    }

    // HUD prompt is now shared via PickupPrompt.ts

    /**
     * Deactivate this pickup from a server event (item_pickup).
     * This is the ONLY way pickups should be deactivated — server-authoritative.
     */
    public deactivateFromServer(): void {
        this.onPickedUp();
    }

    /**
     * Deactivate a pickup by server-assigned ID (O(1) deterministic lookup).
     * Falls back to position-based matching if pickupId is not registered.
     */
    public static deactivateById(pickupId: number, weaponId: string, x: number, y: number, z: number): void {
        const pickup = Pickup.pickupById.get(pickupId);
        if (pickup && pickup.isActive) {
            pickup.deactivateFromServer();
            return;
        }

        // Fallback to position match (for pickups created before ID system)
        Pickup.deactivateByPosition(weaponId, x, y, z);
    }

    /**
     * Deactivate a pickup by position match (called from Game on item_pickup event).
     * Uses position proximity since server numeric IDs don't map to client string IDs.
     */
    public static deactivateByPosition(weaponId: string, x: number, y: number, z: number): void {
        // Use XZ-only matching — client Y differs from server because dropToGround()
        // raycasts to floor, but server uses raw BSP entity position
        const MATCH_DIST_SQ = 200 * 200; // 200 unit tolerance (XZ only)
        let bestPickup: Pickup | null = null;
        let bestDistSq = Infinity;

        for (const pickup of Pickup.allPickups) {
            if (!pickup.isActive) continue;
            // Match weaponId against both options.value (weapon type) and options.id (entity id)
            // Also try with 'weapon_' prefix stripped since server sends e.g. 'riotgun' 
            // but client might store 'weapon_riotgun'
            const val = String(pickup.options.value || '');
            const id = String(pickup.options.id || '');
            const matchesWeapon = val === weaponId || id === weaponId ||
                val === `weapon_${weaponId}` || id === `weapon_${weaponId}` ||
                val.replace('weapon_', '') === weaponId || id.replace('weapon_', '') === weaponId;
            if (!matchesWeapon) continue;

            const dx = pickup.position.x - x;
            const dz = pickup.position.z - z;
            const distSq = dx * dx + dz * dz; // XZ only — ignore Y

            if (distSq < MATCH_DIST_SQ && distSq < bestDistSq) {
                bestDistSq = distSq;
                bestPickup = pickup;
            }
        }

        if (bestPickup) {

            bestPickup.deactivateFromServer();
        } else {
            console.warn(`[Pickup] Server deactivate MISS: ${weaponId} at (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}) — queuing for deferred deactivation (${Pickup.allPickups.filter(p => p.isActive).length} active pickups)`);
            // Queue for deferred deactivation — the Pickup might not exist yet
            Pickup.pendingDeactivations.push({ weaponId, x, y, z, timestamp: Date.now() });
            // Clean up old entries (>10s)
            Pickup.pendingDeactivations = Pickup.pendingDeactivations.filter(d => Date.now() - d.timestamp < 10000);
        }
    }

    /**
     * Check deferred deactivation queue when a new Pickup is created.
     * If there's a pending deactivation that matches this pickup, deactivate it immediately.
     */
    private static checkDeferredDeactivation(pickup: Pickup): void {
        const MATCH_DIST_SQ = 200 * 200;
        const val = String(pickup.options.value || '');
        const id = String(pickup.options.id || '');

        for (let i = Pickup.pendingDeactivations.length - 1; i >= 0; i--) {
            const pending = Pickup.pendingDeactivations[i];
            const matchesWeapon = val === pending.weaponId || id === pending.weaponId ||
                val === `weapon_${pending.weaponId}` || id === `weapon_${pending.weaponId}` ||
                val.replace('weapon_', '') === pending.weaponId || id.replace('weapon_', '') === pending.weaponId;
            if (!matchesWeapon) continue;

            const dx = pickup.position.x - pending.x;
            const dz = pickup.position.z - pending.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < MATCH_DIST_SQ) {

                Pickup.pendingDeactivations.splice(i, 1);
                // Deactivate after a short delay to let the model load
                setTimeout(() => pickup.deactivateFromServer(), 100);
                return;
            }
        }
    }

    /**
     * Raycast down to find the floor and snap the entity to it.
     * Uses Babylon visual raycast (picks against rendered BSP meshes).
     */
    public dropToGround() {
        // Visual Raycast against rendered BSP meshes — most reliable for floor finding.
        // Start from entity position (Q3 BSP entities are always in valid free space).
        // Do NOT offset upward — rooms with ceilings would put the ray above the ceiling,
        // hitting the ceiling exterior and placing the weapon out of view.
        const rayOrigin = this.position.clone();
        const rayDir = new Vector3(0, -1, 0);
        const ray = new Ray(rayOrigin, rayDir, 2000); // Cast down from entity position

        const hit = this.getScene().pickWithRay(ray, (mesh) => {
            // Skip own mesh and children
            if (mesh === this.mesh || mesh.isDescendantOf(this)) return false;
            // Skip player models
            if (mesh.name.startsWith("player")) return false;
            // Skip debug/skybox
            if (mesh.name.includes("debug")) return false;
            if (mesh.name === "skybox") return false;
            // Skip transparent/sprite meshes (not solid floor)
            if (mesh.metadata?.autosprite || mesh.metadata?.autosprite2) return false;
            // Only pick BSP world meshes and solid geometry
            return true;
        });

        if (hit && hit.hit && hit.pickedPoint) {
            // Place weapon slightly above the floor (offset for visual clearance)
            const floorOffset = 12; // Units above floor surface
            const newY = hit.pickedPoint.y + floorOffset;

            console.log(`[Pickup:dropToGround] ${this.name}: ${this.position.y.toFixed(1)} → ${newY.toFixed(1)} (floor=${hit.pickedPoint.y.toFixed(1)}, hit=${hit.pickedMesh?.name})`);

            this.position = new Vector3(this.position.x, newY, this.position.z);
            this.computeWorldMatrix(true);
            const updateChildren = (node: any) => {
                if (node.computeWorldMatrix) node.computeWorldMatrix(true);
                if (node.getChildren) node.getChildren().forEach(updateChildren);
            };
            this.getChildren().forEach(updateChildren);
        } else {
            // Fallback: try BSP collision system
            try {
                const cm = getCollisionManager();
                if (cm.isInitialized()) {
                    const ground = cm.findGround(this.position, 2000, {
                        radius: 0.1,
                        contentMask: 1,
                        debug: false
                    });
                    if (ground) {
                        const newY = ground.position.y + 12;
                        console.log(`[Pickup:dropToGround] ${this.name}: BSP fallback ${this.position.y.toFixed(1)} → ${newY.toFixed(1)}`);
                        this.position = new Vector3(this.position.x, newY, this.position.z);
                        this.computeWorldMatrix(true);
                        return;
                    }
                }
            } catch (e) {
                console.error("[Pickup:dropToGround] BSP collision EXCEPTION:", e);
            }
            console.error(`[Pickup:dropToGround] ALL METHODS FAILED for ${this.name} — item will float at y=${this.position.y.toFixed(1)}`);
        }
    }


    private onPickedUp() {

        // Play sound (use static import to avoid async hiccups)
        const soundKey = this.options.type === 'weapon' ? 'weapon_pickup' : 'ammo_pickup';
        AudioManager.getInstance().playSfx(soundKey, 0.5);

        // Mark as inactive immediately (stops pickup checks)
        this.isActive = false;

        // Defer visual changes to next frame to avoid render state conflicts
        requestAnimationFrame(() => {
            // Disable Pickup node
            this.setEnabled(false);

            // Also hide the leader mesh (root-level, not a child of Pickup)
            if (this.mesh) {
                this.mesh.setEnabled(false);
            }

            // Freeze physics body on the mesh to stop simulation
            if (this.mesh instanceof Mesh && (this.mesh as Mesh).physicsBody) {
                (this.mesh as Mesh).physicsBody!.setMotionType(2); // STATIC
            }

            // Disable glow light to prevent visual artifacts
            if (this.glowLight) this.glowLight.setEnabled(false);
        });

        // Respawn only for map spawns with respawnTime > 0
        const respawnTime = this.options.respawnTime;
        if (respawnTime && respawnTime > 0) {
            this.respawnTimer = window.setTimeout(() => {
                this.respawn();
            }, respawnTime * 1000);
        }
    }

    private respawn() {
        this.isActive = true;
        // Re-enable Pickup node
        this.setEnabled(true);

        // Re-enable and reposition the leader mesh (root-level, not a child of Pickup)
        if (this.mesh) {
            this.mesh.setEnabled(true);
            this.mesh.isVisible = true;
        }

        // Re-enable physics body for respawn drop
        if (this.mesh instanceof Mesh && (this.mesh as Mesh).physicsBody) {
            // Reset mesh to Pickup's world position (mesh is root-level, no parent)
            this.mesh.position.copyFrom(this.getAbsolutePosition());
            this.mesh.rotationQuaternion = null;
            this.mesh.rotation.setAll(0);
            // Sync Babylon → Havok transform before activating
            (this.mesh as Mesh).physicsBody!.disablePreStep = false;
            (this.mesh as Mesh).physicsBody!.setMotionType(1); // DYNAMIC
            // Give a small upward velocity + tumble for visual feedback
            (this.mesh as Mesh).physicsBody!.setLinearVelocity(new Vector3(0, 5, 0));
            const randomRot = new Vector3(
                (Math.random() - 0.5) * 8,
                (Math.random() - 0.5) * 8,
                (Math.random() - 0.5) * 8
            );
            (this.mesh as Mesh).physicsBody!.setAngularVelocity(randomRot);
        }

        // Re-enable glow light
        if (this.glowLight) this.glowLight.setEnabled(true);

        // Re-enable settle detection
        this.settled = false;
        if (this.mesh instanceof Mesh && (this.mesh as Mesh).physicsBody) {
            this._scheduleSettleCheck(this.mesh as Mesh);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Settle detection + server sync
    // ═══════════════════════════════════════════════════════════════════

    /** Schedule velocity checks — when speed < 2, mark as settled and freeze physics */
    private _scheduleSettleCheck(mesh: Mesh): void {
        const SETTLE_TIMEOUT = 3000; // Force-settle after 3s
        const spawnTime = Date.now();

        const checkSettle = () => {
            if (!this.isActive) return;
            if (this.settled) return;

            // Force-settle after timeout
            if (Date.now() - spawnTime > SETTLE_TIMEOUT) {
                this._freezePhysics(mesh);
                return;
            }

            if (mesh.physicsBody) {
                const vel = mesh.physicsBody.getLinearVelocity();
                if (vel.length() < 2) {
                    this._freezePhysics(mesh);
                    return;
                }
            }

            setTimeout(checkSettle, 500);
        };
        setTimeout(checkSettle, 800);
    }

    /** Freeze physics body and mark as settled */
    private _freezePhysics(mesh: Mesh): void {
        this.settled = true;
        if (mesh.physicsBody) {
            mesh.physicsBody.setLinearVelocity(Vector3.Zero());
            mesh.physicsBody.setAngularVelocity(Vector3.Zero());
        }
    }

    /** Lerp this pickup's position toward a target (used for server position convergence after settle) */
    public lerpToPosition(target: Vector3, factor: number = 0.15): void {
        if (!this.settled) return; // Don't fight physics during simulation
        this.position = Vector3.Lerp(this.position, target, factor);
    }

    /** Remove Havok physics body from this pickup (for cleanup) */
    public removePhysics(): void {
        if (this.mesh instanceof Mesh && this.hasPhysics) {
            PhysicsSystem.getInstance().removeBody(this.mesh.name);
            this.hasPhysics = false;
        }
    }

    public dispose() {
        // Unregister from static pickup list
        const idx = Pickup.allPickups.indexOf(this);
        if (idx >= 0) Pickup.allPickups.splice(idx, 1);

        if (this.respawnTimer) clearTimeout(this.respawnTimer);
        if (this.glowLight) {
            this.glowLight.dispose();
            this.glowLight = null;
        }
        this.removePhysics();

        // Dispose root-level mesh (not a child of this TransformNode since Havok fix)
        if (this.mesh) {
            this.mesh.dispose(false, true); // dispose geometry + materials
            this.mesh = null as any;
        }

        super.dispose();
    }
}
