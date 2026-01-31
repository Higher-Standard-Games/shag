/**
 * Network protocol and transport
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

// Transport
export {
    WebSocketTransport,
    type Transport,
    type TransportConfig,
    type TransportEvents,
    type ClientConnection,
} from './transport';

// Client Management
export { ClientManager, type ClientInfo, type ClientManagerEvents } from './ClientManager';
