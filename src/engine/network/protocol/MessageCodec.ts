import type { GameState } from "../core/GameState";
import { BinaryDecoder, BinaryEncoder, BinaryProtocol, MessageType, type NetworkCommand } from "./BinaryProtocol";

// Re-export MessageType for convenience
export { MessageType };

export class MissingSnapshotBaselineError extends Error {
  constructor(readonly baselineTick: number) {
    super(`Missing snapshot baseline ${baselineTick}`);
    this.name = "MissingSnapshotBaselineError";
  }
}

export interface SnapshotHeader {
  tick: number;
  /** null means a self-contained full snapshot; tick zero is a valid baseline. */
  baselineTick: number | null;
}

const SNAPSHOT_HEADER_BYTES = 6; // type + full/delta byte + baseline tick

/**
 * Message codec for network protocol
 * All messages are prefixed with a MessageType byte for proper routing
 */
export class MessageCodec {
  /**
   * Encode a snapshot message (Server → Client)
   * Format: [Snapshot=0x0b][hasBaseline:u8][baselineTick:u32][raw snapshot]
   * A distinct message type keeps pre-baseline peers from misreading the header.
   * BinaryProtocol's raw format is deliberately unchanged for recorded demos.
   */
  static encodeSnapshot(state: GameState, baseline?: GameState): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.Snapshot);
    encoder.writeUint8(baseline ? 1 : 0);
    encoder.writeUint32(baseline?.tick ?? 0);
    encoder.writeBytes(BinaryProtocol.encodeSnapshot(state, baseline));
    return encoder.getData();
  }

  /**
   * Read the dependency identity before attempting component reconstruction.
   */
  static readSnapshotHeader(data: Uint8Array): SnapshotHeader {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType === MessageType.LegacySnapshot) {
      throw new Error("Unsupported legacy network snapshot: update server and clients together");
    }
    if (messageType !== MessageType.Snapshot) {
      throw new Error(
        `Expected Snapshot message (0x${MessageType.Snapshot.toString(16)}), got 0x${messageType.toString(16)}`,
      );
    }
    const hasBaseline = decoder.readUint8();
    const baselineTick = decoder.readUint32();
    if (hasBaseline > 1 || (hasBaseline === 0 && baselineTick !== 0)) {
      throw new Error("Invalid snapshot baseline header");
    }
    return { tick: decoder.readUint32(), baselineTick: hasBaseline ? baselineTick : null };
  }

  static decodeSnapshot(data: Uint8Array, baselines?: GameState | ReadonlyMap<number, GameState>): GameState {
    const header = MessageCodec.readSnapshotHeader(data);
    let baseline: GameState | undefined;
    if (header.baselineTick !== null) {
      baseline = baselines && "tick" in baselines ? baselines : baselines?.get(header.baselineTick);
      if (!baseline || baseline.tick !== header.baselineTick) {
        throw new MissingSnapshotBaselineError(header.baselineTick);
      }
    }
    // Full snapshots ignore any supplied history, including stale grounded and
    // rotation values. Never decode a delta against an arbitrary latest state.
    return BinaryProtocol.decodeSnapshot(data.subarray(SNAPSHOT_HEADER_BYTES), baseline);
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
  static encodeJoin(playerName: string, isBot = false): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.Join);
    encoder.writeString(playerName);
    // Trailing bot flag — optional so older clients (no byte) still decode.
    encoder.writeUint8(isBot ? 1 : 0);
    return encoder.getData();
  }

  /**
   * Decode a join message. The bot flag is optional for backward compatibility
   * with clients that predate it (absent byte → human).
   */
  static decodeJoin(data: Uint8Array): { playerName: string; isBot: boolean } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.Join) {
      throw new Error(`Expected Join message, got 0x${messageType.toString(16)}`);
    }
    const playerName = decoder.readString();
    const isBot = decoder.hasMore() ? decoder.readUint8() !== 0 : false;
    return { playerName, isBot };
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
  static encodeJoinGame(teamId?: string, manualPick = false): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.JoinGame);
    if (teamId) {
      // Widens the old has-team flag rather than adding a byte: 1 is a side the
      // LOBBY assigned, 2 is one the player picked in-game. The server balances
      // only the second — a lobby has already balanced its roster, and judging
      // its players one at a time as they trickle in rejects the very
      // assignment being delivered. An older client sends 1, which reads as
      // lobby-assigned, so it keeps the more permissive behaviour.
      encoder.writeUint8(manualPick ? 2 : 1);
      encoder.writeString(teamId);
    } else {
      encoder.writeUint8(0);
    }
    return encoder.getData();
  }

  /**
   * Decode a JoinGame message
   */
  static decodeJoinGame(data: Uint8Array): { teamId?: string; manualPick: boolean } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.JoinGame) {
      throw new Error(`Expected JoinGame message, got 0x${messageType.toString(16)}`);
    }
    const teamFlag = decoder.readUint8();
    return {
      teamId: teamFlag > 0 ? decoder.readString() : undefined,
      manualPick: teamFlag === 2,
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

  /**
   * Encode a SetLoadout message (Client → Server)
   *
   * The chosen spawn kit, as weapon ids. Sent whenever the player changes it,
   * not per round — the server decides when it takes effect (next round), so a
   * client that spams this gains nothing.
   * Format: [MessageType.SetLoadout][primary: string][secondary: string]
   */
  static encodeSetLoadout(primary: string, secondary: string): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.SetLoadout);
    encoder.writeString(primary);
    encoder.writeString(secondary);
    return encoder.getData();
  }

  /** Decode a SetLoadout message. Validation is the gametype's job, not ours. */
  static decodeSetLoadout(data: Uint8Array): { primary: string; secondary: string } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.SetLoadout) {
      throw new Error(`Expected SetLoadout message, got 0x${messageType.toString(16)}`);
    }
    return { primary: decoder.readString(), secondary: decoder.readString() };
  }

  /**
   * Encode a Chat message (Client → Server)
   * Sender is identified by connection; the server sanitizes, rate-limits,
   * and rebroadcasts the text as a `chat` snapshot event (which also lands
   * in demo recordings). Format: [MessageType.Chat][text: string]
   */
  static encodeChat(text: string): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.Chat);
    encoder.writeString(text);
    return encoder.getData();
  }

  /**
   * Decode a Chat message
   */
  static decodeChat(data: Uint8Array): { text: string } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.Chat) {
      throw new Error(`Expected Chat message, got 0x${messageType.toString(16)}`);
    }
    return { text: decoder.readString() };
  }

  /**
   * Encode a ServerMessage (Server → Client)
   * Generic text message for UI notifications (queue position, join rejection, etc.)
   * Format: [MessageType.ServerMessage][type: string][message: string]
   */
  static encodeServerMessage(message: string, type: string = "info"): Uint8Array {
    const encoder = new BinaryEncoder();
    encoder.writeUint8(MessageType.ServerMessage);
    encoder.writeString(type);
    encoder.writeString(message);
    return encoder.getData();
  }

  /**
   * Decode a ServerMessage
   */
  static decodeServerMessage(data: Uint8Array): { type: string; message: string } {
    const decoder = new BinaryDecoder(data);
    const messageType = decoder.readUint8();
    if (messageType !== MessageType.ServerMessage) {
      throw new Error(`Expected ServerMessage, got 0x${messageType.toString(16)}`);
    }
    return {
      type: decoder.readString(),
      message: decoder.readString(),
    };
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
