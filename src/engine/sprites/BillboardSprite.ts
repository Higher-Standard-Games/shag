import type { Camera } from "@babylonjs/core/Cameras/camera";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { SpriteDirection, SpriteSheet } from "./SpriteSheet";

/**
 * Animation state for a sprite
 */
export interface SpriteAnimationState {
  name: string;
  startFrame: number;
  frameCount: number;
  loop: boolean;
  frameRate?: number; // Override sheet's default
}

/**
 * BillboardSprite is a 2D sprite that always faces the camera.
 * Supports animation and 8-directional sprites.
 */
export class BillboardSprite {
  public readonly mesh: Mesh;
  public readonly spriteSheet: SpriteSheet;

  private scene: Scene;
  private camera: Camera;

  // Transform
  private _position: Vector3 = Vector3.Zero();
  private _scale: number = 1;
  private _facingAngle: number = 0; // Radians, 0 = facing +Z

  // Animation
  private currentFrame: number = 0;
  private frameTime: number = 0;
  private currentAnimation: SpriteAnimationState | null = null;
  private animations: Map<string, SpriteAnimationState> = new Map();

  // Direction
  private currentDirection: SpriteDirection = SpriteDirection.SOUTH;
  private lastCameraAngle: number = 0;

  // Lighting
  private _receiveLighting: boolean = false;
  private _lightUpdateInterval: number = 0.1; // Update lighting every 100ms
  private _lightUpdateTimer: number = 0;
  private _currentLightColor: Color3 = new Color3(1, 1, 1);
  private _ambientLevel: number = 0.15; // Lower ambient for stronger contrast
  private _lightIntensityMultiplier: number = 2.5; // Stronger light effect

  // Shadow
  private shadowMesh: Mesh | null = null;
  private _castShadow: boolean = false;
  private _shadowOpacity: number = 0.4;
  private _shadowScale: number = 1.2;

  private updateObserver: Observer<Scene> | null = null;

  constructor(name: string, spriteSheet: SpriteSheet, scene: Scene, camera: Camera) {
    this.spriteSheet = spriteSheet;
    this.scene = scene;
    this.camera = camera;

    // Create billboard mesh (simple quad)
    this.mesh = this.createQuadMesh(name, scene);
    this.mesh.material = spriteSheet.material;
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_Y; // Only rotate around Y axis

    // Set initial size based on sprite dimensions
    const aspectRatio = spriteSheet.config.frameWidth / spriteSheet.config.frameHeight;
    this.mesh.scaling.x = aspectRatio;
    this.mesh.scaling.y = 1;

    // Register for updates
    this.updateObserver = this.scene.onBeforeRenderObservable.add(() => this.update());
  }

