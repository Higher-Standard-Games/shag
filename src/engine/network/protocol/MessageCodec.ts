import { StateEncoder } from './StateEncoder';
import { StateDecoder } from './StateDecoder';
import { GameState } from '../core/GameState';

/**
 * Message codec for encoding/decoding network messages
 * Handles different message types with appropriate serialization
 */
export class MessageCodec {
  /**
   * Encode a message to binary format
   */
  static encode(message: NetworkMessage): Uint8Array {
    const encoder = new StateEncoder();
    
    // Write message type
    encoder.writeUint8(message.type);
    
    // Encode message based on type
    switch (message.type) {
      case MessageType.Snapshot:
        return this.encodeSnapshot(message as SnapshotMessage, encoder);
      
      case MessageType.Command:
        return this.encodeCommand(message as CommandMessage, encoder);
      
      case MessageType.Event:
        return this.encodeEvent(message as EventMessage, encoder);
      
      case MessageType.Ack:
        return this.encodeAck(message as AckMessage, encoder);
      
      case MessageType.Join:
        return this.encodeJoin(message as JoinMessage, encoder);
      
      case MessageType.Leave:
        return this.encodeLeave(message as LeaveMessage, encoder);
      
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }
  
  /**
   * Decode a message from binary format
   */
  static decode(data: Uint8Array): NetworkMessage {
    const decoder = new StateDecoder(data);
    const messageType = decoder.readUint8() as MessageType;
    
    // Decode message based on type
    switch (messageType) {
      case MessageType.Snapshot:
        return this.decodeSnapshot(decoder);
      
      case MessageType.Command:
        return this.decodeCommand(decoder);
      
      case MessageType.Event:
        return this.decodeEvent(decoder);
      
      case MessageType.Ack:
        return this.decodeAck(decoder);
      
      case MessageType.Join:
        return this.decodeJoin(decoder);
      
      case MessageType.Leave:
        return this.decodeLeave(decoder);
      
      default:
        throw new Error(`Unknown message type: ${messageType}`);
    }
  }
  
  private static encodeSnapshot(message: SnapshotMessage, encoder: StateEncoder): Uint8Array {
    // Write tick
    encoder.writeUint32(message.tick);
    
    // Encode state
    const stateData = encoder.encode(message.state);
    
    // Combine header and state data
    const result = new Uint8Array(1 + 4 + stateData.length);
    result[0] = MessageType.Snapshot;
    new DataView(result.buffer).setUint32(1, message.tick, true);
    result.set(stateData, 5);
    
    return result;
  }
  
  private static encodeCommand(message: CommandMessage, encoder: StateEncoder): Uint8Array {
    // Write player ID
    encoder.writeString(message.playerId);
    
    // Write sequence
    encoder.writeUint16(message.sequence);
    
    // Write command data
    const commandData = JSON.stringify(message.command);
    encoder.writeString(commandData);
    
    return encoder.getBuffer();
  }
  
  private static encodeEvent(message: EventMessage, encoder: StateEncoder): Uint8Array {
    // Write event type
    encoder.writeString(message.event.type);
    
    // Write event data
    const eventData = JSON.stringify(message.event);
    encoder.writeString(eventData);
    
    return encoder.getBuffer();
  }
  
  private static encodeAck(message: AckMessage, encoder: StateEncoder): Uint8Array {
    // Write tick
    encoder.writeUint32(message.tick);
    
    return encoder.getBuffer();
  }
  
  private static encodeJoin(message: JoinMessage, encoder: StateEncoder): Uint8Array {
    // Write player ID
    encoder.writeString(message.playerId);
    
    // Write display name
    encoder.writeString(message.displayName);
    
    return encoder.getBuffer();
  }
  
  private static encodeLeave(message: LeaveMessage, encoder: StateEncoder): Uint8Array {
    // Write player ID
    encoder.writeString(message.playerId);
    
    // Write reason
    encoder.writeString(message.reason || '');
    
    return encoder.getBuffer();
  }
  
  private static decodeSnapshot(decoder: StateDecoder): SnapshotMessage {
    const tick = decoder.readUint32();
    const state = decoder.decode();
    
    return {
      type: MessageType.Snapshot,
      tick,
      state
    };
  }
  
  private static decodeCommand(decoder: StateDecoder): CommandMessage {
    const playerId = decoder.readString();
    const sequence = decoder.readUint16();
    const command = JSON.parse(decoder.readString());
    
    return {
      type: MessageType.Command,
      playerId,
      sequence,
      command
    };
  }
  
  private static decodeEvent(decoder: StateDecoder): EventMessage {
    const eventType = decoder.readString();
    const eventData = JSON.parse(decoder.readString());
    
    return {
      type: MessageType.Event,
      event: {
        type: eventType,
        ...eventData
      }
    };
  }
  
  private static decodeAck(decoder: StateDecoder): AckMessage {
    const tick = decoder.readUint32();
    
    return {
      type: MessageType.Ack,
      tick
    };
  }
  
  private static decodeJoin(decoder: StateDecoder): JoinMessage {
    const playerId = decoder.readString();
    const displayName = decoder.readString();
    
    return {
      type: MessageType.Join,
      playerId,
      displayName
    };
  }
  
  private static decodeLeave(decoder: StateDecoder): LeaveMessage {
    const playerId = decoder.readString();
    const reason = decoder.readString() || undefined;
    
    return {
      type: MessageType.Leave,
      playerId,
      reason
    };
  }
}

// Message types
export enum MessageType {
  Snapshot = 0x01,
  Command = 0x02,
  Event = 0x03,
  Ack = 0x04,
  Join = 0x05,
  Leave = 0x06,
  Error = 0x07
}

// Message interfaces
export interface NetworkMessage {
  type: MessageType;
}

export interface SnapshotMessage extends NetworkMessage {
  type: MessageType.Snapshot;
  tick: number;
  state: GameState;
}

export interface CommandMessage extends NetworkMessage {
  type: MessageType.Command;
  playerId: string;
  sequence: number;
  command: any;
}

export interface EventMessage extends NetworkMessage {
  type: MessageType.Event;
  event: any;
}

export interface AckMessage extends NetworkMessage {
  type: MessageType.Ack;
  tick: number;
}

export interface JoinMessage extends NetworkMessage {
  type: MessageType.Join;
  playerId: string;
  displayName: string;
}

export interface LeaveMessage extends NetworkMessage {
  type: MessageType.Leave;
  playerId: string;
  reason?: string;
}

export interface ErrorMessage extends NetworkMessage {
  type: MessageType.Error;
  code: number;
  message: string;
}
