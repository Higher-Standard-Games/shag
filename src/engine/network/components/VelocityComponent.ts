import type { IComponent } from '../core/Component';
import { BinaryEncoder, BinaryDecoder } from '../protocol/BinaryProtocol';
import type { Vec3 } from './TransformComponent';

/**
 * VelocityComponent - Linear and angular velocity
 *
 * Generic component usable by any game type:
 * - FPS: Player movement velocity
 * - Hack'n'slash: Character/projectile velocity
 * - Racing: Vehicle velocity
 */
export class VelocityComponent implements IComponent {
  /** Linear velocity (units per second) */
  linear: Vec3 = { x: 0, y: 0, z: 0 };

  /** Angular velocity (radians per second) - optional */
  angular: Vec3 = { x: 0, y: 0, z: 0 };

  /** Whether entity is grounded (useful for movement systems) */
  grounded: boolean = false;

  constructor(init?: Partial<{ linear: Vec3; angular: Vec3; grounded: boolean }>) {
    if (init?.linear) {
      this.linear = { ...init.linear };
    }
    if (init?.angular) {
      this.angular = { ...init.angular };
    }
    if (init?.grounded !== undefined) {
      this.grounded = init.grounded;
    }
  }

  serialize(encoder: BinaryEncoder): void {
    // Linear velocity (12 bytes)
    encoder.writeFloat32(this.linear.x);
    encoder.writeFloat32(this.linear.y);
    encoder.writeFloat32(this.linear.z);

    // Flags (1 byte) - grounded + hasAngular
    const hasAngular = this.angular.x !== 0 || this.angular.y !== 0 || this.angular.z !== 0;
    const flags = (this.grounded ? 1 : 0) | (hasAngular ? 2 : 0);
    encoder.writeUint8(flags);

    // Angular velocity - only if non-zero
    if (hasAngular) {
      encoder.writeFloat32(this.angular.x);
      encoder.writeFloat32(this.angular.y);
      encoder.writeFloat32(this.angular.z);
    }
  }

  deserialize(decoder: BinaryDecoder): void {
    // Linear velocity
    this.linear.x = decoder.readFloat32();
    this.linear.y = decoder.readFloat32();
    this.linear.z = decoder.readFloat32();

    // Flags
    const flags = decoder.readUint8();
    this.grounded = (flags & 1) !== 0;
    const hasAngular = (flags & 2) !== 0;

    // Angular velocity
    if (hasAngular) {
      this.angular.x = decoder.readFloat32();
      this.angular.y = decoder.readFloat32();
      this.angular.z = decoder.readFloat32();
    } else {
      this.angular = { x: 0, y: 0, z: 0 };
    }
  }

  clone(): VelocityComponent {
    const cloned = new VelocityComponent();
    cloned.linear = { ...this.linear };
    cloned.angular = { ...this.angular };
    cloned.grounded = this.grounded;
    return cloned;
  }

  /**
   * Set linear velocity from x, y, z values
   */
  setLinear(x: number, y: number, z: number): this {
    this.linear.x = x;
    this.linear.y = y;
    this.linear.z = z;
    return this;
  }

  /**
   * Get horizontal speed (ignoring Y component)
   */
  getHorizontalSpeed(): number {
    return Math.sqrt(this.linear.x * this.linear.x + this.linear.z * this.linear.z);
  }

  /**
   * Get total speed
   */
  getSpeed(): number {
    return Math.sqrt(
      this.linear.x * this.linear.x +
      this.linear.y * this.linear.y +
      this.linear.z * this.linear.z
    );
  }

  /**
   * Add to linear velocity
   */
  addLinear(x: number, y: number, z: number): this {
    this.linear.x += x;
    this.linear.y += y;
    this.linear.z += z;
    return this;
  }

  /**
   * Scale linear velocity
   */
  scaleLinear(factor: number): this {
    this.linear.x *= factor;
    this.linear.y *= factor;
    this.linear.z *= factor;
    return this;
  }
}
