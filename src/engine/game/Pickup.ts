import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { ModelLoader } from "../loader/model/ModelLoader";
import { InventoryManager } from "./InventoryManager";
import { CameraSystem } from "../camera/CameraSystem";
import { getCollisionManager } from "../physics";
import { PhysicsSystem } from "../physics/PhysicsSystem";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
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
    private _startPos: Vector3 | null = null;
    private glowLight: PointLight | null = null;
    private glowPulseTime: number = 0;

    constructor(name: string, scene: Scene, position: Vector3, options: PickupOptions) {
        super(name, scene);
        console.log(`[Pickup] Constructor called for ${name} at ${position}`);
        this.options = options;
        this.position = position;

        this.loadModel();
    }

    private async loadModel() {
        try {
            console.log(`[Pickup] loadModel started for ${this.name}`);

            // Check AssetPreloader cache first for instant spawn
            let result = null;
            try {
                const { AssetPreloader } = await import('../loader/AssetPreloader');
                const preloader = AssetPreloader.getInstance();
                if (preloader.hasModel(this.options.modelPath)) {
                    console.log(`[Pickup] Using cached model: ${this.options.modelPath}`);
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
                console.log(`[Pickup] Model loaded for ${this.name}. Meshes: ${result.meshes.length}`);
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
                console.log(`[Pickup] Meshes parented directly to ${this.name}`);

                // Create glow light if glowColor is defined
                console.log(`[Pickup] ${this.name} glowColor:`, this.options.glowColor);
                if (this.options.glowColor) {
                    // this.createGlowLight(); // Disabled for testing
                } else {
                    console.log(`[Pickup] No glowColor defined for ${this.name}`);
                }

                // PHYSICS IMPLEMENTATION (Havok)
                const physics = PhysicsSystem.getInstance();

                if (physics.isInitialized()) {
                    if (this.mesh instanceof Mesh) {
                        physics.createDynamicBody(this.mesh, PhysicsShapeType.CONVEX_HULL, 10, 0.3);
                        // Fallback or Force Cast if satisfied
                        physics.createDynamicBody(this.mesh as Mesh, PhysicsShapeType.CONVEX_HULL, 10, 0.3);
                    }

                    // Add random rotation tumble
                    if (this.mesh && this.mesh.physicsBody) {
                        const randomRot = new Vector3(
                            (Math.random() - 0.5) * 10,
                            (Math.random() - 0.5) * 10,
                            (Math.random() - 0.5) * 10
                        );
                        this.mesh.physicsBody.setAngularVelocity(randomRot);
                    }

                } else {
                    console.warn(`[Pickup] Physics NOT initialized - falling back to bobbing`);
                    // Fallback to legacy logic if physics unavailable (shouldn't happen now)
                    if (this.options.gravity) {
                        this.dropToGround();
                    }

                    // Only enable bobbing if physics is OFF
                    this.getScene().onBeforeRenderObservable.add(() => {
                        if (this.isActive && this.mesh) {
                            const dt = this.getScene().getEngine().getDeltaTime() / 1000;
                            // Default to true unless explicitly false
                            const enableBob = this.options.bobbing !== false;

                            if (enableBob) {
                                this.mesh.rotation.y += this.rotationSpeed * dt;
                                const time = Date.now() / 1000;
                                this.mesh.position.y = Math.sin(time * this.bobSpeed) * this.bobHeight;
                            }
                        }
                    });
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
     * Create a pulsing glow light for the pickup
     */
    private _createGlowLight(): void {
        if (!this.options.glowColor) return;

        const color = this.options.glowColor;

        // Create point light attached to this pickup
        this.glowLight = new PointLight(
            `${this.name}_glow`,
            new Vector3(0, 10, 0), // Small offset above pickup center
            this.getScene()
        );

        // Set light properties - high intensity for visibility
        this.glowLight.diffuse = new Color3(color.r, color.g, color.b);
        this.glowLight.specular = new Color3(color.r * 0.3, color.g * 0.3, color.b * 0.3);
        this.glowLight.intensity = 500.0; // Very high intensity
        this.glowLight.range = 500; // Large radius

        // Disable shadow casting for performance
        this.glowLight.shadowEnabled = false;

        // Parent to mesh if available (follows physics), otherwise to this TransformNode
        if (this.mesh) {
            this.glowLight.parent = this.mesh;
        } else {
            this.glowLight.parent = this;
        }

        console.log(`[Pickup] Created glow light for ${this.name}, parent: ${this.glowLight.parent?.name}`);
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

        // Try to get player's feet position from FPSController
        // This avoids the issue where camera eye height > pickup radius
        let playerPos = camera.position;
        const controller = CameraSystem.getInstance().getActiveController();

        // Check if controller has getPlayerPosition (FPSController)
        if (controller && 'getPlayerPosition' in controller && typeof (controller as any).getPlayerPosition === 'function') {
            playerPos = (controller as any).getPlayerPosition();
        }

        // Target position (pickup logic uses mesh position if physics is active)
        const targetPos = this.mesh ? this.mesh.getAbsolutePosition() : this.position;

        // Use Cylindrical Check (Vertical + Horizontal separate)
        const dx = playerPos.x - targetPos.x;
        const dz = playerPos.z - targetPos.z;
        const dy = playerPos.y - targetPos.y; // player.y is feet, target.y is pickup bottom/center

        const horizDistSquared = dx * dx + dz * dz;
        const pickupRadius = 48; // Horizontal radius (32 unit player + 16 unit item approx)
        const pickupRadiusSq = pickupRadius * pickupRadius;

        // Vertical check: 
        // Allow pickup if player's feet are slightly above (standing on it) or below (crouching/slopes)
        // Range: -24 (feet just below pickup base) to 88 (head height + reach, allowing for jumping over)
        const verticalRangeMin = -24;
        const verticalRangeMax = 88;

        if (horizDistSquared < pickupRadiusSq && dy > verticalRangeMin && dy < verticalRangeMax) {
            this.tryPickup();
        }
    }

    private tryPickup() {
        // Logic to give item to player
        // We need access to InventoryManager. 
        // Usually valid in GameScene context. 
        // We can get it via a Singleton or ServiceLocator if available, 
        // or pass it in. For now, let's assume we can import the instance/singleton logic 
        // or we need to find where InventoryManager lives. 

        // InventoryManager is instantiated in FPSController usually? 
        // Or GameScene? 

        // Let's assume we can get the player/FPS controller or finding the InventoryManager
        // If InventoryManager is not a singleton, we might have a problem.
        // It is NOT a singleton in the current code (new InventoryManager() in FPSController).

        // Hack: We can emit an event "try_pickup" and let the controller handle it?
        // OR we can rely on the fact that FPSController is the active controller.

        const controller = CameraSystem.getInstance().getActiveController();
        if (controller && (controller as any).inventory) {
            const inventory = (controller as any).inventory as InventoryManager;

            let success = false;
            if (this.options.type === 'weapon') {
                const weaponId = this.options.value as string;
                success = inventory.giveWeapon(weaponId);

                // If player already has weapon, give ammo instead
                if (!success && inventory.hasWeapon(weaponId)) {
                    // Find ammo type for this weapon
                    // We need to look up the weapon def or assume standard logic
                    // InventoryManager has access to definitions.
                    // Let's try to get ammo type from InventoryManager (we might need a public helper there)
                    // OR just cheat and assume we know the ammo type or pass it in options. 
                    // For now, let's just force success = true so it picks up (and disappears), 
                    // maybe giving some standard ammo amount if possible.

                    // Better approach: Check if we can get the weapon def from registry
                    import('../../shared/entities/EntityRegistry').then(({ EntityRegistry }) => {
                        const def = EntityRegistry.getInstance().get(weaponId) as any;
                        if (def && def.ammoType) {
                            inventory.giveAmmo(def.ammoType, 50); // Give standard pack amount
                        }
                    });
                    success = true; // Consumed as ammo
                }
            } else if (this.options.type === 'ammo') {
                // Value is ammo type (e.g. 'cells')
                const amount = this.options.amount || 50;
                const added = inventory.giveAmmo(this.options.value as string, amount);
                success = added > 0;
            }

            if (success) {
                this.onPickedUp();
            }
        }
    }

    /**
     * Raycast down to find the floor and snap the entity to it.
     */
    public dropToGround() {
        console.log(`\n[Pickup:dropToGround] === START for ${this.name} ===`);
        console.log(`[Pickup:dropToGround] Current position: ${this.position}`);
        console.log(`[Pickup:dropToGround] Gravity option: ${this.options.gravity}`);

        // Method 1: Try BSP Collision System (Most accurate for map geometry)
        try {
            const cm = getCollisionManager();
            console.log(`[Pickup:dropToGround] CollisionManager exists: ${!!cm}`);
            console.log(`[Pickup:dropToGround] CollisionManager initialized: ${cm.isInitialized()}`);
            console.log(`[Pickup:dropToGround] Active backend: ${cm.getBackendType()}`);

            if (cm.isInitialized()) {
                console.log(`[Pickup:dropToGround] Calling findGround from Y=${this.position.y}...`);
                // Use a tiny radius (raycast-like) to avoid getting stuck on walls or invisible clip brushes
                // contentMask: 1 = SOLID only (ignores PLAYERCLIP 0x10000)
                const ground = cm.findGround(this.position, 2000, {
                    radius: 0.1,
                    contentMask: 1,
                    debug: false
                });
                console.log(`[Pickup:dropToGround] findGround result: ${ground ? `Y=${ground.position.y}` : 'NULL'}`);

                if (ground) {
                    const groundY = ground.position.y;
                    const offset = 2; // Almost flush with floor (was 16)
                    const newY = groundY + offset;
                    console.log(`[Pickup:dropToGround] Ground Y=${groundY}, offset=${offset}, newY=${newY}`);
                    console.log(`[Pickup:dropToGround] SUCCESS! Dropping from Y=${this.position.y} to Y=${newY}`);
                    // Use full Vector3 assignment to trigger Babylon.js dirty flags
                    this.position = new Vector3(this.position.x, newY, this.position.z);
                    // Force world matrix recalculation for parent and ALL children (recursive)
                    this.computeWorldMatrix(true);
                    const updateChildren = (node: any) => {
                        if (node.computeWorldMatrix) node.computeWorldMatrix(true);
                        if (node.getChildren) node.getChildren().forEach(updateChildren);
                    };
                    this.getChildren().forEach(updateChildren);
                    console.log(`[Pickup:dropToGround] Updated ${this.getChildren().length} children`);
                    console.log(`[Pickup:dropToGround] VERIFY: this.position.y is now ${this.position.y}`);



                    this._startPos = this.position.clone();
                    console.log(`[Pickup:dropToGround] === END (BSP Success) ===\n`);
                    return;
                } else {
                    console.warn(`[Pickup:dropToGround] findGround returned NULL - trying fallback`);
                }
            } else {
                console.warn(`[Pickup:dropToGround] CollisionManager NOT initialized!`);
            }
        } catch (e) {
            console.error("[Pickup:dropToGround] BSP collision EXCEPTION:", e);
        }

        // Method 2: Visual Raycast (Fallback for non-BSP maps or bugs)
        console.log(`[Pickup:dropToGround] Trying visual raycast fallback...`);
        const rayOrigin = this.position.clone();
        rayOrigin.y += 50;
        const rayDir = new Vector3(0, -1, 0);
        const ray = new Ray(rayOrigin, rayDir, 2000);

        console.log(`[Pickup:dropToGround] Ray origin: ${rayOrigin}, direction: ${rayDir}`);

        const hit = this.getScene().pickWithRay(ray, (mesh) => {
            if (mesh === this.mesh || mesh.isDescendantOf(this)) return false;
            if (mesh.name.startsWith("player")) return false;
            if (mesh.name.includes("debug")) return false;
            if (mesh.name === "skybox") return false;
            return true;
        });

        console.log(`[Pickup:dropToGround] Raycast result: hit=${hit?.hit}, point=${hit?.pickedPoint}, mesh=${hit?.pickedMesh?.name}`);

        if (hit && hit.hit && hit.pickedPoint) {
            const newY = hit.pickedPoint.y + (this.options.scale || 1.0) * 8;
            console.log(`[Pickup:dropToGround] Raycast SUCCESS! Dropping to Y=${newY}`);
            // Use full Vector3 assignment to trigger Babylon.js dirty flags
            this.position = new Vector3(this.position.x, newY, this.position.z);
            // Force world matrix recalculation for parent and ALL children (recursive)
            this.computeWorldMatrix(true);
            const updateChildren = (node: any) => {
                if (node.computeWorldMatrix) node.computeWorldMatrix(true);
                if (node.getChildren) node.getChildren().forEach(updateChildren);
            };
            this.getChildren().forEach(updateChildren);
            this._startPos = this.position.clone();
        } else {
            console.error(`[Pickup:dropToGround] BOTH METHODS FAILED - item will float!`);
        }
        console.log(`[Pickup:dropToGround] === END ===\n`);
    }


    private onPickedUp() {
        console.log(`Picked up ${this.options.id}`);
        // Play sound (use static import to avoid async hiccups)
        const soundKey = this.options.type === 'weapon' ? 'weapon_pickup' : 'ammo_pickup';
        AudioManager.getInstance().playSfx(soundKey, 0.5);

        // Mark as inactive immediately (stops pickup checks)
        this.isActive = false;

        // Defer visual changes to next frame to avoid render state conflicts
        requestAnimationFrame(() => {
            if (this.mesh) {
                this.mesh.setEnabled(false);
                // Disable physics body to prevent simulation artifacts
                if (this.mesh.physicsBody) {
                    this.mesh.physicsBody.setMotionType(2); // STATIC - stops simulation
                }
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
            // Re-enable physics body
            if (this.mesh.physicsBody) {
                this.mesh.physicsBody.setMotionType(1); // DYNAMIC - resumes simulation
            }
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
