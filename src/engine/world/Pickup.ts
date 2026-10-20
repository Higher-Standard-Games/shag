/**
 * Pickup — engine-generic in-world collectible.
 *
 * Generic features:
 * - Model loading (MD3/GLB) via AssetPreloader + ModelLoader
 * - Optional physics toss arc (Havok dynamic body with settle detection)
 * - Optional drop-to-ground raycast (BSP collision + Babylon visual raycast)
 * - Optional bobbing/rotating visual
 * - Optional glow light with sinusoidal pulse
 * - Respawn timer
 * - Server-driven deactivation via `deactivateFromServer()` (callable by game)
 * - Per-frame proximity check that fires `onProximity()` hook for game logic
 *
 * Games extend this class and override hook methods:
 *  - onConstructed()      — register on game-specific registries
 *  - onProximity()        — react to player approaching/leaving
 *  - onAfterDeactivated() — extra teardown after pickup
 *  - getPickupSoundKey()  — choose the AudioManager sfx key
 *
 * FPS-specific behavior (weapon type taxonomy, inventory swap prompt,
 * weapon-id static deactivation registry) lives in
 * `src/games/fps/world/FPSPickup.ts`, which extends this class.
 */

import { Ray } from "@babylonjs/core/Culling/ray";
import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { Scene } from "@babylonjs/core/scene";
import { AudioManager } from "../AudioManager";
import { CameraSystem } from "../camera/CameraSystem";
import { devLog } from "../core/DevLog";
import { applySafeMaxSimultaneousLights } from "../lighting/DynamicLightSafety";
import { type ModelAttachmentPoint, ModelLoader } from "../loader/model/ModelLoader";
import { disposeModelResources } from "../loader/model/ModelSourceCache";
import { getCollisionManager } from "../physics";
import { PhysicsSystem } from "../physics/PhysicsSystem";
import { describeModelRender } from "./ModelRenderAudit";
import type { PickupVisual, PickupVisualFactory } from "./PickupVisual";

export interface PickupOptions {
  /** Stable identifier for this pickup (used by callers for matching/lookup). */
  id: string;
  /**
   * Path to the pickup model (e.g. `models/items/ammo/ammobox/ammobox.md3`).
   * Optional when a `visualFactory` is supplied (procedural visuals need no
   * model). Kept as a fallback: if the factory declines, the model path loads.
   */
  modelPath?: string;
  /**
   * Optional procedural visual factory. When present, `Pickup` builds a
   * `PickupVisual` instead of loading `modelPath`, and routes update / active /
   * dispose through it. Used by FPS health & armor. See `PickupVisual.ts`.
   */
  visualFactory?: PickupVisualFactory;
  /** Seconds before respawn. 0 = no respawn (dropped items). */
  respawnTime?: number;
  /** Scale multiplier. Default 1.5. */
  scale?: number;
  /** Yaw (radians) the model rests at, so a row of the same item does not read as copies. */
  yaw?: number;
  /** Drop to the floor after spawn (BSP raycast). */
  gravity?: boolean;
  /**
   * The map pickup is already at the server trigger's position (landed or
   * explicitly suspended), so skip a second, client-only floor raycast.
   */
  landedOnFloor?: boolean;
  /** Enable bobbing/rotation animation (default true). */
  bobbing?: boolean;
  /** Optional glow light color (RGB 0-1). */
  glowColor?: { r: number; g: number; b: number };
  /** Initial linear velocity — if set, the pickup is given a Havok dynamic body and tossed. */
  velocity?: Vector3;
  /** Network entity id (e.g. `item_50001`); if present, this pickup is server-synced. */
  entityId?: string;
  /** Server-assigned sequential pickup id for deterministic deactivation. */
  pickupId?: number;
  /** AudioManager sfx key to play on pickup. Default `"pickup"`. */
  pickupSoundKey?: string;
  /**
   * When true, the client never self-respawns this pickup on a local timer —
   * visibility is driven entirely by the server (the snapshot active-set, see
   * `setActiveState`). Used for networked, server-authoritative map pickups.
   */
  serverManagedRespawn?: boolean;
  /** Free-form game metadata (FPS uses this for weapon type/value/ammoCount). */
  metadata?: Record<string, unknown>;
}

