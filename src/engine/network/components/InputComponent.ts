import type { IComponent } from "../core/Component";
import type { BinaryDecoder, BinaryEncoder } from "../protocol/BinaryProtocol";
import type { Vec3 } from "./TransformComponent";

/**
 * Input button flags - generic for any game type
 */
export const InputButtons = {
  // Movement
  FORWARD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  CROUCH: 1 << 5,
  SPRINT: 1 << 6,
  WALK: 1 << 7,

  // Actions
  FIRE: 1 << 8,
  ALT_FIRE: 1 << 9,
  RELOAD: 1 << 10,
  USE: 1 << 11,

  // Game-specific can use higher bits
  ACTION1: 1 << 12,
  ACTION2: 1 << 13,
  ACTION3: 1 << 14,
  ACTION4: 1 << 15,
} as const;

/**
 * InputComponent - Stores current input state for an entity
 *
 * Used by movement systems to process player input.
 * Updated each tick from network commands.
 *
 * Generic component usable by any game type.
 */
export class InputComponent implements IComponent {
  /** Button state as bitmask */
  buttons: number = 0;

  /** View direction (where player is looking) */
  viewAngles: { pitch: number; yaw: number } = { pitch: 0, yaw: 0 };

  /** Desired movement direction (normalized, world-relative or view-relative) */
  moveDirection: Vec3 = { x: 0, y: 0, z: 0 };

  /** Sequence number for reconciliation */
  sequence: number = 0;

  /** Server tick when this input was received */
  tick: number = 0;

  constructor(init?: Partial<InputComponent>) {
    if (init) {
      if (init.buttons !== undefined) this.buttons = init.buttons;
      if (init.viewAngles) this.viewAngles = { ...init.viewAngles };
      if (init.moveDirection) this.moveDirection = { ...init.moveDirection };
      if (init.sequence !== undefined) this.sequence = init.sequence;
      if (init.tick !== undefined) this.tick = init.tick;
    }
  }

  serialize(encoder: BinaryEncoder): void {
    // Buttons (2 bytes - supports 16 buttons)
    encoder.writeUint16(this.buttons);

    // View angles (8 bytes)
    encoder.writeFloat32(this.viewAngles.pitch);
    encoder.writeFloat32(this.viewAngles.yaw);

    // Move direction (12 bytes)
    encoder.writeFloat32(this.moveDirection.x);
    encoder.writeFloat32(this.moveDirection.y);
    encoder.writeFloat32(this.moveDirection.z);

    // Sequence and tick (8 bytes)
    encoder.writeUint32(this.sequence);
    encoder.writeUint32(this.tick);
  }

  deserialize(decoder: BinaryDecoder): void {
    this.buttons = decoder.readUint16();

    this.viewAngles.pitch = decoder.readFloat32();
    this.viewAngles.yaw = decoder.readFloat32();

    this.moveDirection.x = decoder.readFloat32();
    this.moveDirection.y = decoder.readFloat32();
    this.moveDirection.z = decoder.readFloat32();

    this.sequence = decoder.readUint32();
    this.tick = decoder.readUint32();
  }

  clone(): InputComponent {
    const cloned = new InputComponent();
    cloned.buttons = this.buttons;
    cloned.viewAngles = { ...this.viewAngles };
    cloned.moveDirection = { ...this.moveDirection };
    cloned.sequence = this.sequence;
    cloned.tick = this.tick;
    return cloned;
  }

  /**
   * Check if a button is pressed
   */
  isPressed(button: number): boolean {
    return (this.buttons & button) !== 0;
  }

  /**
   * Check if any movement button is pressed
   */
  hasMovementInput(): boolean {
    const movementMask = InputButtons.FORWARD | InputButtons.BACK | InputButtons.LEFT | InputButtons.RIGHT;
    return (this.buttons & movementMask) !== 0;
  }

  /**
   * Get movement direction from WASD buttons (view-relative)
   * Returns normalized direction vector
   */
  getWASDDirection(): Vec3 {
    let x = 0;
    let z = 0;

    if (this.isPressed(InputButtons.FORWARD)) z += 1;
    if (this.isPressed(InputButtons.BACK)) z -= 1;
    if (this.isPressed(InputButtons.LEFT)) x -= 1;
    if (this.isPressed(InputButtons.RIGHT)) x += 1;

    // Normalize diagonal movement
    const length = Math.sqrt(x * x + z * z);
    if (length > 0) {
      x /= length;
      z /= length;
    }

    return { x, y: 0, z };
  }

  /**
   * Convert view-relative direction to world direction
   */
  toWorldDirection(viewRelative: Vec3): Vec3 {
    const yaw = this.viewAngles.yaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    return {
      x: viewRelative.x * cos - viewRelative.z * sin,
      y: viewRelative.y,
      z: viewRelative.x * sin + viewRelative.z * cos,
    };
  }

  /**
   * Update from a network command
   */
  updateFromCommand(cmd: {
    buttons: number;
    pitch: number;
    yaw: number;
    direction: Vec3;
    seq: number;
    tick: number;
  }): void {
    this.buttons = cmd.buttons;
    this.viewAngles.pitch = cmd.pitch;
    this.viewAngles.yaw = cmd.yaw;
    this.moveDirection = { ...cmd.direction };
    this.sequence = cmd.seq;
    this.tick = cmd.tick;
  }
}
