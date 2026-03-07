import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { ModelLoader } from "../loader/model/ModelLoader";
import { InventoryManager } from "./InventoryManager";
import { CameraSystem } from "../camera/CameraSystem";
import { getCollisionManager } from "../physics";
import { PointLight } from "@babylonjs/core/Lights/pointLight";

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
    respawnTime?: number; // seconds, default 30
    scale?: number;
    amount?: number; // For ammo
    gravity?: boolean; // Attempt to drop to floor
    bobbing?: boolean; // Enable/disable bobbing/rotation (default true)
    glowColor?: { r: number; g: number; b: number }; // Optional glow light color (RGB 0-1)
}

export class Pickup extends TransformNode {
    private options: PickupOptions;
    private mesh: TransformNode | null = null;
    private isActive: boolean = true;
    private rotationSpeed: number = 1.0;
    private bobSpeed: number = 2.0;
    private bobHeight: number = 5.0; // Units
    private respawnTimer: number | null = null;
    private glowLight: PointLight | null = null;

    private glowPulseTime: number = 0;


    // ═══════════════════════════════════════════════════════════════════
    // STATIC: Server-driven pickup registry
    // ═══════════════════════════════════════════════════════════════════
    /** Registry of all Pickup instances for server-driven deactivation */
    private static allPickups: Pickup[] = [];

    /** Deferred deactivation queue — for item_pickup events that arrive before client Pickup is created */
    private static pendingDeactivations: { weaponId: string; x: number; y: number; z: number; timestamp: number }[] = [];

