import type { IComponent } from "../core/Component";
import type { BinaryDecoder, BinaryEncoder } from "../protocol/BinaryProtocol";

/**
 * Simple 3D vector for position/rotation without Babylon dependency
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * TransformComponent - Position and rotation in world space
 *
 * Generic component usable by any game type:
 * - FPS: Player/projectile positions
 * - Hack'n'slash: Character positions
 * - Racing: Vehicle positions
 */
export class TransformComponent implements IComponent {
  /** World position */
  position: Vec3 = { x: 0, y: 0, z: 0 };

  /** Rotation in radians (pitch, yaw, roll) */
  rotation: Vec3 = { x: 0, y: 0, z: 0 };

  /** Optional scale (defaults to 1,1,1) */
  scale: Vec3 = { x: 1, y: 1, z: 1 };

  constructor(init?: Partial<{ position: Vec3; rotation: Vec3; scale: Vec3 }>) {
    if (init?.position) {
      this.position = { ...init.position };
    }
    if (init?.rotation) {
      this.rotation = { ...init.rotation };
    }
    if (init?.scale) {
      this.scale = { ...init.scale };
    }
  }

  serialize(encoder: BinaryEncoder): void {
    // Position (12 bytes)
    encoder.writeFloat32(this.position.x);
    encoder.writeFloat32(this.position.y);
    encoder.writeFloat32(this.position.z);

    // Rotation (12 bytes)
    encoder.writeFloat32(this.rotation.x);
    encoder.writeFloat32(this.rotation.y);
    encoder.writeFloat32(this.rotation.z);

    // Scale - only serialize if not default (1,1,1)
    const hasScale = this.scale.x !== 1 || this.scale.y !== 1 || this.scale.z !== 1;
    encoder.writeUint8(hasScale ? 1 : 0);
    if (hasScale) {
      encoder.writeFloat32(this.scale.x);
      encoder.writeFloat32(this.scale.y);
      encoder.writeFloat32(this.scale.z);
    }
  }

  deserialize(decoder: BinaryDecoder): void {
    // Position
    this.position.x = decoder.readFloat32();
    this.position.y = decoder.readFloat32();
    this.position.z = decoder.readFloat32();

    // Rotation
    this.rotation.x = decoder.readFloat32();
    this.rotation.y = decoder.readFloat32();
    this.rotation.z = decoder.readFloat32();

    // Scale
    const hasScale = decoder.readUint8() === 1;
    if (hasScale) {
      this.scale.x = decoder.readFloat32();
      this.scale.y = decoder.readFloat32();
      this.scale.z = decoder.readFloat32();
    } else {
      this.scale = { x: 1, y: 1, z: 1 };
    }
  }

  clone(): TransformComponent {
    const cloned = new TransformComponent();
    cloned.position = { ...this.position };
    cloned.rotation = { ...this.rotation };
    cloned.scale = { ...this.scale };
    return cloned;
  }

  /**
   * Set position from x, y, z values
   */
  setPosition(x: number, y: number, z: number): this {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    return this;
  }

  /**
   * Set rotation from pitch, yaw, roll values (radians)
   */
  setRotation(pitch: number, yaw: number, roll: number = 0): this {
    this.rotation.x = pitch;
    this.rotation.y = yaw;
    this.rotation.z = roll;
    return this;
  }

  /**
   * Get forward direction vector from rotation
   */
  getForward(): Vec3 {
    const pitch = this.rotation.x;
    const yaw = this.rotation.y;
    return {
      x: Math.sin(yaw) * Math.cos(pitch),
      y: -Math.sin(pitch),
      z: Math.cos(yaw) * Math.cos(pitch),
    };
  }

  /**
   * Get right direction vector from rotation
   */
  getRight(): Vec3 {
    const yaw = this.rotation.y;
    return {
      x: Math.cos(yaw),
      y: 0,
      z: -Math.sin(yaw),
    };
  }
}