export class Pickup extends TransformNode {
  protected options: PickupOptions;
  protected mesh: Mesh | null = null;
  /** The loader root the meshes were detached from; it still holds glTF nodes and bones. */
  private modelRoot: TransformNode | null = null;
  /** Exposed through pickup_audit so cache hits can be compared with fresh model loads. */
  protected modelLoadSource: "none" | "cache-flat" | "fresh-flat" = "none";
  /** Authored tag_* transforms retained even when the cached GLB is flattened. */
  protected modelAttachmentPoints: Record<string, ModelAttachmentPoint> = {};
  public isActive: boolean = true;
  protected respawnTimer: number | null = null;
  protected glowLight: PointLight | null = null;
  protected glowPulseTime: number = 0;

  /** Procedural visual (present only when `options.visualFactory` was supplied). */
  protected visual: PickupVisual | null = null;
  /** Seconds accumulator driving the procedural visual's cosmetic animation. */
  private visualElapsed = 0;

  /** Per-frame proximity/glow observer. Captured so dispose() can detach it. */
  private _renderObserver: Observer<Scene> | null = null;

  /** Model/procedural construction is part of map loading, not detached work. */
  private readonly modelReady: Promise<void>;

  /** Whether physics has settled (velocity near zero). Used for server position sync. */
  public settled: boolean = false;

  /** Whether this pickup has a physics body attached */
  public hasPhysics: boolean = false;

  constructor(name: string, scene: Scene, position: Vector3, options: PickupOptions) {
    super(name, scene);
    this.options = options;
    this.position = position;
    // Fail-closed init for server-managed procedural pickups: start hidden until
    // the first authoritative active-mask arrives, so delayed items (armor,
    // mega) never flash at map start and the first reconcile reaches the visual
    // as a real change (see setActiveState + PickupVisual.setActive). Model-backed
    // and dev-spawned pickups are unaffected.
    if (options.visualFactory && options.serverManagedRespawn) {
      this.isActive = false;
    }
    this.onConstructed();
    this.modelReady = this.loadModel();
  }

  /** Resolve when this pickup's renderable (or deliberate no-model fallback) is ready. */
  public whenReady(): Promise<void> {
    return this.modelReady;
  }

  // ═════════════════════════════════════════════════════════════════
  // Overridable hooks for game subclasses
  // ═════════════════════════════════════════════════════════════════

  /** Called from the constructor BEFORE `loadModel`. Override to register on game registries. */
  protected onConstructed(): void {}

  /**
   * Called every frame from the proximity check.
   * @param playerPos - world position of the player (camera or controller-provided)
   * @param inRange   - true if within the pickup's cylindrical range
   *
   * Default: no-op (engine Pickup is display-only). Games override to surface prompts,
   * trigger inventory checks, etc. Server-authoritative pickup logic should NOT live
   * here — server emits item_pickup events that call `deactivateFromServer()`.
   */
  protected onProximity(_playerPos: Vector3, _inRange: boolean): void {}

  /** Hook called after `onPickedUp` has marked the pickup inactive. */
  protected onAfterDeactivated(): void {}

  /** Returns the AudioManager sfx key to play on pickup. */
  protected getPickupSoundKey(): string {
    return this.options.pickupSoundKey ?? "pickup";
  }

  // ═════════════════════════════════════════════════════════════════
  // Model loading
  // ═════════════════════════════════════════════════════════════════