  /**
   * Create a simple quad mesh for the sprite
   */
  private createQuadMesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);

    const positions = [
      -0.5,
      0,
      0, // bottom-left
      0.5,
      0,
      0, // bottom-right
      0.5,
      1,
      0, // top-right
      -0.5,
      1,
      0, // top-left
    ];

    const indices = [
      0,
      1,
      2, // first triangle
      0,
      2,
      3, // second triangle
    ];

    const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];

    // Initial UVs (will be updated per frame)
    const uvs = [0, 0, 1, 0, 1, 1, 0, 1];

    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.uvs = uvs;
    vertexData.applyToMesh(mesh);

    return mesh;
  }

  /**
   * Update sprite each frame
   */
  private update(): void {
    const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;

    // Update animation
    this.updateAnimation(deltaTime);

    // Update direction based on camera
    this.updateDirection();

    // Update UVs
    this.updateUVs();

    // Update lighting (throttled for performance)
    if (this._receiveLighting) {
      this._lightUpdateTimer += deltaTime;
      if (this._lightUpdateTimer >= this._lightUpdateInterval) {
        this._lightUpdateTimer = 0;
        this.updateLighting();
      }
    }
  }

  /**
   * Sample nearby point lights and update sprite tint
   */
  private updateLighting(): void {
    // Start with ambient color
    const totalColor = new Color3(this._ambientLevel, this._ambientLevel, this._ambientLevel);

    // Sample all point lights in scene
    for (const light of this.scene.lights) {
      if (light instanceof PointLight && light.isEnabled()) {
        const lightPos = light.position;
        const distance = Vector3.Distance(this._position, lightPos);

        // Calculate attenuation (inverse square with range limit)
        const range = light.range || 500;
        if (distance < range) {
          // Smooth falloff
          const attenuation = Math.max(0, 1 - distance / range);
          const intensity = light.intensity * attenuation * attenuation;

          // Add light contribution (with intensity multiplier for stronger effect)
          totalColor.r += light.diffuse.r * intensity * this._lightIntensityMultiplier;
          totalColor.g += light.diffuse.g * intensity * this._lightIntensityMultiplier;
          totalColor.b += light.diffuse.b * intensity * this._lightIntensityMultiplier;
        }
      }
    }

    // Clamp and apply
    this._currentLightColor.r = Math.min(1.5, totalColor.r); // Allow slight overbrightness
    this._currentLightColor.g = Math.min(1.5, totalColor.g);
    this._currentLightColor.b = Math.min(1.5, totalColor.b);

    // Apply to material emissive (tints the sprite)
    if (this.spriteSheet.material) {
      this.spriteSheet.material.emissiveColor = this._currentLightColor;
    }
  }

  /**
   * Update animation frame
   */
  private updateAnimation(deltaTime: number): void {
    if (!this.currentAnimation) return;

    const frameRate = this.currentAnimation.frameRate ?? this.spriteSheet.config.frameRate;
    this.frameTime += deltaTime;

    const frameDuration = 1 / frameRate;
    if (this.frameTime >= frameDuration) {
      this.frameTime -= frameDuration;
      this.currentFrame++;

      if (this.currentFrame >= this.currentAnimation.startFrame + this.currentAnimation.frameCount) {
        if (this.currentAnimation.loop) {
          this.currentFrame = this.currentAnimation.startFrame;
        } else {
          this.currentFrame = this.currentAnimation.startFrame + this.currentAnimation.frameCount - 1;
        }
      }
    }
  }

  /**
   * Update sprite direction based on facing angle and camera position
   */
  private updateDirection(): void {
    // Calculate angle from sprite to camera
    const toCamera = this.camera.position.subtract(this._position);
    const cameraAngle = Math.atan2(toCamera.x, toCamera.z);

    // Only recalculate if camera moved significantly
    if (Math.abs(cameraAngle - this.lastCameraAngle) > 0.1) {
      this.lastCameraAngle = cameraAngle;

      if (this.spriteSheet.config.directions === 8) {
        this.currentDirection = SpriteSheet.calculateDirection(this._facingAngle, cameraAngle);
      } else if (this.spriteSheet.config.directions === 4) {
        const dir8 = SpriteSheet.calculateDirection(this._facingAngle, cameraAngle);
        this.currentDirection = SpriteSheet.to4Direction(dir8);
      } else {
        this.currentDirection = 0; // Single direction sprite
      }
    }
  }

  /**
   * Update mesh UVs for current frame and direction
   */
  private updateUVs(): void {
    const uvs = this.spriteSheet.getUVs(this.currentFrame, this.currentDirection);
    this.mesh.setVerticesData("uv", uvs, true);
  }

  // ==================== Public API ====================

  /**
   * Register an animation
   */
  public addAnimation(state: SpriteAnimationState): void {
    this.animations.set(state.name, state);
  }

  /**
   * Play an animation by name
   */
  public playAnimation(name: string): void {
    const anim = this.animations.get(name);
    if (anim) {
      this.currentAnimation = anim;
      this.currentFrame = anim.startFrame;
      this.frameTime = 0;
    }
  }

  /**
   * Stop animation (freeze on current frame)
   */
  public stopAnimation(): void {
    this.currentAnimation = null;
  }

  /**
   * Set a specific frame (for static sprites)
   */
  public setFrame(frame: number): void {
    this.currentFrame = frame;
    this.updateUVs();
  }

  // ==================== Transform Properties ====================

  public get position(): Vector3 {
    return this._position;
  }

  public set position(value: Vector3) {
    this._position.copyFrom(value);
    this.mesh.position.copyFrom(value);
    this.updateShadow();
  }

  public setPosition(x: number, y: number, z: number): void {
    this._position.set(x, y, z);
    this.mesh.position.set(x, y, z);
    this.updateShadow();
  }

  public get scale(): number {
    return this._scale;
  }

  public set scale(value: number) {
    this._scale = value;
    const aspectRatio = this.spriteSheet.config.frameWidth / this.spriteSheet.config.frameHeight;
    this.mesh.scaling.set(aspectRatio * value, value, 1);
    this.updateShadow();
  }

  public get facingAngle(): number {
    return this._facingAngle;
  }

  public set facingAngle(radians: number) {
    this._facingAngle = radians;
  }

  /**
   * Set facing angle in degrees
   */
  public setFacingDegrees(degrees: number): void {
    this._facingAngle = (degrees * Math.PI) / 180;
  }

  /**
   * Face towards a point
   */
  public lookAt(target: Vector3): void {
    const direction = target.subtract(this._position);
    this._facingAngle = Math.atan2(direction.x, direction.z);
  }

  // ==================== Lighting ====================

  /**
   * Enable/disable dynamic lighting for this sprite
   */
  public set receiveLighting(value: boolean) {
    this._receiveLighting = value;
    if (value) {
      // Immediately update lighting
      this.updateLighting();
    } else {
      // Reset to full brightness
      if (this.spriteSheet.material) {
        this.spriteSheet.material.emissiveColor = new Color3(1, 1, 1);
      }
    }
  }

  public get receiveLighting(): boolean {
    return this._receiveLighting;
  }

  /**
   * Set the ambient light level (0-1) for when in shadow
   */
  public set ambientLevel(value: number) {
    this._ambientLevel = Math.max(0, Math.min(1, value));
  }

  public get ambientLevel(): number {
    return this._ambientLevel;
  }

  /**
   * Get the current computed light color affecting this sprite
   */
  public get currentLightColor(): Color3 {
    return this._currentLightColor.clone();
  }

  // ==================== Shadow ====================

  /**
   * Enable/disable shadow for this sprite
   */
  public set castShadow(value: boolean) {
    this._castShadow = value;

    if (value && !this.shadowMesh) {
      this.createShadow();
    } else if (!value && this.shadowMesh) {
      this.shadowMesh.dispose();
      this.shadowMesh = null;
    }
  }

  public get castShadow(): boolean {
    return this._castShadow;
  }

  /**
   * Set shadow opacity (0-1)
   */
  public set shadowOpacity(value: number) {
    this._shadowOpacity = Math.max(0, Math.min(1, value));
    if (this.shadowMesh?.material) {
      (this.shadowMesh.material as StandardMaterial).alpha = this._shadowOpacity;
    }
  }

  public get shadowOpacity(): number {
    return this._shadowOpacity;
  }

  /**
   * Set shadow scale relative to sprite
   */
  public set shadowScale(value: number) {
    this._shadowScale = value;
    this.updateShadow();
  }

  public get shadowScale(): number {
    return this._shadowScale;
  }

  /**
   * Create the shadow mesh (ellipse on ground)
   */
  private createShadow(): void {
    // Create an ellipse/disc for the shadow
    this.shadowMesh = MeshBuilder.CreateDisc(`${this.mesh.name}_shadow`, { radius: 0.5, tessellation: 16 }, this.scene);

    // Rotate to lie flat on ground
    this.shadowMesh.rotation.x = Math.PI / 2;

    // Create shadow material
    const shadowMat = new StandardMaterial(`${this.mesh.name}_shadowMat`, this.scene);
    shadowMat.diffuseColor = new Color3(0, 0, 0);
    shadowMat.specularColor = new Color3(0, 0, 0);
    shadowMat.emissiveColor = new Color3(0, 0, 0);
    shadowMat.alpha = this._shadowOpacity;
    shadowMat.backFaceCulling = false;

    this.shadowMesh.material = shadowMat;

    // Shadow doesn't receive light
    this.shadowMesh.receiveShadows = false;

    this.updateShadow();
  }

  /**
   * Update shadow position and scale
   */
  private updateShadow(): void {
    if (!this.shadowMesh) return;

    // Position shadow at sprite's feet, slightly above ground to avoid z-fighting
    this.shadowMesh.position.set(
      this._position.x,
      this._position.y + 0.5, // Slightly above ground
      this._position.z,
    );

    // Scale shadow based on sprite size
    const aspectRatio = this.spriteSheet.config.frameWidth / this.spriteSheet.config.frameHeight;
    const baseSize = this._scale * this._shadowScale;
    this.shadowMesh.scaling.set(
      baseSize * aspectRatio * 0.8, // Slightly narrower
      baseSize * 0.5, // Squashed for perspective
      1,
    );
  }

  // ==================== Cleanup ====================

  public dispose(): void {
    if (this.updateObserver) {
      this.scene.onBeforeRenderObservable.remove(this.updateObserver);
      this.updateObserver = null;
    }
    if (this.shadowMesh) {
      this.shadowMesh.dispose();
    }
    this.mesh.dispose();
  }
}