    constructor(name: string, scene: Scene, position: Vector3, options: PickupOptions) {
        super(name, scene);

        this.options = options;
        this.position = position;

        // Register for server-driven deactivation
        Pickup.allPickups.push(this);

        // Check deferred deactivation queue — if server already picked this up before we existed
        Pickup.checkDeferredDeactivation(this);

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
                    hasCollision: false
                });
            }

            if (result && result.root) {

                // Direct Parenting Strategy: Bypass potential issues with the loader's root node
                // Parent meshes directly to the Pickup entity (like the Green Sphere test which worked)
                result.meshes.forEach(m => {
                    m.parent = this;
                    m.position.setAll(0);
                    m.rotationQuaternion = null; // Reset any quats
                    m.rotation.setAll(0);
                    m.isVisible = true;
                    m.scaling.setAll(1.5);
                    m.refreshBoundingInfo(true);
                });

                // Dispose the empty root from loader if it exists/is different
                if (result.root && result.root !== (result.meshes[0] as any)) {
                    result.root.dispose();
                }

                this.mesh = result.meshes[0]; // Keep reference to one mesh for bobbing

                // Create glow light if glowColor is defined
                if (this.options.glowColor) {
                    // this.createGlowLight(); // Disabled for testing
                }

                // Map spawn pickups: drop to floor + bob/rotate (classic Quake-style).
                // Havok tumble physics caused floating due to hierarchy issues and is only
                // appropriate for DroppedWeaponRenderer (weapon drops from kills).
                if (this.options.gravity) {
                    this.dropToGround();
                }

                // Bobbing + rotation animation (always-on for map pickups)
                this.getScene().onBeforeRenderObservable.add(() => {
                    if (this.isActive && this.mesh) {
                        const dt = this.getScene().getEngine().getDeltaTime() / 1000;
                        const enableBob = this.options.bobbing !== false;

                        if (enableBob) {
                            this.mesh.rotation.y += this.rotationSpeed * dt;
                            const time = Date.now() / 1000;
                            this.mesh.position.y = Math.sin(time * this.bobSpeed) * this.bobHeight;
                        }
                    }
                });

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
    private static hudPromptElement: HTMLDivElement | null = null;

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

        Pickup.showHudPrompt(promptText);
    }

    private static clearNearbyWeapon(): void {
        Pickup.nearbyWeaponPickup = null;
        Pickup.hideHudPrompt();
    }

    private static showHudPrompt(text: string): void {
        if (!Pickup.hudPromptElement) {
            const el = document.createElement('div');
            el.id = 'pickup-hud-prompt';
            el.style.cssText = `
                position: fixed;
                bottom: 25%;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(180deg, rgba(10,8,16,0.9) 0%, rgba(6,4,12,0.85) 100%);
                color: rgba(255, 160, 80, 1);
                font-family: 'Orbitron', 'Rajdhani', 'Inter', system-ui, sans-serif;
                font-size: 24px;
                font-weight: 700;
                letter-spacing: 0.12em;
                padding: 14px 32px;
                border: 1px solid rgba(255, 100, 0, 0.45);
                border-radius: 3px;
                pointer-events: none;
                z-index: 900;
                text-shadow: 0 0 12px rgba(255, 100, 0, 0.4), 0 0 24px rgba(255, 80, 0, 0.12);
                box-shadow: 0 0 20px rgba(255, 80, 0, 0.1), inset 0 1px 0 rgba(255, 140, 0, 0.08);
                backdrop-filter: blur(6px);
                transition: opacity 0.15s ease;
            `;
            document.body.appendChild(el);
            Pickup.hudPromptElement = el;
        }
        Pickup.hudPromptElement.textContent = text;
        Pickup.hudPromptElement.style.opacity = '1';
        Pickup.hudPromptElement.style.display = 'block';
    }

    private static hideHudPrompt(): void {
        if (Pickup.hudPromptElement) {
            Pickup.hudPromptElement.style.opacity = '0';
            // Hide after fade
            setTimeout(() => {
                if (Pickup.hudPromptElement) {
                    Pickup.hudPromptElement.style.display = 'none';
                }
            }, 150);
        }
    }

    /**
     * Deactivate this pickup from a server event (item_pickup).
     * This is the ONLY way pickups should be deactivated — server-authoritative.
     */
    public deactivateFromServer(): void {
        this.onPickedUp();
    }

    /**
     * Deactivate a pickup by position match (called from FPSGameManager on item_pickup event).
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
     */
    public dropToGround() {


        // Method 1: Try BSP Collision System (Most accurate for map geometry)
        try {
            const cm = getCollisionManager();


            if (cm.isInitialized()) {

                // Use a tiny radius (raycast-like) to avoid getting stuck on walls or invisible clip brushes
                // contentMask: 1 = SOLID only (ignores PLAYERCLIP 0x10000)
                const ground = cm.findGround(this.position, 2000, {
                    radius: 0.1,
                    contentMask: 1,
                    debug: false
                });


                if (ground) {
                    const groundY = ground.position.y;
                    const offset = 2; // Almost flush with floor (was 16)
                    const newY = groundY + offset;

                    // Use full Vector3 assignment to trigger Babylon.js dirty flags
                    this.position = new Vector3(this.position.x, newY, this.position.z);
                    // Force world matrix recalculation for parent and ALL children (recursive)
                    this.computeWorldMatrix(true);
                    const updateChildren = (node: any) => {
                        if (node.computeWorldMatrix) node.computeWorldMatrix(true);
                        if (node.getChildren) node.getChildren().forEach(updateChildren);
                    };
                    this.getChildren().forEach(updateChildren);






                    return;
                } else {

                }
            } else {

            }
        } catch (e) {
            console.error("[Pickup:dropToGround] BSP collision EXCEPTION:", e);
        }

        // Method 2: Visual Raycast (Fallback for non-BSP maps or bugs)

        const rayOrigin = this.position.clone();
        rayOrigin.y += 50;
        const rayDir = new Vector3(0, -1, 0);
        const ray = new Ray(rayOrigin, rayDir, 2000);



        const hit = this.getScene().pickWithRay(ray, (mesh) => {
            if (mesh === this.mesh || mesh.isDescendantOf(this)) return false;
            if (mesh.name.startsWith("player")) return false;
            if (mesh.name.includes("debug")) return false;
            if (mesh.name === "skybox") return false;
            return true;
        });



        if (hit && hit.hit && hit.pickedPoint) {
            const newY = hit.pickedPoint.y + (this.options.scale || 1.0) * 8;

            // Use full Vector3 assignment to trigger Babylon.js dirty flags
            this.position = new Vector3(this.position.x, newY, this.position.z);
            // Force world matrix recalculation for parent and ALL children (recursive)
            this.computeWorldMatrix(true);
            const updateChildren = (node: any) => {
                if (node.computeWorldMatrix) node.computeWorldMatrix(true);
                if (node.getChildren) node.getChildren().forEach(updateChildren);
            };
            this.getChildren().forEach(updateChildren);

        } else {
            console.error(`[Pickup:dropToGround] BOTH METHODS FAILED - item will float!`);
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
            if (this.mesh) {
                this.mesh.setEnabled(false);
            }

            // Disable glow light to prevent visual artifacts
            if (this.glowLight) this.glowLight.setEnabled(false);
        });

        // Respawn
        const respawnTime = (this.options.respawnTime || 30) * 1000;
        this.respawnTimer = window.setTimeout(() => {
            this.respawn();
        }, respawnTime);
    }

    private respawn() {
        this.isActive = true;
        if (this.mesh) {
            this.mesh.setEnabled(true);
        }
        // Re-enable glow light
        if (this.glowLight) this.glowLight.setEnabled(true);
        // Play respawn sound?
    }

    public dispose() {
        if (this.respawnTimer) clearTimeout(this.respawnTimer);
        if (this.glowLight) {
            this.glowLight.dispose();
            this.glowLight = null;
        }
        super.dispose();
    }
}
