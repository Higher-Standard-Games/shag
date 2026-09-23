/**
 * The commands a demo records alongside its state, from format version 3.
 *
 * A demo used to hold only what the server simulated, which meant training a
 * bot on one required guessing which buttons produced that motion — and the
 * guess is backwards for air-strafing, where input direction and velocity
 * differ on purpose. Version 3 records the command the server actually applied,
 * so a demo carries both what happened and what a person did to cause it.
 *
 * It also makes a demo re-simulatable: the simulation is deterministic, so any
 * derived feature can be regenerated later from the recorded inputs, and a
 * corpus survives every future change to the bot's feature vector.
 *
 * **Aggregation.** Frames are written at snapshot rate and commands arrive at
 * tick rate, so one frame covers several commands. Buttons are OR-ed across the
 * interval, so a press between two snapshots is never lost; the analogue fields
 * are the last applied value, which is where the player had settled when the
 * frame was written.
 */

import { BinaryDecoder, BinaryEncoder } from "../net/BinaryProtocol";

/** One player's input over the interval a frame covers. */
export interface RecordedInput {
  playerId: string;
  /** Bitwise OR of every button held or pressed during the interval. */
  buttons: number;
  /** View angles as last applied, radians. */
  yaw: number;
  pitch: number;
  /** Wish direction as last applied, each in [-1, 1]. */
  forward: number;
  right: number;
  /** Weapon slot as last applied. */
  weaponSlot: number;
  /** How many commands were aggregated into this record. */
  commands: number;
}

/** A command as the server applied it, which is what gets aggregated. */
export interface AppliedCommand {
  buttons: number;
  yaw: number;
  pitch: number;
  forward: number;
  right: number;
  weaponSlot?: number;
}

/** Fold one applied command into a player's record for the current frame. */
export function aggregateCommand(
  into: RecordedInput | undefined,
  command: AppliedCommand,
  playerId: string,
): RecordedInput {
  if (!into) {
    return {
      playerId,
      buttons: command.buttons,
      yaw: command.yaw,
      pitch: command.pitch,
      forward: command.forward,
      right: command.right,
      weaponSlot: command.weaponSlot ?? 0,
      commands: 1,
    };
  }
  return {
    playerId,
    buttons: into.buttons | command.buttons,
    yaw: command.yaw,
    pitch: command.pitch,
    forward: command.forward,
    right: command.right,
    weaponSlot: command.weaponSlot ?? into.weaponSlot,
    commands: into.commands + 1,
  };
}

export function encodeInputs(inputs: readonly RecordedInput[]): Uint8Array {
  const encoder = new BinaryEncoder(64 + inputs.length * 48);
  encoder.writeUint8(Math.min(inputs.length, 255));
  for (const input of inputs.slice(0, 255)) {
    encoder.writeString(input.playerId);
    encoder.writeUint32(input.buttons >>> 0);
    encoder.writeFloat32(input.yaw);
    encoder.writeFloat32(input.pitch);
    encoder.writeFloat32(input.forward);
    encoder.writeFloat32(input.right);
    encoder.writeUint8(Math.max(0, Math.min(255, input.weaponSlot)));
    encoder.writeUint8(Math.max(0, Math.min(255, input.commands)));
  }
  return encoder.toBytes();
}

export function decodeInputs(data: Uint8Array): RecordedInput[] {
  if (data.byteLength === 0) return [];
  const decoder = new BinaryDecoder(data);
  const count = decoder.readUint8();
  const inputs: RecordedInput[] = [];
  for (let i = 0; i < count; i++) {
    inputs.push({
      playerId: decoder.readString(),
      buttons: decoder.readUint32(),
      yaw: decoder.readFloat32(),
      pitch: decoder.readFloat32(),
      forward: decoder.readFloat32(),
      right: decoder.readFloat32(),
      weaponSlot: decoder.readUint8(),
      commands: decoder.readUint8(),
    });
  }
  return inputs;
}
