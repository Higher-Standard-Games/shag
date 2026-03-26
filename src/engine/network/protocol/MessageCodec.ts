import type { GameState } from "../core/GameState";
import { type NetworkCommand, BinaryDecoder, BinaryEncoder, BinaryProtocol, MessageType } from "./BinaryProtocol";

// Re-export MessageType for convenience
export { MessageType };

/**
 * Message codec for network protocol
 * All messages are prefixed with a MessageType byte for proper routing
 */
export class MessageCodec {
  /**
   * Encode a snapshot message (Server → Client)
   * Format: [MessageType.Snapshot][tick][timestamp][entities...][players...][events...]
   */
  static encodeSnapshot(state: GameState, baseline?: GameState): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.Snapshot);
    encoder.writeBytes(BinaryProtocol.encodeSnapshot(state, baseline));
    return encoder.getData();
  }

  /**
   * Decode a snapshot message
   */
  static decodeSnapshot(data: Uint8Array, baseline?: GameState): GameState {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.Snapshot) {
      throw new Error(
        `Expected Snapshot message (0x${MessageType.Snapshot.toString(16)}), got 0x${messageType.toString(16)}`,
      );
    }
    // Read remaining bytes after message type
    const remaining = data.subarray(decoder.getOffset());
    return BinaryProtocol.decodeSnapshot(remaining, baseline);
  }

  /**
   * Encode a command/input message (Client → Server)
   * Format: [MessageType.Input][playerId][sequence][command...]
   */
  static encodeCommand(playerId: string, sequence: number, command: NetworkCommand): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.Input);
    encoder.writeBytes(BinaryProtocol.encodeCommand(playerId, sequence, command));
    return encoder.getData();
  }

  /**
   * Decode a command message
   */
  static decodeCommand(data: Uint8Array): { playerId: string; sequence: number; command: NetworkCommand } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.Input) {
      throw new Error(
        `Expected Input message (0x${MessageType.Input.toString(16)}), got 0x${messageType.toString(16)}`,
      );
    }
    const remaining = data.subarray(decoder.getOffset());
    return BinaryProtocol.decodeCommand(remaining);
  }

  /**
   * Encode a welcome message (Server → Client on connect)
   */
  static encodeWelcome(
    serverId: string,
    serverName: string,
    map: string,
    tickRate: number,
    maxPlayers: number,
    currentPlayers: number,
  ): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.Welcome);
    encoder.writeString(serverId);
    encoder.writeString(serverName);
    encoder.writeString(map);
    encoder.writeUint8(tickRate);
    encoder.writeUint8(maxPlayers);
    encoder.writeUint8(currentPlayers);
    return encoder.getData();
  }

  /**
   * Decode a welcome message
   */
  static decodeWelcome(data: Uint8Array): {
    serverId: string;
    serverName: string;
    map: string;
    tickRate: number;
    maxPlayers: number;
    currentPlayers: number;
  } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.Welcome) {
      throw new Error(`Expected Welcome message, got 0x${messageType.toString(16)}`);
    }
    return {
      serverId: decoder.readString(),
      serverName: decoder.readString(),
      map: decoder.readString(),
      tickRate: decoder.readUint8(),
      maxPlayers: decoder.readUint8(),
      currentPlayers: decoder.readUint8(),
    };
  }

  /**
   * Encode a join message (Client → Server)
   */
  static encodeJoin(playerName: string): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.Join);
    encoder.writeString(playerName);
    return encoder.getData();
  }

  /**
   * Decode a join message
   */
  static decodeJoin(data: Uint8Array): { playerName: string } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.Join) {
      throw new Error(`Expected Join message, got 0x${messageType.toString(16)}`);
    }
    return {
      playerName: decoder.readString(),
    };
  }

  /**
   * Encode a join accept message (Server → Client)
   */
  static encodeJoinAccept(clientId: string, playerId: string, entityId: string): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.JoinAccept);
    encoder.writeString(clientId);
    encoder.writeString(playerId);
    encoder.writeString(entityId);
    return encoder.getData();
  }

  /**
   * Decode a join accept message
   */
  static decodeJoinAccept(data: Uint8Array): { clientId: string; playerId: string; entityId: string } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.JoinAccept) {
      throw new Error(`Expected JoinAccept message, got 0x${messageType.toString(16)}`);
    }
    return {
      clientId: decoder.readString(),
      playerId: decoder.readString(),
      entityId: decoder.readString(),
    };
  }

  /**
   * Encode acknowledgment message (Client → Server)
   */
  static encodeAck(tick: number): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.Ack);
    encoder.writeUint32(tick);
    return encoder.getData();
  }

  /**
   * Decode acknowledgment message
   */
  static decodeAck(data: Uint8Array): { tick: number } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.Ack) {
      throw new Error(`Expected Ack message, got 0x${messageType.toString(16)}`);
    }
    return {
      tick: decoder.readUint32(),
    };
  }

  /**
   * Encode a ready message (Client → Server)
   * Simple 1-byte message — the server identifies the sender by connection.
   */
  static encodeReady(): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.Ready);
    return encoder.getData();
  }

  /**
   * Get message type from raw data without consuming it
   */
  static peekMessageType(data: Uint8Array): MessageType {
    if (data.length === 0) {
      throw new Error("Empty message data");
    }
    return data[0] as MessageType;
  }

  /**
   * Encode a JoinGame message (Client → Server)
   * Sent when spectator wants to enter the game.
   */
  static encodeJoinGame(teamId?: string): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.JoinGame);
    if (teamId) {
      encoder.writeUint8(1);
      encoder.writeString(teamId);
    } else {
      encoder.writeUint8(0);
    }
    return encoder.getData();
  }

  /**
   * Decode a JoinGame message
   */
  static decodeJoinGame(data: Uint8Array): { teamId?: string } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.JoinGame) {
      throw new Error(`Expected JoinGame message, got 0x${messageType.toString(16)}`);
    }
    const hasTeamId = decoder.readUint8() === 1;
    return {
      teamId: hasTeamId ? decoder.readString() : undefined,
    };
  }

  /**
   * Encode a Spectate message (Client → Server)
   * Sent when player wants to leave game and become spectator.
   * Simple 1-byte message — server identifies sender by connection.
   */
  static encodeSpectate(): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.Spectate);
    return encoder.getData();
  }

  /**
   * Encode a RequestSpawn message (Client → Server)
   * Sent when dead player wants to respawn (after cooldown).
   * Simple 1-byte message — server identifies sender by connection.
   */
  static encodeRequestSpawn(): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.RequestSpawn);
    return encoder.getData();
  }

  // ── ClockSync: Ping / Pong ───────────────────────────────

  /**
   * Encode a ping message (Client → Server)
   * Format: [MessageType.Ping][clientSendTime: float64]
   */
  static encodePing(clientSendTime: number): Uint8Array {
    const encoder = new BinaryEncoder(16);
    encoder.writeUint8(MessageType.Ping);
    encoder.writeFloat64(clientSendTime);
    return encoder.getData();
  }

  /**
   * Decode a ping message
   */
  static decodePing(data: Uint8Array): { clientSendTime: number } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.Ping) {
      throw new Error(`Expected Ping message (0x${MessageType.Ping.toString(16)}), got 0x${messageType.toString(16)}`);
    }
    return {
      clientSendTime: decoder.readFloat64(),
    };
  }

  /**
   * Encode a pong message (Server → Client)
   * Format: [MessageType.Pong][clientSendTime: float64][serverTime: float64]
   */
  static encodePong(clientSendTime: number, serverTime: number): Uint8Array {
    const encoder = new BinaryEncoder(24);
    encoder.writeUint8(MessageType.Pong);
    encoder.writeFloat64(clientSendTime);
    encoder.writeFloat64(serverTime);
    return encoder.getData();
  }

  /**
   * Decode a pong message
   */
  static decodePong(data: Uint8Array): { clientSendTime: number; serverTime: number } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.Pong) {
      throw new Error(`Expected Pong message (0x${MessageType.Pong.toString(16)}), got 0x${messageType.toString(16)}`);
    }
    return {
      clientSendTime: decoder.readFloat64(),
      serverTime: decoder.readFloat64(),
    };
  }
}
