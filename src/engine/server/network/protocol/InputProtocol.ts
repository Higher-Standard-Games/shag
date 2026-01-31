/**
 * Input Protocol
 * 
 * Encodes/decodes player input commands for network transmission.
 * Supports input buffering and sequence numbers for reconciliation.
 */

import { BinaryEncoder, BinaryDecoder } from './BinaryEncoder';
import { MessageType } from './MessageTypes';
import type { InputComponent } from '@shared/server/simulation/components';
import type { PlayerId, TickNumber } from '../../ecs/types';
import { playerId, tickNumber } from '../../ecs/types';

// ═══════════════════════════════════════════════════════════════════
// INPUT COMMAND
// ═══════════════════════════════════════════════════════════════════

export interface InputCommand {
    /** Sequence number for reconciliation */
    sequence: number;

    /** Client timestamp when input was generated */
    clientTime: number;

    /** Movement input */
    forward: number;  // -1 to 1
    right: number;    // -1 to 1

    /** View angles */
    pitch: number;
    yaw: number;

    /** Buttons */
    jump: boolean;
    crouch: boolean;
    attack: boolean;
    altAttack: boolean;
    use: boolean;

    /** Weapon */
    weaponSlot: number;
}

// ═══════════════════════════════════════════════════════════════════
// INPUT ENCODER
// ═══════════════════════════════════════════════════════════════════

export class InputEncoder {
    private encoder: BinaryEncoder;

    constructor() {
        this.encoder = new BinaryEncoder(256);
    }

    /**
     * Encode a batch of input commands
     * Clients typically send 2-3 redundant commands for packet loss
     */
    encodeInputBatch(
        playerId: PlayerId,
        lastAckedTick: TickNumber,
        commands: InputCommand[]
    ): Uint8Array {
        this.encoder.reset();

        // Header
        this.encoder.writeUint8(MessageType.C_Input);
        this.encoder.writeVarUint(playerId as number);
        this.encoder.writeUint32(lastAckedTick as number);

        // Command count
        this.encoder.writeUint8(commands.length);

        // Commands
        for (const cmd of commands) {
            this.writeCommand(cmd);
        }

        return this.encoder.toBytes();
    }

    /**
     * Encode single input command
     */
    encodeInput(playerId: PlayerId, command: InputCommand): Uint8Array {
        return this.encodeInputBatch(playerId, tickNumber(0), [command]);
    }

    private writeCommand(cmd: InputCommand): void {
        // Sequence and timing
        this.encoder.writeUint32(cmd.sequence);
        this.encoder.writeFloat32(cmd.clientTime);

        // Movement (quantized to 8-bit)
        this.encoder.writeInt8(Math.round(cmd.forward * 127));
        this.encoder.writeInt8(Math.round(cmd.right * 127));

        // View angles (full precision needed for aiming)
        this.encoder.writeFloat32(cmd.pitch);
        this.encoder.writeFloat32(cmd.yaw);

        // Buttons (packed into single byte)
        let buttons = 0;
        if (cmd.jump) buttons |= 0x01;
        if (cmd.crouch) buttons |= 0x02;
        if (cmd.attack) buttons |= 0x04;
        if (cmd.altAttack) buttons |= 0x08;
        if (cmd.use) buttons |= 0x10;
        this.encoder.writeUint8(buttons);

        // Weapon
        this.encoder.writeUint8(cmd.weaponSlot);
    }
}

// ═══════════════════════════════════════════════════════════════════
// INPUT DECODER
// ═══════════════════════════════════════════════════════════════════

export interface DecodedInputBatch {
    playerId: PlayerId;
    lastAckedTick: TickNumber;
    commands: InputCommand[];
}

export class InputDecoder {
    decode(bytes: Uint8Array): DecodedInputBatch {
        const decoder = new BinaryDecoder(bytes);

        const msgType = decoder.readUint8();
        if (msgType !== MessageType.C_Input) {
            throw new Error(`Expected input message, got ${msgType}`);
        }

        const pid = playerId(decoder.readVarUint());
        const lastAckedTick = tickNumber(decoder.readUint32());
        const commandCount = decoder.readUint8();

        const commands: InputCommand[] = [];
        for (let i = 0; i < commandCount; i++) {
            commands.push(this.readCommand(decoder));
        }

        return { playerId: pid, lastAckedTick, commands };
    }

    private readCommand(decoder: BinaryDecoder): InputCommand {
        const sequence = decoder.readUint32();
        const clientTime = decoder.readFloat32();

        const forward = decoder.readInt8() / 127;
        const right = decoder.readInt8() / 127;

        const pitch = decoder.readFloat32();
        const yaw = decoder.readFloat32();

        const buttons = decoder.readUint8();
        const weaponSlot = decoder.readUint8();

        return {
            sequence,
            clientTime,
            forward,
            right,
            pitch,
            yaw,
            jump: (buttons & 0x01) !== 0,
            crouch: (buttons & 0x02) !== 0,
            attack: (buttons & 0x04) !== 0,
            altAttack: (buttons & 0x08) !== 0,
            use: (buttons & 0x10) !== 0,
            weaponSlot,
        };
    }
}

// ═══════════════════════════════════════════════════════════════════
// APPLY INPUT TO COMPONENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Apply network input command to entity's input component
 */
export function applyInputCommand(
    input: InputComponent,
    cmd: InputCommand
): void {
    input.forward = cmd.forward;
    input.right = cmd.right;
    input.pitch = cmd.pitch;
    input.yaw = cmd.yaw;
    input.jump = cmd.jump;
    input.crouch = cmd.crouch;
    input.attack = cmd.attack;
    input.altAttack = cmd.altAttack;
    input.use = cmd.use;
    input.weaponSlot = cmd.weaponSlot;
    input.sequence = cmd.sequence;
}

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE EXPORTS
// ═══════════════════════════════════════════════════════════════════

export const inputEncoder = new InputEncoder();
export const inputDecoder = new InputDecoder();
