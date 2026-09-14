import type { IComponent } from "../core/Component";
import type { BinaryDecoder, BinaryEncoder } from "../protocol/BinaryProtocol";

/**
 * MovementStateComponent - Stores advanced movement state
 *
 * This component holds state from advanced movement profiles that
 * need to be communicated to clients for visual effects:
 * - Sliding (camera tilt, speed lines)
 * - Wall jump state (charging visual)
 * - Ledge grab state (climbing animation)
 * - Crouch view offset
 *
 * This is separate from VelocityComponent to keep that generic.
 */
export class MovementStateComponent implements IComponent {
  // Crouch/Slide state
  isSliding: boolean = false;
  isCrouching: boolean = false;
  crouchViewOffset: number = 0;

  // Wall jump state
  wallJumpState: "none" | "available" | "charging" = "none";

  // Ledge grab state
  ledgeGrabState: "none" | "grabbing" | "pulling" = "none";

  // Speed (for UI)
  actualHorizSpeed: number = 0;

  /**
   * How deep this player is in liquid: 0 dry, 1 wading, 2 swimming, 3 submerged.
   *
   * Replicated so remote players can be animated as swimming rather than as
   * falling — every ungrounded player currently reads as mid-jump. Discrete by
   * nature: it steps at snapshot boundaries and must never be interpolated
   * through fractional values.
   */
  waterLevel: 0 | 1 | 2 | 3 = 0;

  /**
   * Whether this player is attached to a ladder volume.
   *
   * Replicated for the same reason as {@link waterLevel}: a climber is not
   * grounded, so without this every remote climber animates as mid-jump.
   */
  onLadder: boolean = false;

  constructor(init?: Partial<MovementStateComponent>) {
    if (init) {
      Object.assign(this, init);
    }
  }

  serialize(encoder: BinaryEncoder): void {
    // Pack booleans and enums into flags (2 bytes). The low byte was full at
    // waterLevel, so the field widened here rather than growing a second one.
    let flags = 0;
    if (this.isSliding) flags |= 1;
    if (this.isCrouching) flags |= 2;
    // wallJumpState: 0=none, 1=available, 2=charging (2 bits)
    const wallJumpBits = this.wallJumpState === "none" ? 0 : this.wallJumpState === "available" ? 1 : 2;
    flags |= wallJumpBits << 2;
    // ledgeGrabState: 0=none, 1=grabbing, 2=pulling (2 bits)
    const ledgeBits = this.ledgeGrabState === "none" ? 0 : this.ledgeGrabState === "grabbing" ? 1 : 2;
    flags |= ledgeBits << 4;
    // waterLevel 0..3 (2 bits) — fills the low byte.
    flags |= (this.waterLevel & 3) << 6;
    if (this.onLadder) flags |= 1 << 8;

    encoder.writeUint16(flags);
    encoder.writeFloat32(this.crouchViewOffset);
    encoder.writeFloat32(this.actualHorizSpeed);
  }

  deserialize(decoder: BinaryDecoder): void {
    const flags = decoder.readUint16();
    this.isSliding = (flags & 1) !== 0;
    this.isCrouching = (flags & 2) !== 0;

    const wallJumpBits = (flags >> 2) & 3;
    this.wallJumpState = wallJumpBits === 0 ? "none" : wallJumpBits === 1 ? "available" : "charging";

    const ledgeBits = (flags >> 4) & 3;
    this.ledgeGrabState = ledgeBits === 0 ? "none" : ledgeBits === 1 ? "grabbing" : "pulling";

    this.waterLevel = ((flags >> 6) & 3) as 0 | 1 | 2 | 3;
    this.onLadder = (flags & (1 << 8)) !== 0;

    this.crouchViewOffset = decoder.readFloat32();
    this.actualHorizSpeed = decoder.readFloat32();
  }

  clone(): MovementStateComponent {
    return new MovementStateComponent({
      isSliding: this.isSliding,
      isCrouching: this.isCrouching,
      crouchViewOffset: this.crouchViewOffset,
      wallJumpState: this.wallJumpState,
      ledgeGrabState: this.ledgeGrabState,
      actualHorizSpeed: this.actualHorizSpeed,
      waterLevel: this.waterLevel,
      onLadder: this.onLadder,
    });
  }

  /**
   * Update from advanced movement result
   */
  updateFrom(result: {
    isSliding?: boolean;
    isCrouching?: boolean;
    crouchViewOffset?: number;
    wallJumpState?: "none" | "available" | "charging";
    ledgeGrabState?: "none" | "grabbing" | "pulling";
    actualHorizSpeed?: number;
    waterLevel?: 0 | 1 | 2 | 3;
    onLadder?: boolean;
  }): void {
    if (result.isSliding !== undefined) this.isSliding = result.isSliding;
    if (result.isCrouching !== undefined) this.isCrouching = result.isCrouching;
    if (result.crouchViewOffset !== undefined) this.crouchViewOffset = result.crouchViewOffset;
    if (result.wallJumpState !== undefined) this.wallJumpState = result.wallJumpState;
    if (result.ledgeGrabState !== undefined) this.ledgeGrabState = result.ledgeGrabState;
    if (result.actualHorizSpeed !== undefined) this.actualHorizSpeed = result.actualHorizSpeed;
    if (result.waterLevel !== undefined) this.waterLevel = result.waterLevel;
    if (result.onLadder !== undefined) this.onLadder = result.onLadder;
  }
}
