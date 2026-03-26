import { StateDecoder, StateEncoder } from "./Component";
import type { PlayerId } from "./Entity";

/**
 * Base command interface for all player input
 */
export interface Command {
  /** Command type identifier */
  readonly type: string;

  /** Player who sent this command */
  readonly playerId: PlayerId;

  /** Server tick when command was generated */
  readonly tick: number;

  /** Sequence number for ordering and reconciliation */
  readonly seq: number;

  /** Serialize command to binary */
  serialize(): Uint8Array;
}

/**
 * Movement command for player input
 */
export class MoveCommand implements Command {
  readonly type = "move";
  readonly playerId: PlayerId;
  readonly tick: number;
  readonly seq: number;

  /** Movement direction vector */
  readonly direction: { x: number; y: number; z: number };

  /** Look angles (pitch, yaw) */
  readonly pitch: number;
  readonly yaw: number;

  /** Button states (fire, jump, etc.) */
  readonly buttons: number;

  constructor(
    playerId: PlayerId,
    tick: number,
    seq: number,
    direction: { x: number; y: number; z: number },
    pitch: number,
    yaw: number,
    buttons: number,
  ) {
    this.playerId = playerId;
    this.tick = tick;
    this.seq = seq;
    this.direction = direction;
    this.pitch = pitch;
    this.yaw = yaw;
    this.buttons = buttons;
  }

  serialize(): Uint8Array {
    const encoder = new StateEncoder();
    encoder.writeString(this.type);
    encoder.writeString(this.playerId);
    encoder.writeUint32(this.tick);
    encoder.writeUint32(this.seq);
    encoder.writeFloat32(this.direction.x);
    encoder.writeFloat32(this.direction.y);
    encoder.writeFloat32(this.direction.z);
    encoder.writeFloat32(this.pitch);
    encoder.writeFloat32(this.yaw);
    encoder.writeUint16(this.buttons);
    return encoder.toBytes();
  }

  static deserialize(data: Uint8Array): MoveCommand {
    const decoder = new StateDecoder(data);
    decoder.readString(); // Skip type
    return new MoveCommand(
      decoder.readString(),
      decoder.readUint32(),
      decoder.readUint32(),
      {
        x: decoder.readFloat32(),
        y: decoder.readFloat32(),
        z: decoder.readFloat32(),
      },
      decoder.readFloat32(),
      decoder.readFloat32(),
      decoder.readUint16(),
    );
  }
}

/**
 * Command handler function type
 */
export type CommandHandler<T extends Command = Command> = (state: any, command: T) => void;
