/**
 * Network protocol and transport
 * 
 * Uses WebTransport (QUIC/UDP) for low-latency game networking.
 */

// Protocol
export { BinaryEncoder, BinaryDecoder } from './protocol/BinaryEncoder';
export {
    SnapshotEncoder,
    SnapshotDecoder,
    snapshotEncoder,
    snapshotDecoder,
    type DecodedSnapshot,
    type DecodedEntity,
} from './protocol/SnapshotProtocol';
export {
    InputEncoder,
    InputDecoder,
    inputEncoder,
    inputDecoder,
    applyInputCommand,
    type InputCommand,
    type DecodedInputBatch,
} from './protocol/InputProtocol';
export { MessageType } from './protocol/MessageTypes';

// Transport (WebTransport primary, WebSocket fallback)
export {
    WebTransportServerTransport,
    type Transport,
    type TransportConfig,
    type TransportEvents,
    type ClientConnection,
} from './transport';

// Legacy WebSocket (for fallback)
export { WebSocketServerTransport } from './transport/WebSocketTransport';

// Client Management
export { ClientManager, type ClientInfo, type ClientManagerEvents } from './ClientManager';
