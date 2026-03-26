/**
 * ProjectileComponent - Stores projectile-specific data
 *
 * Reusable for any type of projectile:
 * - Weapons (plasma, rockets, grenades)
 * - Game entities (traps, abilities)
 * - Environmental (thrown objects)
 */

import type { IComponent } from "../core/Component";
import type { BinaryDecoder, BinaryEncoder } from "../protocol/BinaryProtocol";

export class ProjectileComponent implements IComponent {
  /** Projectile definition ID (e.g., 'plasma_bolt', 'rocket') */
  defId: string = "";

  /** Entity ID of who fired this projectile */
  ownerId: string = "";

  /** Server tick when spawned */
  spawnTick: number = 0;

  /** Base damage on direct hit */
  damage: number = 0;

  /** Splash damage radius (0 = no splash) */
  splashRadius: number = 0;

  /** Splash damage amount */
  splashDamage: number = 0;

  /** Movement speed in units/second */
  speed: number = 0;

  /** Lifetime in seconds before auto-despawn */
  lifetime: number = 5.0;

  /** Number of bounces remaining (0 = explode on contact) */
  bouncesRemaining: number = 0;

  /** Gravity multiplier (0 = no gravity, 1 = normal) */
  gravity: number = 0;

  constructor(init?: Partial<ProjectileComponent>) {
    if (init) {
      if (init.defId !== undefined) this.defId = init.defId;
      if (init.ownerId !== undefined) this.ownerId = init.ownerId;
      if (init.spawnTick !== undefined) this.spawnTick = init.spawnTick;
      if (init.damage !== undefined) this.damage = init.damage;
      if (init.splashRadius !== undefined) this.splashRadius = init.splashRadius;
      if (init.splashDamage !== undefined) this.splashDamage = init.splashDamage;
      if (init.speed !== undefined) this.speed = init.speed;
      if (init.lifetime !== undefined) this.lifetime = init.lifetime;
      if (init.bouncesRemaining !== undefined) this.bouncesRemaining = init.bouncesRemaining;
      if (init.gravity !== undefined) this.gravity = init.gravity;
    }
  }

  serialize(encoder: BinaryEncoder): void {
    encoder.writeString(this.defId);
    encoder.writeString(this.ownerId);
    encoder.writeUint32(this.spawnTick);
    encoder.writeUint16(this.damage);
    encoder.writeUint16(this.splashRadius);
    encoder.writeUint16(this.splashDamage);
    encoder.writeFloat32(this.speed);
    encoder.writeFloat32(this.lifetime);
    encoder.writeUint8(this.bouncesRemaining);
    encoder.writeFloat32(this.gravity);
  }

  deserialize(decoder: BinaryDecoder): void {
    this.defId = decoder.readString();
    this.ownerId = decoder.readString();
    this.spawnTick = decoder.readUint32();
    this.damage = decoder.readUint16();
    this.splashRadius = decoder.readUint16();
    this.splashDamage = decoder.readUint16();
    this.speed = decoder.readFloat32();
    this.lifetime = decoder.readFloat32();
    this.bouncesRemaining = decoder.readUint8();
    this.gravity = decoder.readFloat32();
  }

  clone(): ProjectileComponent {
    const cloned = new ProjectileComponent();
    cloned.defId = this.defId;
    cloned.ownerId = this.ownerId;
    cloned.spawnTick = this.spawnTick;
    cloned.damage = this.damage;
    cloned.splashRadius = this.splashRadius;
    cloned.splashDamage = this.splashDamage;
    cloned.speed = this.speed;
    cloned.lifetime = this.lifetime;
    cloned.bouncesRemaining = this.bouncesRemaining;
    cloned.gravity = this.gravity;
    return cloned;
  }
}