  protected async loadModel() {
    // Procedural path: build a generated visual instead of loading a model.
    // Falls through to the model path if the factory declines (returns false).
    if (this.options.visualFactory) {
      const installed = await this.installProceduralVisual();
      if (installed) return;
    }

    const modelPath = this.options.modelPath;
    if (!modelPath) {
      // No model and no (surviving) factory — nothing to render. Still drop to
      // ground so any future overlay would sit correctly.
      if (this.options.gravity) this.dropToGround();
      return;
    }

    try {
      // Check AssetPreloader cache first for instant spawn
      let result = null;
      try {
        const { AssetPreloader } = await import("../loader/AssetPreloader");
        const preloader = AssetPreloader.getInstance();
        if (preloader.hasModel(modelPath)) {
          result = preloader.cloneCachedModel(modelPath, this.getScene());
          if (result) this.modelLoadSource = "cache-flat";
        }
      } catch {
        // Preloader not available, continue with fresh load
      }

      // Fall back to fresh loading if not cached
      if (!result) {
        const loader = ModelLoader.getInstance();
        if (!loader.isInitialized()) loader.init(this.getScene());

        result = await loader.loadModel(modelPath, {
          position: Vector3.Zero(),
          scale: this.options.scale || 1.0,
          hasCollision: false,
          applyLighting: false,
        });
        if (result) this.modelLoadSource = "fresh-flat";
      }

      if (result?.root) {
        this.modelAttachmentPoints = result.attachmentPoints ?? {};
        const pickupScale = this.options.scale || 1.5;

        // Find the leader mesh (first renderable) and parent all other meshes under it.
        // Havok CONVEX_HULL is applied to the leader; child meshes follow via parenting.
        let leaderMesh: Mesh | null = null;
        const otherMeshes: Mesh[] = [];

        for (const m of result.meshes) {
          if (m instanceof Mesh) {
            // Cap lights to prevent shader uniform block overflow
            if (m.material && "maxSimultaneousLights" in m.material) {
              // biome-ignore lint/suspicious/noExplicitAny: Babylon material introspection
              applySafeMaxSimultaneousLights(m.material as any);
            }
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
          leaderMesh.parent = null;
          leaderMesh.position.copyFrom(this.getAbsolutePosition());
          leaderMesh.rotationQuaternion = null;
          leaderMesh.rotation.set(0, this.options.yaw ?? 0, 0);
          leaderMesh.isVisible = true;
          leaderMesh.scaling.setAll(pickupScale);

          for (const m of otherMeshes) {
            m.parent = leaderMesh;
            m.position.setAll(0);
            m.rotationQuaternion = null;
            m.rotation.setAll(0);
            m.isVisible = true;
          }

          this.mesh = leaderMesh;
        } else {
          // Every mesh in the result was empty, so nothing is drawn and nothing
          // says so. A cached source whose geometry has gone hands out clones
          // with no vertices; a weapon with sub-models then shows only the parts
          // loaded fresh after this point — its barrels, standing on no body.
          console.warn(
            `[Pickup] ${this.name}: no renderable mesh from ${this.modelLoadSource} ` +
              `(${result.meshes.length} meshes, all empty) — nothing will be drawn`,
          );
        }

        // Detach loader root from scene hierarchy without disposing children.
        if (result.root) {
          result.root.parent = null;
          result.root.setEnabled(false);
          this.modelRoot = result.root;
        }

        // Physics: only apply Havok for tossed pickups (dropped weapons).
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
          // Map spawn: raycast down to the BSP floor, then place the mesh there —
          // unless the spawn position is already the resting spot the server's
          // trigger uses, in which case a second, client-only raycast can only
          // disagree with it (and has, by seating models below the floor).
          if (!this.options.landedOnFloor) this.dropToGround();
          this.settled = true;
          if (leaderMesh) {
            leaderMesh.position.copyFrom(this.getAbsolutePosition());
          }
        }

        // If the server already marked this pickup inactive before the model
        // finished loading (setActiveState ran with mesh === null), apply the
        // hidden state now that the mesh exists.
        if (!this.isActive && this.mesh) {
          this.mesh.setEnabled(false);
          if (this.glowLight) this.glowLight.setEnabled(false);
        }

        // Per-frame proximity check + glow pulse. Capture the observer so
        // dispose() can detach it — otherwise each unloaded pickup orphans a
        // per-frame callback that pins this (disposed) instance alive.
        this._renderObserver = this.getScene().onBeforeRenderObservable.add(() => {
          this.tick();
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
   * Build a procedural visual from `options.visualFactory`. Returns true if a
   * visual was installed; false if the factory declined or threw, so the caller
   * can fall back to the model path. A standalone pickup without shared landing
   * data retains the legacy floor probe.
   */
  private async installProceduralVisual(): Promise<boolean> {
    const factory = this.options.visualFactory;
    if (!factory) return false;
    try {
      // Map pickups with shared landing data already match the server trigger.
      if (!this.options.landedOnFloor) this.dropToGround();
      this.settled = true;

      const visual = factory({
        scene: this.getScene(),
        position: this.getAbsolutePosition(),
        options: this.options,
      });
      if (!visual) return false;
      this.visual = visual;

      // Per-frame cosmetic animation + proximity, same observer contract as the
      // model path. Captured so dispose() can detach it.
      this._renderObserver = this.getScene().onBeforeRenderObservable.add(() => {
        this.tick();
      });
      return true;
    } catch (e) {
      console.error(`[Pickup] procedural visual install failed for ${this.name}:`, e);
      return false;
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Per-frame
  // ═════════════════════════════════════════════════════════════════

  /** Compute the player position to use for proximity. Override if your game has a different concept. */
  protected getPlayerPosition(): Vector3 | null {
    const camera = CameraSystem.getInstance().getCamera();
    if (!camera) return null;
    const controller = CameraSystem.getInstance().getActiveController();
    const playerPosition = controller?.getPlayerPosition?.();
    if (playerPosition) return playerPosition;
    return camera.position;
  }

  /** Update glow pulse + procedural visual + run proximity check. */
  protected tick(): void {
    if (this.visual) {
      const dt = this.getScene().getEngine().getDeltaTime() / 1000;
      this.visualElapsed += dt;
      this.visual.update(dt, this.visualElapsed);
    }
    if (this.glowLight && this.isActive) {
      const dt = this.getScene().getEngine().getDeltaTime() / 1000;
      this.glowPulseTime += dt * 3.0;
      const pulseValue = Math.sin(this.glowPulseTime) * 0.4 + 0.8;
      this.glowLight.intensity = pulseValue;
    }
    this.runProximityCheck();
  }

  protected runProximityCheck(): void {
    if (!this.isActive) return;
    const playerPos = this.getPlayerPosition();
    if (!playerPos) return;

    const targetPos = this.mesh ? this.mesh.getAbsolutePosition() : this.position;
    const dx = playerPos.x - targetPos.x;
    const dz = playerPos.z - targetPos.z;
    const dy = playerPos.y - targetPos.y;

    const horizDistSquared = dx * dx + dz * dz;
    const pickupRadius = 96;
    const pickupRadiusSq = pickupRadius * pickupRadius;
    const verticalRangeMin = -24;
    const verticalRangeMax = 88;

    const inRange = horizDistSquared < pickupRadiusSq && dy > verticalRangeMin && dy < verticalRangeMax;
    this.onProximity(playerPos, inRange);
  }

  // ═════════════════════════════════════════════════════════════════
  // Drop-to-ground (BSP raycast + collision-manager fallback)
  // ═════════════════════════════════════════════════════════════════

  /** Compact render-path diagnostics consumed by the developer pickup_audit command. */
  public describeModelForAudit(): string {
    const leader = this.mesh;
    if (!leader) return `source=${this.modelLoadSource} model=NONE`;
    return `source=${this.modelLoadSource},parent=${leader.parent?.name ?? "none"},${describeModelRender(leader, this.getScene())}`;
  }

  public dropToGround() {
    const rayOrigin = this.position.clone();
    const rayDir = new Vector3(0, -1, 0);
    const ray = new Ray(rayOrigin, rayDir, 2000);

    const hit = this.getScene().pickWithRay(ray, (mesh) => {
      if (mesh === this.mesh || mesh.isDescendantOf(this)) return false;
      if (mesh.name.startsWith("player")) return false;
      if (mesh.name.includes("debug")) return false;
      if (mesh.name === "skybox") return false;
      if (mesh.metadata?.autosprite || mesh.metadata?.autosprite2) return false;
      return true;
    });

    if (hit?.hit && hit.pickedPoint) {
      const floorOffset = 12;
      const newY = hit.pickedPoint.y + floorOffset;

      devLog(
        `[Pickup:dropToGround] ${this.name}: ${this.position.y.toFixed(1)} → ${newY.toFixed(1)} (floor=${hit.pickedPoint.y.toFixed(1)}, hit=${hit.pickedMesh?.name})`,
      );

      this.position = new Vector3(this.position.x, newY, this.position.z);
      this.computeWorldMatrix(true);
      // biome-ignore lint/suspicious/noExplicitAny: Babylon node traversal
      const updateChildren = (node: any) => {
        if (node.computeWorldMatrix) node.computeWorldMatrix(true);
        if (node.getChildren) node.getChildren().forEach(updateChildren);
      };
      this.getChildren().forEach(updateChildren);
    } else {
      try {
        const cm = getCollisionManager();
        if (cm.isInitialized()) {
          const ground = cm.findGround(this.position, 2000, {
            radius: 0.1,
            // Pin the historical probe height (56) so pickup rest position is
            // unchanged by the findGround default fix (was 56, now PLAYER_HEIGHT
            // 64). The `+ 12` offset below is empirically tuned to this probe.
            // TODO: a point-probe (small height) would be more honest here.
            height: 56,
            contentMask: 1,
            debug: false,
          });
          if (ground) {
            const newY = ground.position.y + 12;
            devLog(
              `[Pickup:dropToGround] ${this.name}: BSP fallback ${this.position.y.toFixed(1)} → ${newY.toFixed(1)}`,
            );
            this.position = new Vector3(this.position.x, newY, this.position.z);
            this.computeWorldMatrix(true);
            return;
          }
        }
      } catch (e) {
        console.error("[Pickup:dropToGround] BSP collision EXCEPTION:", e);
      }
      console.error(
        `[Pickup:dropToGround] ALL METHODS FAILED for ${this.name} — item will float at y=${this.position.y.toFixed(1)}`,
      );
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Deactivation / respawn
  // ═════════════════════════════════════════════════════════════════

  /**
   * Deactivate this pickup. Plays sfx, disables the visual, optionally schedules respawn.
   * Public so server-driven deactivation paths can call it from outside.
   */
  public deactivateFromServer(): void {
    this.onPickedUp();
  }

  protected onPickedUp(): void {
    AudioManager.getInstance().playSfx(this.getPickupSoundKey(), 0.5);
    this.isActive = false;

    // Defer visual changes to next frame to avoid render-state conflicts
    requestAnimationFrame(() => {
      if (this.isActive) return;
      this.setEnabled(false);
      if (this.mesh) {
        this.mesh.setEnabled(false);
      }
      if (this.mesh instanceof Mesh && (this.mesh as Mesh).physicsBody) {
        (this.mesh as Mesh).physicsBody!.setMotionType(2); // STATIC
      }
      if (this.glowLight) this.glowLight.setEnabled(false);
    });

    // Server-managed pickups never self-respawn — the server's snapshot
    // active-set drives reactivation (see setActiveState). Local timer only
    // applies to standalone (non-networked) pickups.
    const respawnTime = this.options.respawnTime;
    if (!this.options.serverManagedRespawn && respawnTime && respawnTime > 0) {
      this.respawnTimer = window.setTimeout(() => {
        this.respawn();
      }, respawnTime * 1000);
    }

    this.onAfterDeactivated();
  }

  /**
   * Idempotently set this pickup's active (visible/collectible) state. Called by
   * the client each snapshot to reconcile with the server's authoritative
   * active-set. Unlike onPickedUp()/respawn() this is silent and side-effect
   * free: no sfx, no respawn timer, no physics toss — just visibility.
   */
  public setActiveState(active: boolean): void {
    if (active === this.isActive) return;
    this.isActive = active;
    this.setEnabled(active);
    // The leader mesh is intentionally NOT parented to this node (Havok needs a
    // root-level mesh), so it must be toggled explicitly.
    if (this.mesh) this.mesh.setEnabled(active);
    if (this.glowLight) this.glowLight.setEnabled(active);
    // Procedural visual: the first call applies visibility silently; later
    // transitions play the collection / respawn-assembly effect.
    if (this.visual) this.visual.setActive(active);
  }

  protected respawn(): void {
    this.isActive = true;
    this.setEnabled(true);

    if (this.mesh) {
      this.mesh.setEnabled(true);
      this.mesh.isVisible = true;
    }

    if (this.mesh instanceof Mesh && (this.mesh as Mesh).physicsBody) {
      this.mesh.position.copyFrom(this.getAbsolutePosition());
      this.mesh.rotationQuaternion = null;
      this.mesh.rotation.setAll(0);
      (this.mesh as Mesh).physicsBody!.disablePreStep = false;
      (this.mesh as Mesh).physicsBody!.setMotionType(1); // DYNAMIC
      (this.mesh as Mesh).physicsBody!.setLinearVelocity(new Vector3(0, 5, 0));
      const randomRot = new Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      (this.mesh as Mesh).physicsBody!.setAngularVelocity(randomRot);
    }

    if (this.glowLight) this.glowLight.setEnabled(true);

    this.settled = false;
    if (this.mesh instanceof Mesh && (this.mesh as Mesh).physicsBody) {
      this._scheduleSettleCheck(this.mesh as Mesh);
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Settle detection + server sync
  // ═════════════════════════════════════════════════════════════════

  /** Schedule velocity checks — when speed < 2, mark as settled and freeze physics. */
  protected _scheduleSettleCheck(mesh: Mesh): void {
    const SETTLE_TIMEOUT = 3000;
    const spawnTime = Date.now();

    const checkSettle = () => {
      if (!this.isActive) return;
      if (this.settled) return;

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

  protected _freezePhysics(mesh: Mesh): void {
    this.settled = true;
    if (mesh.physicsBody) {
      mesh.physicsBody.setLinearVelocity(Vector3.Zero());
      mesh.physicsBody.setAngularVelocity(Vector3.Zero());
    }
  }

  /** Lerp this pickup's position toward a target (used for server position convergence after settle). */
  public lerpToPosition(target: Vector3, factor: number = 0.15): void {
    if (!this.settled) return;
    this.position = Vector3.Lerp(this.position, target, factor);
  }

  /** Remove Havok physics body from this pickup (for cleanup). */
  public removePhysics(): void {
    if (this.mesh instanceof Mesh && this.hasPhysics) {
      PhysicsSystem.getInstance().removeBody(this.mesh.name);
      this.hasPhysics = false;
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Dispose
  // ═════════════════════════════════════════════════════════════════

  public override dispose(): void {
    if (this._renderObserver) {
      this.getScene().onBeforeRenderObservable.remove(this._renderObserver);
      this._renderObserver = null;
    }
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    if (this.glowLight) {
      this.glowLight.dispose();
      this.glowLight = null;
    }
    this.removePhysics();

    // Procedural visuals own their own meshes/materials/transients — dispose
    // through the visual handle.
    if (this.visual) {
      this.visual.dispose();
      this.visual = null;
    }

    // A model clone shares materials, textures and its skeleton with the
    // preloaded source and every other clone; release only what nothing else uses.
    disposeModelResources([this.mesh, this.modelRoot]);
    this.mesh = null as unknown as Mesh;
    this.modelRoot = null;

    super.dispose();
  }
}
